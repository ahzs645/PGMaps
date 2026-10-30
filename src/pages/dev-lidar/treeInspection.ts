import proj4 from 'proj4'
import type { FeatureCollection, Polygon } from 'geojson'
import { METRIC_CRS, toMetric } from './sourceGrids'
import type { CrownFeature, IsolatedPoint, TreeCrop, TreeIsolation } from './treeIsolation'
import type { WorkflowOptions } from './analysisWorkflows'
import { treeCropCSV } from './treeIsolation'

export const REVIEW_DECISIONS = [
  'unreviewed',
  'tree-like',
  'possible structure',
  'merged crowns',
  'split crown',
  'insufficient data',
] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]
export interface ProfileSettings {
  angle: number
  mode: 'whole' | 'slice'
  width: number
  offset: number
  colour: 'black' | 'height' | 'segment'
  pointSize: number
  minHeight: number
  maxHeight: number
  zoom: number
  panX: number
  panY: number
  lockScale: boolean
  showRejected: boolean
}
export const DEFAULT_PROFILE: ProfileSettings = {
  angle: 0,
  mode: 'whole',
  width: 1,
  offset: 0,
  colour: 'black',
  pointSize: 1.5,
  minHeight: 2,
  maxHeight: 80,
  zoom: 1,
  panX: 0,
  panY: 0,
  lockScale: true,
  showRejected: false,
}
export interface InspectionState {
  schema_version: 1
  source_sha256: string
  segmentation_sha256: string
  settings: ProfileSettings
  pins: string[]
  reviews: Record<string, { decision: ReviewDecision; note: string }>
  assignments: Record<string, string>
}
export const pointKey = (p: Pick<IsolatedPoint, 'node' | 'index'>) => `${p.node}:${p.index}`
export function revealCrown(options: WorkflowOptions, crown: CrownFeature): WorkflowOptions {
  return {
    ...options,
    selectedId: crown.properties.id,
    treeShowPoints: true,
    treeOnlySelected: false,
    treeMinimum: Math.min(options.treeMinimum, crown.properties.height_m),
    treeAreaMinimum: Math.min(options.treeAreaMinimum, crown.properties.crown_area_m2),
    treeHideEdge: options.treeHideEdge && !crown.properties.edge,
  }
}
export function inspectionCSV(crop: TreeCrop, points: IsolatedPoint[], assignments: InspectionState['assignments']) {
  const [header, ...rows] = treeCropCSV({ ...crop, points })
    .trimEnd()
    .split('\n')
  return (
    header +
    ',review_group\n' +
    rows.map((row, i) => row + ',' + (assignments[pointKey(points[i])] ?? crop.id)).join('\n')
  )
}
export const emptyInspection = (data?: TreeIsolation | null): InspectionState => ({
  schema_version: 1,
  source_sha256: data?.source_sha256 ?? '',
  segmentation_sha256: data?.label_grid_sha256 ?? '',
  settings: { ...DEFAULT_PROFILE },
  pins: [],
  reviews: {},
  assignments: {},
})
export function validSettings(value: unknown): ProfileSettings {
  if (!value || typeof value !== 'object') throw Error('Missing profile settings')
  const s = value as ProfileSettings
  for (const [key, min, max] of [
    ['angle', 0, 180],
    ['width', 0.1, 40],
    ['offset', -40, 40],
    ['pointSize', 0.5, 6],
    ['minHeight', 2, 80],
    ['maxHeight', 2, 80],
    ['zoom', 1, 8],
    ['panX', -100, 100],
    ['panY', -100, 100],
  ] as const)
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max) throw Error(`Invalid profile ${key}`)
  if (
    s.minHeight > s.maxHeight ||
    !['whole', 'slice'].includes(s.mode) ||
    !['black', 'height', 'segment'].includes(s.colour) ||
    typeof s.lockScale !== 'boolean' ||
    typeof s.showRejected !== 'boolean'
  )
    throw Error('Invalid profile settings')
  return { ...DEFAULT_PROFILE, ...s }
}
export function readInspection(text: string, data: TreeIsolation): InspectionState {
  if (text.length > 3000000) throw Error('Review manifest exceeds 3 MB')
  const value = JSON.parse(text) as InspectionState
  if (
    value.schema_version !== 1 ||
    value.source_sha256 !== data.source_sha256 ||
    value.segmentation_sha256 !== data.label_grid_sha256
  )
    throw Error('Source or crown segmentation mismatch')
  const ids = new Set(data.crowns.features.map((f) => f.properties.id))
  if (
    !Array.isArray(value.pins) ||
    value.pins.length > 4 ||
    value.pins.some((id) => !ids.has(id)) ||
    new Set(value.pins).size !== value.pins.length
  )
    throw Error('Invalid comparison IDs')
  const reviews: InspectionState['reviews'] = {},
    assignments: InspectionState['assignments'] = {}
  if (!value.reviews || !value.assignments || Array.isArray(value.reviews) || Array.isArray(value.assignments))
    throw Error('Invalid review records')
  if (Object.keys(value.reviews).length > ids.size || Object.keys(value.assignments).length > 50000)
    throw Error('Review record limit exceeded')
  for (const [id, r] of Object.entries(value.reviews)) {
    if (
      !ids.has(id) ||
      !r ||
      !REVIEW_DECISIONS.includes(r.decision) ||
      typeof r.note !== 'string' ||
      r.note.length > 2000
    )
      throw Error('Invalid candidate review')
    reviews[id] = { decision: r.decision, note: r.note }
  }
  for (const [key, label] of Object.entries(value.assignments)) {
    if (
      !/^\d+-\d+-\d+-\d+:\d+$/.test(key) ||
      typeof label !== 'string' ||
      !(ids.has(label) || label === '0' || /^edit-[\w-]{1,60}$/.test(label))
    )
      throw Error('Invalid point assignment')
    assignments[key] = label
  }
  return {
    schema_version: 1,
    source_sha256: value.source_sha256,
    segmentation_sha256: value.segmentation_sha256,
    pins: [...value.pins],
    settings: validSettings(value.settings),
    reviews,
    assignments,
  }
}
export function assignPoints(state: InspectionState, keys: string[], label: string): InspectionState {
  const assignments = { ...state.assignments }
  for (const key of keys) assignments[key] = label
  if (Object.keys(assignments).length > 50000) throw Error('50,000 edited-point limit reached; export your review')
  return { ...state, assignments }
}
export function profileCoordinates(p: IsolatedPoint, centre: [number, number], angle: number) {
  const [x, y] = toMetric(p.lon, p.lat),
    [cx, cy] = toMetric(...centre),
    a = (angle * Math.PI) / 180
  return {
    horizontal: (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a),
    depth: -(x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  }
}
const metricCache = new WeakMap<TreeCrop, Map<IsolatedPoint, [number, number]>>()
function localCoordinates(crop: TreeCrop, p: IsolatedPoint) {
  let points = metricCache.get(crop)
  if (!points) {
    const [cx, cy] = toMetric(...crop.centre)
    points = new Map(
      crop.points.map((p) => {
        const [x, y] = toMetric(p.lon, p.lat)
        return [p, [x - cx, y - cy]]
      }),
    )
    metricCache.set(crop, points)
  }
  const known = points.get(p)
  if (known) return known
  const [x, y] = toMetric(p.lon, p.lat),
    [cx, cy] = toMetric(...crop.centre)
  return [x - cx, y - cy]
}
export function inProfile(
  p: IsolatedPoint,
  crop: TreeCrop,
  settings: ProfileSettings,
  assignments: InspectionState['assignments'] = {},
) {
  if (p.height < settings.minHeight || p.height > settings.maxHeight || !Number.isFinite(p.height)) return false
  if (!settings.showRejected && assignments[pointKey(p)] === '0') return false
  if (settings.mode === 'whole') return true
  const [x, y] = localCoordinates(crop, p),
    angle = (settings.angle * Math.PI) / 180
  return Math.abs(-x * Math.sin(angle) + y * Math.cos(angle) - settings.offset) <= settings.width / 2 + 1e-8
}
export function sliceOverlay(
  crop: TreeCrop | null,
  settings: Pick<ProfileSettings, 'mode' | 'angle' | 'width' | 'offset'>,
): FeatureCollection<Polygon> {
  if (!crop || settings.mode !== 'slice') return { type: 'FeatureCollection', features: [] }
  const [cx, cy] = toMetric(...crop.centre),
    a = (settings.angle * Math.PI) / 180
  let radius = 2
  for (const p of crop.points) {
    const [x, y] = toMetric(p.lon, p.lat)
    radius = Math.max(radius, Math.hypot(x - cx, y - cy) + 1)
  }
  const ring = [
    [-radius, settings.offset - settings.width / 2],
    [radius, settings.offset - settings.width / 2],
    [radius, settings.offset + settings.width / 2],
    [-radius, settings.offset + settings.width / 2],
    [-radius, settings.offset - settings.width / 2],
  ].map(([x, y]) =>
    proj4(METRIC_CRS, 'EPSG:4326', [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]),
  )
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { total_width_m: settings.width, offset_m: settings.offset, angle: settings.angle },
      },
    ],
  }
}
export function inPolygon(point: [number, number], polygon: [number, number][]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i],
      [px, py] = polygon[j]
    if (y > point[1] !== py > point[1] && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x) inside = !inside
  }
  return inside
}
export function splitBySeeds(crop: TreeCrop, seeds: IsolatedPoint[], candidates: IsolatedPoint[]) {
  if (seeds.length < 2) throw Error('Pick at least two seed returns')
  const seedCoords = seeds.map((p) => [...toMetric(p.lon, p.lat), p.height])
  return candidates.map((p) => {
    const [x, y] = toMetric(p.lon, p.lat)
    let winner = 0,
      distance = Infinity
    for (let i = 0; i < seedCoords.length; i++) {
      const [sx, sy, sz] = seedCoords[i],
        d = (x - sx) ** 2 + (y - sy) ** 2 + (p.height - sz) ** 2
      if (d < distance) {
        distance = d
        winner = i
      }
    }
    return { key: pointKey(p), label: `edit-${crop.id}-seed-${winner + 1}` }
  })
}
