/** Lazy WebGL2 presentation of the existing engineering scene. No terrain fetches or calculations. */
import * as THREE from 'three'
import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'
import { UNFINISHED_BATTER_COLOUR } from './previewEarthwork'
import { terrainElevationColor, terrainSlopeColor } from './terrainDisplay'
import { TERRAIN_SHARPEN_DELAY_MS, terrainRenderSize } from './terrainRenderQuality'
import { prepareTerrainGpuTexture } from './terrainGpuTexture'
import type { TerrainGpuData, TerrainGpuHandle, TerrainGpuView } from './terrainGpuTypes'
import { slopeTextureUv, type TerrainSlopeTexture } from './terrainSlopeTexture'

/** Ground with no colour scheme of its own (Plain), and under an orthophoto's transparent pixels. */
const PLAIN_GROUND: [number, number, number] = [151, 170, 137]
const ESTIMATED_TINT = new THREE.Color('#d6b783')
/** Vertex indices by exact position: x, then y, then z. Numbers are looked up as numbers; no text key is built. */
type PositionIndex = Map<number, Map<number, Map<number, number>>>
const indexAt = (positions: PositionIndex, v: TerrainVertex) => positions.get(v.x)?.get(v.y)?.get(v.z)
function setIndexAt(positions: PositionIndex, v: TerrainVertex, index: number) {
  let ys = positions.get(v.x)
  if (!ys) positions.set(v.x, (ys = new Map()))
  let zs = ys.get(v.y)
  if (!zs) ys.set(v.y, (zs = new Map()))
  zs.set(v.z, index)
}

/**
 * Smooth only natural ground. Design triangles keep their exact coordinates and hard breaklines.
 *
 * Vertices are shared where their positions are exactly equal (and both estimated or both measured), so the ground is
 * lit smoothly. The mesh builders share one vertex object between the faces that meet at it, so an object already seen
 * is found by identity first; a new object is found by its position's numbers.
 */
export function groundGeometry(data: TerrainGpuData) {
  // Measured vertices, then estimated ones: an estimated patch's edge keeps vertices of its own.
  const byPosition: [PositionIndex, PositionIndex] = [new Map(), new Map()]
  const seen = [new Map<TerrainVertex, number>(), new Map<TerrainVertex, number>()]
  const positions: number[] = [],
    indices: number[] = [],
    estimated: number[] = []
  for (const face of data.ground) {
    const flag = !!face.estimated
    const known = seen[flag ? 1 : 0]
    const shared = byPosition[flag ? 1 : 0]
    const ids = face.vertices.map((v) => {
      const same = known.get(v)
      if (same !== undefined) return same
      let index = indexAt(shared, v)
      if (index === undefined) {
        index = positions.length / 3
        setIndexAt(shared, v, index)
        positions.push(v.x, v.y, v.z - data.originZ)
        estimated.push(flag ? 1 : 0)
      }
      known.set(v, index)
      return index
    })
    for (let i = 1; i + 1 < ids.length; i++) {
      const a = face.vertices[0],
        b = face.vertices[i],
        c = face.vertices[i + 1]
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) indices.push(ids[0], ids[i + 1], ids[i])
      else indices.push(ids[0], ids[i], ids[i + 1])
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')
  const colors = new Float32Array(positions.length)
  const uv = data.ortho && data.imagePoint ? new Float32Array((positions.length / 3) * 2) : null
  const color = new THREE.Color()
  for (let i = 0; i < positions.length / 3; i++) {
    const slope = (Math.atan2(Math.hypot(normal.getX(i), normal.getY(i)), Math.abs(normal.getZ(i))) * 180) / Math.PI
    const rgb =
      data.colour === 'slope'
        ? terrainSlopeColor(slope)
        : data.colour === 'elevation'
          ? terrainElevationColor(positions[i * 3 + 2] + data.originZ, data.low, data.high)
          : data.colour === 'ortho'
            ? [255, 255, 255]
            : PLAIN_GROUND
    color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
    if (estimated[i]) color.lerp(ESTIMATED_TINT, 0.3)
    color.toArray(colors, i * 3)
    if (uv) {
      const [u, v] = data.imagePoint!(positions[i * 3], positions[i * 3 + 1])
      uv[i * 2] = u
      uv[i * 2 + 1] = v
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (uv) geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  /** The colour this mesh gives a ground vertex, so a skirt hung from it matches the ground above. */
  const colourAt = (v: TerrainVertex): [number, number, number] | null => {
    const index = indexAt(byPosition[0], v) ?? indexAt(byPosition[1], v)
    return index === undefined ? null : [colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2]]
  }
  return { geometry, colourAt }
}

/**
 * A vertical face hanging `depth` metres below each edge where the cut ground ends on the design footprint, as terrain
 * renderers hang skirts at tile edges: a gap left between the ground and the design then shows ground, not the page.
 * Each face takes the colour of the ground at its top edge (`colourAt`, else plain ground) and, over an orthophoto,
 * the image's colour there. Positions are in the upload frame (`originZ` removed); flat normals face sideways.
 */
export function terrainSkirtGeometry(
  edges: readonly { a: TerrainVertex; b: TerrainVertex }[],
  depth: number,
  originZ: number,
  colourAt: (v: TerrainVertex) => [number, number, number] | null = () => null,
  imagePoint?: (x: number, y: number) => [number, number],
) {
  const positions: number[] = [],
    colors: number[] = [],
    uv: number[] = []
  const plain = new THREE.Color().setRGB(
    PLAIN_GROUND[0] / 255,
    PLAIN_GROUND[1] / 255,
    PLAIN_GROUND[2] / 255,
    THREE.SRGBColorSpace,
  )
  for (const { a, b } of edges) {
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) continue
    if (a.x === b.x && a.y === b.y) continue
    const top = [a, b].map((v) => {
      const colour = colourAt(v)
      return { v, colour: colour ?? [plain.r, plain.g, plain.b] }
    })
    const corners = [
      { ...top[0], z: a.z },
      { ...top[1], z: b.z },
      { ...top[1], z: b.z - depth },
      { ...top[0], z: a.z - depth },
    ]
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const { v, colour, z } = corners[k]
      positions.push(v.x, v.y, z - originZ)
      colors.push(...colour)
      if (imagePoint) uv.push(...imagePoint(v.x, v.y))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  if (imagePoint) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.computeVertexNormals()
  return geometry
}

/** Texture coordinates of each vertex in `position` (x and y in the scene's plan metres) on a slope texture. */
export function slopeTextureUvAttribute(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  texture: TerrainSlopeTexture,
) {
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const [u, v] = slopeTextureUv(texture, position.getX(i), position.getY(i))
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  return new THREE.BufferAttribute(uv, 2)
}

/** The slope texture as the GPU takes it: sRGB bytes, rows north to south at v = 0 to 1, filtered and mipmapped. */
export function slopeDataTexture(texture: TerrainSlopeTexture, maxAnisotropy = 1) {
  const map = new THREE.DataTexture(texture.rgba, texture.width, texture.height, THREE.RGBAFormat)
  map.colorSpace = THREE.SRGBColorSpace
  map.magFilter = THREE.LinearFilter
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.generateMipmaps = true
  map.anisotropy = Math.min(8, maxAnisotropy)
  map.needsUpdate = true
  return map
}

/**
 * Ground coloured by a slope texture where it has one, and by its vertex colour everywhere else: before the texture
 * is ready, outside its bounds and where its slope is unknown (alpha 0), so an estimated patch keeps its tint. Unknown
 * texels are all zero bytes, so a filtered sample is in effect premultiplied by its alpha: the texture is laid over
 * the vertex colour as `vertex * (1 - a) + texture`, which leaves no dark fringe at the edge of known ground. Lighting
 * still comes from the mesh's normals.
 */
export const SLOPE_TEXTURE_FRAGMENT = `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor *= vColor;
#endif
#ifdef USE_MAP
  vec4 slopeTexel = texture2D( map, vMapUv );
  float slopeCovered = step( 0.0, vMapUv.x ) * step( vMapUv.x, 1.0 ) * step( 0.0, vMapUv.y ) * step( vMapUv.y, 1.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 1.0 - slopeTexel.a ) + slopeTexel.rgb, slopeCovered );
#endif
`

/** Install the slope texture's shader on a ground or skirt material. With no map set it draws vertex colours alone. */
export function withSlopeTextureShader(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', SLOPE_TEXTURE_FRAGMENT)
  }
  material.customProgramCacheKey = () => 'terrain-slope-texture'
}

function facesGeometry(faces: TerrainFace[], originZ: number) {
  const positions: number[] = [],
    colors: number[] = [],
    stations: number[] = []
  const color = new THREE.Color()
  for (const face of faces) {
    color.set(face.fill || '#b5916a')
    for (let i = 1; i + 1 < face.vertices.length; i++)
      for (const v of [face.vertices[0], face.vertices[i], face.vertices[i + 1]]) {
        positions.push(v.x, v.y, v.z - originZ)
        colors.push(color.r, color.g, color.b)
        stations.push(face.station ?? NaN)
      }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('station', new THREE.Float32BufferAttribute(stations, 1))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The formation's own mesh lines, as the canvas preview strokes them: each road face between two stations and each
 * batter strip, once an edge however many faces share it. Lifted a little, like the centreline, to stay over the faces.
 */
function faceEdgesGeometry(faces: TerrainFace[], originZ: number) {
  const positions: number[] = []
  const seen = new Set<string>()
  const key = (v: { x: number; y: number; z: number }) =>
    `${Math.round(v.x * 100)}:${Math.round(v.y * 100)}:${Math.round(v.z * 100)}`
  for (const face of faces)
    for (let i = 0, j = face.vertices.length - 1; i < face.vertices.length; j = i++) {
      const a = face.vertices[j],
        b = face.vertices[i]
      const ka = key(a),
        kb = key(b)
      if (ka === kb) continue
      const edge = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      if (seen.has(edge)) continue
      seen.add(edge)
      positions.push(a.x, a.y, a.z - originZ + EDGE_LIFT_M, b.x, b.y, b.z - originZ + EDGE_LIFT_M)
    }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}
const EDGE_LIFT_M = 0.03
/** The canvas preview's face stroke. */
const FORMATION_EDGE_COLOUR = '#94744a'
/** How opaque an unfinished batter's curtain is: enough to read, light enough to see what stands behind it. */
const UNFINISHED_CURTAIN_OPACITY = 0.45
/** The canvas preview draws an unfinished edge dashed; so does this view, in metres along the edge. */
const UNFINISHED_DASH_M = 1.5
const UNFINISHED_GAP_M = 1

/** Dispose of every geometry, material and texture in the group, except `keep`, which outlives a rebuild. */
function release(group: THREE.Group, keep?: THREE.Texture) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if ('map' in material && material.map instanceof THREE.Texture && material.map !== keep) material.map.dispose()
      material.dispose()
    }
  })
  group.clear()
}

/** The near plane sits this share of the way to the scene's nearest corner, and the far plane this much past its farthest. */
const DEPTH_FIT_NEAR_SHARE = 0.9
const DEPTH_FIT_FAR_SHARE = 1.1

/**
 * Everything drawn in the group, in the group's own (unexaggerated) coordinates, or null when nothing is. The camera's
 * near and far planes are fitted to it.
 */
export function terrainGpuSceneBox(group: THREE.Object3D) {
  const box = new THREE.Box3()
  const part = new THREE.Box3()
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) continue
    const geometry = child.geometry as THREE.BufferGeometry
    if (!geometry.getAttribute('position')?.count) continue
    geometry.computeBoundingBox()
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) continue
    child.updateMatrix()
    box.union(part.copy(geometry.boundingBox).applyMatrix4(child.matrix))
  }
  return box.isEmpty() ? null : box
}

/**
 * The same perspective as previewCamera: labels, pointer-anchored zoom and GPU picking agree.
 *
 * The camera stands `cameraDistance` back, fitted to the whole window, and zooms by focal length. Near and far planes
 * at fixed shares of that distance (a near plane 1/10,000 of it away) left a 24-bit depth buffer resolving only about
 * 2.4 m at the training road (about 4 km away): the skirt behind the ground's cut edge and the batters a polygon offset
 * pulls forward then won the depth test against ground standing up to metres in front of them, as shards along every
 * batter outline. With `sceneBox` (from `terrainGpuSceneBox`) the planes hug what is drawn instead. Only depth changes:
 * the projection's x and y rows, and so labels and picking rays, do not.
 */
export function setTerrainGpuCamera(
  camera: THREE.PerspectiveCamera,
  view: TerrainGpuView,
  originZ: number,
  sceneBox?: THREE.Box3 | null,
) {
  const { camera: source, angle, tilt, exaggeration, width, height } = view
  const right = new THREE.Vector3(Math.cos(angle), -Math.sin(angle), 0)
  const up = new THREE.Vector3(Math.sin(angle) * Math.sin(tilt), Math.cos(angle) * Math.sin(tilt), Math.cos(tilt))
  const back = new THREE.Vector3(-Math.sin(angle) * Math.cos(tilt), -Math.cos(angle) * Math.cos(tilt), Math.sin(tilt))
  const eye = new THREE.Vector3(
    source.focus.x,
    source.focus.y,
    (source.focus.z - originZ) * exaggeration,
  ).addScaledVector(back, source.cameraDistance)
  camera.matrixAutoUpdate = false
  camera.matrixWorld.makeBasis(right, up, back).setPosition(eye)
  camera.matrix.copy(camera.matrixWorld)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  const floor = Math.max(0.01, source.cameraDistance / 10000)
  let near = floor
  let far = source.cameraDistance * 8
  if (sceneBox && !sceneBox.isEmpty()) {
    // Depth along the view of each corner of the drawn scene, its heights exaggerated as the group draws them.
    let closest = Infinity,
      farthest = -Infinity
    for (const x of [sceneBox.min.x, sceneBox.max.x])
      for (const y of [sceneBox.min.y, sceneBox.max.y])
        for (const z of [sceneBox.min.z, sceneBox.max.z]) {
          const depth = -((x - eye.x) * back.x + (y - eye.y) * back.y + (z * exaggeration - eye.z) * back.z)
          closest = Math.min(closest, depth)
          farthest = Math.max(farthest, depth)
        }
    if (Number.isFinite(closest) && Number.isFinite(farthest) && farthest > 0) {
      near = Math.max(floor, closest * DEPTH_FIT_NEAR_SHARE)
      far = Math.max(near * 2, farthest * DEPTH_FIT_FAR_SHARE + 1)
    }
  }
  const focal = (2 * source.scale * source.cameraDistance) / Math.max(1, height)
  const offsetX = (2 * source.anchor.x) / Math.max(1, width) - 1
  const offsetY = 1 - (2 * source.anchor.y) / Math.max(1, height)
  camera.projectionMatrix.set(
    (focal * height) / Math.max(1, width),
    0,
    -offsetX,
    0,
    0,
    focal,
    -offsetY,
    0,
    0,
    0,
    -(far + near) / (far - near),
    (-2 * far * near) / (far - near),
    0,
    0,
    -1,
    0,
  )
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
}

export function createTerrainGpu(
  canvas: HTMLCanvasElement,
  onStatus: (status: 'webgl' | 'canvas', reason?: string) => void,
): TerrainGpuHandle {
  const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' })
  if (!context) throw Error('This browser cannot create an accelerated 3D view. Using the canvas preview.')
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.localClippingEnabled = true
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  const group = new THREE.Group()
  scene.add(group)
  scene.add(new THREE.AmbientLight(0xffffff, 1.5))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(-0.35, -0.45, 0.82)
  scene.add(sun)
  let data: TerrainGpuData | undefined, view: TerrainGpuView | undefined
  let disposed = false,
    lost = false,
    ready = false,
    moving = false
  let frame = 0,
    sharpen: ReturnType<typeof setTimeout> | undefined
  let draws = 0,
    revision = 0
  let cameraKey = ''
  let ground: THREE.Mesh | undefined, road: THREE.Mesh | undefined, earthwork: THREE.Mesh | undefined
  let earthworkEdges: THREE.LineSegments | undefined
  let skirt: THREE.Mesh | undefined, curtain: THREE.Mesh | undefined
  let curtainEdges: THREE.LineSegments | undefined
  const pickables: THREE.Object3D[] = []
  const culverts = new Map<string, THREE.Mesh>()
  const materials: THREE.Material[] = []
  const raycaster = new THREE.Raycaster()
  /** What `setData` drew, for fitting the camera's near and far planes to it. */
  let sceneBox: THREE.Box3 | null = null
  // The slope texture, and the GPU texture made from it. Both outlive a scene rebuild.
  let slopeTexture: TerrainSlopeTexture | null = null
  let slopeMap: THREE.DataTexture | undefined
  /** Lay the slope texture on the ground and skirt when the ground is coloured by slope, else take it off. */
  const applySlopeTexture = () => {
    if (!data || data.colour === 'ortho') return
    const shown = data.colour === 'slope' && slopeTexture && slopeMap ? slopeTexture : null
    for (const mesh of [ground, skirt]) {
      if (!mesh) continue
      const material = mesh.material as THREE.MeshStandardMaterial
      if (shown)
        mesh.geometry.setAttribute('uv', slopeTextureUvAttribute(mesh.geometry.getAttribute('position'), shown))
      else if (mesh.geometry.getAttribute('uv')) mesh.geometry.deleteAttribute('uv')
      const map = shown ? slopeMap! : null
      if (material.map !== map) {
        // A map switched on or off changes the program; a new map in place of another does not.
        if (!material.map !== !map) material.needsUpdate = true
        material.map = map
      }
    }
  }

  const invalidate = () => {
    if (disposed || lost || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (disposed || lost || !data || !view) return
      try {
        const size = terrainRenderSize({
          width: view.width,
          height: view.height,
          devicePixelRatio: window.devicePixelRatio || 1,
          quality: view.quality,
          moving,
          maxDimension: renderer.capabilities.maxTextureSize,
        })
        if (canvas.width !== size.width || canvas.height !== size.height)
          renderer.setSize(size.width, size.height, false)
        setTerrainGpuCamera(camera, view, data.originZ, sceneBox)
        group.scale.z = view.exaggeration
        group.updateMatrixWorld(true)
        const bounds = view.bounds
        const clipping = [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -bounds[0]),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), bounds[2]),
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -bounds[1]),
          new THREE.Plane(new THREE.Vector3(0, -1, 0), bounds[3]),
        ]
        if (view.cutaway) {
          const { point, normal } = view.cutaway
          clipping.push(
            new THREE.Plane(new THREE.Vector3(normal[0], normal[1], 0), -point.x * normal[0] - point.y * normal[1]),
          )
        }
        for (const material of materials) {
          material.clippingPlanes = clipping
          if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial)
            material.wireframe = view.wireframe
        }
        if (earthwork) earthwork.visible = view.showEarthwork
        if (earthworkEdges) earthworkEdges.visible = view.showEarthwork && !view.wireframe
        // The skirt only fills gaps under opaque ground; under X-ray's translucent ground it would read as a wall.
        if (skirt) skirt.visible = !view.xray
        if (curtain) curtain.visible = view.showEarthwork
        if (curtainEdges) curtainEdges.visible = view.showEarthwork
        if (road) road.visible = true
        // X-ray exposes buried structures without altering the terrain or their actual positions.
        if (ground && ground.material instanceof THREE.MeshStandardMaterial) {
          if (ground.material.transparent !== view.xray) ground.material.needsUpdate = true
          ground.material.transparent = view.xray
          ground.material.opacity = view.xray ? 0.35 : 1
          ground.material.depthWrite = !view.xray
        }
        for (const [id, mesh] of culverts) {
          const material = mesh.material as THREE.MeshStandardMaterial
          material.depthTest = !view.xray
          material.color.set(id === view.selectedCulvertId ? '#e11d48' : '#60a5fa')
          mesh.renderOrder = view.xray ? 20 : 0
        }
        renderer.render(scene, camera)
        canvas.dataset.renderCount = String(++draws)
        canvas.dataset.triangleCount = String(renderer.info.render.triangles)
        canvas.dataset.drawCalls = String(renderer.info.render.calls)
        canvas.dataset.pixelRatio = size.pixelRatio.toFixed(3)
        canvas.dataset.geometryRevision = String(revision)
        // Which slope texture the ground is drawn with, if any: its size, or empty while vertex colours show alone.
        canvas.dataset.groundTexture =
          data.colour === 'slope' && slopeTexture ? `${slopeTexture.width}x${slopeTexture.height}` : ''
        canvas.dataset.moving = String(moving)
        canvas.style.visibility = 'visible'
        if (!ready) {
          ready = true
          onStatus('webgl')
        }
      } catch (error) {
        ready = false
        canvas.style.visibility = 'hidden'
        onStatus('canvas', error instanceof Error ? error.message : 'The accelerated scene could not be drawn.')
      }
    })
  }
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    ready = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    canvas.style.visibility = 'hidden'
    onStatus('canvas', '3D acceleration was interrupted. The canvas preview remains available while it recovers.')
  }
  const onRestored = () => {
    lost = false
    invalidate()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  const onVisibility = () => {
    if (!document.hidden) invalidate()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial) => {
    const mesh = new THREE.Mesh(geometry, material)
    material.side = THREE.DoubleSide
    group.add(mesh)
    materials.push(material)
    return mesh
  }
  return {
    setData(next) {
      if (disposed || data === next) return
      data = next
      release(group, slopeMap)
      pickables.length = 0
      materials.length = 0
      culverts.clear()
      skirt = curtain = curtainEdges = undefined
      const groundMesh = groundGeometry(next)
      const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
      if (next.colour !== 'ortho') withSlopeTextureShader(groundMaterial)
      ground = addMesh(groundMesh.geometry, groundMaterial)
      if (next.skirt?.length) {
        const imagePoint = next.ortho && next.imagePoint ? next.imagePoint : undefined
        // Pushed back in depth: where a curtain or the design stands in the same place, they are drawn, never it.
        const skirtMaterial = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
        // In Slope colour the skirt takes the slope texture at its own plan position, as the ground above it does.
        if (next.colour !== 'ortho') withSlopeTextureShader(skirtMaterial)
        skirt = addMesh(
          terrainSkirtGeometry(next.skirt, next.skirtDepth ?? 0, next.originZ, groundMesh.colourAt, imagePoint),
          skirtMaterial,
        )
      }
      if (next.ortho && next.imagePoint) {
        const ortho = prepareTerrainGpuTexture(next.ortho, renderer.capabilities.maxTextureSize)
        const texture = new THREE.DataTexture(Uint8Array.from(ortho.rgba), ortho.width, ortho.height, THREE.RGBAFormat)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.magFilter = THREE.LinearFilter
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.generateMipmaps = true
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        texture.needsUpdate = true
        // Preserve transparent/no-data pixels and do not stretch the edge of a photo outside its footprint. The skirt
        // takes the same image, so it reads as the ground it hangs from.
        for (const mesh of [ground, skirt]) {
          if (!mesh) continue
          const material = mesh.material as THREE.MeshStandardMaterial
          material.map = texture
          material.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <map_fragment>',
              `
            #ifdef USE_MAP
              vec4 image = texture2D(map, vMapUv);
              float covered = step(0.0, vMapUv.x) * step(vMapUv.x, 1.0) * step(0.0, vMapUv.y) * step(vMapUv.y, 1.0);
              diffuseColor.rgb *= mix(vec3(0.52, 0.61, 0.46), image.rgb, image.a * covered * ${ortho.opacity.toFixed(5)});
            #endif
          `,
            )
          }
          material.customProgramCacheKey = () => `terrain-ortho-${ortho.opacity}`
        }
      }
      if (next.design?.indices.length) {
        const geometry = new THREE.BufferGeometry()
        const positions = next.design.positions.slice()
        for (let i = 2; i < positions.length; i += 3) positions[i] -= next.originZ
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setIndex(new THREE.BufferAttribute(next.design.indices, 1))
        geometry.computeVertexNormals()
        road = addMesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: next.design.kind === 'finished' ? '#c5bda7' : '#bd956b',
            flatShading: true,
            roughness: 1,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        )
      } else
        road = addMesh(
          facesGeometry(next.road, next.originZ),
          // The formation's faces keep the colours they are keyed by (the road, cut, fill, over the grade limit), as
          // the canvas preview paints them: unlit, their mesh lines giving the shape.
          new THREE.MeshBasicMaterial({
            vertexColors: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        )
      road.userData.road = true
      pickables.push(ground, road)
      earthwork = addMesh(
        facesGeometry(next.design ? [] : next.earthwork, next.originZ),
        new THREE.MeshBasicMaterial({ vertexColors: true }),
      )
      earthwork.userData.road = true
      pickables.push(earthwork)
      // The formation drawn as faces (not one exact surface) keeps its mesh lines: stations across the road, strips
      // down each batter.
      const addEdges = (faces: TerrainFace[]) => {
        const material = new THREE.LineBasicMaterial({ color: FORMATION_EDGE_COLOUR, transparent: true, opacity: 0.5 })
        materials.push(material)
        const lines = new THREE.LineSegments(faceEdgesGeometry(faces, next.originZ), material)
        group.add(lines)
        return lines
      }
      if (!next.design) addEdges(next.road)
      earthworkEdges = addEdges(next.design ? [] : next.earthwork)
      if (next.unfinished?.faces.length) {
        const positions: number[] = []
        for (const face of next.unfinished.faces)
          for (let i = 1; i + 1 < face.length; i++)
            for (const v of [face[0], face[i], face[i + 1]]) positions.push(v.x, v.y, v.z - next.originZ)
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        // Translucent and unlit, so it reads as a marking rather than more earthwork. It writes no depth, so ground
        // and batters behind it stay visible, and the skirt it may share a plane with is pushed back behind it.
        curtain = addMesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: UNFINISHED_BATTER_COLOUR,
            transparent: true,
            opacity: UNFINISHED_CURTAIN_OPACITY,
            depthWrite: false,
          }),
        )
      }
      if (next.unfinished?.edges.length) {
        const positions: number[] = []
        for (const { a, b } of next.unfinished.edges)
          positions.push(a.x, a.y, a.z - next.originZ + EDGE_LIFT_M, b.x, b.y, b.z - next.originZ + EDGE_LIFT_M)
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        const material = new THREE.LineDashedMaterial({
          color: UNFINISHED_BATTER_COLOUR,
          dashSize: UNFINISHED_DASH_M,
          gapSize: UNFINISHED_GAP_M,
        })
        materials.push(material)
        curtainEdges = new THREE.LineSegments(geometry, material)
        curtainEdges.computeLineDistances()
        group.add(curtainEdges)
      }
      const linePositions: number[] = [],
        lineColors: number[] = []
      const color = new THREE.Color()
      for (const line of next.lines) {
        color.set(line.color)
        for (const p of [line.a, line.b]) {
          linePositions.push(p.x, p.y, p.z - next.originZ + 0.03)
          lineColors.push(color.r, color.g, color.b)
        }
      }
      const lineGeometry = new THREE.BufferGeometry()
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3))
      const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true })
      materials.push(lineMaterial)
      group.add(new THREE.LineSegments(lineGeometry, lineMaterial))
      for (const culvert of next.culverts) {
        const mesh = addMesh(
          facesGeometry(culvert.faces, next.originZ),
          new THREE.MeshStandardMaterial({ color: '#60a5fa', roughness: 0.7, metalness: 0.15 }),
        )
        mesh.userData.culvertId = culvert.id
        mesh.userData.station = culvert.station
        pickables.push(mesh)
        culverts.set(culvert.id, mesh)
      }
      applySlopeTexture()
      sceneBox = terrainGpuSceneBox(group)
      revision++
      invalidate()
    },
    setGroundTexture(texture) {
      if (disposed || texture === slopeTexture) return
      slopeTexture = texture
      const previous = slopeMap
      slopeMap = texture ? slopeDataTexture(texture, renderer.capabilities.getMaxAnisotropy()) : undefined
      applySlopeTexture()
      previous?.dispose()
      invalidate()
    },
    setView(next) {
      if (disposed) return
      view = next
      const key = JSON.stringify([
        next.camera.focus,
        next.camera.scale,
        next.angle,
        next.tilt,
        next.width,
        next.height,
        next.exaggeration,
      ])
      if (key !== cameraKey) {
        moving = !!cameraKey
        cameraKey = key
        if (sharpen) clearTimeout(sharpen)
        if (moving)
          sharpen = setTimeout(() => {
            moving = false
            invalidate()
          }, TERRAIN_SHARPEN_DELAY_MS)
      }
      invalidate()
    },
    pick(x, y) {
      if (!data || !view || lost || !ready) return null
      raycaster.setFromCamera(new THREE.Vector2((x / view.width) * 2 - 1, 1 - (y / view.height) * 2), camera)
      const hits = raycaster.intersectObjects(pickables, false)
      if (view.xray) hits.sort((a, b) => Number(!!b.object.userData.culvertId) - Number(!!a.object.userData.culvertId))
      for (const hit of hits) {
        const p = hit.point
        const b = view.bounds
        if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue
        if (
          view.cutaway &&
          (p.x - view.cutaway.point.x) * view.cutaway.normal[0] +
            (p.y - view.cutaway.point.y) * view.cutaway.normal[1] <
            0
        )
          continue
        if (hit.object === ground) {
          if (view.xray) continue
          return null
        }
        if (hit.object === earthwork && !view.showEarthwork) continue
        if (hit.object.userData.culvertId)
          return { station: hit.object.userData.station, culvertId: hit.object.userData.culvertId }
        let nearest: TerrainGpuData['stations'][number] | undefined,
          distance = Infinity
        for (const station of data.stations) {
          const d = (p.x - station.x) ** 2 + (p.y - station.y) ** 2
          if (d < distance) {
            distance = d
            nearest = station
          }
        }
        return nearest ? { station: nearest.station } : null
      }
      return null
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      if (sharpen) clearTimeout(sharpen)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      document.removeEventListener('visibilitychange', onVisibility)
      release(group)
      slopeMap?.dispose()
      renderer.dispose()
      // Release the context on a real unmount; fullscreen/resize never disposes the renderer.
      renderer.forceContextLoss()
    },
  }
}
