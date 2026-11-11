/**
 * Where a block is looked at from, as BC's inventories record it.
 *
 * - **Viewpoints** (`REC_VIEWPOINT_POINT_SVW`) — the Visual Landscape
 *   Inventory's viewing points. Every row carries an expiry date in the past
 *   (12,396 of 12,396 in November 2026), so expiry is reported, not used as a
 *   filter. Type `ERROR` is the inventory flagging its own mistakes; those are
 *   dropped. The ArcGIS view of this layer (MapServer layer 5) answers queries
 *   with no rows, so the WFS is the only working source.
 * - **Viewing directions** (`REC_VIEWING_DIRECTION_LIN`) — the landscape
 *   arrows, stored as arrow-shaped *polygons* despite the name. Their
 *   `COMPASS_BEARING` is 0 on every row, so the bearing is read off the shape:
 *   from the arrow's viewpoint (joined on `VIEWPOINT_ID`, a median 8 m from
 *   the tail) to the vertex farthest from it, the tip. Without the viewpoint,
 *   the end with the wider head is the tip; on the 294 arrows around Bear Lake
 *   that guess was wrong for 33, which is why the viewpoint comes first.
 * - **Screenings** (`REC_SCREENINGS_POLY`) — ground the inventory recorded as
 *   screening a view. Evidence for "screening along the highway", not a
 *   substitute for the run's timber.
 * - **Recreation sites** (`FTEN_REC_SITE_POINTS_SVW`) — "may be visible from
 *   Davie Lake South Rec Site".
 * - **Tenure roads** (`FTEN_ROAD_SECTION_LINES_SVW`) — names for the road a
 *   windfirm screen is left along.
 *
 * Parsing, the arrow bearing and the ranking are pure; `fetchViewpointInventory`
 * is the one network call. The bounding box goes in `CQL_FILTER`, never the
 * WFS `bbox` parameter (see `bcVegetationInventory.ts`).
 */
import {
  bearingDegrees,
  haversineMeters,
  metersPerDegree,
  polygonBounds,
  polygonInteriorPoint,
  type PolygonGeometry,
} from './visibility'
import { lineToPolygonMeters } from './visualsNarrative'

export const BC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'

export const VIEWPOINT_LAYERS = {
  viewpoints: 'WHSE_FOREST_VEGETATION.REC_VIEWPOINT_POINT_SVW',
  arrows: 'WHSE_FOREST_VEGETATION.REC_VIEWING_DIRECTION_LIN',
  screenings: 'WHSE_FOREST_VEGETATION.REC_SCREENINGS_POLY',
  recSites: 'WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW',
  roads: 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW',
} as const

const FIELDS: Record<keyof typeof VIEWPOINT_LAYERS, string[]> = {
  viewpoints: ['VIEWPOINT_ID', 'VIEWPOINT_NUMBER', 'REC_VIEWPOINT_TYPE_CODE', 'DESCRIPTION', 'EXPIRY_DATE', 'GEOMETRY'],
  arrows: ['VIEWING_DIRECTION_ID', 'VIEWPOINT_ID', 'DIRECTION_NUMBER', 'VIEWING_DIRECTION_TYPE', 'GEOMETRY'],
  screenings: ['SCREENING_NUMBER', 'RS_TYPE', 'OBJECTID', 'GEOMETRY'],
  recSites: ['FOREST_FILE_ID', 'PROJECT_NAME', 'SITE_LOCATION', 'OBJECTID', 'GEOMETRY'],
  roads: [
    'FOREST_FILE_ID',
    'ROAD_SECTION_ID',
    'ROAD_SECTION_NAME',
    'FILE_TYPE_DESCRIPTION',
    'LIFE_CYCLE_STATUS_CODE',
    'MAP_LABEL',
    'OBJECTID',
    'GEOMETRY',
  ],
}

/** Widest box asked for at once, degrees: a district-scale view, not a province. */
export const MAX_VIEWPOINT_QUERY_DEGREES = 0.8
const MAX_FEATURES = 3000

export type Bounds = [number, number, number, number]

/** Keeps the box centred and no wider than the limit. */
export function clampViewpointBounds(bounds: Bounds, limit = MAX_VIEWPOINT_QUERY_DEGREES): Bounds {
  const [west, south, east, north] = bounds
  const lng = (west + east) / 2,
    lat = (south + north) / 2
  const half = (span: number) => Math.min(span, limit) / 2
  return [lng - half(east - west), lat - half(north - south), lng + half(east - west), lat + half(north - south)]
}

export function viewpointLayerUrl(layer: keyof typeof VIEWPOINT_LAYERS, bounds: Bounds): string {
  const [west, south, east, north] = clampViewpointBounds(bounds)
  const parameters = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: VIEWPOINT_LAYERS[layer],
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(MAX_FEATURES),
    propertyName: FIELDS[layer].join(','),
    CQL_FILTER: `BBOX(GEOMETRY,${west},${south},${east},${north},'EPSG:4326')`,
  })
  return `${BC_WFS}?${parameters.toString()}`
}

// ---------------------------------------------------------------------------
// Records

export type VliViewpoint = {
  id: string
  number: number | null
  /** `MAJVP`, `MINVP`, `PHOTOP`. */
  typeCode: string
  typeLabel: string
  lng: number
  lat: number
  expiry: string | null
}

export type ViewingArrow = {
  id: string
  viewpointId: string
  size: 'small' | 'large'
  geometry: GeoJSON.Polygon
  /** Degrees clockwise from north, tail to tip. */
  bearing: number
  tail: [number, number]
  tip: [number, number]
  lengthMeters: number
  /** How the bearing was read: from the joined viewpoint, or from the shape alone. */
  bearingFrom: 'viewpoint' | 'shape'
}

export type RecSite = { id: string; name: string; location: string | null; lng: number; lat: number }

export type InventoryScreening = { id: string; number: string | null; type: string | null; geometry: PolygonGeometry }

export type TenureRoad = {
  id: string
  /** As a note writes it: "Davie Lake FSR", "DABE 2000". */
  name: string
  fileId: string | null
  forestServiceRoad: boolean
  retired: boolean
  coordinates: Array<[number, number]>
}

export type ViewpointInventory = {
  viewpoints: VliViewpoint[]
  arrows: ViewingArrow[]
  screenings: InventoryScreening[]
  recSites: RecSite[]
  roads: TenureRoad[]
  /** Layers that hit the feature cap, so more lie in the box than came back. */
  truncated: Array<keyof typeof VIEWPOINT_LAYERS>
  /** Layers that could not be read. */
  failed: Array<{ layer: keyof typeof VIEWPOINT_LAYERS; message: string }>
  retrievedAt: string
  bounds: Bounds
  /** Viewpoints the inventory itself typed `ERROR`, left out. */
  droppedErrorViewpoints: number
}

const VIEWPOINT_TYPE_LABELS: Record<string, string> = {
  MAJVP: 'Major viewpoint',
  MINVP: 'Minor viewpoint',
  PHOTOP: 'Photopoint',
}

type RawFeature = { id?: unknown; geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }

function features(payload: unknown): RawFeature[] {
  const list = (payload as { features?: unknown })?.features
  return Array.isArray(list) ? (list as RawFeature[]) : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isPoint(geometry: GeoJSON.Geometry | null | undefined): geometry is GeoJSON.Point {
  return (
    geometry?.type === 'Point' && Number.isFinite(geometry.coordinates[0]) && Number.isFinite(geometry.coordinates[1])
  )
}

export function parseViewpoints(payload: unknown): { viewpoints: VliViewpoint[]; droppedErrors: number } {
  let droppedErrors = 0
  const viewpoints = features(payload).flatMap((feature): VliViewpoint[] => {
    const p = feature.properties ?? {}
    if (!isPoint(feature.geometry)) return []
    const typeCode = text(p.REC_VIEWPOINT_TYPE_CODE)?.toUpperCase() ?? ''
    if (typeCode === 'ERROR') {
      droppedErrors += 1
      return []
    }
    const id = text(p.VIEWPOINT_ID)
    if (!id) return []
    return [
      {
        id,
        number: finite(p.VIEWPOINT_NUMBER),
        typeCode,
        typeLabel: VIEWPOINT_TYPE_LABELS[typeCode] ?? text(p.DESCRIPTION) ?? 'Viewpoint',
        lng: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
        expiry: text(p.EXPIRY_DATE)?.replace(/Z$/, '') ?? null,
      },
    ]
  })
  return { viewpoints, droppedErrors }
}

function localMetres(origin: { lng: number; lat: number }) {
  const scale = metersPerDegree(origin.lat)
  return (point: GeoJSON.Position): [number, number] => [
    (point[0] - origin.lng) * scale.lng,
    (point[1] - origin.lat) * scale.lat,
  ]
}

/**
 * Tail, tip and bearing of an arrow polygon. With its viewpoint, the tip is
 * the vertex farthest from the viewpoint. Without one, the arrow's long axis
 * is its two most distant vertices, and the tip is the end whose last quarter
 * spreads widest across the axis: the head, not the rounded tail.
 */
export function arrowAxis(
  ring: ReadonlyArray<GeoJSON.Position>,
  viewpoint?: { lng: number; lat: number } | null,
): {
  tail: [number, number]
  tip: [number, number]
  bearing: number
  lengthMeters: number
  from: 'viewpoint' | 'shape'
} | null {
  const points = ring.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (points.length < 3) return null
  if (viewpoint) {
    const toMetres = localMetres(viewpoint)
    let tip = points[0],
      far = -1
    for (const point of points) {
      const [x, y] = toMetres(point)
      const distance = Math.hypot(x, y)
      if (distance > far) {
        far = distance
        tip = point
      }
    }
    const tail: [number, number] = [viewpoint.lng, viewpoint.lat]
    return {
      tail,
      tip: [tip[0], tip[1]],
      bearing: bearingDegrees(viewpoint, { lng: tip[0], lat: tip[1] }),
      lengthMeters: haversineMeters(viewpoint, { lng: tip[0], lat: tip[1] }),
      from: 'viewpoint',
    }
  }
  const origin = { lng: points[0][0], lat: points[0][1] }
  const toMetres = localMetres(origin)
  const xy = points.map(toMetres)
  let a = 0,
    b = 1,
    longest = -1
  for (let i = 0; i < xy.length; i += 1)
    for (let j = i + 1; j < xy.length; j += 1) {
      const distance = Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1])
      if (distance > longest) {
        longest = distance
        a = i
        b = j
      }
    }
  if (!(longest > 0)) return null
  const ux = (xy[b][0] - xy[a][0]) / longest,
    uy = (xy[b][1] - xy[a][1]) / longest
  const spread = (nearB: boolean) => {
    const across = xy
      .filter(([x, y]) => {
        const along = ((x - xy[a][0]) * ux + (y - xy[a][1]) * uy) / longest
        return nearB ? along >= 0.75 : along <= 0.25
      })
      .map(([x, y]) => (x - xy[a][0]) * -uy + (y - xy[a][1]) * ux)
    return across.length ? Math.max(...across) - Math.min(...across) : 0
  }
  const [tailIndex, tipIndex] = spread(true) >= spread(false) ? [a, b] : [b, a]
  const tail = points[tailIndex],
    tip = points[tipIndex]
  return {
    tail: [tail[0], tail[1]],
    tip: [tip[0], tip[1]],
    bearing: bearingDegrees({ lng: tail[0], lat: tail[1] }, { lng: tip[0], lat: tip[1] }),
    lengthMeters: longest,
    from: 'shape',
  }
}

export function parseArrows(payload: unknown, viewpoints: ReadonlyArray<VliViewpoint>): ViewingArrow[] {
  const byId = new Map(viewpoints.map((viewpoint) => [viewpoint.id, viewpoint]))
  return features(payload).flatMap((feature): ViewingArrow[] => {
    const p = feature.properties ?? {}
    const geometry = feature.geometry
    if (geometry?.type !== 'Polygon' || !geometry.coordinates[0]?.length) return []
    const id = text(p.VIEWING_DIRECTION_ID) ?? text(feature.id)
    const viewpointId = text(p.VIEWPOINT_ID) ?? ''
    if (!id) return []
    const axis = arrowAxis(geometry.coordinates[0], byId.get(viewpointId) ?? null)
    if (!axis) return []
    return [
      {
        id,
        viewpointId,
        size: /large/i.test(text(p.VIEWING_DIRECTION_TYPE) ?? '') ? 'large' : 'small',
        geometry,
        bearing: axis.bearing,
        tail: axis.tail,
        tip: axis.tip,
        lengthMeters: axis.lengthMeters,
        bearingFrom: axis.from,
      },
    ]
  })
}

export function parseScreenings(payload: unknown): InventoryScreening[] {
  return features(payload).flatMap((feature, index): InventoryScreening[] => {
    const geometry = feature.geometry
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []
    const p = feature.properties ?? {}
    return [
      {
        id: text(p.OBJECTID) ?? text(feature.id) ?? `screening-${index}`,
        number: text(p.SCREENING_NUMBER),
        type: text(p.RS_TYPE),
        geometry,
      },
    ]
  })
}

/** "DAVIE LAKE FSR" → "Davie Lake FSR"; "Crystal Lake FSR" kept. */
function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
    .replace(/\bFsr\b/g, 'FSR')
}

export function tenureRoadLabel(name: string, forestServiceRoad: boolean): string {
  const trimmed = name.trim()
  if (!forestServiceRoad) return trimmed
  const label = trimmed === trimmed.toUpperCase() ? titleCase(trimmed) : trimmed
  return /\bFSR\b/i.test(label) ? label : `${label} FSR`
}

export function parseRecSites(payload: unknown): RecSite[] {
  return features(payload).flatMap((feature, index): RecSite[] => {
    if (!isPoint(feature.geometry)) return []
    const p = feature.properties ?? {}
    const project = text(p.PROJECT_NAME)
    const id = text(p.FOREST_FILE_ID) ?? text(p.OBJECTID) ?? `rec-${index}`
    return [
      {
        id,
        name: project
          ? /\brec(?:reation)? site\b/i.test(project)
            ? project
            : `${project} Rec Site`
          : `Recreation site ${id}`,
        location: text(p.SITE_LOCATION),
        lng: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1],
      },
    ]
  })
}

export function parseTenureRoads(payload: unknown): TenureRoad[] {
  return features(payload).flatMap((feature, index): TenureRoad[] => {
    const geometry = feature.geometry
    const parts =
      geometry?.type === 'LineString'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiLineString'
          ? geometry.coordinates
          : []
    const p = feature.properties ?? {}
    const forestServiceRoad = /forest service road/i.test(text(p.FILE_TYPE_DESCRIPTION) ?? '')
    const rawName = text(p.ROAD_SECTION_NAME) ?? text(p.MAP_LABEL)
    if (!rawName) return []
    const base = text(p.OBJECTID) ?? `${text(p.FOREST_FILE_ID) ?? 'road'}-${text(p.ROAD_SECTION_ID) ?? index}`
    return parts.flatMap((part, partIndex): TenureRoad[] => {
      const coordinates = part
        .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map((c): [number, number] => [c[0], c[1]])
      if (coordinates.length < 2) return []
      return [
        {
          id: parts.length > 1 ? `${base}-${partIndex}` : base,
          name: tenureRoadLabel(rawName, forestServiceRoad),
          fileId: text(p.FOREST_FILE_ID),
          forestServiceRoad,
          retired: text(p.LIFE_CYCLE_STATUS_CODE)?.toUpperCase() === 'RETIRED',
          coordinates,
        },
      ]
    })
  })
}

// ---------------------------------------------------------------------------
// Which of them look at the block

/** An arrow within this many degrees of the block's direction aims at it. */
export const ARROW_AIM_DEGREES = 30
/** Viewpoints and sites farther than this are not offered for a block, metres. */
export const VIEWPOINT_SEARCH_METERS = 12_000

export type ViewpointCandidate = {
  key: string
  kind: 'vli' | 'rec-site'
  name: string
  lng: number
  lat: number
  distanceMeters: number
  bearingToBlock: number
  /** The viewpoint's arrow nearest the block's direction. */
  arrow: { id: string; bearing: number; offsetDegrees: number; lengthMeters: number; aims: boolean } | null
  /** Sort key: nearer and aimed at the block first. Not a visibility figure. */
  weight: number
}

export function vliViewpointName(viewpoint: VliViewpoint): string {
  return `VLI ${viewpoint.typeLabel.toLowerCase()}${viewpoint.number !== null ? ` ${viewpoint.number}` : ''}`
}

function angleBetween(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/**
 * Inventory viewpoints and recreation sites near a block, nearest and
 * aimed-at-it first. An arrow aiming at the block raises a viewpoint, as the
 * planner would weigh it; one aiming away does not drop it, because a person
 * at a site looks around. Whether the block is in view is the reverse run's
 * job, not this ranking's.
 */
export function viewpointsNearBlock(
  block: PolygonGeometry,
  inventory: Pick<ViewpointInventory, 'viewpoints' | 'arrows' | 'recSites'>,
  maxDistanceMeters = VIEWPOINT_SEARCH_METERS,
): ViewpointCandidate[] {
  const centre = polygonInteriorPoint(block)
  if (!centre) return []
  const arrowsByViewpoint = new Map<string, ViewingArrow[]>()
  for (const arrow of inventory.arrows) {
    const list = arrowsByViewpoint.get(arrow.viewpointId) ?? []
    list.push(arrow)
    arrowsByViewpoint.set(arrow.viewpointId, list)
  }
  const distanceTo = (point: { lng: number; lat: number }) => lineToPolygonMeters(block, [[point.lng, point.lat]])
  const rows: ViewpointCandidate[] = []
  for (const viewpoint of inventory.viewpoints) {
    const distance = distanceTo(viewpoint)
    if (distance > maxDistanceMeters) continue
    const toBlock = bearingDegrees(viewpoint, centre)
    const arrow = (arrowsByViewpoint.get(viewpoint.id) ?? [])
      .map((entry) => ({ entry, offset: angleBetween(entry.bearing, toBlock) }))
      .sort((x, y) => x.offset - y.offset)[0]
    const aims = !!arrow && arrow.offset <= ARROW_AIM_DEGREES
    rows.push({
      key: `vli:${viewpoint.id}`,
      kind: 'vli',
      name: vliViewpointName(viewpoint),
      lng: viewpoint.lng,
      lat: viewpoint.lat,
      distanceMeters: distance,
      bearingToBlock: toBlock,
      arrow: arrow
        ? {
            id: arrow.entry.id,
            bearing: arrow.entry.bearing,
            offsetDegrees: arrow.offset,
            lengthMeters: arrow.entry.lengthMeters,
            aims,
          }
        : null,
      weight: distance / (aims ? 2 : 1) / (viewpoint.typeCode === 'MAJVP' ? 1.5 : 1),
    })
  }
  for (const site of inventory.recSites) {
    const distance = distanceTo(site)
    if (distance > maxDistanceMeters) continue
    rows.push({
      key: `rec:${site.id}`,
      kind: 'rec-site',
      name: site.name,
      lng: site.lng,
      lat: site.lat,
      distanceMeters: distance,
      bearingToBlock: bearingDegrees(site, centre),
      arrow: null,
      // A campsite is lived in, not driven past: weigh it as a major viewpoint.
      weight: distance / 1.5,
    })
  }
  return rows.sort((a, b) => a.weight - b.weight)
}

/** Tenure roads within `withinMeters` of the block, nearest first, retired roads left out. */
export function roadsNearBlock(
  block: PolygonGeometry,
  roads: ReadonlyArray<TenureRoad>,
  withinMeters = 500,
): Array<{ name: string; distanceMeters: number; forestServiceRoad: boolean }> {
  const [west, south, east, north] = polygonBounds(block)
  const scale = metersPerDegree((south + north) / 2)
  const padLng = withinMeters / scale.lng,
    padLat = withinMeters / scale.lat
  const best = new Map<string, { name: string; distanceMeters: number; forestServiceRoad: boolean }>()
  for (const road of roads) {
    if (road.retired) continue
    const near = road.coordinates.some(
      ([lng, lat]) => lng >= west - padLng && lng <= east + padLng && lat >= south - padLat && lat <= north + padLat,
    )
    if (!near) continue
    const distance = lineToPolygonMeters(block, road.coordinates)
    if (distance > withinMeters) continue
    const current = best.get(road.name)
    if (!current || distance < current.distanceMeters)
      best.set(road.name, { name: road.name, distanceMeters: distance, forestServiceRoad: road.forestServiceRoad })
  }
  return [...best.values()].sort((a, b) => a.distanceMeters - b.distanceMeters)
}

// ---------------------------------------------------------------------------
// Network

async function readLayer(layer: keyof typeof VIEWPOINT_LAYERS, bounds: Bounds, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(viewpointLayerUrl(layer, bounds), { signal })
  if (!response.ok) throw new Error(`DataBC answered ${response.status}`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown })?.exceptions) throw new Error('DataBC refused the query')
  return payload
}

function truncatedPayload(payload: unknown): boolean {
  const collection = payload as { features?: unknown[]; numberMatched?: unknown }
  const matched = finite(collection?.numberMatched)
  return (
    (Array.isArray(collection?.features) && collection.features.length >= MAX_FEATURES) ||
    (matched !== null && Array.isArray(collection?.features) && matched > collection.features.length)
  )
}

/** All five layers for a box; a layer that fails is reported, not fatal. */
export async function fetchViewpointInventory(bounds: Bounds, signal?: AbortSignal): Promise<ViewpointInventory> {
  const layers = Object.keys(VIEWPOINT_LAYERS) as Array<keyof typeof VIEWPOINT_LAYERS>
  const settled = await Promise.allSettled(layers.map((layer) => readLayer(layer, bounds, signal)))
  signal?.throwIfAborted()
  const payload = (layer: keyof typeof VIEWPOINT_LAYERS) => {
    const result = settled[layers.indexOf(layer)]
    return result.status === 'fulfilled' ? result.value : null
  }
  const { viewpoints, droppedErrors } = parseViewpoints(payload('viewpoints'))
  return {
    viewpoints,
    arrows: parseArrows(payload('arrows'), viewpoints),
    screenings: parseScreenings(payload('screenings')),
    recSites: parseRecSites(payload('recSites')),
    roads: parseTenureRoads(payload('roads')),
    truncated: layers.filter((layer) => truncatedPayload(payload(layer))),
    failed: layers.flatMap((layer, i) => {
      const result = settled[i]
      return result.status === 'rejected'
        ? [{ layer, message: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
        : []
    }),
    retrievedAt: new Date().toISOString(),
    bounds: clampViewpointBounds(bounds),
    droppedErrorViewpoints: droppedErrors,
  }
}

// ---------------------------------------------------------------------------
// Standing at one

/** The pullout a viewpoint is stood on, metres: long enough for the road view, short enough to be one spot. */
export const PULLOUT_METERS = 30

/**
 * A short "road" through a viewpoint, square to the line of sight to the block,
 * so the road view — built along a road — can stand there. The eye is at its
 * middle; the run's stations along it are effectively one spot.
 */
export function pulloutThrough(
  point: { lng: number; lat: number },
  toward: { lng: number; lat: number },
  lengthMeters = PULLOUT_METERS,
): Array<[number, number]> {
  const radians = ((bearingDegrees(point, toward) + 90) * Math.PI) / 180
  const scale = metersPerDegree(point.lat)
  const half = lengthMeters / 2
  const dx = (Math.sin(radians) * half) / scale.lng,
    dy = (Math.cos(radians) * half) / scale.lat
  return [
    [point.lng - dx, point.lat - dy],
    [point.lng + dx, point.lat + dy],
  ]
}
