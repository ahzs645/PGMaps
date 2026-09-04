import createWebShareEngine from '@firstform/json-url/web-share'

/**
 * Portable trip-plan document for the BC outdoors planner prototype.
 *
 * The same JSON shape backs all three persistence paths, so a plan saved one
 * way can always be reopened another way:
 *  - compressed into the `?s=` share token in the page URL,
 *  - exported to / imported from a `*.plan.json` file,
 *  - autosaved to localStorage between visits.
 */
export const OUTDOORS_PLAN_SCHEMA = 'pgmaps.bc-outdoors-plan'
export const OUTDOORS_PLAN_VERSION = 1

export const PLAN_ACTIVITIES = ['hunt', 'fish', 'scout'] as const
export type PlanActivity = (typeof PLAN_ACTIVITIES)[number]

export const WAYPOINT_KINDS = ['camp', 'access', 'launch', 'site', 'hazard', 'note'] as const
export type WaypointKind = (typeof WAYPOINT_KINDS)[number]

export const WAYPOINT_KIND_LABELS: Record<WaypointKind, string> = {
  camp: 'Camp',
  access: 'Access point',
  launch: 'Boat launch',
  site: 'Recreation site',
  hazard: 'Hazard',
  note: 'Note',
}

export const AREA_KINDS = ['closure', 'hunt-area', 'water', 'area'] as const
export type AreaKind = (typeof AREA_KINDS)[number]

export const AREA_KIND_LABELS: Record<AreaKind, string> = {
  closure: 'Vehicle closure',
  'hunt-area': 'Legal hunt area',
  water: 'Water',
  area: 'Area',
}

export const ROUTE_KINDS = ['corridor', 'access-route', 'water-route', 'travel', 'route'] as const
export type RouteKind = (typeof ROUTE_KINDS)[number]

export const ROUTE_KIND_LABELS: Record<RouteKind, string> = {
  corridor: 'Vehicle corridor',
  'access-route': 'Access route',
  'water-route': 'Water route',
  travel: 'Travel range',
  route: 'Route',
}

export interface PlanWaypoint {
  id: string
  name: string
  kind: WaypointKind
  /** WGS84, rounded to 5 decimal places (~1 m) to keep share tokens short. */
  lng: number
  lat: number
  notes?: string
}

export interface PlanRoute {
  id: string
  name: string
  kind: RouteKind
  /** WGS84 [lng, lat] pairs, rounded to 5 decimal places. */
  coordinates: Array<[number, number]>
  notes?: string
}

export interface PlanArea {
  id: string
  name: string
  kind: AreaKind
  /** Polygon rings (outer first, holes after), closed, rounded to 5 dp. */
  rings: Array<Array<[number, number]>>
  notes?: string
}

export interface PlanWmu {
  /** Management unit id as published in the WMU layer, e.g. "7-42". */
  id: string
  /** Display name captured at selection time so shared links can label it. */
  name?: string
}

export interface PlanViewport {
  center: [number, number]
  zoom: number
}

export interface OutdoorsPlan {
  schema: typeof OUTDOORS_PLAN_SCHEMA
  version: typeof OUTDOORS_PLAN_VERSION
  name: string
  activity: PlanActivity
  species: string
  /** ISO dates (yyyy-mm-dd) or empty strings when not chosen yet. */
  startDate: string
  endDate: string
  notes: string
  wmus: PlanWmu[]
  waypoints: PlanWaypoint[]
  routes: PlanRoute[]
  areas: PlanArea[]
  viewport?: PlanViewport
}

export const MAX_PLAN_WAYPOINTS = 300
export const MAX_PLAN_ROUTES = 100
export const MAX_PLAN_AREAS = 100
/** Per line/ring; longer geometry is uniformly downsampled on import. */
export const MAX_VERTICES_PER_LINE = 400
const MAX_NAME_LENGTH = 120
const MAX_NOTES_LENGTH = 2000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function createWaypointId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function createEmptyPlan(): OutdoorsPlan {
  return {
    schema: OUTDOORS_PLAN_SCHEMA,
    version: OUTDOORS_PLAN_VERSION,
    name: '',
    activity: 'hunt',
    species: '',
    startDate: '',
    endDate: '',
    notes: '',
    wmus: [],
    waypoints: [],
    routes: [],
    areas: [],
  }
}

export function roundCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function normalizeDate(value: unknown): string {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : ''
}

function normalizeLng(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 180 ? roundCoordinate(value) : null
}

function normalizeLat(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 90 ? roundCoordinate(value) : null
}

function normalizeWaypoint(value: unknown): PlanWaypoint | null {
  const record = asRecord(value)
  if (!record) return null
  const lng = normalizeLng(record.lng)
  const lat = normalizeLat(record.lat)
  if (lng == null || lat == null) return null
  // Null-island placeholder, not a real fix — see normalizeLinePoints.
  if (lng === 0 && lat === 0) return null
  const kind = WAYPOINT_KINDS.includes(record.kind as WaypointKind) ? (record.kind as WaypointKind) : 'note'
  const notes = normalizeText(record.notes, MAX_NOTES_LENGTH)
  return {
    id: typeof record.id === 'string' && record.id ? record.id.slice(0, 40) : createWaypointId(),
    name: normalizeText(record.name, MAX_NAME_LENGTH),
    kind,
    lng,
    lat,
    ...(notes ? { notes } : {}),
  }
}

/** Uniformly thin a vertex list so its length never exceeds `max`. */
function downsampleVertices(points: Array<[number, number]>, max: number): Array<[number, number]> {
  if (points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, index) => points[Math.round(index * step)])
}

function normalizeLinePoints(value: unknown, max: number): Array<[number, number]> {
  if (!Array.isArray(value)) return []
  const points: Array<[number, number]> = []
  for (const entry of value) {
    if (!Array.isArray(entry)) continue
    const lng = normalizeLng(entry[0])
    const lat = normalizeLat(entry[1])
    if (lng == null || lat == null) continue
    // Exact (0, 0) is the "null island" placeholder GPS/KML tools emit for a
    // missing fix; one slipped vertex would drag every bounds calculation out
    // to the Atlantic.
    if (lng === 0 && lat === 0) continue
    const previous = points[points.length - 1]
    // Rounding can collapse neighbours into duplicates; keep the line clean.
    if (previous && previous[0] === lng && previous[1] === lat) continue
    points.push([lng, lat])
  }
  return downsampleVertices(points, max)
}

function normalizeRoute(value: unknown): PlanRoute | null {
  const record = asRecord(value)
  if (!record) return null
  const coordinates = normalizeLinePoints(record.coordinates, MAX_VERTICES_PER_LINE)
  if (coordinates.length < 2) return null
  const kind = ROUTE_KINDS.includes(record.kind as RouteKind) ? (record.kind as RouteKind) : 'route'
  const notes = normalizeText(record.notes, MAX_NOTES_LENGTH)
  return {
    id: typeof record.id === 'string' && record.id ? record.id.slice(0, 40) : createWaypointId(),
    name: normalizeText(record.name, MAX_NAME_LENGTH),
    kind,
    coordinates,
    ...(notes ? { notes } : {}),
  }
}

function normalizeRing(value: unknown): Array<[number, number]> | null {
  // A ring needs headroom for its closing point.
  const points = normalizeLinePoints(value, MAX_VERTICES_PER_LINE - 1)
  const last = points[points.length - 1]
  // Drop an already-closed ring's duplicate endpoint before the length check,
  // then re-close deterministically.
  if (last && points[0][0] === last[0] && points[0][1] === last[1]) points.pop()
  if (points.length < 3) return null
  return [...points, points[0]]
}

function normalizeArea(value: unknown): PlanArea | null {
  const record = asRecord(value)
  if (!record) return null
  const rings = (Array.isArray(record.rings) ? record.rings : [])
    .map(normalizeRing)
    .filter((ring): ring is Array<[number, number]> => ring != null)
  if (rings.length === 0) return null
  const kind = AREA_KINDS.includes(record.kind as AreaKind) ? (record.kind as AreaKind) : 'area'
  const notes = normalizeText(record.notes, MAX_NOTES_LENGTH)
  return {
    id: typeof record.id === 'string' && record.id ? record.id.slice(0, 40) : createWaypointId(),
    name: normalizeText(record.name, MAX_NAME_LENGTH),
    kind,
    rings,
    ...(notes ? { notes } : {}),
  }
}

function normalizeWmu(value: unknown): PlanWmu | null {
  const record = asRecord(value)
  // Tolerate the compact `"7-42"` form alongside `{ id, name }`.
  if (typeof value === 'string' && value.trim()) return { id: value.trim().slice(0, 20) }
  if (!record || typeof record.id !== 'string' || !record.id.trim()) return null
  const name = normalizeText(record.name, MAX_NAME_LENGTH)
  return { id: record.id.trim().slice(0, 20), ...(name ? { name } : {}) }
}

function normalizeViewport(value: unknown): PlanViewport | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const center = Array.isArray(record.center) ? record.center : null
  const lng = center ? normalizeLng(center[0]) : null
  const lat = center ? normalizeLat(center[1]) : null
  const zoom = typeof record.zoom === 'number' && Number.isFinite(record.zoom) ? record.zoom : null
  if (lng == null || lat == null || zoom == null) return undefined
  return { center: [lng, lat], zoom: Math.min(Math.max(zoom, 0), 22) }
}

/**
 * Validate and coerce untrusted JSON (share token, imported file, localStorage)
 * into a plan. Returns null when the value is not recognizably a plan document.
 */
export function normalizeOutdoorsPlan(value: unknown): OutdoorsPlan | null {
  const record = asRecord(value)
  if (!record) return null
  if (record.schema !== OUTDOORS_PLAN_SCHEMA) return null
  if (record.version !== OUTDOORS_PLAN_VERSION) return null

  const seenWmuIds = new Set<string>()
  const wmus = (Array.isArray(record.wmus) ? record.wmus : []).map(normalizeWmu).filter((wmu): wmu is PlanWmu => {
    if (!wmu || seenWmuIds.has(wmu.id)) return false
    seenWmuIds.add(wmu.id)
    return true
  })

  const waypoints = (Array.isArray(record.waypoints) ? record.waypoints : [])
    .map(normalizeWaypoint)
    .filter((waypoint): waypoint is PlanWaypoint => waypoint != null)
    .slice(0, MAX_PLAN_WAYPOINTS)

  const routes = (Array.isArray(record.routes) ? record.routes : [])
    .map(normalizeRoute)
    .filter((route): route is PlanRoute => route != null)
    .slice(0, MAX_PLAN_ROUTES)

  const areas = (Array.isArray(record.areas) ? record.areas : [])
    .map(normalizeArea)
    .filter((area): area is PlanArea => area != null)
    .slice(0, MAX_PLAN_AREAS)

  const activity = PLAN_ACTIVITIES.includes(record.activity as PlanActivity)
    ? (record.activity as PlanActivity)
    : 'hunt'

  return {
    schema: OUTDOORS_PLAN_SCHEMA,
    version: OUTDOORS_PLAN_VERSION,
    name: normalizeText(record.name, MAX_NAME_LENGTH),
    activity,
    species: normalizeText(record.species, MAX_NAME_LENGTH),
    startDate: normalizeDate(record.startDate),
    endDate: normalizeDate(record.endDate),
    notes: normalizeText(record.notes, MAX_NOTES_LENGTH),
    wmus,
    waypoints,
    routes,
    areas,
    viewport: normalizeViewport(record.viewport),
  }
}

// --- URL sharing -----------------------------------------------------------

const planShareEngine = createWebShareEngine<OutdoorsPlan>({
  codecs: ['raw', 'lz'],
  maxLength: 12000,
  skipUnsupportedCodecs: true,
})

export function encodeOutdoorsPlanToken(plan: OutdoorsPlan): Promise<string> {
  return planShareEngine.compress(plan)
}

export async function decodeOutdoorsPlanToken(token: string): Promise<OutdoorsPlan | null> {
  const decoded = await planShareEngine.tryDecompress(token, null as unknown as OutdoorsPlan, {
    deURI: true,
  })
  return normalizeOutdoorsPlan(decoded)
}

// --- File export / import --------------------------------------------------

export function serializeOutdoorsPlan(plan: OutdoorsPlan): string {
  return `${JSON.stringify({ ...plan, exportedAt: new Date().toISOString() }, null, 2)}\n`
}

export function planFileName(plan: OutdoorsPlan, extension: string): string {
  const slug = plan.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'outdoors-plan'}.${extension}`
}

export function planToGeoJson(plan: OutdoorsPlan): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...plan.areas.map<GeoJSON.Feature>((area) => ({
        type: 'Feature',
        id: area.id,
        geometry: { type: 'Polygon', coordinates: area.rings },
        properties: {
          name: area.name,
          kind: area.kind,
          featureType: 'area',
          ...(area.notes ? { notes: area.notes } : {}),
        },
      })),
      ...plan.routes.map<GeoJSON.Feature>((route) => ({
        type: 'Feature',
        id: route.id,
        geometry: { type: 'LineString', coordinates: route.coordinates },
        properties: {
          name: route.name,
          kind: route.kind,
          featureType: 'route',
          ...(route.notes ? { notes: route.notes } : {}),
        },
      })),
      ...plan.waypoints.map<GeoJSON.Feature>((waypoint) => ({
        type: 'Feature',
        id: waypoint.id,
        geometry: { type: 'Point', coordinates: [waypoint.lng, waypoint.lat] },
        properties: {
          name: waypoint.name,
          kind: waypoint.kind,
          featureType: 'waypoint',
          ...(waypoint.notes ? { notes: waypoint.notes } : {}),
        },
      })),
    ],
    // Non-geometric plan context rides along for other tools (QGIS keeps
    // foreign members; consumers that drop them still get the waypoints).
    ...({
      metadata: {
        schema: OUTDOORS_PLAN_SCHEMA,
        version: OUTDOORS_PLAN_VERSION,
        name: plan.name,
        activity: plan.activity,
        species: plan.species,
        startDate: plan.startDate,
        endDate: plan.endDate,
        notes: plan.notes,
        wmus: plan.wmus,
      },
    } as object),
  }
}

/** planningClass values written by the bcdatamapper KML importer. */
const KML_CLASS_TO_KIND: Record<string, WaypointKind> = {
  'formal-access': 'launch',
  'access-candidate': 'access',
  'recreation-site': 'site',
  'personal-note': 'note',
}

const KML_CLASS_TO_AREA_KIND: Record<string, AreaKind> = {
  'vehicle-closure': 'closure',
  'legal-hunt-area': 'hunt-area',
  'navigable-water': 'water',
}

const KML_CLASS_TO_ROUTE_KIND: Record<string, RouteKind> = {
  'designated-corridor': 'corridor',
  'access-candidate': 'access-route',
  'navigable-water': 'water-route',
  'travel-range': 'travel',
}

/**
 * Classes whose geometry the planner deliberately does not import: duplicate
 * label pins, and the MU boundary that the authoritative WMU layer already
 * renders.
 */
const SKIPPED_KML_CLASSES = new Set(['map-label', 'management-context'])

export interface PlanImportResult {
  plan: OutdoorsPlan
  source: 'plan' | 'geojson'
  /** Features in an imported GeoJSON that could not become waypoints. */
  skippedCount: number
}

/**
 * Convert a GeoJSON FeatureCollection — such as the private plans produced by
 * `outdoors:kml:import` — into a plan. Point features become waypoints;
 * duplicate map-label points and non-point geometry are counted as skipped.
 */
export function planFromGeoJson(value: unknown): PlanImportResult | null {
  const record = asRecord(value)
  if (!record || record.type !== 'FeatureCollection' || !Array.isArray(record.features)) return null

  const plan = createEmptyPlan()
  const metadata = asRecord(record.metadata)
  plan.name = normalizeText(metadata?.name ?? record.name, MAX_NAME_LENGTH)
  plan.activity = PLAN_ACTIVITIES.includes(metadata?.activity as PlanActivity)
    ? (metadata?.activity as PlanActivity)
    : plan.activity
  plan.species = normalizeText(metadata?.species, MAX_NAME_LENGTH)
  plan.startDate = normalizeDate(metadata?.startDate)
  plan.endDate = normalizeDate(metadata?.endDate)
  plan.notes = normalizeText(metadata?.notes, MAX_NOTES_LENGTH)

  const seenWmuIds = new Set<string>()
  plan.wmus = (Array.isArray(metadata?.wmus) ? metadata.wmus : []).map(normalizeWmu).filter((wmu): wmu is PlanWmu => {
    if (!wmu || seenWmuIds.has(wmu.id)) return false
    seenWmuIds.add(wmu.id)
    return true
  })
  let skippedCount = 0

  const addRoute = (id: unknown, name: unknown, kind: RouteKind, coordinates: unknown, notes: unknown): boolean => {
    const route = plan.routes.length < MAX_PLAN_ROUTES ? normalizeRoute({ id, name, kind, coordinates, notes }) : null
    if (route) plan.routes.push(route)
    return route != null
  }

  const addArea = (id: unknown, name: unknown, kind: AreaKind, rings: unknown, notes: unknown): boolean => {
    const area = plan.areas.length < MAX_PLAN_AREAS ? normalizeArea({ id, name, kind, rings, notes }) : null
    if (area) plan.areas.push(area)
    return area != null
  }

  for (const feature of record.features) {
    const featureRecord = asRecord(feature)
    const geometry = asRecord(featureRecord?.geometry)
    const properties = asRecord(featureRecord?.properties) ?? {}
    const planningClass = typeof properties.planningClass === 'string' ? properties.planningClass : ''
    const { name } = properties
    const notes = properties.notes ?? properties.description
    // Kinds already in the plan vocabulary (our own GeoJSON exports) win over
    // the bcdatamapper KML classes.
    const kind = properties.kind
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : []
    const sourceId =
      typeof featureRecord?.id === 'string' || typeof featureRecord?.id === 'number'
        ? String(featureRecord.id)
        : undefined

    if (SKIPPED_KML_CLASSES.has(planningClass)) {
      skippedCount += 1
      continue
    }

    let imported = false
    switch (geometry?.type) {
      case 'Point': {
        if (plan.waypoints.length < MAX_PLAN_WAYPOINTS) {
          const waypoint = normalizeWaypoint({
            id: sourceId,
            name,
            kind: WAYPOINT_KINDS.includes(kind as WaypointKind) ? kind : (KML_CLASS_TO_KIND[planningClass] ?? 'note'),
            lng: coordinates[0],
            lat: coordinates[1],
            notes,
          })
          if (waypoint) {
            plan.waypoints.push(waypoint)
            imported = true
          }
        }
        break
      }
      case 'LineString':
      case 'MultiLineString': {
        const routeKind = ROUTE_KINDS.includes(kind as RouteKind)
          ? (kind as RouteKind)
          : (KML_CLASS_TO_ROUTE_KIND[planningClass] ?? 'route')
        const lines = geometry.type === 'LineString' ? [coordinates] : coordinates
        for (const [index, line] of lines.entries()) {
          const partName = lines.length > 1 && typeof name === 'string' && name ? `${name} (${index + 1})` : name
          const partId = sourceId && lines.length > 1 ? `${sourceId}-${index + 1}` : sourceId
          imported = addRoute(partId, partName, routeKind, line, notes) || imported
        }
        break
      }
      case 'Polygon':
      case 'MultiPolygon': {
        const areaKind = AREA_KINDS.includes(kind as AreaKind)
          ? (kind as AreaKind)
          : (KML_CLASS_TO_AREA_KIND[planningClass] ?? 'area')
        const polygons = geometry.type === 'Polygon' ? [coordinates] : coordinates
        for (const [index, rings] of polygons.entries()) {
          const partName = polygons.length > 1 && typeof name === 'string' && name ? `${name} (${index + 1})` : name
          const partId = sourceId && polygons.length > 1 ? `${sourceId}-${index + 1}` : sourceId
          imported = addArea(partId, partName, areaKind, rings, notes) || imported
        }
        break
      }
    }
    if (!imported) skippedCount += 1
  }

  const featureCount = plan.waypoints.length + plan.routes.length + plan.areas.length
  return featureCount > 0 ? { plan, source: 'geojson', skippedCount } : null
}

/** Parse an imported file: a plan JSON document or a plan-like GeoJSON. */
export function parseOutdoorsPlanFile(text: string): PlanImportResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const plan = normalizeOutdoorsPlan(parsed)
  if (plan) return { plan, source: 'plan', skippedCount: 0 }
  return planFromGeoJson(parsed)
}
