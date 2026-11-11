import { RoadSelect } from './Controls'
import type { RoadSelectionRange } from './roadSelection'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { Crosshair, Grid3x3, Minus, PaintBucket, Plus, RotateCcw, RotateCw, TriangleRight } from 'lucide-react'
import { TerrainGround, type TerrainFace as Face } from './TerrainGround'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ROAD_CHART_COLORS, formatRoadStation } from './Charts'
import { sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import { terrainMesh, cachedTerrainSampler, type TerrainVertex as Vertex } from './terrainMesh'
import { previewEarthwork, type PreviewBatterEdge } from './previewEarthwork'
import {
  autoPreviewExaggeration,
  clampPreviewZoom,
  focusHoldingPoint,
  focusOnGround,
  groundUnder,
  pixelsPerMetreAtFocus,
  previewCamera,
  previewDetailWindow,
  scaleBarLength,
  type CameraFocus,
  type PreviewCamera,
} from './previewCamera'
import { isBeyondReachFlag } from './engine'
import {
  TERRAIN_ELEVATION_COLORS,
  TERRAIN_SLOPE_STOPS,
  terrainElevationColor,
  terrainSlopeColor,
} from './terrainDisplay'
import type { Coordinate, RoadAnalysis, RoadStation, TerrainSource } from './types'

const NO_FACES: Face[] = []
const radians = Math.PI / 180
const radius = 6371008.8
/** Half-width of the Around station window, in metres. */
const FOLLOW_HALF_WINDOW_M = 120
/** A press that moves less than this is a click (pick a station), not a drag. */
const DRAG_THRESHOLD_PX = 3
const DEFAULT_YAW = 28
const DEFAULT_PITCH = 42
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)
const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})

/** Clip preview overlays to the sampled ground window, retaining their elevations. */
function clipFace(vertices: Vertex[], bounds: number[]): Vertex[] {
  let result = vertices
  for (const [axis, boundary, minimum] of [
    ['x', bounds[0], true],
    ['x', bounds[2], false],
    ['y', bounds[1], true],
    ['y', bounds[3], false],
  ] as const) {
    const input = result
    result = []
    for (let i = 0; i < input.length; i++) {
      const a = input[(i + input.length - 1) % input.length],
        b = input[i]
      const aInside = minimum ? a[axis] >= boundary : a[axis] <= boundary
      const bInside = minimum ? b[axis] >= boundary : b[axis] <= boundary
      if (aInside !== bInside) result.push(interpolate(a, b, (boundary - a[axis]) / (b[axis] - a[axis])))
      if (bInside) result.push(b)
    }
  }
  return result
}
function clipLine(a: Vertex, b: Vertex, bounds: number[]): [Vertex, Vertex] | null {
  let first = 0,
    last = 1
  for (const [axis, low, high] of [
    ['x', bounds[0], bounds[2]],
    ['y', bounds[1], bounds[3]],
  ] as const) {
    const delta = b[axis] - a[axis]
    if (Math.abs(delta) < 1e-10) {
      if (a[axis] < low || a[axis] > high) return null
      continue
    }
    const p = (low - a[axis]) / delta,
      q = (high - a[axis]) / delta
    first = Math.max(first, Math.min(p, q))
    last = Math.min(last, Math.max(p, q))
    if (last < first) return null
  }
  return [interpolate(a, b, first), interpolate(a, b, last)]
}

/** Display-only local frame; analysis continues to use its own source sampler. */
function localFrame(origin: Coordinate) {
  const cos = Math.cos(origin[1] * radians)
  return {
    point: ([lng, lat]: Coordinate): [number, number] => [
      (lng - origin[0]) * radians * radius * cos,
      (lat - origin[1]) * radians * radius,
    ],
    coordinate: (x: number, y: number): Coordinate => [
      origin[0] + x / (radius * cos * radians),
      origin[1] + y / (radius * radians),
    ],
  }
}
type Frame = ReturnType<typeof localFrame>

function sampleSection(station: RoadStation, offset: number): number | null {
  return sectionSampleAt(station, offset).design
}

function sideways(station: RoadStation, offset: number, frame: Frame): Vertex | null {
  const elevation = sampleSection(station, offset)
  if (!finite(elevation)) return null
  const [x, y] = frame.point(station.coordinate)
  const bearing = station.bearing * radians
  return { x: x + Math.cos(bearing) * offset, y: y - Math.sin(bearing) * offset, z: elevation }
}

type GroundColour = 'slope' | 'elevation' | 'plain'
const GROUND_COLOURS: { value: GroundColour; label: string }[] = [
  { value: 'slope', label: 'Slope' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'plain', label: 'Plain' },
]
type Exaggeration = 'auto' | 1 | 2 | 4
/** Road faces over the grade limit: light enough to stay apart from the rose selection. */
const OVER_GRADE_FILL = '#f2a39b'
const percentOf = (degrees: number) => Math.round(Math.tan((degrees * Math.PI) / 180) * 100)

/** Light on a face as drawn, i.e. with the vertical exaggeration, so relief reads at any setting. */
function faceLight(a: Vertex, b: Vertex, c: Vertex, exaggeration: number) {
  const ux = b.x - a.x,
    uy = b.y - a.y,
    uz = (b.z - a.z) * exaggeration
  const vx = c.x - a.x,
    vy = c.y - a.y,
    vz = (c.z - a.z) * exaggeration
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx
  if (nz < 0) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const magnitude = Math.hypot(nx, ny, nz) || 1
  return clamp((nx * -0.35 + ny * -0.45 + nz * 0.82) / magnitude, -0.5, 1)
}

/**
 * A ground face coloured the way the plan colours the same ground, then hill-shaded, so steepness and
 * relief both read. Slope comes from the face's true metres; shading follows the drawn exaggeration.
 */
function colourFace(
  a: Vertex,
  b: Vertex,
  c: Vertex,
  colour: GroundColour,
  zMin: number,
  zMax: number,
  exaggeration: number,
) {
  const light = faceLight(a, b, c, exaggeration)
  if (colour === 'plain') return `hsl(153 18% ${(32 + light * 28).toFixed(1)}%)`
  const ux = b.x - a.x,
    uy = b.y - a.y,
    uz = b.z - a.z
  const vx = c.x - a.x,
    vy = c.y - a.y,
    vz = c.z - a.z
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = Math.abs(ux * vy - uy * vx)
  const degrees = (Math.atan2(Math.hypot(nx, ny), nz) * 180) / Math.PI
  const base =
    colour === 'slope' ? terrainSlopeColor(degrees) : terrainElevationColor((a.z + b.z + c.z) / 3, zMin, zMax)
  const factor = clamp(0.45 + light * 0.6, 0.35, 1.05)
  return `rgb(${base.map((value) => Math.round(clamp(value * factor, 0, 255))).join(',')})`
}

/** The display window: the whole road with a margin, or a fixed window around the followed station. */
function displayBounds(analysis: RoadAnalysis, frame: Frame, following: RoadStation | undefined) {
  if (following) {
    const [x, y] = frame.point(following.coordinate)
    return [x - FOLLOW_HALF_WINDOW_M, y - FOLLOW_HALF_WINDOW_M, x + FOLLOW_HALF_WINDOW_M, y + FOLLOW_HALF_WINDOW_M]
  }
  const route = analysis.stations.map((s) => frame.point(s.coordinate))
  const east = route.map((p) => p[0]),
    north = route.map((p) => p[1])
  const routeX = Math.max(...east) - Math.min(...east),
    routeY = Math.max(...north) - Math.min(...north)
  const margin = Math.max(35, Math.max(routeX, routeY) * 0.13)
  return [
    Math.min(...east) - margin,
    Math.min(...north) - margin,
    Math.max(...east) + margin,
    Math.max(...north) + margin,
  ]
}

/**
 * Ground, formation, batters and ditches for one display window. With `detail`, the ground inside that
 * window is meshed again at finer spacing and every road station inside it is drawn; the coarse cells
 * it covers are left out. Elevation range, median and ground range always come from the coarse window,
 * so a finer patch never moves the camera fit or the colour scale.
 */
function buildGeometry({
  analysis,
  frame,
  bounds,
  detail: requestedDetail,
  elevation,
  fillGaps,
  terrainOnly,
  maxGradePercent,
}: {
  analysis: RoadAnalysis
  frame: Frame
  bounds: number[]
  detail: number[] | null
  elevation: (x: number, y: number) => number
  fillGaps: boolean
  terrainOnly: boolean
  maxGradePercent: number | undefined
}) {
  // A coarse cell can have four valid corners around a real source gap.
  // Carry the analysis's missing samples into the display mesh as well.
  const missing: Array<[number, number]> = []
  for (const s of analysis.stations) {
    const [x, y] = frame.point(s.coordinate),
      bearing = s.bearing * radians
    if (!finite(s.groundElevation)) missing.push([x, y])
    for (const p of s.section)
      if (!finite(p.ground)) missing.push([x + Math.cos(bearing) * p.offset, y - Math.sin(bearing) * p.offset])
  }
  const mesh = terrainMesh(bounds, elevation, missing, fillGaps)
  // A window from an earlier display window may reach past this one; keep only the overlap.
  const detail = requestedDetail && [
    Math.max(requestedDetail[0], bounds[0] - mesh.spacing),
    Math.max(requestedDetail[1], bounds[1] - mesh.spacing),
    Math.min(requestedDetail[2], bounds[2] + mesh.spacing),
    Math.min(requestedDetail[3], bounds[3] + mesh.spacing),
  ]
  const fine =
    detail && detail[2] > detail[0] && detail[3] > detail[1] ? terrainMesh(detail, elevation, missing, fillGaps) : null
  const inDetail = (x: number, y: number, margin = 0) =>
    !!fine &&
    !!detail &&
    x > detail[0] - margin &&
    x < detail[2] + margin &&
    y > detail[1] - margin &&
    y < detail[3] + margin
  const coarse = (faces: Vertex[][]) =>
    faces.filter(
      (vertices) =>
        !inDetail(
          vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length,
          vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length,
        ),
    )
  const clipped = (faces: Vertex[][]) =>
    faces.flatMap((vertices) => {
      const result = clipFace(vertices, detail!)
      return result.length >= 3 ? [result] : []
    })
  const ground: Face[] = [
    ...coarse(mesh.faces).map((vertices) => ({ vertices, fill: '' })),
    ...coarse(mesh.estimatedFaces).map((vertices) => ({ vertices, fill: '', estimated: true })),
    ...(fine ? clipped(fine.faces).map((vertices) => ({ vertices, fill: '' })) : []),
    ...(fine ? clipped(fine.estimatedFaces).map((vertices) => ({ vertices, fill: '', estimated: true })) : []),
  ]
  const step = Math.max(1, Math.ceil(analysis.stations.length / 180))
  const selected = analysis.stations.filter((s, i) => {
    if (i % step === 0 || i === analysis.stations.length - 1) return true
    const [x, y] = frame.point(s.coordinate)
    return inDetail(x, y, 40)
  })
  const road: Face[] = []
  const earthwork: Face[] = []
  const unfinishedEdges: PreviewBatterEdge[] = []
  const line: Array<{ vertex: Vertex | null; chainage: number; connected: boolean }> = []
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i]
    const connected =
      i > 0 &&
      analysis.stations
        .slice(selected[i - 1].index, s.index + 1)
        .every((p) => (terrainOnly ? finite(p.groundElevation) : finite(p.designElevation)))
    const lineElevation = terrainOnly ? s.groundElevation : s.designElevation
    if (finite(lineElevation)) {
      const [x, y] = frame.point(s.coordinate)
      line.push({ vertex: { x, y, z: lineElevation }, chainage: s.chainage, connected })
    } else line.push({ vertex: null, chainage: s.chainage, connected: false })
  }
  for (let i = 1; !terrainOnly && i < selected.length; i++) {
    const a = selected[i - 1],
      b = selected[i]
    if (!finite(a.designElevation) || !finite(b.designElevation)) continue
    // A known design surface does not depend on ground coverage. Only unknown design
    // levels break the formation; batters below use each side's supported samples.
    if (analysis.stations.slice(a.index, b.index + 1).some((s) => !finite(s.designElevation))) continue
    const leftA = sideways(a, -a.leftWidth, frame),
      rightA = sideways(a, a.rightWidth, frame)
    const leftB = sideways(b, -b.leftWidth, frame),
      rightB = sideways(b, b.rightWidth, frame)
    if (leftA && rightA && leftB && rightB) {
      const vertices = clipFace([leftA, rightA, rightB, leftB], bounds)
      if (vertices.length >= 3)
        road.push({
          vertices,
          fill:
            maxGradePercent !== undefined &&
            Math.max(Math.abs(a.gradePercent ?? 0), Math.abs(b.gradePercent ?? 0)) > maxGradePercent
              ? OVER_GRADE_FILL
              : '#e8c886',
          station: (a.chainage + b.chainage) / 2,
          terrainGap: analysis.stations.slice(a.index, b.index + 1).some((s) => !finite(s.groundElevation)),
        })
    }
    const batters = previewEarthwork(analysis.stations.slice(a.index, b.index + 1), (s, offset, z) => {
      const [x, y] = frame.point(s.coordinate)
      const bearing = s.bearing * radians
      return { x: x + Math.cos(bearing) * offset, y: y - Math.sin(bearing) * offset, z }
    })
    for (const face of batters.faces) {
      const vertices = clipFace(face.vertices, bounds)
      if (vertices.length >= 3) earthwork.push({ ...face, vertices })
    }
    for (const edge of batters.edges) {
      const clippedEdge = clipLine(edge.a, edge.b, bounds)
      if (clippedEdge) unfinishedEdges.push({ ...edge, a: clippedEdge[0], b: clippedEdge[1] })
    }
  }
  const zValues = mesh.elevations
  const templates = new Map(analysis.engineering?.stations.map((s) => [s.chainage, s.template]))
  const ditchPoints = analysis.stations.map((s) => {
    const template = templates.get(s.chainage)
    return !terrainOnly && template ? sectionCodePoints(s, template) : []
  })
  const ditches = analysis.stations.slice(1).flatMap((b, index) => {
    const a = analysis.stations[index]
    return (['left', 'right'] as const).flatMap((side) => {
      const pa = ditchPoints[index].find((p) => p.code === `${side}-ditch-bottom`),
        pb = ditchPoints[index + 1].find((p) => p.code === `${side}-ditch-bottom`)
      if (!pa || !pb || !finite(pa.ground) || !finite(pb.ground) || !finite(pa.design) || !finite(pb.design)) return []
      const va = sideways(a, pa.offset, frame),
        vb = sideways(b, pb.offset, frame)
      const clippedLine = va && vb ? clipLine(va, vb, bounds) : null
      return clippedLine
        ? [{ a: clippedLine[0], b: clippedLine[1], chainage: (a.chainage + b.chainage) / 2, side }]
        : []
    })
  })
  const medianZ = zValues.length ? [...zValues].sort((a, b) => a - b)[Math.floor(zValues.length / 2)] : 0
  // Fit elevations actually inside this display window; a high PVI outside the
  // follow window must not shrink the current view, and a visible one must fit.
  let low = zValues.length ? Math.min(...zValues) : Infinity
  let high = zValues.length ? Math.max(...zValues) : -Infinity
  const include = (vertex: Vertex) => {
    low = Math.min(low, vertex.z)
    high = Math.max(high, vertex.z)
  }
  for (const face of [...road, ...earthwork]) for (const vertex of face.vertices) include(vertex)
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i]
    const clippedLine = a.vertex && b.vertex && b.connected ? clipLine(a.vertex, b.vertex, bounds) : null
    if (clippedLine) clippedLine.forEach(include)
  }
  return {
    frame,
    bounds,
    ground,
    road,
    earthwork,
    unfinishedEdges,
    ditches,
    line,
    medianZ,
    low: Number.isFinite(low) ? low : 0,
    high: Number.isFinite(high) ? high : 0,
    meshSpacing: mesh.spacing,
    detailSpacing: fine?.spacing ?? null,
    cells: ground.length,
    infilledCells: mesh.infilledCells + (fine?.infilledCells ?? 0),
    openGapCells: mesh.openGapCells + (fine?.openGapCells ?? 0),
    groundLow: zValues.length ? Math.min(...zValues) : 0,
    groundHigh: zValues.length ? Math.max(...zValues) : 0,
  }
}

const sameWindow = (a: number[] | null, b: number[] | null) =>
  a === b || (!!a && !!b && a.every((value, i) => value === b[i]))

/** Camera inputs the pointer and wheel handlers need between renders. */
interface CameraView {
  width: number
  height: number
  angle: number
  make: (zoom: number, focus: CameraFocus | null) => PreviewCamera
}

export function TerrainPreview({
  selectedRange,
  analysis,
  terrain,
  station,
  onStation,
  playing = false,
  terrainOnly = false,
  sourceLabel = 'Project terrain',
  selectedCulvertId,
  onSelectCulvert,
  maxGradePercent,
}: {
  selectedRange?: RoadSelectionRange
  analysis: RoadAnalysis
  terrain: TerrainSource
  station: number
  onStation: (chainage: number) => void
  playing?: boolean
  terrainOnly?: boolean
  sourceLabel?: string
  selectedCulvertId?: string
  onSelectCulvert?: (id: string) => void
  /** Road faces steeper than this draw in the over-grade colour, as on the plan. */
  maxGradePercent?: number
}) {
  const [mode, setMode] = useState<'orbit' | 'follow'>('orbit')
  const [yaw, setYaw] = useState(DEFAULT_YAW)
  const [pitch, setPitch] = useState(DEFAULT_PITCH)
  const [exaggerationChoice, setExaggerationChoice] = useState<Exaggeration>('auto')
  const [wireframe, setWireframe] = useState(false)
  const [showEarthwork, setShowEarthwork] = useState(true)
  const [fillGaps, setFillGaps] = useState(true)
  const [groundColour, setGroundColour] = useState<GroundColour>('slope')
  const [zoom, setZoom] = useState(1)
  const active = analysis.stations.reduce<RoadStation | undefined>(
    (best, candidate) =>
      !best || Math.abs(candidate.chainage - station) < Math.abs(best.chainage - station) ? candidate : best,
    undefined,
  )
  const followingStation = mode === 'follow' ? active : undefined
  // Around station recentres on every station change; a pan there lasts until the station moves.
  const lookKey = followingStation ? `follow:${followingStation.chainage}` : 'whole'
  const [lookState, setLookState] = useState<{ key: string; point: CameraFocus } | null>(null)
  /** The ground point the camera orbits and zooms about; null is the window's fit target. */
  const look = lookState?.key === lookKey ? lookState.point : null
  const setLook = (point: CameraFocus | null) => setLookState(point ? { key: lookKey, point } : null)
  const [detail, setDetail] = useState<number[] | null>(null)
  const [interacted, setInteracted] = useState(false)
  const [wheelSvg, setWheelSvg] = useState<SVGSVGElement | null>(null)
  const dragFrame = useRef<number>()
  const pointerStart = useRef<[number, number]>()
  const cameraView = useRef<CameraView>()
  // Wheel events can arrive several times per frame; each builds on the last one, not the last render.
  const live = useRef({ zoom, look })
  useLayoutEffect(() => {
    live.current = { zoom, look }
  }, [zoom, look])
  const drag = useRef<{
    x: number
    y: number
    yaw: number
    pitch: number
    rotating: boolean
    moved: boolean
    camera: PreviewCamera
    /** Elevation of the ground under the press, which a pan keeps under the pointer. */
    groundZ: number | undefined
    scaleX: number
    scaleY: number
    left: number
    top: number
  } | null>(null)
  const resetCamera = () => {
    setYaw(DEFAULT_YAW)
    setPitch(DEFAULT_PITCH)
    setZoom(1)
    setLook(null)
    live.current = { zoom: 1, look: null }
  }
  const cachedElevation = useMemo(() => {
    const frame = localFrame(analysis.stations[0]?.coordinate ?? [0, 0])
    return cachedTerrainSampler((x, y) => terrain.elevationAt(...frame.coordinate(x, y)))
  }, [analysis, terrain])
  const cachedElevationRef = useRef(cachedElevation)
  useLayoutEffect(() => {
    cachedElevationRef.current = cachedElevation
  }, [cachedElevation])
  /** Apply a camera change, after moving the focus onto the ground at the centre (`focusOnGround`). */
  const settleView = (zoom: number, focus: CameraFocus | null, onGround: boolean) => {
    const view = cameraView.current
    const grounded = onGround && view ? focusOnGround(view.make(zoom, focus), zoom, cachedElevationRef.current) : null
    const next = grounded ?? { zoom, focus }
    live.current = { zoom: next.zoom, look: next.focus }
    setZoom(next.zoom)
    setLook(next.focus)
  }
  const zoomAt = (factor: number, point?: { x: number; y: number }) => {
    const view = cameraView.current
    const { zoom: current, look: focus } = live.current
    const next = clampPreviewZoom(current * factor)
    if (next === current) return
    setInteracted(true)
    if (!view || !point) {
      live.current = { zoom: next, look: focus }
      setZoom(next)
      return
    }
    // Hold the ground under the pointer, so zooming moves toward what is pointed at.
    const before = view.make(current, focus)
    const ground = groundUnder(before, point, cachedElevationRef.current)
    const held = focusHoldingPoint(before, view.make(next, focus), point, point, ground?.z)
    settleView(next, held ?? focus, true)
  }
  /** Move the view by a screen offset, e.g. from the keyboard. */
  const panBy = (dx: number, dy: number) => {
    const view = cameraView.current
    if (!view) return
    const camera = view.make(live.current.zoom, live.current.look)
    const ground = groundUnder(camera, camera.anchor, cachedElevationRef.current)
    const held = focusHoldingPoint(
      camera,
      camera,
      camera.anchor,
      { x: camera.anchor.x + dx, y: camera.anchor.y + dy },
      ground?.z,
    )
    if (held) settleView(live.current.zoom, held, true)
  }
  const zoomAtRef = useRef(zoomAt)
  useLayoutEffect(() => {
    zoomAtRef.current = zoomAt
  })
  useEffect(() => {
    if (!wheelSvg) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const view = cameraView.current
      if (!view) return
      const rectangle = wheelSvg.getBoundingClientRect()
      const point = {
        x: ((event.clientX - rectangle.left) * view.width) / (rectangle.width || 1),
        y: ((event.clientY - rectangle.top) * view.height) / (rectangle.height || 1),
      }
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1)
      // A trackpad pinch arrives as a wheel with ctrlKey and small deltas.
      zoomAtRef.current(Math.exp(-clamp(delta, -200, 200) * (event.ctrlKey ? 0.01 : 0.0025)), point)
    }
    wheelSvg.addEventListener('wheel', wheel, { passive: false })
    return () => wheelSvg.removeEventListener('wheel', wheel)
  }, [wheelSvg])
  useEffect(
    () => () => {
      if (dragFrame.current) cancelAnimationFrame(dragFrame.current)
    },
    [],
  )
  const selectedCulvert = terrainOnly
    ? undefined
    : analysis.engineering?.culverts.find((c) => c.id === selectedCulvertId)
  const frame = useMemo(() => localFrame(analysis.stations[0]?.coordinate ?? [0, 0]), [analysis])
  const base = useMemo(() => {
    if (!analysis.stations.length) return null
    return buildGeometry({
      analysis,
      frame,
      bounds: displayBounds(analysis, frame, followingStation),
      detail: null,
      elevation: cachedElevation,
      fillGaps,
      terrainOnly,
      maxGradePercent,
    })
  }, [analysis, frame, followingStation, terrainOnly, cachedElevation, fillGaps, maxGradePercent])
  const sourceGeometry = useMemo(
    () =>
      base && detail
        ? buildGeometry({
            analysis,
            frame,
            bounds: base.bounds,
            detail,
            elevation: cachedElevation,
            fillGaps,
            terrainOnly,
            maxGradePercent,
          })
        : base,
    [base, detail, analysis, frame, cachedElevation, fillGaps, terrainOnly, maxGradePercent],
  )
  // The automatic exaggeration reads the whole road's sections, so it does not change while following.
  const autoExaggeration = useMemo(() => {
    let low = Infinity,
      high = -Infinity
    for (const s of analysis.stations)
      for (const value of [s.groundElevation, ...s.section.map((p) => p.ground)])
        if (finite(value)) {
          low = Math.min(low, value)
          high = Math.max(high, value)
        }
    const points = analysis.stations.map((s) => frame.point(s.coordinate))
    const span = points.length
      ? Math.max(
          Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])),
          Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])),
          70,
        )
      : 0
    return high > low ? autoPreviewExaggeration(high - low, span) : 1
  }, [analysis, frame])
  const exaggeration = exaggerationChoice === 'auto' ? autoExaggeration : exaggerationChoice
  const groundFaces = useMemo(() => {
    if (!sourceGeometry) return NO_FACES
    const { groundLow, groundHigh } = sourceGeometry
    return sourceGeometry.ground.map((face) => ({
      ...face,
      fill: colourFace(
        face.vertices[0],
        face.vertices[1],
        face.vertices[2],
        groundColour,
        groundLow,
        groundHigh,
        exaggeration,
      ),
    }))
  }, [sourceGeometry, groundColour, exaggeration])

  const following = mode === 'follow' && active ? active : undefined
  const activeElevation = terrainOnly ? active?.groundElevation : (active?.designElevation ?? active?.groundElevation)
  const target = base
    ? following
      ? frame.point(following.coordinate)
      : [(base.bounds[0] + base.bounds[2]) / 2, (base.bounds[1] + base.bounds[3]) / 2]
    : [0, 0]
  const targetZ = base ? (following ? (activeElevation ?? base.medianZ) : (base.low + base.high) / 2) : 0
  const angleDegrees = following ? following.bearing + yaw - DEFAULT_YAW : yaw
  const angle = angleDegrees * radians
  const tilt = (following ? clamp(pitch - 10, 15, 80) : pitch) * radians
  const activeVertex =
    active && finite(activeElevation)
      ? (() => {
          const [x, y] = frame.point(active.coordinate)
          return { x, y, z: activeElevation }
        })()
      : null

  // Mesh a finer window around the focus once zooming or panning settles.
  const focusX = look?.x ?? target[0],
    focusY = look?.y ?? target[1]
  useEffect(() => {
    const next = base ? previewDetailWindow(base.bounds, zoom, { x: focusX, y: focusY }, base.meshSpacing) : null
    if (sameWindow(next, detail)) return
    const timer = setTimeout(() => setDetail(next), next ? 180 : 0)
    return () => clearTimeout(timer)
  }, [base, zoom, focusX, focusY, detail])

  const centreOnStation = () => {
    if (!activeVertex) return
    // Keep the focus's place on screen, so the view slides to the station rather than jumping.
    const screen = cameraView.current?.make(live.current.zoom, live.current.look).focus.screen
    const focus = { ...activeVertex, screen }
    live.current = { ...live.current, look: focus }
    setLook(focus)
    setInteracted(true)
  }
  const faceNorth = () => setYaw((value) => value - angleDegrees)
  // Screen direction of north, clockwise from up; tilt foreshortens the ahead component.
  const northDegrees = (Math.atan2(-Math.sin(angle), Math.cos(angle) * Math.sin(tilt)) * 180) / Math.PI

  const controlHelp = (
    <InfoTip label="3D view controls" bubbleClassName="max-w-72">
      <span className="block">
        <strong>Drag</strong> to pan. <strong>Right-drag</strong>, <strong>Ctrl-drag</strong> or{' '}
        <strong>Alt-drag</strong> to rotate and tilt.
      </span>
      <span className="mt-1 block">
        <strong>Scroll</strong> or <strong>pinch</strong> to zoom toward the pointer; <strong>double-click</strong>{' '}
        zooms in there (Shift-double-click zooms out).
      </span>
      <span className="mt-1 block">
        Keys: arrows pan, Shift+arrows rotate and tilt, + and − zoom, Home fits the view.
      </span>
      <span className="mt-1 block">
        The compass turns the view north up. Zoomed in, the ground around the centre is meshed again at finer spacing.
        Click the road to select that station.
      </span>
    </InfoTip>
  )

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col"
      data-testid="road-terrain-preview"
      data-station={active?.chainage ?? station}
      data-terrain-only={terrainOnly}
      data-zoom={zoom}
      data-exaggeration={exaggeration}
      data-mesh-spacing={sourceGeometry?.meshSpacing}
      data-detail-spacing={sourceGeometry?.detailSpacing ?? undefined}
      data-infilled-cells={sourceGeometry?.infilledCells ?? 0}
      data-open-gap-cells={sourceGeometry?.openGapCells ?? 0}
      data-batter-face-count={sourceGeometry?.earthwork.length ?? 0}
      aria-label={`${sourceLabel} 3D preview`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-1 gap-y-1 border-b px-1.5 py-1 [&>*]:shrink-0">
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as 'orbit' | 'follow')}
          options={[
            { value: 'orbit', label: 'Whole road' },
            { value: 'follow', label: 'Around station' },
          ]}
          label="Terrain camera mode"
          size="sm"
          fullWidth={false}
        />
        {!terrainOnly && !!analysis.engineering?.culverts.length && (
          <label className="flex min-w-0 items-center gap-1 text-3xs text-muted-foreground">
            Structure
            <RoadSelect
              ariaLabel="3D structure"
              className="h-7 max-w-48"
              value={selectedCulvert?.id ?? ''}
              options={[
                { value: '', label: 'Select a culvert', disabled: true },
                ...(analysis.engineering?.culverts ?? []).map((culvert) => ({
                  value: culvert.id,
                  label: `${culvert.name} · ${formatRoadStation(culvert.chainage)}`,
                })),
              ]}
              onValueChange={(id) => {
                const culvert = analysis.engineering?.culverts.find((c) => c.id === id)
                if (culvert) {
                  onSelectCulvert?.(culvert.id)
                  onStation(culvert.chainage)
                }
              }}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-x-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            aria-label="Fit terrain view"
            title="Fit the whole window in view and reset the angle (Home)"
            onClick={resetCamera}
          >
            Fit
          </Button>
          {/* Display toggles are icons so the bar fits one row; pressed ones keep a tint. */}
          <Button
            size="icon"
            variant="ghost"
            className="size-7 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            aria-label="Mesh"
            title="Show the triangle mesh"
            aria-pressed={wireframe}
            onClick={() => setWireframe((value) => !value)}
          >
            <Grid3x3 className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 aria-pressed:bg-primary/10 aria-pressed:text-primary"
            aria-label="Fill small gaps in 3D display"
            aria-pressed={fillGaps}
            title="Fill small gaps: estimate small enclosed gaps for the 3D display only. Turn off to show the original source gaps. Calculations always use the original terrain."
            onClick={() => setFillGaps((value) => !value)}
          >
            <PaintBucket className="size-3.5" />
          </Button>
          {!terrainOnly && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 aria-pressed:bg-primary/10 aria-pressed:text-primary"
              aria-label="Batters"
              title="Show cut and fill batters"
              aria-pressed={showEarthwork}
              onClick={() => setShowEarthwork((value) => !value)}
            >
              <TriangleRight className="size-3.5" />
            </Button>
          )}
          <RoadSelect
            title="Ground colour"
            ariaLabel="Terrain colour"
            className="h-7 w-20 px-2"
            value={groundColour}
            onValueChange={(value) => setGroundColour(value as GroundColour)}
            options={GROUND_COLOURS}
          />
          <RoadSelect
            title="Vertical exaggeration: heights are drawn this many times taller than true scale"
            ariaLabel="Terrain vertical exaggeration"
            className="h-7 w-[5.75rem] px-1.5"
            value={String(exaggerationChoice)}
            onValueChange={(value) => setExaggerationChoice(value === 'auto' ? 'auto' : (Number(value) as 1 | 2 | 4))}
            options={[
              { value: 'auto', label: `Auto ×${autoExaggeration}` },
              ...[1, 2, 4].map((value) => ({ value: String(value), label: `×${value}` })),
            ]}
          />
          {controlHelp}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChartViewport className="min-h-0 flex-1" minHeight={1} initialHeight={240}>
          {(height) => (
            <SizedChart height={height}>
              {(width) => {
                if (!sourceGeometry || !base)
                  return (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Draw an alignment to inspect its terrain.
                    </div>
                  )
                const cameraInputs = {
                  bounds: base.bounds,
                  low: base.low,
                  high: base.high,
                  target,
                  targetZ,
                  angle,
                  tilt,
                  exaggeration,
                  width,
                  height,
                }
                const camera = previewCamera({ ...cameraInputs, zoom, focus: look })
                cameraView.current = {
                  width,
                  height,
                  angle,
                  make: (nextZoom, focus) => previewCamera({ ...cameraInputs, zoom: nextZoom, focus }),
                }
                const { scale, cameraDistance, project } = camera
                const { bounds, frame: geometryFrame } = sourceGeometry
                const route = sourceGeometry.line.slice(1).flatMap((s, index) => {
                  const previous = sourceGeometry.line[index]
                  if (!s.vertex || !previous.vertex || !s.connected) return []
                  const clipped = clipLine(previous.vertex, s.vertex, bounds)
                  return clipped
                    ? [{ first: project(clipped[0]), last: project(clipped[1]), chainage: s.chainage }]
                    : []
                })
                const faces = (items: Face[]) =>
                  items
                    .map((face) => {
                      const projected = face.vertices.map(project)
                      return {
                        ...face,
                        points: projected.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
                        depth: projected.reduce((sum, p) => sum + p.depth, 0) / projected.length,
                      }
                    })
                    .sort((a, b) => b.depth - a.depth)
                const section =
                  active?.section.map((p) => {
                    if (!finite(p.ground)) return null
                    const [x, y] = geometryFrame.point(active.coordinate)
                    const bearing = active.bearing * radians
                    return {
                      x: x + Math.cos(bearing) * p.offset,
                      y: y - Math.sin(bearing) * p.offset,
                      z: p.ground as number,
                    }
                  }) ?? []
                const activePoint = activeVertex ? project(activeVertex) : null
                const culverts = terrainOnly
                  ? []
                  : (analysis.engineering?.culverts ?? []).map((culvert) => {
                      const segments = culvert.profile.slice(1).flatMap((p, i) => {
                        const previous = culvert.profile[i]
                        if (!finite(previous.crownElevation) || !finite(p.crownElevation)) return []
                        const [ax, ay] = geometryFrame.point(previous.coordinate),
                          [bx, by] = geometryFrame.point(p.coordinate)
                        const clipped = clipLine(
                          { x: ax, y: ay, z: previous.crownElevation },
                          { x: bx, y: by, z: p.crownElevation },
                          bounds,
                        )
                        return clipped ? [{ a: project(clipped[0]), b: project(clipped[1]) }] : []
                      })
                      return { culvert, segments }
                    })
                const scaleBar = scaleBarLength(pixelsPerMetreAtFocus(camera, angle))
                const svgPoint = (event: { clientX: number; clientY: number }, element: Element) => {
                  const rectangle = element.getBoundingClientRect()
                  return {
                    x: ((event.clientX - rectangle.left) * width) / (rectangle.width || 1),
                    y: ((event.clientY - rectangle.top) * height) / (rectangle.height || 1),
                  }
                }
                return (
                  <svg
                    ref={setWheelSvg}
                    width={width}
                    height={height}
                    role="group"
                    tabIndex={0}
                    data-camera-focus={look ? `${look.x.toFixed(2)},${look.y.toFixed(2)}` : 'fit'}
                    aria-label={
                      terrainOnly
                        ? 'Three dimensional terrain surface and sampled transect. Drag to pan, right-drag or Ctrl-drag to rotate, scroll to zoom; arrow keys pan and Shift+arrows rotate.'
                        : 'Three dimensional terrain surface and road formation overlay. Drag to pan, right-drag or Ctrl-drag to rotate, scroll to zoom; arrow keys pan and Shift+arrows rotate.'
                    }
                    className="cursor-grab select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    onContextMenu={(event) => event.preventDefault()}
                    onDoubleClick={(event) => zoomAt(event.shiftKey ? 0.5 : 2, svgPoint(event, event.currentTarget))}
                    onClick={(event) => {
                      if (
                        !showEarthwork ||
                        !pointerStart.current ||
                        (event.target as Element).closest('.cursor-pointer')
                      )
                        return
                      if (
                        Math.hypot(event.clientX - pointerStart.current[0], event.clientY - pointerStart.current[1]) >
                        DRAG_THRESHOLD_PX
                      )
                        return
                      const { x, y } = svgPoint(event, event.currentTarget)
                      const picked = [...sourceGeometry.earthwork]
                        .sort(
                          (a, b) =>
                            b.vertices.reduce((sum, v) => sum + project(v).depth, 0) / b.vertices.length -
                            a.vertices.reduce((sum, v) => sum + project(v).depth, 0) / a.vertices.length,
                        )
                        .reverse()
                        .find((face) => {
                          const points = face.vertices.map(project)
                          let inside = false
                          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                            const a = points[i],
                              b = points[j]
                            if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
                              inside = !inside
                          }
                          return inside
                        })
                      if (picked?.station !== undefined) onStation(picked.station)
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0 && event.button !== 2) return
                      event.preventDefault()
                      event.currentTarget.focus({ preventScroll: true })
                      pointerStart.current = [event.clientX, event.clientY]
                      const rectangle = event.currentTarget.getBoundingClientRect()
                      drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        yaw,
                        pitch,
                        rotating: event.button === 2 || event.ctrlKey || event.altKey,
                        moved: false,
                        camera,
                        groundZ: groundUnder(camera, svgPoint(event, event.currentTarget), cachedElevation)?.z,
                        scaleX: width / (rectangle.width || 1),
                        scaleY: height / (rectangle.height || 1),
                        left: rectangle.left,
                        top: rectangle.top,
                      }
                    }}
                    onPointerMove={(event) => {
                      const start = drag.current
                      if (!start) return
                      const dx = event.clientX - start.x,
                        dy = event.clientY - start.y
                      if (!start.moved) {
                        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return
                        // Capture only once it is a drag, so a plain click still reaches the road it is on.
                        start.moved = true
                        try {
                          event.currentTarget.setPointerCapture(event.pointerId)
                        } catch {
                          // The pointer may already be released (synthetic events in tests).
                        }
                        setInteracted(true)
                      }
                      const to = {
                        x: (event.clientX - start.left) * start.scaleX,
                        y: (event.clientY - start.top) * start.scaleY,
                      }
                      if (dragFrame.current) cancelAnimationFrame(dragFrame.current)
                      dragFrame.current = requestAnimationFrame(() => {
                        if (start.rotating) {
                          setYaw(start.yaw - dx * 0.35)
                          setPitch(clamp(start.pitch + dy * 0.2, 15, 80))
                          return
                        }
                        // The ground under the pointer stays under it. Above the horizon, move the focus instead.
                        const from = {
                          x: (start.x - start.left) * start.scaleX,
                          y: (start.y - start.top) * start.scaleY,
                        }
                        const anchor = start.camera.anchor
                        const held =
                          focusHoldingPoint(start.camera, start.camera, from, to, start.groundZ) ??
                          focusHoldingPoint(start.camera, start.camera, anchor, {
                            x: anchor.x + (to.x - from.x),
                            y: anchor.y + (to.y - from.y),
                          })
                        if (!held) return
                        live.current = { ...live.current, look: held }
                        setLook(held)
                      })
                    }}
                    onPointerUp={() => {
                      const ended = drag.current
                      drag.current = null
                      // Once a pan ends, orbit about the ground now at the centre.
                      if (ended?.moved && !ended.rotating) {
                        if (dragFrame.current) cancelAnimationFrame(dragFrame.current)
                        requestAnimationFrame(() => settleView(live.current.zoom, live.current.look, true))
                      }
                    }}
                    onPointerCancel={() => {
                      drag.current = null
                    }}
                    onKeyDown={(event) => {
                      const step = Math.min(width, height) / 8
                      const keys: Record<string, () => void> = event.shiftKey
                        ? {
                            ArrowLeft: () => setYaw((value) => value - 10),
                            ArrowRight: () => setYaw((value) => value + 10),
                            ArrowUp: () => setPitch((value) => clamp(value + 5, 15, 80)),
                            ArrowDown: () => setPitch((value) => clamp(value - 5, 15, 80)),
                          }
                        : {
                            ArrowLeft: () => panBy(step, 0),
                            ArrowRight: () => panBy(-step, 0),
                            ArrowUp: () => panBy(0, step),
                            ArrowDown: () => panBy(0, -step),
                          }
                      keys.Home = resetCamera
                      keys['+'] = keys['='] = () => zoomAt(1.25)
                      keys['-'] = () => zoomAt(1 / 1.25)
                      const action = keys[event.key]
                      if (!action) return
                      event.preventDefault()
                      action()
                    }}
                  >
                    <title>
                      {terrainOnly
                        ? 'Decimated surface and transect sampled from the same elevation source as the terrain profile.'
                        : 'Decimated surface sampled from the same elevation source as the road calculations. Road formation is overlaid to remain visible in cut.'}
                    </title>
                    <rect width={width} height={height} fill="hsl(var(--muted))" opacity={0.3} />
                    <TerrainGround
                      faces={groundFaces}
                      overlays={showEarthwork ? sourceGeometry.earthwork : NO_FACES}
                      project={project}
                      width={width}
                      height={height}
                      wireframe={wireframe}
                      projectionKey={JSON.stringify([
                        width,
                        height,
                        target,
                        targetZ,
                        angle,
                        tilt,
                        scale,
                        cameraDistance,
                        exaggeration,
                        camera.focus,
                      ])}
                    />
                    {faces(sourceGeometry.road).map((face, i) => (
                      <polygon
                        key={`road${i}`}
                        data-design-over-terrain-gap={face.terrainGap || undefined}
                        points={face.points}
                        fill={
                          selectedRange &&
                          face.station !== undefined &&
                          face.station >= selectedRange.start &&
                          face.station <= selectedRange.end
                            ? '#e11d48'
                            : face.fill
                        }
                        stroke="#94744a"
                        strokeWidth={0.3}
                        opacity={0.95}
                        className="cursor-pointer"
                        onClick={() => onStation(face.station ?? 0)}
                      >
                        <title>
                          Design surface at {formatRoadStation(face.station ?? 0)}
                          {face.terrainGap ? '; ground is unverified here' : ''}; click to inspect
                        </title>
                      </polygon>
                    ))}
                    {culverts
                      .sort(
                        (a, b) =>
                          Number(a.culvert.id === selectedCulvertId) - Number(b.culvert.id === selectedCulvertId),
                      )
                      .map(({ culvert, segments }) => (
                        <g
                          key={culvert.id}
                          role="button"
                          tabIndex={segments.length ? 0 : undefined}
                          aria-label={`Inspect 3D culvert ${culvert.name}`}
                          aria-pressed={selectedCulvertId === culvert.id}
                          className="cursor-pointer"
                          onClick={() => {
                            onSelectCulvert?.(culvert.id)
                            onStation(culvert.chainage)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              event.stopPropagation()
                              onSelectCulvert?.(culvert.id)
                              onStation(culvert.chainage)
                            }
                          }}
                        >
                          {segments.map(({ a, b }, index) => (
                            <line
                              key={index}
                              x1={a.x}
                              y1={a.y}
                              x2={b.x}
                              y2={b.y}
                              stroke={
                                selectedCulvertId === culvert.id
                                  ? ROAD_CHART_COLORS.selected
                                  : culvert.warnings.length
                                    ? '#b45309'
                                    : '#0284c7'
                              }
                              strokeWidth={selectedCulvertId === culvert.id ? 6 : 4}
                            />
                          ))}
                          <title>
                            {culvert.name} · {formatRoadStation(culvert.chainage)} · entered barrel crown geometry
                          </title>
                        </g>
                      ))}
                    {showEarthwork &&
                      sourceGeometry.unfinishedEdges.map((edge, index) => {
                        const a = project(edge.a),
                          b = project(edge.b)
                        return (
                          <line
                            key={`unfinished-${index}`}
                            data-unfinished-batter={edge.reason}
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke="#e11d48"
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            pointerEvents="none"
                          >
                            <title>
                              {edge.reason === 'reach'
                                ? 'Batter continues beyond the sampled section reach; it has not met the ground.'
                                : 'Batter stops at missing terrain; its connection to the ground is unknown.'}
                            </title>
                          </line>
                        )
                      })}
                    {showEarthwork &&
                      sourceGeometry.ditches.map((segment, index) => {
                        const a = project(segment.a),
                          b = project(segment.b)
                        return (
                          <line
                            key={`ditch-${index}`}
                            x1={a.x}
                            y1={a.y}
                            x2={b.x}
                            y2={b.y}
                            stroke={ROAD_CHART_COLORS.ditch}
                            strokeWidth={1.5}
                            strokeDasharray="3 2"
                            className="cursor-pointer"
                            onClick={() => onStation(segment.chainage)}
                          >
                            <title>
                              {segment.side} ditch bottom at {formatRoadStation(segment.chainage)}
                            </title>
                          </line>
                        )
                      })}
                    {route.map((segment, i) => (
                      <line
                        key={`line${i}`}
                        x1={segment.first.x}
                        y1={segment.first.y}
                        x2={segment.last.x}
                        y2={segment.last.y}
                        stroke={terrainOnly ? ROAD_CHART_COLORS.ground : ROAD_CHART_COLORS.design}
                        strokeWidth={terrainOnly ? 2.5 : 1.2}
                        strokeDasharray="3 2"
                        opacity={0.9}
                        pointerEvents={terrainOnly ? 'stroke' : 'none'}
                        onClick={terrainOnly ? () => onStation(segment.chainage) : undefined}
                      />
                    ))}
                    {section.length > 1 && (
                      <path
                        d={section
                          .map((vertex, i) => {
                            if (!vertex) return ''
                            const p = project(vertex)
                            return `${i > 0 && section[i - 1] ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
                          })
                          .join(' ')}
                        fill="none"
                        stroke={ROAD_CHART_COLORS.selected}
                        strokeWidth={1.8}
                        pointerEvents="none"
                      />
                    )}
                    {activePoint && (
                      <g pointerEvents="none">
                        <circle
                          cx={activePoint.x}
                          cy={activePoint.y}
                          r={5}
                          fill={ROAD_CHART_COLORS.selected}
                          stroke="white"
                          strokeWidth={1.5}
                        />
                        <text
                          x={activePoint.x + 8}
                          y={activePoint.y - 8}
                          fontSize="11"
                          fontWeight={600}
                          fill="hsl(var(--foreground))"
                          stroke="hsl(var(--background))"
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {formatRoadStation(active?.chainage ?? station)}
                        </text>
                      </g>
                    )}
                    {scaleBar && (
                      <g
                        data-testid="road-3d-scale-bar"
                        data-metres={scaleBar.metres}
                        transform={`translate(10 ${height - 12})`}
                        pointerEvents="none"
                      >
                        <title>Scale at the view centre; perspective shortens distances farther away.</title>
                        <path
                          d={`M0,-5 V0 H${scaleBar.pixels.toFixed(1)} V-5`}
                          fill="none"
                          stroke="hsl(var(--background))"
                          strokeWidth={3.5}
                        />
                        <path
                          d={`M0,-5 V0 H${scaleBar.pixels.toFixed(1)} V-5`}
                          fill="none"
                          stroke="hsl(var(--foreground))"
                          strokeWidth={1.2}
                        />
                        <text
                          x={scaleBar.pixels / 2}
                          y={-4}
                          textAnchor="middle"
                          fontSize="10"
                          fill="hsl(var(--foreground))"
                          stroke="hsl(var(--background))"
                          strokeWidth={3}
                          paintOrder="stroke"
                        >
                          {scaleBar.metres >= 1000 ? `${scaleBar.metres / 1000} km` : `${scaleBar.metres} m`}
                        </text>
                      </g>
                    )}
                    {sourceGeometry.cells === 0 && (
                      <text
                        x={width / 2}
                        y={height / 2}
                        fontSize="12"
                        textAnchor="middle"
                        fill="hsl(var(--muted-foreground))"
                      >
                        No terrain coverage in this view
                      </text>
                    )}
                  </svg>
                )
              }}
            </SizedChart>
          )}
        </ChartViewport>
        {sourceGeometry && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-4rem)] flex-col items-start gap-1 text-3xs">
            {following ? (
              <p className="rounded border bg-background/90 px-1.5 py-0.5 font-medium" data-testid="road-3d-following">
                {playing ? 'Following' : 'Around'} {formatRoadStation(station)}
              </p>
            ) : (
              !interacted && (
                <p className="rounded bg-background/85 px-1.5 py-0.5 text-muted-foreground" data-testid="road-3d-hint">
                  Drag to pan · right-drag or Ctrl-drag to rotate · scroll to zoom
                </p>
              )
            )}
            {!!sourceGeometry.infilledCells && (
              <p
                role="status"
                data-testid="road-terrain-infill-note"
                className="rounded border bg-background/90 px-2 py-1 text-muted-foreground"
                title="Small enclosed gaps are estimated from surrounding terrain for display. Station elevations, quantities and reports retain the original missing data."
              >
                Estimated patches · display only
              </p>
            )}
          </div>
        )}
        {sourceGeometry && (
          <div
            className="absolute right-2 top-2 z-20 flex flex-col rounded border bg-background/90 shadow-sm"
            role="toolbar"
            aria-orientation="vertical"
            aria-label="3D camera"
          >
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-none"
              aria-label="Zoom terrain in"
              title="Zoom in (+)"
              onClick={() => zoomAt(1.25)}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-none border-b"
              aria-label="Zoom terrain out"
              title="Zoom out (−)"
              onClick={() => zoomAt(1 / 1.25)}
            >
              <Minus className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-none"
              aria-label="Face north"
              title="Compass: click to turn north up"
              data-north-degrees={Math.round(northDegrees) || 0}
              onClick={faceNorth}
            >
              <svg viewBox="-10 -10 20 20" className="size-4" aria-hidden="true">
                <g transform={`rotate(${northDegrees.toFixed(1)})`}>
                  <path d="M0,-8 L3,0 L-3,0 Z" fill="#e11d48" />
                  <path d="M0,8 L3,0 L-3,0 Z" fill="currentColor" opacity={0.45} />
                </g>
              </svg>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-none"
              aria-label="Rotate terrain left"
              title="Rotate left (Shift+←)"
              onClick={() => setYaw((value) => value - 15)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-none border-b"
              aria-label="Rotate terrain right"
              title="Rotate right (Shift+→)"
              onClick={() => setYaw((value) => value + 15)}
            >
              <RotateCw className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-none"
              aria-label="Centre on selected station"
              title="Centre on the selected station"
              disabled={!activeVertex}
              onClick={centreOnStation}
            >
              <Crosshair className="size-3.5" />
            </Button>
          </div>
        )}
        {sourceGeometry && groundColour !== 'plain' && (
          <TerrainColourLegend
            colour={groundColour}
            low={sourceGeometry.groundLow}
            high={sourceGeometry.groundHigh}
            maxGradePercent={terrainOnly ? undefined : maxGradePercent}
            exaggeration={exaggeration}
          />
        )}
      </div>
      <div className="shrink-0 text-3xs">
        {!terrainOnly && active && !active.complete && (
          <p
            role="status"
            data-testid="road-3d-incomplete-section"
            className="border-t px-2 py-1 text-amber-800 dark:text-amber-200"
          >
            {formatRoadStation(active.chainage)} ·{' '}
            {active.flags.some(isBeyondReachFlag)
              ? 'Batter extends beyond the sampled section reach. Increase “Section reach each side (m)” in Review, or revise the PVI elevations.'
              : !finite(active.designElevation)
                ? 'Formation elevation is unavailable. Set a vertical profile to show the road.'
                : 'Terrain is missing before the section meets the ground. Load terrain covering the full road footprint.'}{' '}
            {finite(active.designElevation) &&
              'Supported geometry remains visible; dashed red edges mark unfinished batters. Earthwork quantities remain incomplete.'}
          </p>
        )}
        {selectedCulvert && (
          <p className="text-rose-700 dark:text-rose-300" data-testid="road-3d-selected-culvert">
            Selected: {selectedCulvert.name} · {formatRoadStation(selectedCulvert.chainage)} · cover{' '}
            {selectedCulvert.coverM === null ? 'unknown' : `${selectedCulvert.coverM.toFixed(2)} m`}.{' '}
            {selectedCulvert.warnings.join(' ')}
          </p>
        )}
      </div>
    </div>
  )
}

/** What the ground colours mean, in the plan's degrees and the percent forestry works in. */
function TerrainColourLegend({
  colour,
  low,
  high,
  maxGradePercent,
  exaggeration,
}: {
  colour: Exclude<GroundColour, 'plain'>
  low: number
  high: number
  maxGradePercent?: number
  exaggeration: number
}) {
  const top = TERRAIN_SLOPE_STOPS[TERRAIN_SLOPE_STOPS.length - 1].value
  return (
    <div
      className="pointer-events-none absolute bottom-2 right-2 z-10 w-52 max-w-[calc(100%-3rem)] rounded border bg-background/90 px-2 py-1 text-3xs"
      data-testid="road-3d-legend"
    >
      {colour === 'slope' ? (
        <>
          <LegendTitle exaggeration={exaggeration}>Ground slope</LegendTitle>
          <div
            className="mt-0.5 h-2 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${TERRAIN_SLOPE_STOPS.map((stop) => `${stop.color} ${(stop.value / top) * 100}%`).join(', ')})`,
            }}
          />
          <div className="relative mt-0.5 h-6 tabular-nums text-muted-foreground">
            {TERRAIN_SLOPE_STOPS.map((stop, i) => (
              <span
                key={stop.value}
                className="absolute top-0 -translate-x-1/2 text-center leading-3"
                style={{
                  left: `${(stop.value / top) * 100}%`,
                  transform: i === 0 ? 'none' : i === TERRAIN_SLOPE_STOPS.length - 1 ? 'translateX(-100%)' : undefined,
                }}
              >
                {stop.value}°{i === TERRAIN_SLOPE_STOPS.length - 1 ? '+' : ''}
                <br />
                {percentOf(stop.value)}%
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <LegendTitle exaggeration={exaggeration}>Ground elevation</LegendTitle>
          <div
            className="mt-0.5 h-2 rounded-sm"
            style={{ background: `linear-gradient(to right, ${TERRAIN_ELEVATION_COLORS.join(', ')})` }}
          />
          <p className="flex justify-between tabular-nums text-muted-foreground">
            <span>{Math.round(low)} m</span>
            <span>{Math.round(high)} m</span>
          </p>
        </>
      )}
      {maxGradePercent !== undefined && (
        <p className="mt-0.5 flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: OVER_GRADE_FILL }} aria-hidden="true" />
          Road over {maxGradePercent}% grade
        </p>
      )}
    </div>
  )
}

/** Legend heading, with the drawn exaggeration when heights are not at true scale. */
function LegendTitle({ exaggeration, children }: { exaggeration: number; children: string }) {
  return (
    <p className="flex justify-between gap-2 font-medium">
      {children}
      {exaggeration !== 1 && (
        <span
          className="font-normal text-muted-foreground"
          data-testid="road-3d-exaggeration-note"
          title="Heights are drawn taller than true scale; slope colours and all values use true scale."
        >
          heights ×{exaggeration}
        </span>
      )}
    </p>
  )
}
