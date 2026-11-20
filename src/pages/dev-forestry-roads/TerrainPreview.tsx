import { RoadSelect } from './Controls'
import type { RoadSelectionRange } from './roadSelection'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChartViewport, SizedChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { useElementSize } from '@/hooks/useElementSize'
import { useSizeFold } from '@/hooks/useSizeFold'
import { InfoTip } from '@/components/ui/info-tip'
import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import {
  Crosshair,
  Eye,
  Grid3x3,
  Minus,
  PaintBucket,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  TriangleRight,
} from 'lucide-react'
import { TerrainCover, TerrainGround, type TerrainFace as Face } from './TerrainGround'
import { TerrainGpu } from './TerrainGpu'
import type { TerrainGpuHandle } from './terrainGpuTypes'
import type { TerrainRenderQuality } from './terrainRenderQuality'
import { terrainSceneFrame, terrainSceneGeometry, type TerrainSceneFrame } from './terrainSceneGeometry'
import { terrainScenePresentation } from './terrainScenePresentation'
import type { DesignSurfaceKind } from './designSurfaceExport'
import { stationOffsetCoordinate } from './designExports'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ROAD_CHART_COLORS, formatRoadStation } from './Charts'
import { sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import { terrainMesh, cachedTerrainSampler, type TerrainVertex as Vertex } from './terrainMesh'
import { CUT_BATTER_FILL, FILL_BATTER_FILL, previewEarthwork, type PreviewBatterEdge } from './previewEarthwork'
import { excavatedGround, occlusionTest, type OcclusionCover } from './terrainOcclusion'
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
import { isBeyondReachFlag, offsetCoordinate } from './engine'
import { gradeBreachBetween, gradeSpanOf, type GradeSpan } from './designStandards'
import { BARREL_MIN_OPENING_PX, barrelPolygons, culvertBarrel, shadedColour } from './culvertBarrel'
import { culvertRiseM, culvertShapeOf, culvertSpanM } from './culverts/culvertShape'
import type { Culvert } from './engineeringTypes'
import {
  TERRAIN_ELEVATION_COLORS,
  TERRAIN_SLOPE_STOPS,
  terrainElevationColor,
  terrainSlopeColor,
} from './terrainDisplay'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, TerrainSource, TerrainMetadata } from './types'

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

/** Geographic bearings must be projected with the geometry: grid north can differ from true north. */
function bearingInFrame(frame: Frame, coordinate: Coordinate, bearing: number) {
  const [x, y] = frame.point(coordinate)
  const [aheadX, aheadY] = frame.point(offsetCoordinate(coordinate, bearing, 10))
  return Math.atan2(aheadX - x, aheadY - y) / radians
}

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
  const [x, y] = frame.point(stationOffsetCoordinate(station, offset))
  return { x, y, z: elevation }
}

type GroundColour = 'slope' | 'elevation' | 'plain' | 'ortho'
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
  gradeSpan,
  meshOptions,
}: {
  analysis: RoadAnalysis
  frame: Frame
  bounds: number[]
  detail: number[] | null
  elevation: (x: number, y: number) => number
  fillGaps: boolean
  terrainOnly: boolean
  maxGradePercent: number | undefined
  gradeSpan: GradeSpan
  meshOptions?: { maxSide?: number; minSpacing?: number }
}) {
  // A coarse cell can have four valid corners around a real source gap.
  // Carry the analysis's missing samples into the display mesh as well.
  const missing: Array<[number, number]> = []
  for (const s of analysis.stations) {
    const [x, y] = frame.point(s.coordinate)
    if (!finite(s.groundElevation)) missing.push([x, y])
    for (const p of s.section) if (!finite(p.ground)) missing.push(frame.point(stationOffsetCoordinate(s, p.offset)))
  }
  const mesh = terrainMesh(bounds, elevation, missing, fillGaps, meshOptions)
  // A window from an earlier display window may reach past this one; keep only the overlap.
  const detail = requestedDetail && [
    Math.max(requestedDetail[0], bounds[0] - mesh.spacing),
    Math.max(requestedDetail[1], bounds[1] - mesh.spacing),
    Math.min(requestedDetail[2], bounds[2] + mesh.spacing),
    Math.min(requestedDetail[3], bounds[3] + mesh.spacing),
  ]
  const fine =
    detail && detail[2] > detail[0] && detail[3] > detail[1]
      ? terrainMesh(detail, elevation, missing, fillGaps, meshOptions)
      : null
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
            maxGradePercent !== undefined && gradeBreachBetween(analysis.stations, a.index, b.index, gradeSpan)
              ? OVER_GRADE_FILL
              : '#e8c886',
          station: (a.chainage + b.chainage) / 2,
          terrainGap: analysis.stations.slice(a.index, b.index + 1).some((s) => !finite(s.groundElevation)),
        })
    }
    const batters = previewEarthwork(analysis.stations.slice(a.index, b.index + 1), (s, offset, z) => {
      const [x, y] = frame.point(stationOffsetCoordinate(s, offset))
      return { x, y, z }
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
  culvertDesigns,
  maxGradePercent,
  alignment,
  terrainMetadata,
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
  /** The culverts as designed, for each barrel's shape and span; without them a barrel is round. */
  culvertDesigns?: Culvert[]
  /** Enables grade highlighting; the analysis's reviewed flags decide breaches, as on the plan. */
  maxGradePercent?: number
  /** Exact design surfaces and imported imagery, supplied by the road workspace. */
  alignment?: Alignment
  terrainMetadata?: TerrainMetadata
}) {
  const gradeSpan = gradeSpanOf(alignment ?? { vertical: [] })
  const [mode, setMode] = useState<'orbit' | 'follow'>('orbit')
  const [yaw, setYaw] = useState(DEFAULT_YAW)
  const [pitch, setPitch] = useState(DEFAULT_PITCH)
  const [exaggerationChoice, setExaggerationChoice] = useState<Exaggeration>('auto')
  const [wireframe, setWireframe] = useState(false)
  const [showEarthwork, setShowEarthwork] = useState(true)
  const [fillGaps, setFillGaps] = useState(true)
  const [groundColour, setGroundColour] = useState<GroundColour>('slope')
  const [quality, setQuality] = useState<TerrainRenderQuality>('auto')
  // What the road is drawn as: the cut-and-fill formation (the road's lanes and each batter strip, coloured by cut
  // and fill, as the canvas preview draws it), or one exact design surface.
  const [surfaceKind, setSurfaceKind] = useState<'formation' | DesignSurfaceKind>('formation')
  const [xray, setXray] = useState(false)
  const [cutaway, setCutaway] = useState(false)
  const [orthoId, setOrthoId] = useState('')
  const [renderer, setRenderer] = useState<'webgl' | 'canvas'>('canvas')
  const [rendererReason, setRendererReason] = useState<string>()
  const gpuHandle = useRef<TerrainGpuHandle | null>(null)
  const gpuEnabled = !!terrainMetadata
  const onRendererStatus = useCallback((status: 'webgl' | 'canvas', reason?: string) => {
    setRenderer(status)
    setRendererReason(reason)
  }, [])
  const orthophotos = useMemo(
    () => terrainMetadata?.backgrounds?.filter((layer) => layer.kind === 'ortho' && layer.visible) ?? [],
    [terrainMetadata],
  )
  const ortho = orthophotos.find((layer) => layer.id === orthoId) ?? orthophotos[orthophotos.length - 1]
  const shownColour = groundColour === 'ortho' && !ortho ? 'plain' : groundColour
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
  // The depth test and the batters it lets through, kept while the camera and geometry hold still, so
  // a station scrub neither rebuilds the buffer nor repaints the ground.
  const occlusionCache = useRef<{
    key: string
    occluders: unknown
    showEarthwork: boolean
    visible: ReturnType<typeof occlusionTest>['visible']
    earthwork: Face[]
    road: Face[]
    cover: OcclusionCover | null
  }>()
  const groundLayer = useRef<HTMLCanvasElement | null>(null)
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
  const frame = useMemo<Frame | TerrainSceneFrame>(
    () =>
      terrainMetadata
        ? terrainSceneFrame(terrainMetadata, analysis.stations[0]?.coordinate ?? [0, 0])
        : localFrame(analysis.stations[0]?.coordinate ?? [0, 0]),
    [analysis, terrainMetadata],
  )
  const cachedElevation = useMemo(
    () =>
      cachedTerrainSampler((x, y) => terrain.elevationAt(...frame.coordinate(x, y)), gpuEnabled ? 262144 : undefined),
    [frame, terrain, gpuEnabled],
  )
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
  const meshOptions = useMemo(
    () =>
      gpuEnabled
        ? {
            maxSide: rendererReason || quality === 'efficient' ? 128 : quality === 'high' ? 256 : 192,
            minSpacing: terrainMetadata?.resolutionM,
          }
        : undefined,
    [gpuEnabled, quality, terrainMetadata?.resolutionM, rendererReason],
  )
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
      gradeSpan,
      meshOptions: gpuEnabled ? { minSpacing: terrainMetadata?.resolutionM } : undefined,
    })
  }, [
    analysis,
    frame,
    followingStation,
    terrainOnly,
    cachedElevation,
    fillGaps,
    maxGradePercent,
    gradeSpan,
    gpuEnabled,
    terrainMetadata?.resolutionM,
  ])
  const sourceGeometry = useMemo(
    () =>
      base && (detail || gpuEnabled)
        ? {
            ...buildGeometry({
              analysis,
              frame,
              bounds: base.bounds,
              detail,
              elevation: cachedElevation,
              fillGaps,
              terrainOnly,
              maxGradePercent,
              gradeSpan,
              meshOptions,
            }),
            low: base.low,
            high: base.high,
            groundLow: base.groundLow,
            groundHigh: base.groundHigh,
            medianZ: base.medianZ,
          }
        : base,
    [
      base,
      detail,
      analysis,
      frame,
      cachedElevation,
      fillGaps,
      terrainOnly,
      maxGradePercent,
      gradeSpan,
      meshOptions,
      gpuEnabled,
    ],
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
        shownColour === 'ortho' ? 'plain' : shownColour,
        groundLow,
        groundHigh,
        exaggeration,
      ),
    }))
  }, [sourceGeometry, shownColour, exaggeration])

  const design = useMemo(
    () =>
      !terrainOnly && alignment && 'epsg' in frame && surfaceKind !== 'formation'
        ? terrainSceneGeometry({ kind: surfaceKind, alignment, analysis, frame })
        : null,
    [terrainOnly, alignment, analysis, frame, surfaceKind],
  )
  const presentation = useMemo(
    () =>
      gpuEnabled && sourceGeometry
        ? terrainScenePresentation({
            geometry: sourceGeometry,
            design,
            analysis,
            culvertDesigns,
            terrainOnly,
            colour: shownColour,
            ortho: shownColour === 'ortho' ? ortho : undefined,
            showEarthwork,
            maxGradePercent,
            gradeSpan,
          })
        : null,
    [
      gpuEnabled,
      sourceGeometry,
      design,
      analysis,
      culvertDesigns,
      terrainOnly,
      shownColour,
      ortho,
      showEarthwork,
      maxGradePercent,
      gradeSpan,
    ],
  )
  const gpuActive = gpuEnabled && !!presentation && !presentation.requiresCanvas && renderer === 'webgl'
  // Fit the stable whole-window geometry, never the optional detail patch.
  const fitVertices = useMemo(
    () =>
      base
        ? Array.from(
            new Set([
              ...base.ground.flatMap((face) => face.vertices),
              ...base.road.flatMap((face) => face.vertices),
              ...base.earthwork.flatMap((face) => face.vertices),
              ...(design?.footprint.flatMap((face) => clipFace(face, base.bounds)) ?? []),
            ]),
          )
        : [],
    [base, design],
  )

  // Ground the road's overlays are tested against: the ground as the formation and batters leave it,
  // since the display draws it unexcavated over a cut. A terrain-only transect has no footprint and
  // lies on the ground it would be tested against, so it is never culled.
  const occluders = useMemo(() => {
    if (!sourceGeometry || terrainOnly || gpuActive) return null
    const footprint = [...sourceGeometry.road, ...sourceGeometry.earthwork].map((face) => face.vertices)
    const spacing = sourceGeometry.detailSpacing ?? sourceGeometry.meshSpacing
    return {
      ground: excavatedGround(
        sourceGeometry.ground.map((face) => face.vertices),
        footprint,
        spacing / 4,
      ),
      // The mesh's error in height is drawn exaggerated, so the allowance grows with the exaggeration.
      tolerance: (spacing / 2) * Math.max(1, exaggeration),
    }
  }, [sourceGeometry, terrainOnly, exaggeration, gpuActive])

  const following = mode === 'follow' && active ? active : undefined
  const activeElevation = terrainOnly ? active?.groundElevation : (active?.designElevation ?? active?.groundElevation)
  const target = base
    ? following
      ? frame.point(following.coordinate)
      : [(base.bounds[0] + base.bounds[2]) / 2, (base.bounds[1] + base.bounds[3]) / 2]
    : [0, 0]
  const targetZ = base ? (following ? (activeElevation ?? base.medianZ) : (base.low + base.high) / 2) : 0
  const angleDegrees = following
    ? bearingInFrame(frame, following.coordinate, following.bearing) + yaw - DEFAULT_YAW
    : yaw
  const angle = angleDegrees * radians
  const tilt = (following ? clamp(pitch - 10, 15, 80) : pitch) * radians
  const activeVertex =
    active && finite(activeElevation)
      ? (() => {
          const [x, y] = frame.point(active.coordinate)
          return gpuActive
            ? (presentation?.data.stations.find((point) => point.station === active.chainage) ?? {
                x,
                y,
                z: activeElevation,
              })
            : { x, y, z: activeElevation }
        })()
      : null

  // Mesh a finer window around the focus once zooming or panning settles.
  const focusX = look?.x ?? target[0],
    focusY = look?.y ?? target[1]
  useEffect(() => {
    const next = base
      ? previewDetailWindow(
          base.bounds,
          zoom,
          { x: focusX, y: focusY },
          sourceGeometry?.meshSpacing ?? base.meshSpacing,
        )
      : null
    if (sameWindow(next, detail)) return
    const timer = setTimeout(() => setDetail(next), next ? 180 : 0)
    return () => clearTimeout(timer)
  }, [base, zoom, focusX, focusY, detail, sourceGeometry?.meshSpacing])

  const centreOnStation = () => {
    if (!activeVertex) return
    // Keep the focus's place on screen, so the view slides to the station rather than jumping.
    const screen = cameraView.current?.make(live.current.zoom, live.current.look).focus.screen
    const focus = { ...activeVertex, screen }
    live.current = { ...live.current, look: focus }
    setLook(focus)
    setInteracted(true)
  }
  const northBearing = bearingInFrame(frame, frame.coordinate(focusX, focusY), 0)
  const faceNorth = () => setYaw((value) => value + northBearing - angleDegrees)
  // Screen direction of north, clockwise from up; tilt foreshortens the ahead component.
  const northAngle = northBearing * radians - angle
  const northDegrees = (Math.atan2(Math.sin(northAngle), Math.cos(northAngle) * Math.sin(tilt)) * 180) / Math.PI

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
      data-renderer={gpuActive ? 'webgl' : 'canvas'}
      data-design-surface={design?.status}
      data-surface-kind={surfaceKind}
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
            size="xs"
            variant="ghost"
            aria-label="Fit terrain view"
            title="Fit the whole window in view and reset the angle (Home)"
            onClick={resetCamera}
          >
            Fit
          </Button>
          <div role="toolbar" aria-label="3D camera" className="flex items-center">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Zoom terrain in"
              title="Zoom in (+)"
              disabled={!sourceGeometry}
              onClick={() => zoomAt(1.25)}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Zoom terrain out"
              title="Zoom out (−)"
              disabled={!sourceGeometry}
              onClick={() => zoomAt(1 / 1.25)}
            >
              <Minus className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Face north"
              title="Compass: click to turn north up"
              data-north-degrees={Math.round(northDegrees) || 0}
              disabled={!sourceGeometry}
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
              size="icon-xs"
              variant="ghost"
              aria-label="Rotate terrain left"
              title="Rotate left (Shift+←)"
              disabled={!sourceGeometry}
              onClick={() => setYaw((value) => value - 15)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Rotate terrain right"
              title="Rotate right (Shift+→)"
              disabled={!sourceGeometry}
              onClick={() => setYaw((value) => value + 15)}
            >
              <RotateCw className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Centre on selected station"
              title="Centre on the selected station"
              disabled={!sourceGeometry || !activeVertex}
              onClick={centreOnStation}
            >
              <Crosshair className="size-3.5" />
            </Button>
          </div>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          {/* Display toggles are icons so the bar fits one row; pressed ones keep a tint. */}
          <Button
            size="icon-xs"
            variant="ghost"
            className="aria-pressed:bg-primary/10 aria-pressed:text-primary"
            aria-label="Mesh"
            title="Show the triangle mesh"
            aria-pressed={wireframe}
            onClick={() => setWireframe((value) => !value)}
          >
            <Grid3x3 className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="aria-pressed:bg-primary/10 aria-pressed:text-primary"
            aria-label="Fill small gaps in 3D display"
            aria-pressed={fillGaps}
            data-testid="road-terrain-fill-gaps"
            data-estimated-patches={!!sourceGeometry?.infilledCells}
            title={`${sourceGeometry?.infilledCells ? 'Showing estimated patches (display only). ' : ''}Fill small gaps: estimate small enclosed gaps for the 3D display only. Turn off to show the original source gaps. Calculations always use the original terrain.`}
            onClick={() => setFillGaps((value) => !value)}
          >
            <PaintBucket className="size-3.5" />
          </Button>
          {!terrainOnly && (
            <Button
              size="icon-xs"
              variant="ghost"
              className="aria-pressed:bg-primary/10 aria-pressed:text-primary"
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
            value={shownColour}
            onValueChange={(value) => setGroundColour(value as GroundColour)}
            options={[
              ...GROUND_COLOURS,
              ...(orthophotos.length ? [{ value: 'ortho', label: 'Orthophoto', disabled: !gpuActive }] : []),
            ]}
          />
          {shownColour === 'ortho' && orthophotos.length > 1 && (
            <RoadSelect
              ariaLabel="3D orthophoto"
              title="Imported orthophoto"
              className="h-7 max-w-40"
              value={ortho?.id ?? ''}
              onValueChange={setOrthoId}
              options={orthophotos.map((layer) => ({ value: layer.id, label: layer.name }))}
            />
          )}
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
        {gpuEnabled && (
          <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="3D presentation">
            {!terrainOnly && (
              <RoadSelect
                ariaLabel="3D road surface"
                title={
                  showEarthwork
                    ? 'Cut and fill colours the road and each batter; Finished and Subgrade draw that exact design surface'
                    : 'Batters are hidden: the road is drawn alone. Turn Batters on to choose a surface.'
                }
                disabled={!gpuActive || !showEarthwork}
                className="h-7 w-28"
                value={showEarthwork ? surfaceKind : 'formation'}
                onValueChange={(value) => setSurfaceKind(value as 'formation' | DesignSurfaceKind)}
                options={[
                  { value: 'formation', label: showEarthwork ? 'Cut and fill' : 'Road only' },
                  { value: 'finished', label: 'Finished' },
                  { value: 'subgrade', label: 'Subgrade' },
                ]}
              />
            )}
            <RoadSelect
              ariaLabel="Terrain render quality"
              title="Rendering quality; source elevations are unchanged"
              // Stays usable while a quality the accelerated view cannot draw falls back, so another can be chosen.
              disabled={!gpuEnabled || (!gpuActive && !presentation?.requiresCanvas)}
              className="h-7 w-28"
              value={quality}
              onValueChange={(value) => setQuality(value as TerrainRenderQuality)}
              options={[
                { value: 'auto', label: 'Auto quality' },
                { value: 'high', label: 'High quality' },
                { value: 'efficient', label: 'Efficient' },
              ]}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="X-ray structures"
              title="See buried culverts through the ground"
              disabled={!gpuActive}
              aria-pressed={xray}
              onClick={() => setXray((value) => !value)}
              className="aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              <Eye className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Cutaway at selected station"
              title="Cut the view at the selected cross-section"
              disabled={!gpuActive || !active}
              aria-pressed={cutaway}
              onClick={() => setCutaway((value) => !value)}
              className="aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              <Scissors className="size-3.5" />
            </Button>
            <InfoTip label="3D rendering and source detail" bubbleClassName="max-w-80">
              <span className="block">
                Auto quality sharpens after the camera stops. High increases the pixel budget; Efficient uses fewer
                pixels.
              </span>
              <span className="mt-1 block">
                Source: {terrainMetadata?.resolutionM ?? 'unknown'} m. Display mesh:{' '}
                {sourceGeometry?.detailSpacing ?? sourceGeometry?.meshSpacing ?? '—'} m. Height ×{exaggeration}.
                Rendering quality cannot add detail absent from the source.
              </span>
              <span className="mt-1 block">
                {terrainOnly
                  ? 'Terrain display only.'
                  : gpuActive && showEarthwork
                    ? (design?.notice ?? 'Simplified subgrade preview.')
                    : 'Simplified subgrade preview.'}{' '}
                {shownColour === 'ortho' && ortho ? `Image: ${ortho.name}; imported display pixels.` : ''}
              </span>
              <span className="mt-1 block">
                Culverts show entered count and dimensions. Multiple-barrel spacing and arch outlines are schematic; no
                installation spacing is inferred.
              </span>
            </InfoTip>
          </div>
        )}
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
                  fitVertices,
                }
                const camera = previewCamera({ ...cameraInputs, zoom, focus: look })
                cameraView.current = {
                  width,
                  height,
                  angle,
                  make: (nextZoom, focus) => previewCamera({ ...cameraInputs, zoom: nextZoom, focus }),
                }
                const { scale, cameraDistance, project } = camera
                const projectionKey = JSON.stringify([
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
                ])
                let occlusion = occlusionCache.current
                if (
                  !occlusion ||
                  occlusion.key !== projectionKey ||
                  occlusion.occluders !== (occluders ?? sourceGeometry) ||
                  occlusion.showEarthwork !== showEarthwork
                ) {
                  const test = !gpuActive && occluders ? occlusionTest({ ...occluders, project, width, height }) : null
                  const visible = test?.visible ?? (() => true)
                  const shown = (items: Face[]) => items.filter((face) => visible(face.vertices.map(project)))
                  const road = gpuActive ? NO_FACES : shown(sourceGeometry.road)
                  const earthwork = !gpuActive && showEarthwork ? shown(sourceGeometry.earthwork) : NO_FACES
                  occlusion = {
                    key: projectionKey,
                    occluders: occluders ?? sourceGeometry,
                    showEarthwork,
                    visible,
                    road,
                    earthwork,
                    cover: test?.cover([...road, ...earthwork].map((face) => face.vertices.map(project))) ?? null,
                  }
                  occlusionCache.current = occlusion
                }
                const { visible, road: visibleRoad } = occlusion
                const { bounds, frame: geometryFrame } = sourceGeometry
                const route = sourceGeometry.line.slice(1).flatMap((s, index) => {
                  const previous = sourceGeometry.line[index]
                  if (!s.vertex || !previous.vertex || !s.connected) return []
                  const clipped = clipLine(previous.vertex, s.vertex, bounds)
                  if (!clipped) return []
                  const first = project(clipped[0]),
                    last = project(clipped[1])
                  return visible([first, last]) ? [{ first, last, chainage: s.chainage }] : []
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
                    const [x, y] = geometryFrame.point(stationOffsetCoordinate(active, p.offset))
                    return {
                      x,
                      y,
                      z: p.ground as number,
                    }
                  }) ?? []
                const activePoint = activeVertex ? project(activeVertex) : null
                // Each culvert's barrel as a tube of quads, with its two openings (culvertBarrel.ts).
                // The tube is drawn over the road like RoadEng's see-through fill; only the faces
                // turned to the camera are drawn, so it reads solid without a depth sort of the scene.
                const culverts = terrainOnly
                  ? []
                  : (analysis.engineering?.culverts ?? []).map((culvert) => {
                      const design = culvertDesigns?.find((c) => c.id === culvert.id)
                      const crownRise = culvert.profile.find(
                        (p) => finite(p.crownElevation) && finite(p.invertElevation),
                      )
                      const riseM = design
                        ? culvertRiseM(design)
                        : crownRise
                          ? (crownRise.crownElevation as number) - (crownRise.invertElevation as number)
                          : 0
                      const barrel = culvertBarrel({
                        profile: culvert.profile.filter((p) => {
                          const [x, y] = geometryFrame.point(p.coordinate)
                          return x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3]
                        }),
                        riseM,
                        spanM: design ? culvertSpanM(design) : riseM,
                        shape: design ? culvertShapeOf(design) : 'round',
                        point: (coordinate) => geometryFrame.point(coordinate) as [number, number],
                        exaggeration,
                      })
                      return { culvert, barrel: barrel ? barrelPolygons(barrel, project) : null }
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
                    data-hidden-road-faces={sourceGeometry.road.length - visibleRoad.length}
                    aria-label={
                      terrainOnly
                        ? 'Three dimensional terrain surface and sampled transect. Drag to pan, right-drag or Ctrl-drag to rotate, scroll to zoom; arrow keys pan and Shift+arrows rotate.'
                        : 'Three dimensional terrain surface and road formation overlay. Drag to pan, right-drag or Ctrl-drag to rotate, scroll to zoom; arrow keys pan and Shift+arrows rotate.'
                    }
                    className="cursor-grab select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    onContextMenu={(event) => event.preventDefault()}
                    onDoubleClick={(event) => zoomAt(event.shiftKey ? 0.5 : 2, svgPoint(event, event.currentTarget))}
                    onClick={(event) => {
                      if (gpuActive) {
                        if (
                          !pointerStart.current ||
                          Math.hypot(event.clientX - pointerStart.current[0], event.clientY - pointerStart.current[1]) >
                            DRAG_THRESHOLD_PX
                        )
                          return
                        const p = svgPoint(event, event.currentTarget)
                        const picked = gpuHandle.current?.pick(p.x, p.y)
                        if (picked) {
                          if (picked.culvertId) onSelectCulvert?.(picked.culvertId)
                          onStation(picked.station)
                        }
                        return
                      }
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
                      const picked = [...occlusion.earthwork]
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
                    <rect width={width} height={height} fill="hsl(var(--muted))" opacity={0.3} />
                    {!gpuActive && (
                      <TerrainGround
                        faces={groundFaces}
                        overlays={occlusion.earthwork}
                        project={project}
                        width={width}
                        height={height}
                        wireframe={wireframe}
                        projectionKey={projectionKey}
                        groundLayer={groundLayer}
                      />
                    )}
                    {gpuEnabled && presentation && !presentation.requiresCanvas && (
                      <TerrainGpu
                        data={presentation.data}
                        handle={gpuHandle}
                        onStatus={onRendererStatus}
                        projectionKey={projectionKey}
                        view={{
                          camera,
                          angle,
                          tilt,
                          exaggeration,
                          width,
                          height,
                          quality,
                          wireframe,
                          showEarthwork,
                          xray,
                          selectedCulvertId,
                          bounds: sourceGeometry.bounds,
                          cutaway:
                            cutaway && activeVertex && active
                              ? {
                                  point: activeVertex,
                                  normal: (() => {
                                    const [x, y] = frame.point(stationOffsetCoordinate(active, 1))
                                    const dx = x - activeVertex.x,
                                      dy = y - activeVertex.y
                                    const length = Math.hypot(dx, dy) || 1
                                    return [-dy / length, dx / length] as [number, number]
                                  })(),
                                }
                              : null,
                        }}
                      />
                    )}
                    {faces(
                      gpuActive && selectedRange
                        ? sourceGeometry.road.filter(
                            (face) =>
                              face.station !== undefined &&
                              face.station >= selectedRange.start &&
                              face.station <= selectedRange.end,
                          )
                        : visibleRoad,
                    ).map((face, i) => (
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
                        opacity={gpuActive ? 0.35 : 0.95}
                        className="cursor-pointer"
                        onClick={() => onStation(face.station ?? 0)}
                      />
                    ))}
                    {showEarthwork &&
                      sourceGeometry.unfinishedEdges.map((edge, index) => {
                        const a = project(edge.a),
                          b = project(edge.b)
                        if (!visible([a, b])) return null
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
                    {!gpuActive &&
                      showEarthwork &&
                      sourceGeometry.ditches.map((segment, index) => {
                        const a = project(segment.a),
                          b = project(segment.b)
                        if (!visible([a, b])) return null
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
                          />
                        )
                      })}
                    {(!gpuActive || terrainOnly) &&
                      route.map((segment, i) => (
                        <line
                          key={`line${i}`}
                          x1={segment.first.x}
                          y1={segment.first.y}
                          x2={segment.last.x}
                          y2={segment.last.y}
                          stroke={
                            gpuActive
                              ? 'transparent'
                              : terrainOnly
                                ? ROAD_CHART_COLORS.ground
                                : ROAD_CHART_COLORS.design
                          }
                          strokeWidth={gpuActive ? 10 : terrainOnly ? 2.5 : 1.2}
                          strokeDasharray={gpuActive ? undefined : '3 2'}
                          opacity={0.9}
                          pointerEvents={terrainOnly ? 'stroke' : 'none'}
                          onClick={terrainOnly ? () => onStation(segment.chainage) : undefined}
                        />
                      ))}
                    {/* The ground in front of the road, drawn back over it pixel by pixel. */}
                    {!gpuActive && (
                      <TerrainCover
                        groundLayer={groundLayer}
                        cover={occlusion.cover}
                        width={width}
                        height={height}
                        faces={groundFaces}
                        wireframe={wireframe}
                        projectionKey={projectionKey}
                      />
                    )}
                    {!gpuActive &&
                      culverts
                        .sort(
                          (a, b) =>
                            Number(a.culvert.id === selectedCulvertId) - Number(b.culvert.id === selectedCulvertId),
                        )
                        .map(({ culvert, barrel }) => (
                          <g
                            key={culvert.id}
                            role="button"
                            tabIndex={barrel ? 0 : undefined}
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
                            {barrel &&
                              (() => {
                                const colour =
                                  selectedCulvertId === culvert.id
                                    ? ROAD_CHART_COLORS.selected
                                    : culvert.warnings.length
                                      ? '#dc2626'
                                      : '#0284c7'
                                if (barrel.openingPx < BARREL_MIN_OPENING_PX)
                                  return (
                                    <line
                                      x1={barrel.axis[0].x}
                                      y1={barrel.axis[0].y}
                                      x2={barrel.axis[1].x}
                                      y2={barrel.axis[1].y}
                                      stroke={colour}
                                      strokeWidth={selectedCulvertId === culvert.id ? 6 : 4}
                                    />
                                  )
                                return (
                                  <>
                                    {barrel.sides.map((side, index) => (
                                      <polygon
                                        key={`side-${index}`}
                                        points={side.points}
                                        fill={shadedColour(colour, side.light)}
                                        stroke={shadedColour(colour, side.light)}
                                        strokeWidth={0.5}
                                        strokeLinejoin="round"
                                      />
                                    ))}
                                    {barrel.ends.map((end, index) => (
                                      <polygon
                                        key={`end-${index}`}
                                        points={end}
                                        fill="#1e3a8a"
                                        stroke={colour}
                                        strokeWidth={selectedCulvertId === culvert.id ? 2 : 1.25}
                                      />
                                    ))}
                                  </>
                                )
                              })()}
                          </g>
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
          <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1 text-3xs">
            {following ? (
              <p
                className="rounded-sm border bg-background/90 px-1.5 py-0.5 font-medium"
                data-testid="road-3d-following"
              >
                {playing ? 'Following' : 'Around'} {formatRoadStation(station)}
              </p>
            ) : (
              !interacted && (
                <p
                  className="rounded-sm bg-background/85 px-1.5 py-0.5 text-muted-foreground"
                  data-testid="road-3d-hint"
                >
                  Drag to pan · right-drag or Ctrl-drag to rotate · scroll to zoom
                </p>
              )
            )}
          </div>
        )}
        {sourceGeometry && (shownColour === 'slope' || shownColour === 'elevation') && (
          <TerrainColourLegend
            colour={shownColour}
            low={sourceGeometry.groundLow}
            high={sourceGeometry.groundHigh}
            maxGradePercent={terrainOnly ? undefined : maxGradePercent}
            exaggeration={exaggeration}
            // The batters are keyed while they are drawn in their cut and fill colours: the canvas preview always, the
            // accelerated view while it draws the formation rather than one exact surface.
            batters={!terrainOnly && showEarthwork && (!gpuActive || surfaceKind === 'formation')}
          />
        )}
      </div>
      <div className="shrink-0 text-3xs">
        {rendererReason && (
          <p role="status" className="border-t px-2 py-1 text-muted-foreground">
            {rendererReason}
          </p>
        )}
        {presentation?.notice && (
          <p role="status" className="border-t px-2 py-1 text-muted-foreground">
            {presentation.notice}
          </p>
        )}
        {gpuActive && cutaway && (
          <p className="border-t px-2 py-1 text-muted-foreground">
            Cutaway at {formatRoadStation(station)} · display only
          </p>
        )}
        {!terrainOnly && active && !active.complete && (
          <p role="status" data-testid="road-3d-incomplete-section" className="border-t px-2 py-1 text-warning">
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

/**
 * What the ground colours mean, in the plan's degrees and the percent forestry works in. Drawn as the plan's legend is
 * (`PlanLegend.tsx`): the shared folding panel in the corner, a titled section, the gradient bar with its ticks and a
 * legend row, so the two views read alike.
 */
/** The 3D pane height below which its legend starts folded (with a gap, so a pane dragged across it does not flip). */
const LEGEND_FOLD = { foldBelow: 300, unfoldFrom: 320 }

function TerrainColourLegend({
  colour,
  low,
  high,
  maxGradePercent,
  exaggeration,
  batters = false,
}: {
  colour: 'slope' | 'elevation'
  low: number
  high: number
  maxGradePercent?: number
  exaggeration: number
  /** The batters are drawn in their cut and fill colours, so the legend keys them. */
  batters?: boolean
}) {
  // Folded on a short 3D pane, as the plan's legend starts folded: open, it would cover the middle of the view and take
  // its drags and wheel. A fold or unfold the reader chooses holds. The legend sits over the pane, so folding it never
  // changes the height measured.
  const [chosen, setChosen] = useState<boolean | null>(null)
  const [pane, setPane] = useState<Element | null>(null)
  const { height: paneHeight } = useElementSize(pane)
  const short = useSizeFold(paneHeight, LEGEND_FOLD)
  const collapsed = chosen ?? short
  const top = TERRAIN_SLOPE_STOPS[TERRAIN_SLOPE_STOPS.length - 1].value
  const last = TERRAIN_SLOPE_STOPS.length - 1
  // The heights note sits in the section's corner, where the plan's legend puts a section's action.
  const heights =
    exaggeration !== 1 ? (
      <span
        className="shrink-0 text-muted-foreground"
        data-testid="road-3d-exaggeration-note"
        title="Heights are drawn taller than true scale; slope colours and all values use true scale."
      >
        heights ×{exaggeration}
      </span>
    ) : undefined
  return (
    <div data-testid="road-3d-legend" ref={(element) => setPane(element?.parentElement ?? null)}>
      <MapLegendPanel
        title="Legend"
        collapsible
        collapsed={collapsed}
        onCollapsedChange={setChosen}
        width="sm"
        // The plan legend's corner, size and folded height (`PlanLegend.tsx`).
        className="road-map-legend bottom-2 right-2 flex max-h-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col rounded-md p-2 shadow-sm workspace-desktop:bottom-2 workspace-desktop:right-2 workspace-desktop:rounded-md workspace-desktop:p-2 data-[collapsed]:h-8 data-[collapsed]:justify-center data-[collapsed]:py-0 workspace-desktop:data-[collapsed]:py-0 [&>div:first-child]:shrink-0"
        contentClassName="min-h-0 max-h-64 overflow-y-auto overscroll-none text-2xs"
      >
        <div className="mt-1 space-y-3 border-t pt-1.5">
          {colour === 'slope' ? (
            <MapLegendSection title="Ground slope" actions={heights}>
              <MapGradientLegendItem
                className="py-1"
                aria-label="Ground slope in degrees and percent"
                colors={TERRAIN_SLOPE_STOPS.map((stop) => `${stop.color} ${(stop.value / top) * 100}%`)}
                // Each tick under its own point of the ramp: the ends to the edges, the rest centred.
                labelClassName="relative block h-7"
                ticks={TERRAIN_SLOPE_STOPS.map((stop, i) => (
                  <span
                    key={stop.value}
                    className="absolute top-0 text-center leading-tight tabular-nums"
                    style={{
                      left: `${(stop.value / top) * 100}%`,
                      transform: i === 0 ? 'none' : i === last ? 'translateX(-100%)' : 'translateX(-50%)',
                    }}
                  >
                    <span className="block text-foreground">
                      {stop.value}°{i === last ? '+' : ''}
                    </span>
                    <span className="block">{percentOf(stop.value)}%</span>
                  </span>
                ))}
              />
            </MapLegendSection>
          ) : (
            <MapLegendSection title="Ground elevation" actions={heights}>
              <MapGradientLegendItem
                className="py-1"
                aria-label="Ground elevation colours"
                colors={TERRAIN_ELEVATION_COLORS}
                labelClassName="tabular-nums"
                minLabel={`${Math.round(low)} m`}
                maxLabel={`${Math.round(high)} m`}
              />
            </MapLegendSection>
          )}
          {(maxGradePercent !== undefined || batters) && (
            <MapLegendSection title="Road">
              {batters && (
                <>
                  <LegendItem color={CUT_BATTER_FILL} swatchShape="square" label="Cut batter" />
                  <LegendItem color={FILL_BATTER_FILL} swatchShape="square" label="Fill batter" />
                </>
              )}
              {maxGradePercent !== undefined && (
                <LegendItem color={OVER_GRADE_FILL} swatchShape="square" label="Grade standard not met" />
              )}
            </MapLegendSection>
          )}
        </div>
      </MapLegendPanel>
    </div>
  )
}
