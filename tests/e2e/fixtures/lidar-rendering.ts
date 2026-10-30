import { Map as LibreMap, MercatorCoordinate, type CustomLayerInterface } from 'maplibre-gl'
import { buildingMeshLayer } from '../../../src/pages/dev-lidar/buildingMesh'
import { treePointLayer, type PointAppearance } from '../../../src/pages/dev-lidar/treePointLayer'
import { coloredVertexLayer } from '../../../src/pages/dev-lidar/coloredVertexLayer'
import type { BuildingModel } from '../../../src/pages/dev-lidar/analysisWorkflows'
import type { TreeCrop } from '../../../src/pages/dev-lidar/treeIsolation'
import { pointKey } from '../../../src/pages/dev-lidar/treeInspection'

// Synthetic inputs exercise production vertex conversion and shaders without
// downloading point clouds, geometry products, tiles or generated snapshots.
const center: [number, number] = [-122.75, 53.92]
const origin = MercatorCoordinate.fromLngLat(center)
const unit = origin.meterInMercatorCoordinateUnits()
function geographic(x: number, y: number): [number, number] {
  const point = new MercatorCoordinate(origin.x + x * unit, origin.y + y * unit).toLngLat()
  return [point.lng, point.lat]
}
const model: BuildingModel = {
  id: 'browser-roof',
  centre: center,
  area_m2: 72,
  ground_m: 100,
  success: true,
  mode: 'test',
  rmse_m: null,
  roof_planes: 1,
  roof_type: 'flat',
  closed_edge_incidence: false,
  nonmanifold_edges: 0,
  facets: [],
  triangles: [
    {
      kind: 'RoofSurface',
      vertices: [
        [-6, -6],
        [6, -6],
        [0, 6],
      ].map(([x, y]) => [...geographic(x, y), 102] as [number, number, number]),
    },
  ],
}
const crop: TreeCrop = {
  id: 'tree-1',
  centre: center,
  ground_m: 100,
  loaded_points: 3,
  loaded_nodes: 1,
  available_nodes: 1,
  budget_limited: false,
  withheld_filtered: true,
  source_sha256: 'synthetic',
  points: [-3, 0, 3].map((x, index) => {
    const [lon, lat] = geographic(x, 0)
    return { lon, lat, z: 120, height: 20, classification: 5, node: '0-0-0-0', index }
  }),
}
const scale = 1 / (8 * unit)
// Deliberately retain a nonzero geographic origin. The shared renderer must
// apply its local-origin translation before converting the matrix to Float32.
const projection = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale / 4, 0, -scale * origin.x, -scale * origin.y, 0, 1]
type RenderArgs = Parameters<CustomLayerInterface['render']>[1]
const renderArgs = (modern: boolean) =>
  (modern
    ? { defaultProjectionData: { mainMatrix: projection } }
    : { modelViewProjectionMatrix: projection }) as unknown as RenderArgs

function canvasContext() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  document.getElementById('direct')!.replaceChildren(canvas)
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false })
  if (!gl) throw new Error('The rendering regression requires a real WebGL2 context')
  return { canvas, gl }
}
function clear(gl: WebGL2RenderingContext) {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.clearColor(1, 1, 1, 1)
  gl.clearDepth(1)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
}
function pixels(gl: WebGL2RenderingContext) {
  gl.finish()
  const width = gl.drawingBufferWidth,
    height = gl.drawingBufferHeight
  const data = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
  const sample = (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4))
  let coloredPixels = 0
  for (let i = 0; i < data.length; i += 4) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) coloredPixels++
  return {
    center: sample(Math.floor(width / 2), Math.floor(height / 2)),
    outside: sample(4, 4),
    pointCorner: sample(Math.floor(width / 2) + 4, Math.floor(height / 2) + 4),
    coloredPixels,
    error: gl.getError(),
    version: gl.getParameter(gl.VERSION) as string,
  }
}

/** Observe actual allocated resources without replacing any WebGL operations. */
function resources(gl: WebGL2RenderingContext) {
  const programs: WebGLProgram[] = [],
    buffers: WebGLBuffer[] = [],
    arrays: WebGLVertexArrayObject[] = [],
    shaders: WebGLShader[] = []
  const tracked = new Proxy(gl, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args)
        if (result) {
          if (property === 'createProgram') programs.push(result)
          if (property === 'createBuffer') buffers.push(result)
          if (property === 'createVertexArray') arrays.push(result)
          if (property === 'createShader') shaders.push(result)
        }
        return result
      }
    },
  })
  const live = () => ({
    programs: programs.filter((value) => gl.isProgram(value)).length,
    buffers: buffers.filter((value) => gl.isBuffer(value)).length,
    arrays: arrays.filter((value) => gl.isVertexArray(value)).length,
    shaders: shaders.filter((value) => gl.isShader(value)).length,
  })
  const deletionRequested = () =>
    programs.every((value) => !gl.isProgram(value) || gl.getProgramParameter(value, gl.DELETE_STATUS)) &&
    shaders.every((value) => !gl.isShader(value) || gl.getShaderParameter(value, gl.DELETE_STATUS))
  return { tracked, live, deletionRequested }
}
function draw(layer: CustomLayerInterface, gl: WebGL2RenderingContext, modern = true) {
  layer.onAdd?.({} as LibreMap, gl)
  clear(gl)
  layer.render(gl, renderArgs(modern))
  return pixels(gl)
}

async function roof(modern = true) {
  const { gl } = canvasContext(),
    layer = buildingMeshLayer(model, model.ground_m)
  const result = draw(layer, gl, modern)
  layer.onRemove?.({} as LibreMap, gl)
  return result
}
async function points(appearance: PointAppearance = {}) {
  const { gl } = canvasContext(),
    layer = treePointLayer(crop, appearance)
  const result = draw(layer, gl)
  layer.onRemove?.({} as LibreMap, gl)
  return result
}
async function lifecycle() {
  const layer = buildingMeshLayer(model, model.ground_m)
  const first = canvasContext(),
    observed = resources(first.gl)
  const before = draw(layer, observed.tracked)
  const active = observed.live()
  layer.onRemove?.({} as LibreMap, observed.tracked)
  const deletionRequested = observed.deletionRequested()
  // Native GL defers deletion of the current program (and its attached
  // shaders) until another renderer binds a program. Simulate that handoff.
  first.gl.useProgram(null)
  const released = observed.live()
  clear(first.gl)
  layer.render(observed.tracked, renderArgs(true))
  const afterRemoval = pixels(first.gl)
  // Reuse the same production layer object with a different browser context.
  const second = canvasContext(),
    next = resources(second.gl)
  const replacement = draw(layer, next.tracked, false)
  layer.onRemove?.({} as LibreMap, next.tracked)
  layer.onRemove?.({} as LibreMap, next.tracked)
  second.gl.useProgram(null)
  return { before, active, deletionRequested, released, afterRemoval, replacement, replacementReleased: next.live() }
}
async function failedSetup(linkFailure: boolean) {
  const { gl } = canvasContext(),
    observed = resources(gl)
  const layer = coloredVertexLayer({
    id: 'shader-failure-regression',
    origin: [0, 0],
    vertices: new Float32Array(18),
    primitive: 'triangles',
    vertexShader:
      '#version 300 es\nin vec3 position; in vec3 color; out vec3 tint; void main(){gl_Position=vec4(position,1.0);tint=color;}',
    fragmentShader: linkFailure
      ? '#version 300 es\nprecision highp float; in vec4 tint; out vec4 result; void main(){result=tint;}'
      : '#version 300 es\nTHIS IS DELIBERATELY INVALID GLSL',
  })
  let message = ''
  try {
    layer.onAdd?.({} as LibreMap, observed.tracked)
  } catch (error) {
    message = String(error)
  }
  layer.onRemove?.({} as LibreMap, observed.tracked)
  return { message, live: observed.live(), error: gl.getError() }
}

let map: LibreMap | undefined
async function mapIntegration() {
  map?.remove()
  map = new LibreMap({
    container: 'map',
    center,
    zoom: 18,
    pitch: 0,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: false },
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }],
    },
  })
  await map.once('load')
  const current = map
  const gl = current.getCanvas().getContext('webgl2')!
  current.addLayer(buildingMeshLayer(model, model.ground_m))
  await current.once('idle')
  const building = pixels(gl)
  current.removeLayer('analysis-building-model')
  current.triggerRepaint()
  await current.once('idle')
  const removed = pixels(gl)
  current.addLayer(treePointLayer(crop, { picked: pointKey(crop.points[1]), pointSize: 3 }))
  await current.once('idle')
  const tree = pixels(gl)
  return {
    building,
    removed,
    tree,
    hasTreeLayer: !!current.getLayer('analysis-tree-points'),
    canvasWidth: gl.drawingBufferWidth,
  }
}

export interface LidarRenderingHarness {
  roof: typeof roof
  points: typeof points
  lifecycle: typeof lifecycle
  failedSetup: typeof failedSetup
  mapIntegration: typeof mapIntegration
  pickedKey: string
}
Object.assign(window, {
  lidarRendering: {
    roof,
    points,
    lifecycle,
    failedSetup,
    mapIntegration,
    pickedKey: pointKey(crop.points[1]),
  } satisfies LidarRenderingHarness,
})
