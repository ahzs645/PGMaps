/**
 * The VIA report's maps, planned and composed without a browser: which ground each map shows (the overview of the
 * blocks and viewpoints, a location map per viewpoint with its view wedge, a regional map at a much smaller scale,
 * and the overview again as an 11 × 17 topographic sheet at a round scale), the camera the plan map is put at to
 * capture it, and the figure drawn over the capture as sheet operations (`src/lib/mapSheet/drawOps.ts`): the visual
 * inventory hatched in its objective's colour and labelled with the VQO, the proposed blocks filled orange and
 * labelled, existing openings, each viewpoint as a star, a legend, a scale bar and a north arrow, as the block sheets
 * compose theirs (docs/forestry-block-map-sheets.md).
 *
 * The maps follow the reference reports: 01 p6 "VLI Map with Proposed Harvest" (imagery, hatched VLI polygons in
 * their objective's colour, orange blocks, star viewpoints), 22 Appendix A1 (viewpoint map) and 26 Figure 1 and its
 * figure pages ("Location map and viewpoint" with the view's wedge, "Regional map").
 *
 * Units are the capture's CSS pixels: the plan map is a north-up Web Mercator map at a known centre and zoom, so a
 * `FrameProjection` built from them (`frameProjectionFor`) lands every vertex where MapLibre drew it, and the scale
 * bar holds at the frame's centre latitude. No DOM or network access.
 */
import proj4 from 'proj4'

import { BLOCK_OF_INTEREST, SHEET_CHROME, VIA_FIGURE_MAP } from '@/lib/forestry/blockSheet/styles'
import { viewerConeFeatures } from '@/lib/geo/viewerCone'
import { boxesMeet, rectRing, type DrawOp, type Point } from '@/lib/mapSheet/drawOps'
import {
  FIT_SCALES,
  formatScale,
  frameProjection,
  inverseMercator,
  mercatorX,
  mercatorY,
  METRES_PER_INCH,
  metresPerPoint,
  POINTS_PER_INCH,
  scaleBar,
  type FrameProjection,
} from '@/lib/mapSheet/scale'
import {
  areaSymbolOps,
  lineSymbolOps,
  swatchOps,
  symbolKeyColor,
  type AreaSymbol,
  type LineSymbol,
} from '@/lib/mapSheet/symbols'
import { fitText, textWidth } from '@/lib/mapSheet/textMetrics'
import { ASSESSMENT_VIEWPOINT_COLOR, ROAD_COLOR } from './planMapStyle'
import { ROLE_COLORS } from './scene'
import { DEM_TILE_SIZE, demTileRange, EARTH_RADIUS_METERS } from '@/lib/forestry/terrain/terrain'
import type { TargetPolygon } from './types'
import { blockId } from './viaDocument/resolve'
import {
  bearingDegrees,
  haversineMeters,
  pointInPolygon,
  polygonBounds,
  polygonInteriorPoint,
  type PolygonGeometry,
} from './visibility'
import { EVQO_CODE_FOR_CLASS, EVQO_COLORS, EVQO_NAMES, type EvqoCode } from './visualsNarrative'
import type { VisualQualityClassId } from './vqo'

export type LngLat = [number, number]
/** West, south, east, north. */
export type LngLatBounds = [number, number, number, number]

export interface ReportViewpoint {
  /** The name the report gives the viewpoint; the per-viewpoint maps are keyed by it. */
  name: string
  lng: number
  lat: number
  /** Compass bearing of the view's centre line, and its horizontal field, degrees; null when not kept. */
  bearingDeg: number | null
  fovDeg: number | null
}

export interface ReportMapFeatures {
  blocks: ReadonlyArray<{ name: string; geometry: PolygonGeometry }>
  openings: ReadonlyArray<{ name: string; geometry: PolygonGeometry }>
  /** Wildlife tree patches and retention (the scene's `retained` masks); the end map draws them as WTRA. */
  retention?: ReadonlyArray<{ name: string; geometry: PolygonGeometry }>
  /** The visual inventory's polygons with their established VQO (null: none established); empty when not read. */
  inventory: ReadonlyArray<{ id: string; code: EvqoCode | null; label: string | null; geometry: PolygonGeometry }>
  /** The road the viewpoints are on, when the scene has one. */
  road: readonly LngLat[] | null
  viewpoints: readonly ReportViewpoint[]
  /**
   * The symbols a chosen map style draws the blocks and the existing openings with, in place of each map's own
   * (`ReportMapStyle`). Absent: every map keeps its own.
   */
  symbols?: ReportMapStyle
}

/**
 * A map style for the report's maps: a figure style's block and opening symbols (`visualsSheetSymbols`), drawn on the
 * overview map, the 11 × 17 sheet in either style and the figure page's location map, and listed in their legends.
 * A role the style does not draw keeps the map's own symbol.
 */
export type ReportMapStyle = { block?: AreaSymbol; opening?: AreaSymbol }

export type ReportMapKind = 'overview' | 'location' | 'regional' | 'sheet'

/** A centred window of the plan map's canvas, CSS pixels. */
export interface MapFrame {
  width: number
  height: number
}

export interface MapCamera {
  center: LngLat
  zoom: number
}

export interface ReportMapPlan {
  kind: ReportMapKind
  /** Viewpoint name for a location map; the kind otherwise. */
  key: string
  camera: MapCamera
  /**
   * Which of the plan map's basemaps it is captured on: imagery, the vector map, or the vector map with the plan's
   * hillshade (`topo`, the 11 × 17 sheet's topographic base).
   */
  basemap: 'satellite' | 'map' | 'topo'
  caption: string
  /** Location maps: the viewpoint whose wedge is drawn, and the wedge itself. */
  viewpoint?: ReportViewpoint
  wedge?: { ring: LngLat[]; lengthM: number }
  /** Regional maps: the overview's ground, marked as the project area. */
  projectArea?: LngLatBounds
  /**
   * The figure page's regional map: named places inside its frame that the basemap did not draw there, which the map
   * names itself (`regionalPlaceLabels`). Set at capture, where the names are read.
   */
  places?: readonly LabelledPlace[]
  /**
   * The 11 × 17 sheet: the round scale it states, true at the frame's centre latitude, the paper it is drawn for, and
   * its style (the landscape topographic sheet when absent).
   */
  sheet?: { scale: number; paper: { widthIn: number; heightIn: number }; style?: OverviewSheetStyle }
  /** The portrait end map's page, grid ticks, contour interval, terrain zoom and key map (`planEndMap`). */
  endMap?: EndMapPlan
  /**
   * `figure-page`: the location or regional map as 26's Figure 2 page prints it (`planFigurePageMaps`), with no
   * legend, scale bar, hatching or viewpoint label. The report's other maps when absent.
   */
  style?: 'figure-page'
  /** The window of the canvas this map is captured from, when it is not the report maps' common one. */
  frame?: MapFrame
}

/** Width over height of each map's window of the canvas. */
export const REPORT_MAP_ASPECT: Record<ReportMapKind, number> = {
  overview: 4 / 3,
  location: 4 / 3,
  regional: 4 / 3,
  sheet: 17 / 11,
}
/** Share of the frame left round the fitted ground on each side. */
export const FIT_PADDING_SHARE = 0.07
/**
 * Closest zoom a map is fitted at. Esri's imagery stops at z18 in rural BC (`map-satellite-imagery.tsx`), and a
 * report map wider than a few hundred metres is never needed closer.
 */
export const MAX_REPORT_ZOOM = 16.5
export const MIN_REPORT_ZOOM = 3
/** How much smaller the regional map's scale is than the overview's, in zoom levels (2⁴ = 16 times). */
export const REGIONAL_ZOOM_STEP = 4
/** The regional map is never closer than this zoom, so a single small block still sits in its region. */
export const MAX_REGIONAL_ZOOM = 11
/** The location map's wedge reaches the farthest block it covers by this factor, within these limits, metres. */
export const WEDGE_REACH = 1.12
export const MIN_WEDGE_M = 300
export const MAX_WEDGE_M = 40_000
/** Field drawn when a view kept none (a 50 mm lens on full frame is about 40°). */
export const DEFAULT_WEDGE_FOV_DEG = 40
/** MapLibre tiles are 512 px at zoom 0. */
const TILE = 512
const R = 6378137
const RAD = Math.PI / 180

/**
 * Proposed blocks as 01 p6 draws them: orange, sampled #f8a800–#ffaa00 from the reference page, the block sheets'
 * block-of-interest orange; a thin black edge keeps neighbouring blocks apart.
 */
const BLOCK_ORANGE = BLOCK_OF_INTEREST.default.outline.at(-1)!.color
export const REPORT_MAP_SYMBOLS = {
  block: {
    kind: 'area',
    label: 'Proposed block',
    fill: BLOCK_ORANGE,
    fillOpacity: 0.9,
    outline: [{ color: '#000000', width: 1.1, join: 'round' }],
  },
  opening: {
    kind: 'area',
    label: 'Existing opening',
    fill: ROLE_COLORS.harvested,
    fillOpacity: 0.35,
    outline: [
      { color: '#ffffff', width: 2.2, join: 'round' },
      { color: ROLE_COLORS.harvested, width: 1.3, join: 'round' },
    ],
  },
  wedge: {
    kind: 'area',
    label: 'View from the viewpoint',
    fill: ASSESSMENT_VIEWPOINT_COLOR,
    fillOpacity: 0.2,
    outline: [{ color: ASSESSMENT_VIEWPOINT_COLOR, width: 1.6, join: 'round' }],
  },
  projectArea: {
    kind: 'area',
    label: 'Project area (overview map)',
    outline: [
      { color: '#ffffff', width: 3.6, join: 'miter' },
      { color: SHEET_CHROME.northArrow, width: 2, join: 'miter' },
    ],
  },
  unrated: {
    kind: 'area',
    label: 'Inventory unit, no VQO established',
    outline: [{ color: '#e5e7eb', width: 1.2, dash: [4, 3], join: 'round' }],
  },
  road: {
    kind: 'line',
    label: 'Road',
    layers: [
      { color: '#ffffff', width: 4, cap: 'round', join: 'round' },
      { color: ROAD_COLOR, width: 2.2, cap: 'round', join: 'round' },
    ],
  },
} as const satisfies Record<string, AreaSymbol | LineSymbol>

/** A VQO polygon as 01 p6 hatches the inventory: 45° lines and an outline in the objective's colour. */
export function vqoSymbol(code: EvqoCode): AreaSymbol {
  const color = EVQO_COLORS[code]
  return {
    kind: 'area',
    label: `${EVQO_NAMES[code]} (${code}) VQO`,
    hatches: [{ angleDeg: 45, spacing: 9, stroke: { color, width: 1.1, opacity: 0.9 } }],
    outline: [
      { color: '#ffffff', width: 3, join: 'round', opacity: 0.6 },
      { color, width: 1.8, join: 'round' },
    ],
  }
}

/**
 * What the maps draw, from the page's state: the scene's blocks and existing openings, the visual inventory as read
 * (step 1's sensitivity units and the plan's established VQO polygons, one polygon each), the road and the saved
 * views' viewpoints. Nothing is read that the page has not read already.
 */
export function reportMapFeatures(input: {
  targets: readonly Pick<TargetPolygon, 'role' | 'name' | 'geometry'>[]
  units: ReadonlyArray<{
    id: string
    polygonNumber?: string | null
    objectiveId: VisualQualityClassId | null
    geometry: PolygonGeometry
  }>
  evqo: GeoJSON.FeatureCollection | null
  road: readonly LngLat[] | null
  viewpoints: readonly ReportViewpoint[]
  /** The scene's assessment masks; only wildlife tree patches / retention (`retained`) are drawn. */
  masks?: ReadonlyArray<{ name: string; kind: string; geometry: PolygonGeometry }>
  /** A chosen map style's symbols for the blocks and openings; absent, each map's own. */
  symbols?: ReportMapStyle
}): ReportMapFeatures {
  const inventory: Array<ReportMapFeatures['inventory'][number]> = input.units.map((unit) => ({
    id: unit.id,
    code: unit.objectiveId ? EVQO_CODE_FOR_CLASS[unit.objectiveId] : null,
    label: unit.polygonNumber || null,
    geometry: unit.geometry,
  }))
  const seen = new Set(inventory.map((unit) => unit.id))
  for (const feature of input.evqo?.features ?? []) {
    const id = String(feature.properties?.id ?? feature.id ?? '')
    const code = feature.properties?.code as EvqoCode | undefined
    if (!id || seen.has(id) || !code || !(code in EVQO_COLORS)) continue
    if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') continue
    seen.add(id)
    inventory.push({ id, code, label: null, geometry: feature.geometry })
  }
  return {
    blocks: input.targets.filter((target) => target.role === 'block').map(({ name, geometry }) => ({ name, geometry })),
    openings: input.targets
      .filter((target) => target.role === 'harvested')
      .map(({ name, geometry }) => ({ name, geometry })),
    retention: (input.masks ?? [])
      .filter((mask) => mask.kind === 'retained')
      .map(({ name, geometry }) => ({ name, geometry })),
    inventory,
    road: input.road && input.road.length > 1 ? input.road : null,
    viewpoints: input.viewpoints.filter((vp) => Number.isFinite(vp.lng) && Number.isFinite(vp.lat)),
    ...(input.symbols?.block || input.symbols?.opening ? { symbols: input.symbols } : {}),
  }
}

// ---------------------------------------------------------------- planning

const worldX = (lng: number) => (lng + 180) / 360
const worldY = (lat: number) => {
  const clamped = Math.max(-85.05, Math.min(85.05, lat)) * RAD
  return (1 - Math.log(Math.tan(Math.PI / 4 + clamped / 2)) / Math.PI) / 2
}
const fromWorld = (x: number, y: number): LngLat => [
  x * 360 - 180,
  (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) / RAD,
]

/** The largest window of the canvas at `aspect`, centred: what a map is captured from. */
export function captureFrame(canvas: MapFrame, aspect: number): MapFrame {
  const width = Math.min(canvas.width, canvas.height * aspect)
  return { width: Math.floor(width), height: Math.floor(width / aspect) }
}

/** The box round some points, or null when there are none. */
export function boundsOf(points: Iterable<LngLat>): LngLatBounds | null {
  const box: LngLatBounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    box[0] = Math.min(box[0], lng)
    box[1] = Math.min(box[1], lat)
    box[2] = Math.max(box[2], lng)
    box[3] = Math.max(box[3], lat)
  }
  return Number.isFinite(box[0]) ? box : null
}

const corners = (box: LngLatBounds): LngLat[] => [
  [box[0], box[1]],
  [box[2], box[3]],
]

/**
 * The north-up camera that shows `bounds` in `frame` with `paddingShare` of the frame left on each side, as
 * MapLibre's `fitBounds` would, held between `MIN_REPORT_ZOOM` and `maxZoom`.
 */
export function fitCamera(
  bounds: LngLatBounds,
  frame: MapFrame,
  paddingShare = FIT_PADDING_SHARE,
  maxZoom = MAX_REPORT_ZOOM,
  /** Extra share of the frame kept clear at the bottom, where the legend and scale bar are drawn. */
  bottomShare = paddingShare,
): MapCamera {
  const x0 = worldX(bounds[0]),
    x1 = worldX(bounds[2])
  const y0 = worldY(bounds[3]),
    y1 = worldY(bounds[1])
  const availableW = frame.width * (1 - 2 * paddingShare),
    availableH = frame.height * (1 - paddingShare - bottomShare)
  const zoomFor = (span: number, available: number) =>
    span > 0 ? Math.log2(available / (TILE * span)) : Number.POSITIVE_INFINITY
  const zoom = Math.max(MIN_REPORT_ZOOM, Math.min(maxZoom, zoomFor(x1 - x0, availableW), zoomFor(y1 - y0, availableH)))
  // The bounds sit centred in the space above the bottom strip: the map's centre moves down by half the difference.
  const shift = (((bottomShare - paddingShare) / 2) * frame.height) / (TILE * 2 ** zoom)
  return { center: fromWorld((x0 + x1) / 2, (y0 + y1) / 2 + shift), zoom }
}

/** Share of a report map's height the legend and scale bar take at the bottom, kept clear of the features. */
export const MAP_FURNITURE_SHARE = 0.3

/** Ground metres a CSS pixel covers at the camera's centre latitude. */
export const metresPerPixel = (camera: MapCamera) =>
  (2 * Math.PI * R * Math.cos(camera.center[1] * RAD)) / (TILE * 2 ** camera.zoom)

/**
 * The capture's projection, one unit per CSS pixel of the frame: the sheet engine's `frameProjection` at the scale
 * whose "point" is the pixel, so its Mercator maths match MapLibre's at the camera exactly.
 */
export function frameProjectionFor(camera: MapCamera, frame: MapFrame): FrameProjection {
  // `frameProjection` reads 72 units an inch; a pixel's ground is `metresPerPixel`.
  const unitScale = (metresPerPixel(camera) * 72) / 0.0254
  return frameProjection({ x: 0, y: 0, w: frame.width, h: frame.height }, camera.center, unitScale)
}

const ringsOf = (geometry: PolygonGeometry): LngLat[][][] =>
  (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as LngLat[][][]
const verticesOf = (geometry: PolygonGeometry) => ringsOf(geometry).flatMap((rings) => rings[0] ?? [])

const turn = (from: number, to: number) => Math.abs(((((to - from) % 360) + 540) % 360) - 180)

/**
 * The location map's view wedge: from the eye along the view's bearing over its field, out to just past the
 * farthest block corner inside the field (else the nearest block), within `MIN_WEDGE_M`–`MAX_WEDGE_M`. Null when
 * the view kept no bearing.
 */
export function viewWedge(
  viewpoint: ReportViewpoint,
  blocks: ReportMapFeatures['blocks'],
): { ring: LngLat[]; lengthM: number; blocks: string[] } | null {
  if (viewpoint.bearingDeg === null || !Number.isFinite(viewpoint.bearingDeg)) return null
  const fov = Math.min(170, Math.max(5, viewpoint.fovDeg ?? DEFAULT_WEDGE_FOV_DEG))
  const eye = { lng: viewpoint.lng, lat: viewpoint.lat }
  const { lengthM, covered } = wedgeReach(viewpoint.bearingDeg, fov, eye, blocks)
  const cone = viewerConeFeatures({ ...eye, bearing: viewpoint.bearingDeg, fovDegrees: fov }, lengthM).features[0]
  if (!cone || cone.geometry.type !== 'Polygon') return null
  return { ring: cone.geometry.coordinates[0] as LngLat[], lengthM, blocks: covered }
}

/**
 * How far a wedge from `eye` along `bearingDeg` over `fov` reaches: just past the farthest block corner inside the
 * field (else the nearest block's middle), by `WEDGE_REACH`, within `MIN_WEDGE_M`–`MAX_WEDGE_M`; and the blocks with
 * a corner inside it.
 */
function wedgeReach(
  bearingDeg: number,
  fov: number,
  eye: { lng: number; lat: number },
  blocks: ReportMapFeatures['blocks'],
): { lengthM: number; covered: string[] } {
  let reach = 0
  const covered: string[] = []
  for (const block of blocks) {
    let inside = false
    for (const [lng, lat] of verticesOf(block.geometry)) {
      if (turn(bearingDeg, bearingDegrees(eye, { lng, lat })) > fov / 2) continue
      inside = true
      reach = Math.max(reach, haversineMeters(eye, { lng, lat }))
    }
    if (inside) covered.push(block.name)
  }
  if (!reach)
    for (const block of blocks) {
      const centre = polygonInteriorPoint(block.geometry)
      if (centre) reach = reach ? Math.min(reach, haversineMeters(eye, centre)) : haversineMeters(eye, centre)
    }
  return { lengthM: Math.min(MAX_WEDGE_M, Math.max(MIN_WEDGE_M, (reach || MIN_WEDGE_M) * WEDGE_REACH)), covered }
}

const list = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** "Block 2", "Blocks 2, 20 and 21" or "Blocks 2, 20 and 21 and 2 more", whatever the names carry. */
const blockNames = (names: readonly string[]) => {
  const ids = names.map(blockId)
  const words = ids.length > 4 ? `${list(ids.slice(0, 3))} and ${ids.length - 3} more` : list(ids)
  return `${ids.length === 1 ? 'Block' : 'Blocks'} ${words}`
}

/**
 * The report's maps: the overview fitted to the blocks and viewpoints, a location map per viewpoint fitted to the
 * viewpoint, its wedge and the blocks inside it, and the regional map `REGIONAL_ZOOM_STEP` zoom levels out from the
 * overview with the overview's ground marked. Empty when there are no blocks and no viewpoints.
 */
export function planReportMaps(features: ReportMapFeatures, frame: MapFrame): ReportMapPlan[] {
  const blockPoints = features.blocks.flatMap((block) => corners(polygonBounds(block.geometry)))
  const viewpointPoints = features.viewpoints.map((vp): LngLat => [vp.lng, vp.lat])
  const overviewBounds = boundsOf([...blockPoints, ...viewpointPoints])
  if (!overviewBounds) return []
  const plans: ReportMapPlan[] = []
  const overview = fitCamera(overviewBounds, frame, FIT_PADDING_SHARE, MAX_REPORT_ZOOM, MAP_FURNITURE_SHARE)
  const inventory = features.inventory.some((unit) => unit.code)
  const names = features.blocks.map((block) => block.name)
  plans.push({
    kind: 'overview',
    key: 'overview',
    camera: overview,
    basemap: 'satellite',
    caption: `Proposed ${blockNames(names).replace(/^B/, 'b')}${
      features.viewpoints.length
        ? ` and the ${features.viewpoints.length === 1 ? 'viewpoint' : `${features.viewpoints.length} viewpoints`}`
        : ''
    }${inventory ? ', over the visual landscape inventory’s established VQO polygons' : ''}.`,
  })
  for (const viewpoint of features.viewpoints) {
    const wedge = viewWedge(viewpoint, features.blocks)
    const seen = wedge ? features.blocks.filter((block) => wedge.blocks.includes(block.name)) : features.blocks
    const bounds = boundsOf([
      [viewpoint.lng, viewpoint.lat],
      ...(wedge?.ring ?? []),
      ...seen.flatMap((block) => corners(polygonBounds(block.geometry))),
    ])
    if (!bounds) continue
    plans.push({
      kind: 'location',
      key: viewpoint.name,
      camera: fitCamera(bounds, frame, FIT_PADDING_SHARE, MAX_REPORT_ZOOM, MAP_FURNITURE_SHARE),
      basemap: 'satellite',
      viewpoint,
      ...(wedge ? { wedge: { ring: wedge.ring, lengthM: wedge.lengthM } } : {}),
      caption: wedge
        ? `Location map: ${viewpoint.name}, facing ${Math.round(((viewpoint.bearingDeg ?? 0) + 360) % 360)}° over a ${Math.round(
            viewpoint.fovDeg ?? DEFAULT_WEDGE_FOV_DEG,
          )}° field${wedge.blocks.length ? `, toward ${blockNames(wedge.blocks)}` : ''}; the wedge reaches ${(wedge.lengthM / 1000).toFixed(1)} km.`
        : `Location map: ${viewpoint.name} and the proposed blocks (the view’s bearing was not kept).`,
    })
  }
  const projectFrame = frameProjectionFor(overview, frame)
  plans.push({
    kind: 'regional',
    key: 'regional',
    camera: {
      center: overview.center,
      zoom: Math.max(MIN_REPORT_ZOOM, Math.min(MAX_REGIONAL_ZOOM, overview.zoom - REGIONAL_ZOOM_STEP)),
    },
    basemap: 'map',
    projectArea: projectFrame.bounds,
    caption: 'Regional map: the project area (the overview map’s ground, outlined in red) in its region.',
  })
  return plans
}

// ---------------------------------------------------------------- the figure page's maps (26's Figure 2)

/** Width over height of the figure page's side slots ("Location map and viewpoint", "Regional map"). */
export const FIGURE_PAGE_MAP_ASPECT = 0.8
/** The side slots' printed width, inches: the figure page's maps size their symbols in points on it. */
export const FIGURE_PAGE_MAP_WIDTH_IN = 2.3
/** Share of the location map's frame left round the wedge and the blocks in it, on each side. */
export const FIGURE_PAGE_PADDING_SHARE = 0.04
/** At the bottom, room for the sources' line under the viewpoint's star. */
export const FIGURE_PAGE_BOTTOM_SHARE = 0.07
/** The wedge's arc has a vertex every this many degrees, and at least `FIGURE_WEDGE_MIN_ARC_STEPS` steps. */
export const FIGURE_WEDGE_ARC_STEP_DEG = 1
export const FIGURE_WEDGE_MIN_ARC_STEPS = 12
/** The widest field a figure wedge draws, degrees: a panorama's total field, short of a full circle. */
export const FIGURE_WEDGE_MAX_FIELD_DEG = 330
/** The regional map's scale, true at its centre latitude printed `FIGURE_PAGE_MAP_WIDTH_IN` wide (26: about 1:300,000). */
export const FIGURE_REGIONAL_SCALE = 400_000
/**
 * The regional map's window of the canvas, CSS pixels wide. The basemap draws names and lines at a screen size, so
 * they print at a size this width sets; and it loads the tiles of its zoom, which this width also sets at a fixed
 * printed scale. 600 px puts 1:400,000 near zoom 10, whose tiles carry village names (zoom 9's carry only towns), and
 * the capture draws the basemap's type and highways larger to match (`regionalTypeScale`), so they print at about 6 pt.
 */
export const FIGURE_REGIONAL_FRAME_WIDTH = 600
/** The capture width the regional look's sizes (`VIA_FIGURE_MAP.regional`) are given for. */
export const FIGURE_REGIONAL_TYPE_BASE_PX = 300
/** How much larger the regional map's basemap type and highways are drawn on a capture `frameWidth` wide. */
export const regionalTypeScale = (frameWidth: number) => Math.max(1, frameWidth / FIGURE_REGIONAL_TYPE_BASE_PX)
/** The regional map goes out to this scale at most to take in the nearest named place (`regionalWithPlace`). */
export const FIGURE_REGIONAL_MAX_SCALE = 500_000
/** Share of the regional frame kept clear round the project and the place it is fitted to. */
export const FIGURE_REGIONAL_PADDING_SHARE = 0.1

/** The point `distanceM` from (lng, lat) along `bearingDeg`, on the sphere `haversineMeters` measures on. */
export function destinationPoint(lng: number, lat: number, bearingDeg: number, distanceM: number): LngLat {
  const d = distanceM / EARTH_RADIUS_METERS,
    theta = bearingDeg * RAD
  const phi1 = lat * RAD,
    lambda1 = lng * RAD
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(theta))
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(d) * Math.cos(phi1), Math.cos(d) - Math.sin(phi1) * Math.sin(phi2))
  return [(((lambda2 / RAD + 540) % 360) - 180) as number, phi2 / RAD]
}

export interface FigureWedge {
  /** The viewpoint, the wedge's apex. */
  apex: LngLat
  bearingDeg: number
  /** The field the wedge spans, degrees: the view's whole horizontal field. */
  spanDeg: number
  lengthM: number
  /** Apex, the arc from the field's left edge to its right, apex again. */
  ring: LngLat[]
  /** Blocks with a corner inside the field. */
  blocks: string[]
}

/**
 * The figure page's view wedge: from the viewpoint over the view's whole horizontal field (the saved view's or
 * panorama's total, `fovDeg`), with straight sides and a true arc at its far end, reaching just past the farthest
 * block corner in the field as the report's wedge does. Null when the view kept no bearing.
 */
export function figureWedge(viewpoint: ReportViewpoint, blocks: ReportMapFeatures['blocks']): FigureWedge | null {
  if (viewpoint.bearingDeg === null || !Number.isFinite(viewpoint.bearingDeg)) return null
  const span = Math.min(FIGURE_WEDGE_MAX_FIELD_DEG, Math.max(5, viewpoint.fovDeg ?? DEFAULT_WEDGE_FOV_DEG))
  const eye = { lng: viewpoint.lng, lat: viewpoint.lat }
  const { lengthM, covered } = wedgeReach(viewpoint.bearingDeg, span, eye, blocks)
  const steps = Math.max(FIGURE_WEDGE_MIN_ARC_STEPS, Math.ceil(span / FIGURE_WEDGE_ARC_STEP_DEG))
  const apex: LngLat = [viewpoint.lng, viewpoint.lat]
  const arc = Array.from({ length: steps + 1 }, (_, i) =>
    destinationPoint(viewpoint.lng, viewpoint.lat, viewpoint.bearingDeg! - span / 2 + (span * i) / steps, lengthM),
  )
  return { apex, bearingDeg: viewpoint.bearingDeg, spanDeg: span, lengthM, ring: [apex, ...arc, apex], blocks: covered }
}

/** The zoom at which `frame`, printed `widthIn` wide, shows 1:`scale` at latitude `lat`. */
export const zoomForPrintedScale = (scale: number, lat: number, frame: MapFrame, widthIn: number) =>
  Math.log2(
    (2 * Math.PI * R * Math.cos(lat * RAD)) / (TILE * ((scale * widthIn * METRES_PER_INCH) / Math.max(1, frame.width))),
  )
/** The scale `camera` shows when `frame` prints `widthIn` wide. */
export const printedScale = (camera: MapCamera, frame: MapFrame, widthIn: number) =>
  (metresPerPixel(camera) * frame.width) / (widthIn * METRES_PER_INCH)

/** A scale rounded to two significant figures, for a caption ("about 1:410,000"). */
const roundScale = (scale: number) => {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(scale)) - 1)
  return Math.round(scale / step) * step
}

/**
 * 26's Figure 2 maps, for the figure page (`ea-figure-pages`) only; the report's other maps are `planReportMaps`.
 * Per viewpoint, a location map on imagery fitted tightly to the view's wedge (`figureWedge`) and the blocks in it, at
 * the side slot's shape (`FIGURE_PAGE_MAP_ASPECT`); and one regional map on the vector road map at
 * `FIGURE_REGIONAL_SCALE` (out further only when the project would not fit), from a small window
 * (`FIGURE_REGIONAL_FRAME_WIDTH`) so its labels print readable, with the project's ground outlined. `canvas` is the
 * plan map's canvas, CSS pixels; each plan carries its own `frame`. Empty when there are no blocks and no viewpoints.
 */
export function planFigurePageMaps(features: ReportMapFeatures, canvas: MapFrame): ReportMapPlan[] {
  const blockPoints = features.blocks.flatMap((block) => corners(polygonBounds(block.geometry)))
  const viewpointPoints = features.viewpoints.map((vp): LngLat => [vp.lng, vp.lat])
  const projectBounds = boundsOf([...blockPoints, ...viewpointPoints])
  if (!projectBounds) return []
  const plans: ReportMapPlan[] = []
  const locationFrame = captureFrame(canvas, FIGURE_PAGE_MAP_ASPECT)
  for (const viewpoint of features.viewpoints) {
    const wedge = figureWedge(viewpoint, features.blocks)
    const seen = wedge ? features.blocks.filter((block) => wedge.blocks.includes(block.name)) : features.blocks
    const bounds = boundsOf([
      [viewpoint.lng, viewpoint.lat],
      ...(wedge?.ring ?? []),
      ...seen.flatMap((block) => corners(polygonBounds(block.geometry))),
    ])
    if (!bounds) continue
    plans.push({
      kind: 'location',
      key: viewpoint.name,
      style: 'figure-page',
      frame: locationFrame,
      camera: fitCamera(bounds, locationFrame, FIGURE_PAGE_PADDING_SHARE, MAX_REPORT_ZOOM, FIGURE_PAGE_BOTTOM_SHARE),
      basemap: 'satellite',
      viewpoint,
      ...(wedge ? { wedge: { ring: wedge.ring, lengthM: wedge.lengthM } } : {}),
      caption: wedge
        ? `Location map: ${viewpoint.name}, facing ${Math.round((wedge.bearingDeg + 360) % 360)}° over its ${Math.round(
            wedge.spanDeg,
          )}° field${wedge.blocks.length ? `, toward ${blockNames(wedge.blocks)}` : ''}; the view is drawn to ${(wedge.lengthM / 1000).toFixed(1)} km.`
        : `Location map: ${viewpoint.name} and the proposed blocks (the view’s bearing was not kept).`,
    })
  }
  const regionalWidth = Math.min(
    canvas.width,
    FIGURE_REGIONAL_FRAME_WIDTH,
    Math.floor(canvas.height * FIGURE_PAGE_MAP_ASPECT),
  )
  const regionalFrame: MapFrame = {
    width: Math.floor(regionalWidth),
    height: Math.floor(regionalWidth / FIGURE_PAGE_MAP_ASPECT),
  }
  const fitted = fitCamera(projectBounds, regionalFrame, 0.2, MAX_REGIONAL_ZOOM, 0.2)
  const zoom = Math.max(
    MIN_REPORT_ZOOM,
    Math.min(
      MAX_REGIONAL_ZOOM,
      fitted.zoom,
      zoomForPrintedScale(FIGURE_REGIONAL_SCALE, fitted.center[1], regionalFrame, FIGURE_PAGE_MAP_WIDTH_IN),
    ),
  )
  const camera: MapCamera = { center: fitted.center, zoom }
  plans.push({
    kind: 'regional',
    key: 'regional',
    style: 'figure-page',
    frame: regionalFrame,
    camera,
    basemap: 'map',
    projectArea: projectBounds,
    caption: regionalCaption(camera, regionalFrame, features.viewpoints.length, null),
  })
  return plans
}

const regionalCaption = (camera: MapCamera, frame: MapFrame, viewpoints: number, place: string | null) =>
  `Regional map at about ${formatScale(roundScale(printedScale(camera, frame, FIGURE_PAGE_MAP_WIDTH_IN)))}: the project (outlined) and its viewpoint${
    viewpoints === 1 ? '' : 's'
  } ${place ? `with ${place}, the nearest named place,` : ''} in the region’s roads and towns.`.replace('  ', ' ')

/**
 * The figure page's regional map as one viewpoint's page prints it: the same camera and capture, starring only that
 * viewpoint, as 26's Figures 2 and 3 each star their own. A report with several viewpoints draws one per page
 * (`captureReportMap`), so a page's star is never another page's viewpoint.
 */
export function regionalForViewpoint(plan: ReportMapPlan, viewpoint: ReportViewpoint): ReportMapPlan {
  return { ...plan, key: viewpoint.name, viewpoint, caption: plan.caption.replace('its viewpoints', 'its viewpoint') }
}

/** A place the basemap names on the regional map (a town, village or hamlet), read at capture. */
export interface LabelledPlace {
  name: string
  lng: number
  lat: number
}

/** The basemap's place-name layers (towns, villages, hamlets, cities), whose drawn names `regionalWithPlace` reads. */
export const placeLayerIds = (layers: readonly BasemapLayerInfo[]) =>
  layers
    .filter(
      (layer) =>
        layer.type === 'symbol' &&
        /^places?$/.test(layer['source-layer'] ?? '') &&
        /hamlet|village|town|city/.test(layer.id.toLowerCase()),
    )
    .map((layer) => layer.id)

/**
 * The figure page's regional map, taking in the nearest named place: when the nearest of `places` (the names the
 * basemap drew round the regional camera) lies outside the frame, the frame is fitted to the project and that place
 * together, never closer than `FIGURE_REGIONAL_SCALE` and only when that fits by `FIGURE_REGIONAL_MAX_SCALE`. The plan
 * as it was when a named place is already in the frame, when there is none, or when the nearest is too far.
 */
export function regionalWithPlace(
  plan: ReportMapPlan,
  places: readonly LabelledPlace[],
  viewpointCount: number,
): ReportMapPlan {
  if (plan.kind !== 'regional' || plan.style !== 'figure-page' || !plan.projectArea || !plan.frame) return plan
  const frame = plan.frame
  const [w, s, e, n] = plan.projectArea
  const centre = { lng: (w + e) / 2, lat: (s + n) / 2 }
  const inFrame = placeInFrame(plan.camera, frame)
  const named = places.filter((place) => place.name && Number.isFinite(place.lng) && Number.isFinite(place.lat))
  if (!named.length || named.some(inFrame)) return plan
  const nearest = named.reduce((best, place) =>
    haversineMeters(centre, place) < haversineMeters(centre, best) ? place : best,
  )
  const bounds = boundsOf([...corners(plan.projectArea), [nearest.lng, nearest.lat]])!
  const fitted = fitCamera(
    bounds,
    frame,
    FIGURE_REGIONAL_PADDING_SHARE,
    MAX_REGIONAL_ZOOM,
    FIGURE_REGIONAL_PADDING_SHARE,
  )
  const closest = zoomForPrintedScale(FIGURE_REGIONAL_SCALE, fitted.center[1], frame, FIGURE_PAGE_MAP_WIDTH_IN)
  const camera: MapCamera = { center: fitted.center, zoom: Math.min(fitted.zoom, closest) }
  if (printedScale(camera, frame, FIGURE_PAGE_MAP_WIDTH_IN) > FIGURE_REGIONAL_MAX_SCALE * 1.0001) return plan
  return { ...plan, camera, caption: regionalCaption(camera, frame, viewpointCount, nearest.name) }
}

/** Whether a place lies inside `frame` at `camera`, clear of half the regional padding at every edge. */
function placeInFrame(camera: MapCamera, frame: MapFrame) {
  const projection = frameProjectionFor(camera, frame)
  const margin = FIGURE_REGIONAL_PADDING_SHARE / 2
  return (place: LabelledPlace) => {
    const [x, y] = projection.project(place.lng, place.lat)
    return (
      x >= frame.width * margin &&
      x <= frame.width * (1 - margin) &&
      y >= frame.height * margin &&
      y <= frame.height * (1 - margin)
    )
  }
}

/**
 * The zoom whose tiles the regional map reads the places it names itself from: CARTO's vector tiles carry localities
 * and hamlets (their `min_zoom` 13) only from zoom 12, and the regional camera stands near zoom 10, whose nearest
 * name to Marblehead was Kaslo, 38 km away, while Meadow Creek and Howser lie inside the frame.
 */
export const FIGURE_REGIONAL_PLACE_READ_ZOOM = 12
/** The most places the regional map names itself: enough to place the project, few enough to read. */
export const FIGURE_REGIONAL_PLACE_LABELS = 4
/** Places the regional map names itself lie at least this share of the frame's width apart, so names never crowd. */
export const FIGURE_REGIONAL_PLACE_SPACING_SHARE = 0.18

/**
 * The named places the figure page's regional map names itself: those inside its frame (clear of half the padding)
 * that the basemap did not draw (`drawn`, by name), nearest the project first, each at least
 * `FIGURE_REGIONAL_PLACE_SPACING_SHARE` of the frame's width from every one kept, at most
 * `FIGURE_REGIONAL_PLACE_LABELS`. Empty for any other map. Places come once each by name, the first given kept.
 */
export function regionalPlaceLabels(
  plan: ReportMapPlan,
  places: readonly LabelledPlace[],
  drawn: readonly string[] = [],
): LabelledPlace[] {
  if (plan.kind !== 'regional' || plan.style !== 'figure-page' || !plan.projectArea || !plan.frame) return []
  const frame = plan.frame
  const [w, s, e, n] = plan.projectArea
  const centre = { lng: (w + e) / 2, lat: (s + n) / 2 }
  const inFrame = placeInFrame(plan.camera, frame)
  const projection = frameProjectionFor(plan.camera, frame)
  const skip = new Set(drawn)
  const candidates = new Map<string, LabelledPlace>()
  for (const place of places)
    if (
      place.name &&
      !skip.has(place.name) &&
      !candidates.has(place.name) &&
      Number.isFinite(place.lng) &&
      Number.isFinite(place.lat) &&
      inFrame(place)
    )
      candidates.set(place.name, place)
  const spacing = frame.width * FIGURE_REGIONAL_PLACE_SPACING_SHARE
  const kept: Array<{ place: LabelledPlace; at: Point }> = []
  for (const place of [...candidates.values()].sort(
    (a, b) => haversineMeters(centre, a) - haversineMeters(centre, b),
  )) {
    if (kept.length >= FIGURE_REGIONAL_PLACE_LABELS) break
    const at = projection.project(place.lng, place.lat)
    if (kept.some((other) => Math.hypot(other.at[0] - at[0], other.at[1] - at[1]) < spacing)) continue
    kept.push({ place, at })
  }
  return kept.map((entry) => entry.place)
}

/** A basemap layer as `getStyle().layers` lists it: what `figureRegionalLook` reads. */
export interface BasemapLayerInfo {
  id: string
  type: string
  'source-layer'?: string
  minzoom?: number
  maxzoom?: number
}
/** One change `figureRegionalLook` makes to the basemap while the regional map is captured. */
export type BasemapOverride =
  | { id: string; kind: 'paint'; property: string; value: string | number }
  | { id: string; kind: 'layout'; property: string; value: string | number }
  | { id: string; kind: 'zoom'; minzoom: number; maxzoom: number }
/** Place names are shown from this zoom on the regional map: villages too (positron starts them at 10). */
export const FIGURE_REGIONAL_PLACE_MINZOOM = 7
/**
 * Hamlets are named from this zoom (positron starts them at 12): in rural BC the nearest named place is often one.
 * Positron's hamlet layer adds city neighbourhoods only from zoom 14, so this brings in no city clutter.
 */
export const FIGURE_REGIONAL_HAMLET_MINZOOM = 9
/** Highway lines are drawn from this zoom on the regional map: secondary ones too (positron starts them at 11). */
export const FIGURE_REGIONAL_ROAD_MINZOOM = 8

/**
 * The regional map's road-map look (`VIA_FIGURE_MAP.regional`) as changes to the plan's vector basemap, in CARTO's
 * Protomaps schema (`roads`, `places`, `water`) or OpenMapTiles' (`transportation`, `place`, `water_name`): highway
 * lines (motorway, trunk, primary and secondary) orange over a darker edge from `FIGURE_REGIONAL_ROAD_MINZOOM`, place
 * and water names dark on a white halo, town and village names from `FIGURE_REGIONAL_PLACE_MINZOOM`, and hamlets from `FIGURE_REGIONAL_HAMLET_MINZOOM`, every
 * name at a set size; sizes and widths are times `typeScale` (`regionalTypeScale` of the capture's width). The capture applies them only while it stands at the regional map's
 * camera and puts every one back. Positron draws its roads near-white on near-white, which left 26's regional map
 * with no road or name to read.
 */
export function figureRegionalLook(layers: readonly BasemapLayerInfo[], typeScale = 1): BasemapOverride[] {
  const look = VIA_FIGURE_MAP.regional
  const out: BasemapOverride[] = []
  const paint = (id: string, property: string, value: string | number) =>
    out.push({ id, kind: 'paint', property, value })
  for (const layer of layers) {
    const source = layer['source-layer'] ?? ''
    const id = layer.id.toLowerCase()
    if (layer.type === 'line' && (source === 'roads' || source === 'transportation')) {
      const road = /(^|_)(mot|motorway|trunk|pri|primary|sec|secondary)(_|$)/.exec(id)
      if (!road || /tunnel|rail|path|_ramp|link/.test(id)) continue
      const casing = /case|casing/.test(id)
      const width = /^sec/.test(road[2]) ? look.secondaryWidth : look.highwayWidth
      paint(layer.id, 'line-color', casing ? look.highwayEdge : look.highway)
      paint(layer.id, 'line-width', (casing ? width + 1.2 : width) * typeScale)
      if ((layer.minzoom ?? 0) > FIGURE_REGIONAL_ROAD_MINZOOM)
        out.push({ id: layer.id, kind: 'zoom', minzoom: FIGURE_REGIONAL_ROAD_MINZOOM, maxzoom: layer.maxzoom ?? 24 })
    } else if (layer.type === 'symbol' && /^(places?|water|water_name)$/.test(source)) {
      const water = source.startsWith('water')
      paint(layer.id, 'text-color', water ? look.waterLabel : look.label)
      paint(layer.id, 'text-halo-color', look.labelHalo)
      paint(layer.id, 'text-halo-width', look.labelHaloWidth * typeScale)
      const from = water
        ? null
        : /hamlet/.test(id)
          ? FIGURE_REGIONAL_HAMLET_MINZOOM
          : /village|town|city/.test(id)
            ? FIGURE_REGIONAL_PLACE_MINZOOM
            : null
      if (from !== null && (layer.minzoom ?? 0) > from)
        out.push({ id: layer.id, kind: 'zoom', minzoom: from, maxzoom: layer.maxzoom ?? 24 })
      const size = water
        ? look.waterLabelSize
        : /hamlet|village/.test(id)
          ? look.smallPlaceSize
          : /town|city/.test(id)
            ? look.townSize
            : null
      if (size !== null) out.push({ id: layer.id, kind: 'layout', property: 'text-size', value: size * typeScale })
    }
  }
  return out
}

/** The overview sheet's paper: 11 × 17 in, landscape (05's 1:40,000 map, 22/23's Appendix A1). */
export const OVERVIEW_SHEET_PAPER = { widthIn: 17, heightIn: 11 } as const
/** The sheet's pixels: 11 × 17 at about 194 dpi, 17:11 so the report prints it on a sheet page of its own. */
export const OVERVIEW_SHEET_PIXELS = { width: 3300, height: Math.round((3300 * 11) / 17) } as const
/** Largest scale (smallest denominator) the sheet is fitted at: closer than that, the location maps show it. */
export const MIN_SHEET_SCALE = 5000
/** Share of the sheet's height kept clear at the bottom for its legend and scale bar. */
export const SHEET_FURNITURE_SHARE = 0.24
/** Symbols and text on the sheet, in points printed on the 11 × 17 paper, are this many times a report map's. */
export const SHEET_SYMBOL_SCALE = 1.25

/**
 * The overview as an 11 × 17 topographic sheet: every block and every viewpoint fitted inside the sheet's padding
 * (the bottom `SHEET_FURNITURE_SHARE` left to the legend and scale bar) at the largest round scale of `FIT_SCALES`
 * that holds them, as the block sheets fit theirs. `frame` is the canvas window it is captured from (17:11,
 * `captureFrame`); its zoom puts the stated scale at the frame's centre latitude when the frame prints
 * `OVERVIEW_SHEET_PAPER` wide. Null when there are no blocks and no viewpoints.
 */
export function planOverviewSheet(
  features: ReportMapFeatures,
  frame: MapFrame,
  style: OverviewSheetStyle = DEFAULT_OVERVIEW_SHEET_STYLE,
): ReportMapPlan | null {
  if (style === 'end-map-portrait') return planEndMap(features, frame)
  const bounds = boundsOf([
    ...features.blocks.flatMap((block) => corners(polygonBounds(block.geometry))),
    ...features.viewpoints.map((vp): LngLat => [vp.lng, vp.lat]),
  ])
  if (!bounds) return null
  const paper = OVERVIEW_SHEET_PAPER
  const widthPt = paper.widthIn * POINTS_PER_INCH,
    heightPt = paper.heightIn * POINTS_PER_INCH
  const availableW = widthPt * (1 - 2 * FIT_PADDING_SHARE),
    availableH = heightPt * (1 - FIT_PADDING_SHARE - SHEET_FURNITURE_SHARE)
  // The fit is measured at the ground's centre latitude, where Web Mercator's stretch is 1 / cos(latitude).
  const x0 = mercatorX(bounds[0]),
    x1 = mercatorX(bounds[2])
  const y0 = mercatorY(bounds[1]),
    y1 = mercatorY(bounds[3])
  const cos = Math.cos(inverseMercator(0, (y0 + y1) / 2)[1] * RAD)
  const scales = FIT_SCALES.filter((scale) => scale >= MIN_SHEET_SCALE)
  const scale =
    scales.find(
      (candidate) =>
        ((x1 - x0) * cos) / metresPerPoint(candidate) <= availableW &&
        ((y1 - y0) * cos) / metresPerPoint(candidate) <= availableH,
    ) ?? scales[scales.length - 1]
  // The ground sits centred in the space above the bottom strip: the map's centre moves down by half the difference.
  const shiftPt = ((SHEET_FURNITURE_SHARE - FIT_PADDING_SHARE) / 2) * heightPt
  const center = inverseMercator((x0 + x1) / 2, (y0 + y1) / 2 - (shiftPt * metresPerPoint(scale)) / cos)
  // The zoom whose frame, printed the paper's width, is at `scale` at the frame's own centre latitude.
  const groundPerPixel = (scale * paper.widthIn * METRES_PER_INCH) / frame.width
  const zoom = Math.log2((2 * Math.PI * R * Math.cos(center[1] * RAD)) / (TILE * groundPerPixel))
  const names = features.blocks.map((block) => block.name)
  const viewpoints = features.viewpoints.map((vp) => vp.name)
  return {
    kind: 'sheet',
    key: 'sheet',
    camera: { center, zoom },
    basemap: 'topo',
    sheet: { scale, paper: { ...paper } },
    caption: `Overview at ${formatScale(scale)} (11 × 17): ${names.length ? `proposed ${blockNames(names).replace(/^B/, 'b')}` : 'the viewpoints'}${
      names.length && viewpoints.length ? ` and viewpoint${viewpoints.length === 1 ? '' : 's'} ${list(viewpoints)}` : ''
    }, on the topographic base map.`,
  }
}

// ---------------------------------------------------------------- the portrait end map

/**
 * How the 11 × 17 overview sheet is drawn: the landscape topographic sheet (vector map and hillshade, VQO polygons
 * hatched; 22/23's Appendix A1) or the portrait end map a consultant prints as the last page of a 2001-form VIA
 * (contours on a plain base, VQO linework, a title block and key map; 05's "VIA Overview Map").
 */
export type OverviewSheetStyle = 'topo-landscape' | 'end-map-portrait'
export const OVERVIEW_SHEET_STYLES: ReadonlyArray<{ id: OverviewSheetStyle; label: string }> = [
  { id: 'topo-landscape', label: 'Landscape topographic (17 × 11)' },
  { id: 'end-map-portrait', label: 'Portrait end map (11 × 17)' },
]
export const DEFAULT_OVERVIEW_SHEET_STYLE: OverviewSheetStyle = 'topo-landscape'

/** The end map's paper: 11 × 17 in, portrait. */
export const END_MAP_PAPER = { widthIn: 11, heightIn: 17 } as const
/** Its pixels: the topographic sheet's 3300 along the long side (about 194 dpi), 11:17. */
export const END_MAP_PIXELS = { width: Math.round((3300 * 11) / 17), height: 3300 } as const
/** Page margin, title band, the strip for the grid tick labels round the neat line and the footer line, points. */
export const END_MAP_MARGIN_PT = 22
export const END_MAP_TITLE_PT = 92
export const END_MAP_TICK_MARGIN_PT = 22
export const END_MAP_FOOTER_PT = 14
/** The key map is this many times the sheet's scale (2⁴, as the regional map's four zoom levels). */
export const KEY_MAP_SCALE_FACTOR = 16
/** Round grid intervals, metres; the ticks take the first at least `UTM_TICK_MIN_IN` apart on paper. */
export const UTM_TICK_INTERVALS = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000] as const
export const UTM_TICK_MIN_IN = 0.8
/** Contours are traced on a grid of one sample per this many points of paper, as the block sheets trace theirs. */
export const END_MAP_CONTOUR_GRID_PT = 2.5
/** Terrain tiles the end map reads for its contours, at most; past it the terrain zoom steps out. */
export const END_MAP_MAX_DEM_TILES = 64
/** Closest and farthest terrain zooms read for contours (z13 is about 12 m a pixel in central BC). */
export const END_MAP_DEM_ZOOMS = { min: 8, max: 13 } as const

type PageBox = { x: number; y: number; w: number; h: number }

/** Where everything sits on the end map's page, points from its top-left. */
export interface EndMapLayout {
  page: PageBox
  /** The title band across the top: the logo slot at its left, the title in its middle, the key map at its right. */
  title: PageBox
  logo: PageBox
  heading: PageBox
  keyMap: PageBox
  /** The map's neat line; the grid tick labels sit in the strip outside it. */
  map: PageBox
  /** The line under the map for the grid, contour and source notes. */
  footer: PageBox
}

export function endMapLayout(): EndMapLayout {
  const W = END_MAP_PAPER.widthIn * POINTS_PER_INCH,
    H = END_MAP_PAPER.heightIn * POINTS_PER_INCH
  const m = END_MAP_MARGIN_PT
  const title: PageBox = { x: m, y: m, w: W - 2 * m, h: END_MAP_TITLE_PT }
  const keyH = title.h,
    keyW = Math.round(keyH * 1.15)
  const logo: PageBox = { x: title.x, y: title.y + 10, w: 190, h: title.h - 20 }
  const keyMap: PageBox = { x: title.x + title.w - keyW, y: title.y, w: keyW, h: keyH }
  const heading: PageBox = {
    x: logo.x + logo.w + 10,
    y: title.y,
    w: keyMap.x - 10 - (logo.x + logo.w + 10),
    h: title.h,
  }
  const t = END_MAP_TICK_MARGIN_PT
  const mapTop = title.y + title.h + 6 + t
  const footer: PageBox = { x: m, y: H - m - END_MAP_FOOTER_PT, w: W - 2 * m, h: END_MAP_FOOTER_PT }
  const map: PageBox = { x: m + t, y: mapTop, w: W - 2 * (m + t), h: footer.y - t - mapTop }
  return { page: { x: 0, y: 0, w: W, h: H }, title, logo, heading, keyMap, map, footer }
}
/** Width over height of the end map's neat line: the window of the canvas it is captured from. */
export const END_MAP_ASPECT = (() => {
  const { map } = endMapLayout()
  return map.w / map.h
})()

/** The window of the canvas each overview sheet style is captured from, width over height. */
export const overviewSheetAspect = (style: OverviewSheetStyle) =>
  style === 'end-map-portrait' ? END_MAP_ASPECT : REPORT_MAP_ASPECT.sheet

export interface UtmTick {
  /** Easting or northing, metres. */
  value: number
  label: string
  /** Paper position along its edge: x on the top and bottom, y on the left and right. */
  at: number
}
export interface UtmTicks {
  zone: number
  /** The sheet's grid datum; NAD83 and WGS84 differ by about a metre here, under a tick's width at these scales. */
  datum: 'NAD83'
  intervalM: number
  top: UtmTick[]
  bottom: UtmTick[]
  left: UtmTick[]
  right: UtmTick[]
}

/** The UTM zone a longitude falls in (BC is zones 7 to 11). */
export const utmZoneOf = (lng: number) => Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1))

/** The first round grid interval whose ticks fall at least `UTM_TICK_MIN_IN` apart at `scale`. */
export function utmTickInterval(scale: number): number {
  const inches = (metres: number) => metres / (scale * METRES_PER_INCH)
  return UTM_TICK_INTERVALS.find((interval) => inches(interval) >= UTM_TICK_MIN_IN) ?? UTM_TICK_INTERVALS.at(-1)!
}

/**
 * UTM grid ticks round the neat line of a north-up Web Mercator frame: where each round easting crosses the top and
 * bottom edges and each round northing the left and right, in the zone of the frame's centre. Grid lines are not
 * parallel to the frame's edges (grid convergence), so each edge is solved on its own, by bisection.
 */
export function utmTicks(projection: FrameProjection, intervalM: number): UtmTicks {
  const zone = utmZoneOf(projection.center[0])
  const south = projection.center[1] < 0
  const forward = proj4('EPSG:4326', `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=NAD83 +units=m +no_defs`)
    .forward as (p: [number, number]) => [number, number]
  const { x, y, w, h } = projection.frame
  const at = (px: number, py: number) => forward(projection.unproject(px, py))
  /** Ticks along one edge, `read` giving the grid value at a share 0–1 along it (monotonic). */
  const edge = (read: (share: number) => number, toPaper: (share: number) => number, format: (v: number) => string) => {
    const a = read(0),
      b = read(1)
    const rising = b > a
    const lo = Math.min(a, b),
      hi = Math.max(a, b)
    const ticks: UtmTick[] = []
    for (let value = Math.ceil(lo / intervalM) * intervalM; value <= hi; value += intervalM) {
      let s0 = 0,
        s1 = 1
      for (let i = 0; i < 40; i++) {
        const mid = (s0 + s1) / 2
        if (read(mid) < value === rising) s0 = mid
        else s1 = mid
      }
      ticks.push({ value, label: format(value), at: toPaper((s0 + s1) / 2) })
    }
    return ticks.sort((p, q) => p.at - q.at)
  }
  const whole = (v: number) => String(Math.round(v))
  return {
    zone,
    datum: 'NAD83',
    intervalM,
    top: edge(
      (s) => at(x + s * w, y)[0],
      (s) => x + s * w,
      whole,
    ),
    bottom: edge(
      (s) => at(x + s * w, y + h)[0],
      (s) => x + s * w,
      whole,
    ),
    left: edge(
      (s) => at(x, y + s * h)[1],
      (s) => y + s * h,
      whole,
    ),
    right: edge(
      (s) => at(x + w, y + s * h)[1],
      (s) => y + s * h,
      whole,
    ),
  }
}

/** The contour interval and index spacing for an end map at `scale`: 20 m with 100 m index lines at 1:40,000. */
export function endMapContourInterval(scale: number): { intervalM: number; indexEvery: number } {
  const intervalM = scale <= 12500 ? 5 : scale <= 25000 ? 10 : scale <= 60000 ? 20 : scale <= 120000 ? 40 : 100
  return { intervalM, indexEvery: 5 }
}

/**
 * The terrain zoom read for the end map's contours: the coarsest whose pixel is no larger than the contour grid's
 * cell, within `END_MAP_DEM_ZOOMS`, stepped out until the frame takes at most `END_MAP_MAX_DEM_TILES` tiles.
 */
export function endMapDemZoom(projection: FrameProjection): number {
  const cellM = END_MAP_CONTOUR_GRID_PT * metresPerPoint(projection.scale)
  const cos = Math.cos(projection.center[1] * RAD)
  let zoom: number = END_MAP_DEM_ZOOMS.max
  for (let z = END_MAP_DEM_ZOOMS.min; z <= END_MAP_DEM_ZOOMS.max; z++)
    if ((2 * Math.PI * R * cos) / (DEM_TILE_SIZE * 2 ** z) <= cellM) {
      zoom = z
      break
    }
  while (zoom > END_MAP_DEM_ZOOMS.min && demTileRange(projection.bounds, zoom).tileCount > END_MAP_MAX_DEM_TILES)
    zoom -= 1
  return zoom
}

export interface EndMapPlan {
  layout: EndMapLayout
  /** The sheet's projection in page points: the map's neat line at the stated scale. */
  projection: FrameProjection
  ticks: UtmTicks
  contours: { intervalM: number; indexEvery: number }
  demZoom: number
  /** The key map: its camera and the window of the map's frame it is captured from, and the scale it is drawn at. */
  keyMap: { camera: MapCamera; frame: MapFrame; scale: number }
}

/**
 * The overview as the portrait end map: every block and viewpoint fitted inside the neat line's padding at the
 * largest round scale of `FIT_SCALES` (from `MIN_SHEET_SCALE`) that holds them, centred. `frame` is the canvas window
 * it is captured from (`END_MAP_ASPECT`); its zoom puts the stated scale at the frame's centre latitude when the
 * neat line prints its width on the 11 × 17 paper. Null when there are no blocks and no viewpoints.
 */
export function planEndMap(features: ReportMapFeatures, frame: MapFrame): ReportMapPlan | null {
  const bounds = boundsOf([
    ...features.blocks.flatMap((block) => corners(polygonBounds(block.geometry))),
    ...features.viewpoints.map((vp): LngLat => [vp.lng, vp.lat]),
  ])
  if (!bounds) return null
  const layout = endMapLayout()
  const box = layout.map
  const availableW = box.w * (1 - 2 * FIT_PADDING_SHARE),
    availableH = box.h * (1 - 2 * FIT_PADDING_SHARE)
  const x0 = mercatorX(bounds[0]),
    x1 = mercatorX(bounds[2])
  const y0 = mercatorY(bounds[1]),
    y1 = mercatorY(bounds[3])
  const cos = Math.cos(inverseMercator(0, (y0 + y1) / 2)[1] * RAD)
  const scales = FIT_SCALES.filter((scale) => scale >= MIN_SHEET_SCALE)
  const scale =
    scales.find(
      (candidate) =>
        ((x1 - x0) * cos) / metresPerPoint(candidate) <= availableW &&
        ((y1 - y0) * cos) / metresPerPoint(candidate) <= availableH,
    ) ?? scales[scales.length - 1]
  const center = inverseMercator((x0 + x1) / 2, (y0 + y1) / 2)
  const zoomFor = (scaleOf: number, widthPt: number, widthPx: number) =>
    Math.log2(
      (2 * Math.PI * R * Math.cos(center[1] * RAD)) /
        (TILE * ((scaleOf * (widthPt / POINTS_PER_INCH) * METRES_PER_INCH) / widthPx)),
    )
  const projection = frameProjection(box, center, scale)
  const keyFrame = captureFrame(frame, layout.keyMap.w / layout.keyMap.h)
  // Held to the regional map's zooms, the key map states the scale it is drawn at, not the one asked for.
  const keyZoom = Math.max(
    MIN_REPORT_ZOOM,
    Math.min(MAX_REGIONAL_ZOOM, zoomFor(scale * KEY_MAP_SCALE_FACTOR, layout.keyMap.w, keyFrame.width)),
  )
  const keyScale =
    (((2 * Math.PI * R * Math.cos(center[1] * RAD)) / (TILE * 2 ** keyZoom)) * keyFrame.width) /
    ((layout.keyMap.w / POINTS_PER_INCH) * METRES_PER_INCH)
  const names = features.blocks.map((block) => block.name)
  const viewpoints = features.viewpoints.map((vp) => vp.name)
  return {
    kind: 'sheet',
    key: 'sheet',
    camera: { center, zoom: zoomFor(scale, box.w, frame.width) },
    basemap: 'map',
    sheet: { scale, paper: { ...END_MAP_PAPER }, style: 'end-map-portrait' },
    endMap: {
      layout,
      projection,
      ticks: utmTicks(projection, utmTickInterval(scale)),
      contours: endMapContourInterval(scale),
      demZoom: endMapDemZoom(projection),
      keyMap: {
        camera: { center, zoom: keyZoom },
        frame: keyFrame,
        scale: keyScale,
      },
    },
    caption: `VIA overview map at ${formatScale(scale)} (11 × 17 portrait): ${names.length ? `proposed ${blockNames(names).replace(/^B/, 'b')}` : 'the viewpoints'}${
      names.length && viewpoints.length ? ` and viewpoint${viewpoints.length === 1 ? '' : 's'} ${list(viewpoints)}` : ''
    }, over contours and the visual landscape inventory’s VQO linework.`,
  }
}

/** The end map's legend rows, in the order a 2001-form VIA's overview map keys them. */
export type EndMapLegendKey =
  | 'viewpoint'
  | 'existingRoad'
  | 'highway'
  | 'block'
  | 'vqo'
  | 'lake'
  | 'creek'
  | 'wtra'
  | 'harvested'
  | 'parks'
export const END_MAP_LEGEND_ORDER: readonly EndMapLegendKey[] = [
  'viewpoint',
  'existingRoad',
  'highway',
  'block',
  'vqo',
  'lake',
  'creek',
  'wtra',
  'harvested',
  'parks',
]
/** Only the rows the map has drawn, in the legend's order. */
export const endMapLegendKeys = (drawn: ReadonlySet<EndMapLegendKey>) =>
  END_MAP_LEGEND_ORDER.filter((key) => drawn.has(key))

// ---------------------------------------------------------------- composing

export interface ComposedReportMap {
  ops: DrawOp[]
  width: number
  height: number
  /** The legend's rows, top to bottom. */
  legend: string[]
  /** The same rows as the report's map furniture reads them (`MapFurniture.legend`), with each symbol's key colour. */
  legendRows: Array<{ label: string; color: string; kind: 'area' | 'line' | 'point' }>
  /** What the scale bar spans, "Scale bar: 1.5 km"; on the 11 × 17 sheet the scale it states, "1:40,000". */
  scale: string
  /** Labels placed on the map, for the tests and the caption. */
  labels: string[]
}

type Box = { x: number; y: number; w: number; h: number }

/** A five-pointed star centred on (x, y), `size` across. */
export function starRing(x: number, y: number, size: number): Point[] {
  const outer = size / 2,
    inner = outer * 0.42
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 ? inner : outer
    return [x + r * Math.cos(a), y + r * Math.sin(a)] as Point
  })
}

const starOps = (
  x: number,
  y: number,
  size: number,
  k: number,
  colors: { fill: string; edge: string; edgeWidth?: number } = { fill: ASSESSMENT_VIEWPOINT_COLOR, edge: '#000000' },
): DrawOp[] => [
  {
    op: 'path',
    parts: [starRing(x, y, size)],
    closed: true,
    fill: colors.fill,
    stroke: { color: colors.edge, width: (colors.edgeWidth ?? 1.1) * k, join: 'round' },
  },
]

const HALO = { color: '#ffffff', width: 3 }

/**
 * The north arrow the block sheets draw (`composeSheet.ts`): a red needle with a white edge and an N, here in the
 * frame's top-left corner. The map is north-up Web Mercator, so it points straight up.
 */
function northArrowOps(
  frame: Box,
  k: number,
  at: { corner: 'left' | 'right'; height: number } | null = null,
): DrawOp[] {
  const height = (at?.height ?? 40) * k,
    width = height * 0.32
  const cx = at?.corner === 'right' ? frame.x + frame.w - width / 2 - 6 * k : frame.x + 22 * k,
    top = frame.y + (at ? 4 : 10) * k
  const bottom = top + height
  const notch = bottom - height * 0.18
  const red = SHEET_CHROME.northArrow
  const needle: Point[] = [
    [cx, top + height * 0.2],
    [cx + width / 2, bottom],
    [cx, notch],
    [cx - width / 2, bottom],
  ]
  return [
    {
      op: 'path',
      parts: [needle],
      closed: true,
      fill: '#ffffff',
      stroke: { color: '#ffffff', width: 3 * k, join: 'round' },
    },
    {
      op: 'path',
      parts: [
        [
          [cx, top + height * 0.2],
          [cx, notch],
          [cx - width / 2, bottom],
        ],
      ],
      closed: true,
      fill: red,
    },
    { op: 'path', parts: [needle], closed: true, stroke: { color: red, width: 0.9 * k, join: 'round' } },
    {
      op: 'text',
      x: cx,
      y: top + height * 0.15,
      text: 'N',
      size: Math.max(8, height * 0.24),
      style: 'bold',
      color: red,
      align: 'center',
      halo: { color: '#ffffff', width: 2.4 * k },
    },
  ]
}

const inUnit = (metres: number, kilometres: boolean) =>
  kilometres ? String(Number((metres / 1000).toFixed(2))) : String(Math.round(metres))
const formatDistance = (metres: number) =>
  metres >= 1000 ? `${Number((metres / 1000).toFixed(metres % 1000 ? 1 : 0))} km` : `${Math.round(metres)} m`

/**
 * An alternating black and white scale bar from the sheet engine's `scaleBar`, on a white panel in the frame's
 * bottom-left corner: 0 at the left, then each segment's end, the unit on the last label.
 */
function scaleBarOps(
  projection: FrameProjection,
  frame: Box,
  k: number,
  /** A line over the bar stating the map's scale ("Scale 1:40,000 (11 × 17 in)"). */
  title: string | null = null,
): { ops: DrawOp[]; box: Box; spanM: number } {
  const bar = scaleBar(projection.scale, frame.w * 0.3)
  const segments = bar.rightSegments
  const segmentW = bar.segmentPt
  const size = 9 * k
  const barH = 5 * k
  const pad = 6 * k
  const totalW = segmentW * segments
  const lastLabel = formatDistance(bar.segmentM * segments)
  const kilometres = bar.segmentM * segments >= 1000
  const titleSize = 10.5 * k
  const titleH = title ? titleSize * 1.5 : 0
  const h = pad * 2 + titleH + barH + size * 1.4
  const box: Box = {
    x: frame.x + 8 * k,
    y: frame.y + frame.h - 8 * k - h,
    w: Math.max(
      totalW + pad * 2 + textWidth(lastLabel, size) / 2 + 2 * k,
      title ? textWidth(title, titleSize, 'bold') + pad * 2 : 0,
    ),
    h,
  }
  const ops: DrawOp[] = [
    { op: 'rect', ...box, fill: '#ffffff', fillOpacity: 0.85, stroke: { color: '#6e6e6e', width: 0.6 * k } },
  ]
  const x0 = box.x + pad,
    y0 = box.y + pad + titleH
  if (title)
    ops.push({
      op: 'text',
      x: x0,
      y: box.y + pad + titleSize,
      text: title,
      size: titleSize,
      style: 'bold',
      color: '#000000',
    })
  for (let i = 0; i < segments; i++)
    ops.push({
      op: 'rect',
      x: x0 + i * segmentW,
      y: y0,
      w: segmentW,
      h: barH,
      fill: i % 2 ? '#ffffff' : '#000000',
      stroke: { color: '#000000', width: 0.6 * k },
    })
  for (let i = 0; i <= segments; i++)
    ops.push({
      op: 'text',
      x: x0 + i * segmentW,
      y: y0 + barH + size * 1.15,
      // Every label in the last label's unit: "0 0.5 1 1.5 2 km", never "500" beside "1".
      text: i === segments ? lastLabel : i === 0 ? '0' : inUnit(bar.segmentM * i, kilometres),
      size,
      color: '#000000',
      align: 'center',
    })
  return { ops, box, spanM: bar.segmentM * segments }
}

type LegendRow = {
  label: string
  color: string
  kind: 'area' | 'line' | 'point'
  draw: (box: Box) => DrawOp[]
}

function legendOps(rows: readonly LegendRow[], frame: Box, k: number, avoid: Box): { ops: DrawOp[]; box: Box } {
  const size = 9.5 * k,
    pitch = 15 * k,
    swatch = { w: 22 * k, h: 10 * k },
    pad = 7 * k
  const titleSize = 10.5 * k
  const maxText = frame.w * 0.36
  const labels = rows.map((row) => fitText(row.label, size, maxText))
  const w =
    pad * 2 +
    swatch.w +
    6 * k +
    Math.max(textWidth('Legend', titleSize, 'bold'), ...labels.map((label) => textWidth(label, size)))
  const h = pad * 2 + titleSize * 1.3 + rows.length * pitch
  let box: Box = { x: frame.x + frame.w - 8 * k - w, y: frame.y + frame.h - 8 * k - h, w, h }
  // The scale bar keeps its corner; a legend that would meet it moves up.
  if (boxesMeet(box, avoid)) box = { ...box, y: Math.max(frame.y + 8 * k, avoid.y - 6 * k - h) }
  const ops: DrawOp[] = [
    { op: 'rect', ...box, fill: '#ffffff', fillOpacity: 0.92, stroke: { color: '#6e6e6e', width: 0.6 * k } },
    {
      op: 'text',
      x: box.x + pad,
      y: box.y + pad + titleSize,
      text: 'Legend',
      size: titleSize,
      style: 'bold',
      color: '#000000',
    },
  ]
  rows.forEach((row, i) => {
    const y = box.y + pad + titleSize * 1.3 + i * pitch + (pitch - swatch.h) / 2
    ops.push(...row.draw({ x: box.x + pad, y, w: swatch.w, h: swatch.h }))
    ops.push({
      op: 'text',
      x: box.x + pad + swatch.w + 6 * k,
      y: y + swatch.h / 2,
      text: labels[i],
      size,
      color: '#000000',
      baseline: 'middle',
    })
  })
  return { ops, box }
}

/**
 * The map figure over its capture: the capture itself, the inventory, openings, the road, the wedge or project area,
 * the blocks, the viewpoints and their labels (placed so no two meet), then the north arrow, scale bar and a legend
 * of what was drawn. `image` null draws a grey frame (the tests, and a capture that failed).
 */
export function composeReportMap(
  plan: ReportMapPlan,
  features: ReportMapFeatures,
  frame: MapFrame,
  image: { url: string; width: number; height: number; format: 'PNG' | 'JPEG' } | null,
  attribution: string | null,
): ComposedReportMap {
  if (plan.style === 'figure-page') return composeFigurePageMap(plan, features, frame, image, attribution)
  const projection = frameProjectionFor(plan.camera, frame)
  const box: Box = { x: 0, y: 0, w: frame.width, h: frame.height }
  // Symbol sizes are points at a 640 px frame, as the block sheets scale theirs by paper; on the 11 × 17 sheet they
  // are points on its paper (times `SHEET_SYMBOL_SCALE`), whatever the frame's pixels.
  const k = plan.sheet
    ? (SHEET_SYMBOL_SCALE * frame.width) / (plan.sheet.paper.widthIn * POINTS_PER_INCH)
    : Math.max(0.75, Math.min(1.6, frame.width / 640))
  const project = ([lng, lat]: LngLat): Point => projection.project(lng, lat)
  const partsOf = (geometry: PolygonGeometry): Point[][] =>
    ringsOf(geometry).flatMap((rings) => rings.map((ring) => ring.map(project)))
  const visible = (geometry: PolygonGeometry) => {
    const [w, s, e, n] = polygonBounds(geometry)
    const [west, south, east, north] = projection.bounds
    return !(e < west || w > east || n < south || s > north)
  }
  const ops: DrawOp[] = [
    image
      ? { op: 'image', x: 0, y: 0, w: frame.width, h: frame.height, image: { kind: 'url', ...image } }
      : { op: 'rect', ...box, fill: '#e5e7eb' },
    { op: 'clip', parts: [rectRing(0, 0, frame.width, frame.height)] },
  ]
  const legend: LegendRow[] = []
  const areaRow = (symbol: AreaSymbol | LineSymbol): LegendRow => ({
    label: symbol.label,
    color: symbolKeyColor(symbol),
    kind: symbol.kind,
    draw: (at) => swatchOps(symbol, at, k),
  })

  // The visual inventory, under everything the scene draws.
  // The regional map places the project in its region: the project area stands for the scene's polygons there,
  // which its inventory, openings and blocks would otherwise bury.
  const units = plan.projectArea ? [] : features.inventory.filter((unit) => visible(unit.geometry))
  const codes = new Set<EvqoCode>()
  let unrated = false
  for (const unit of units) {
    if (unit.code) {
      codes.add(unit.code)
      ops.push(...areaSymbolOps(partsOf(unit.geometry), vqoSymbol(unit.code), k))
    } else {
      unrated = true
      ops.push(...areaSymbolOps(partsOf(unit.geometry), REPORT_MAP_SYMBOLS.unrated, k))
    }
  }
  for (const code of ['P', 'R', 'PR', 'M', 'MM'] as const) if (codes.has(code)) legend.push(areaRow(vqoSymbol(code)))
  if (unrated) legend.push(areaRow(REPORT_MAP_SYMBOLS.unrated))

  const openings = plan.projectArea ? [] : features.openings.filter((opening) => visible(opening.geometry))
  const openingSymbol: AreaSymbol = features.symbols?.opening ?? REPORT_MAP_SYMBOLS.opening
  for (const opening of openings) ops.push(...areaSymbolOps(partsOf(opening.geometry), openingSymbol, k))
  if (openings.length) legend.push(areaRow(openingSymbol))

  // A road shorter on the map than a star (a stood-at viewpoint's pullout) is the viewpoint, not a road to key.
  const road = plan.projectArea ? [] : (features.road?.map(project) ?? [])
  const roadLength = road.reduce(
    (sum, point, i) => (i ? sum + Math.hypot(point[0] - road[i - 1][0], point[1] - road[i - 1][1]) : 0),
    0,
  )
  if (road.length > 1 && roadLength > 24 * k) {
    ops.push(...lineSymbolOps([road], REPORT_MAP_SYMBOLS.road, k))
    legend.push(areaRow(REPORT_MAP_SYMBOLS.road))
  }
  if (plan.wedge) {
    ops.push(...areaSymbolOps([plan.wedge.ring.map(project)], REPORT_MAP_SYMBOLS.wedge, k))
    legend.push(areaRow(REPORT_MAP_SYMBOLS.wedge))
  }
  // On the regional map the project area stands for the blocks too: at that scale they are specks under labels.
  const blocks = plan.projectArea ? [] : features.blocks.filter((block) => visible(block.geometry))
  const blockSymbol: AreaSymbol = features.symbols?.block ?? REPORT_MAP_SYMBOLS.block
  for (const block of blocks) ops.push(...areaSymbolOps(partsOf(block.geometry), blockSymbol, k))
  if (blocks.length) legend.push(areaRow(blockSymbol))
  if (plan.projectArea) {
    const [w, s, e, n] = plan.projectArea
    const ring: LngLat[] = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ]
    ops.push(...areaSymbolOps([ring.map(project)], REPORT_MAP_SYMBOLS.projectArea, k))
    legend.push(areaRow(REPORT_MAP_SYMBOLS.projectArea))
  }

  // Viewpoints: on a location map only its own, elsewhere every one.
  const viewpoints = plan.viewpoint ? [plan.viewpoint] : features.viewpoints
  const starSize = 15 * k
  const placedViewpoints = viewpoints.flatMap((vp) => {
    const [x, y] = project([vp.lng, vp.lat])
    return x >= 0 && x <= frame.width && y >= 0 && y <= frame.height ? [{ vp, x, y }] : []
  })
  for (const { x, y } of placedViewpoints) ops.push(...starOps(x, y, starSize, k))
  if (placedViewpoints.length)
    legend.push({
      label: viewpoints.length === 1 && plan.viewpoint ? 'Viewpoint' : 'Viewpoint (saved view)',
      color: ASSESSMENT_VIEWPOINT_COLOR,
      kind: 'point',
      draw: (at) => starOps(at.x + at.w / 2, at.y + at.h / 2, Math.min(at.h * 1.4, starSize), k),
    })

  // Labels, most important first; one that would meet a placed label or the chrome's corners is left out.
  // The scale bar and legend are laid out first, so no label lands under them.
  const bar = scaleBarOps(
    projection,
    box,
    k,
    plan.sheet
      ? `Scale ${formatScale(plan.sheet.scale)} (${plan.sheet.paper.heightIn} × ${plan.sheet.paper.widthIn} in)`
      : null,
  )
  const keyRows = legendOps(legend, { ...box, h: box.h - 10 * k }, k, bar.box)
  const taken: Box[] = [{ x: 0, y: 0, w: 48 * k, h: 60 * k }, bar.box, ...(legend.length ? [keyRows.box] : [])]
  const placedLabels: string[] = []
  const label = (
    text: string,
    x: number,
    y: number,
    options: { size: number; color: string; align: 'left' | 'center'; style?: 'bold' | 'normal' },
  ) => {
    const value = fitText(text, options.size, frame.width * 0.4, options.style ?? 'bold')
    const w = textWidth(value, options.size, options.style ?? 'bold')
    const left = options.align === 'center' ? x - w / 2 : x
    const rect: Box = { x: left - 2 * k, y: y - options.size * 0.9, w: w + 4 * k, h: options.size * 1.3 }
    if (rect.x < 2 || rect.y < 2 || rect.x + rect.w > frame.width - 2 || rect.y + rect.h > frame.height - 2)
      return false
    if (taken.some((other) => boxesMeet(other, rect))) return false
    taken.push(rect)
    placedLabels.push(value)
    ops.push({
      op: 'text',
      x,
      y,
      text: value,
      size: options.size,
      style: options.style ?? 'bold',
      color: options.color,
      align: options.align,
      halo: { color: HALO.color, width: HALO.width * k },
    })
    return true
  }
  for (const { x, y } of placedViewpoints)
    taken.push({ x: x - starSize / 2, y: y - starSize / 2, w: starSize, h: starSize })
  // A viewpoint's name goes right of its star, else left, above or below it.
  for (const { vp, x, y } of placedViewpoints) {
    const size = 10.5 * k
    const width = textWidth(vp.name, size, 'bold')
    for (const [at, dy] of [
      [x + starSize * 0.7, 4 * k],
      [x - starSize * 0.7 - width, 4 * k],
      [x - width / 2, -starSize * 0.75],
      [x - width / 2, starSize * 0.75 + size * 0.8],
    ] as const)
      if (label(vp.name, at, y + dy, { size, color: '#000000', align: 'left' })) break
  }
  const inFrame = (geometry: PolygonGeometry): Point | null => {
    const centre = polygonInteriorPoint(geometry)
    if (centre) {
      const [x, y] = project([centre.lng, centre.lat])
      if (x > 0 && x < frame.width && y > 0 && y < frame.height) return [x, y]
    }
    // A polygon larger than the frame: the first point of a grid over the frame that falls inside it.
    for (let j = 1; j < 8; j++)
      for (let i = 1; i < 8; i++) {
        const x = (frame.width * i) / 8,
          y = (frame.height * j) / 8
        const [lng, lat] = projection.unproject(x, y)
        if (pointInPolygon(geometry, lng, lat)) return [x, y]
      }
    return null
  }
  // A block label that meets another tries just above, then just below, its block's middle.
  for (const block of blocks) {
    const at = inFrame(block.geometry)
    if (!at) continue
    const size = 10 * k
    for (const dy of [0, -size * 1.4, size * 1.4])
      if (label(block.name, at[0], at[1] + 4 * k + dy, { size, color: '#000000', align: 'center' })) break
  }
  for (const unit of units) {
    if (!unit.code) continue
    const at = inFrame(unit.geometry)
    const text = unit.label ? `${unit.label} ${unit.code}` : unit.code
    if (at) label(text, at[0], at[1] + 4 * k, { size: 9.5 * k, color: EVQO_COLORS[unit.code], align: 'center' })
  }
  if (attribution)
    ops.push({
      op: 'text',
      x: frame.width - 4 * k,
      y: frame.height - 4 * k,
      text: fitText(attribution, 6.5 * k, frame.width * 0.6),
      size: 6.5 * k,
      color: SHEET_CHROME.attribution,
      align: 'right',
      halo: { color: '#ffffff', width: 1.6 * k },
    })
  ops.push({ op: 'restore' })

  // Chrome over the map: north arrow, scale bar, legend, then the neatline.
  ops.push(...northArrowOps(box, k))
  ops.push(...bar.ops)
  if (legend.length) ops.push(...keyRows.ops)
  ops.push({ op: 'rect', ...box, stroke: { color: '#000000', width: 1.2 * k } })
  return {
    ops,
    width: frame.width,
    height: frame.height,
    legend: legend.map((row) => row.label),
    legendRows: legend.map(({ label, color, kind }) => ({ label, color, kind })),
    scale: plan.sheet ? formatScale(plan.sheet.scale) : `Scale bar: ${formatDistance(bar.spanM)}`,
    labels: placedLabels,
  }
}

/** The figure page's road and project-area lines, in points printed on its side slot. */
const FIGURE_PAGE_ROAD: LineSymbol = {
  kind: 'line',
  label: 'Road',
  layers: [
    { color: '#ffffff', width: 1.8, cap: 'round', join: 'round' },
    { color: ROAD_COLOR, width: 1, cap: 'round', join: 'round' },
  ],
}
const FIGURE_PAGE_PROJECT_AREA: AreaSymbol = {
  kind: 'area',
  label: 'Project area',
  outline: [
    { color: '#ffffff', width: 2.2, join: 'miter' },
    { color: SHEET_CHROME.northArrow, width: 1.2, join: 'miter' },
  ],
}
/** The proposed blocks on the figure page's location map: the block sheets' block of interest, a little lighter. */
const FIGURE_PAGE_BLOCK_WEIGHT = 0.7

/**
 * A figure page map (`planFigurePageMaps`) over its capture, sized in points printed on the side slot. The location
 * map: the road, the view's teal wedge, the proposed blocks in the block sheets' block-of-interest style with their
 * names, and the viewpoint as a cyan star at the wedge's apex. The regional map: the project's ground outlined and the
 * viewpoints' stars. Either has a small north arrow at its top right and the sources' attribution, and nothing else:
 * no legend, scale bar, VQO hatching or viewpoint name (the slot's bar and the page name it).
 */
function composeFigurePageMap(
  plan: ReportMapPlan,
  features: ReportMapFeatures,
  frame: MapFrame,
  image: { url: string; width: number; height: number; format: 'PNG' | 'JPEG' } | null,
  attribution: string | null,
): ComposedReportMap {
  const projection = frameProjectionFor(plan.camera, frame)
  const box: Box = { x: 0, y: 0, w: frame.width, h: frame.height }
  const k = frame.width / (FIGURE_PAGE_MAP_WIDTH_IN * POINTS_PER_INCH)
  const project = ([lng, lat]: LngLat): Point => projection.project(lng, lat)
  const partsOf = (geometry: PolygonGeometry): Point[][] =>
    ringsOf(geometry).flatMap((rings) => rings.map((ring) => ring.map(project)))
  const visible = (geometry: PolygonGeometry) => {
    const [w, s, e, n] = polygonBounds(geometry)
    const [west, south, east, north] = projection.bounds
    return !(e < west || w > east || n < south || s > north)
  }
  const ops: DrawOp[] = [
    image
      ? { op: 'image', x: 0, y: 0, w: frame.width, h: frame.height, image: { kind: 'url', ...image } }
      : { op: 'rect', ...box, fill: '#e5e7eb' },
    { op: 'clip', parts: [rectRing(0, 0, frame.width, frame.height)] },
  ]
  const rows: ComposedReportMap['legendRows'] = []
  const row = (symbol: AreaSymbol | LineSymbol) =>
    rows.push({ label: symbol.label, color: symbolKeyColor(symbol), kind: symbol.kind })
  const labels: string[] = []
  const star = VIA_FIGURE_MAP.viewpoint
  const starSize = 10 * k
  /** The regional map's project outline as drawn, which its place names keep clear of. */
  let projectBox: Box | null = null

  if (plan.kind === 'location') {
    const road = features.road?.map(project) ?? []
    const roadLength = road.reduce(
      (sum, point, i) => (i ? sum + Math.hypot(point[0] - road[i - 1][0], point[1] - road[i - 1][1]) : 0),
      0,
    )
    if (road.length > 1 && roadLength > starSize * 1.6) {
      ops.push(...lineSymbolOps([road], FIGURE_PAGE_ROAD, k))
      row(FIGURE_PAGE_ROAD)
    }
    if (plan.wedge) {
      ops.push(...areaSymbolOps([plan.wedge.ring.map(project)], VIA_FIGURE_MAP.viewWedge, k))
      row(VIA_FIGURE_MAP.viewWedge)
    }
    const blocks = features.blocks.filter((block) => visible(block.geometry))
    const blockSymbol = features.symbols?.block ?? { ...BLOCK_OF_INTEREST.default, label: 'Proposed block' }
    for (const block of blocks)
      ops.push(...areaSymbolOps(partsOf(block.geometry), blockSymbol, k * FIGURE_PAGE_BLOCK_WEIGHT))
    if (blocks.length) row(blockSymbol)
    // Block names at their middles, white on a dark halo as 26 labels its linework; one that meets another is left out.
    const taken: Box[] = []
    const size = 6 * k
    for (const block of blocks) {
      const centre = polygonInteriorPoint(block.geometry)
      if (!centre) continue
      const [x, y] = project([centre.lng, centre.lat])
      const text = fitText(block.name, size, frame.width * 0.3, 'bold')
      const w = textWidth(text, size, 'bold')
      const rect: Box = { x: x - w / 2 - k, y: y - size * 0.6, w: w + 2 * k, h: size * 1.3 }
      if (rect.x < 2 || rect.y < 2 || rect.x + rect.w > frame.width - 2 || rect.y + rect.h > frame.height - 2) continue
      if (taken.some((other) => boxesMeet(other, rect))) continue
      taken.push(rect)
      labels.push(text)
      ops.push({
        op: 'text',
        x,
        y,
        text,
        size,
        style: 'bold',
        color: '#ffffff',
        align: 'center',
        baseline: 'middle',
        halo: { color: '#000000', width: 1.6 * k },
      })
    }
  } else if (plan.projectArea) {
    const [w, s, e, n] = plan.projectArea
    const ring: LngLat[] = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ]
    // Never smaller than the star it holds: a single block is a speck at the regional scale.
    const points = ring.map(project)
    const [cx, cy] = [(points[0][0] + points[2][0]) / 2, (points[0][1] + points[2][1]) / 2]
    const half = starSize * 0.9
    const grown = points.map(
      ([x, y]): Point => [
        x < cx ? Math.min(x, cx - half) : Math.max(x, cx + half),
        y < cy ? Math.min(y, cy - half) : Math.max(y, cy + half),
      ],
    )
    ops.push(...areaSymbolOps([grown], FIGURE_PAGE_PROJECT_AREA, k))
    row(FIGURE_PAGE_PROJECT_AREA)
    const xs = grown.map((point) => point[0]),
      ys = grown.map((point) => point[1])
    const left = Math.min(...xs),
      top = Math.min(...ys)
    projectBox = { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top }
  }

  const viewpoints = plan.viewpoint ? [plan.viewpoint] : features.viewpoints
  let starred = 0
  const starBoxes: Box[] = []
  for (const vp of viewpoints) {
    const [x, y] = project([vp.lng, vp.lat])
    if (x < 0 || x > frame.width || y < 0 || y > frame.height) continue
    ops.push(...starOps(x, y, starSize, k, { fill: star.fill, edge: star.edge, edgeWidth: 0.6 }))
    starBoxes.push({ x: x - starSize / 2, y: y - starSize / 2, w: starSize, h: starSize })
    starred += 1
  }
  if (starred) rows.push({ label: 'Viewpoint', color: star.fill, kind: 'point' })

  // The regional map's own place names (`regionalPlaceLabels`): a dot and the name beside it, in the basemap's own
  // village size and colours; a name that would cross the project's outline, a star, another name or the north arrow
  // tries the dot's other side, above, then below, and is left out when none is clear.
  if (plan.kind === 'regional' && plan.places?.length) {
    const look = VIA_FIGURE_MAP.regional
    const size = (look.smallPlaceSize / FIGURE_REGIONAL_TYPE_BASE_PX) * frame.width
    const halo = (look.labelHaloWidth / FIGURE_REGIONAL_TYPE_BASE_PX) * frame.width
    const dot = 1.1 * k
    const taken: Box[] = [
      ...(projectBox ? [projectBox] : []),
      ...starBoxes,
      // The north arrow at the top right, and the sources' line along the bottom.
      { x: frame.width - 16 * k, y: 0, w: 16 * k, h: 24 * k },
      { x: 0, y: frame.height - 6 * k, w: frame.width, h: 6 * k },
    ]
    for (const place of plan.places) {
      const [x, y] = project([place.lng, place.lat])
      const text = fitText(place.name, size, frame.width * 0.45, 'bold')
      const width = textWidth(text, size, 'bold')
      const dotBox: Box = { x: x - dot, y: y - dot, w: 2 * dot, h: 2 * dot }
      if (taken.some((other) => boxesMeet(other, dotBox))) continue
      const gap = dot + 1.2 * k
      const options: Array<{ x: number; y: number; align: 'left' | 'right' | 'center' }> = [
        { x: x + gap, y: y + size * 0.35, align: 'left' },
        { x: x - gap, y: y + size * 0.35, align: 'right' },
        { x, y: y - gap, align: 'center' },
        { x, y: y + gap + size * 0.8, align: 'center' },
      ]
      for (const option of options) {
        const left =
          option.align === 'left' ? option.x : option.align === 'right' ? option.x - width : option.x - width / 2
        const rect: Box = { x: left - halo, y: option.y - size * 0.85, w: width + 2 * halo, h: size * 1.15 }
        if (rect.x < 2 || rect.y < 2 || rect.x + rect.w > frame.width - 2 || rect.y + rect.h > frame.height - 2)
          continue
        if (taken.some((other) => boxesMeet(other, rect))) continue
        taken.push(rect, dotBox)
        labels.push(text)
        ops.push(
          { op: 'circle', x, y, r: dot, fill: look.label, stroke: { color: look.labelHalo, width: 0.5 * k } },
          {
            op: 'text',
            x: option.x,
            y: option.y,
            text,
            size,
            style: 'bold',
            color: look.label,
            align: option.align,
            halo: { color: look.labelHalo, width: halo },
          },
        )
        break
      }
    }
  }

  if (attribution)
    ops.push({
      op: 'text',
      x: frame.width - 2 * k,
      y: frame.height - 2 * k,
      text: fitText(attribution, 3.6 * k, frame.width * 0.96),
      size: 3.6 * k,
      color: SHEET_CHROME.attribution,
      align: 'right',
      halo: { color: '#ffffff', width: 0.8 * k },
    })
  ops.push({ op: 'restore' })
  ops.push(...northArrowOps(box, k, { corner: 'right', height: 16 }))
  return {
    ops,
    width: frame.width,
    height: frame.height,
    // Nothing is keyed on the picture: the rows say what it shows.
    legend: [],
    legendRows: rows,
    scale: `About ${formatScale(roundScale(printedScale(plan.camera, frame, FIGURE_PAGE_MAP_WIDTH_IN)))} printed ${FIGURE_PAGE_MAP_WIDTH_IN} in wide`,
    labels,
  }
}
