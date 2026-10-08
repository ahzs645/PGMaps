import { assetBase, CITIES, type CityConfig, type CityId } from './cities'
import { Bundle, Geometry, Graph, Grid, loadBundle, type Route, type RouteStats, type TravelMode } from './engine.js'
import { Index } from './search.js'

export const MILE = 1609.344
export const ASSET_BASE = assetBase('sf')
export type Place = { lon: number; lat: number; label: string }
export type Point = Place & { node: number }
export type Units = 'mi' | 'km'
export type Trip = { from: Place | null; to: Place | null; mode: TravelMode; calm: boolean; loop: boolean; outBack: boolean; loopMi: number; t: number; loopIndex: number }
export type RouteMember = { arcs: number[]; coordinates: [number, number][]; stats: RouteStats; kind?: string }
export type Family = { members: RouteMember[]; partial: boolean; loop: boolean; tried?: number; shortfall?: boolean }
export type Model = { city: CityConfig; graph: Graph; geometry: Geometry; grid: Grid; index: Index; streets: GeoJSON.FeatureCollection<GeoJSON.LineString> }

const models = new Map<CityId, Promise<Model>>()
export function loadModel(buildStreets = true, city: CityId = 'sf'): Promise<Model> {
  let modelPromise = models.get(city)
  if (!modelPromise) {
    const config = CITIES[city], DATA = config.data
    modelPromise = (async (): Promise<Model> => {
      const bytes = await loadBundle({ bundle_url: assetBase(city) + DATA.bundle_url.split('/').pop(), bundle_bytes: DATA.bundle_bytes })
      const bundle = new Bundle(bytes, DATA.manifest)
      const graph = new Graph(bundle, DATA.meta)
      const geometry = new Geometry(bundle, DATA.meta)
      const lon = new Float32Array(graph.n), lat = new Float32Array(graph.n)
      for (let n = 0; n < graph.n; n++) { lon[n] = graph.nodeLon(n); lat[n] = graph.nodeLat(n) }
      const grid = new Grid(lon, lat, 0.004)
      const index = new Index(graph, geometry, bundle, DATA)
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
      for (let edge = 0; buildStreets && edge < geometry.nEdges; edge++) {
        const points = geometry.edgeCoords(edge), coordinates: [number, number][] = []
        for (let k = 0; k < points.length; k += 2) coordinates.push([points[k], points[k + 1]])
        if (coordinates.length > 1) features.push({ type: 'Feature', properties: { id: edge, name: geometry.name[edge] ? geometry.names[geometry.name[edge] - 1] : '' }, geometry: { type: 'LineString', coordinates } })
      }
      return { city: config, graph, geometry, grid, index, streets: { type: 'FeatureCollection', features } }
    })().catch((error: unknown) => { models.delete(city); throw error })
    models.set(city, modelPromise)
  }
  return modelPromise
}

export function snapPoint(model: Model, place: Place, mode: TravelMode): Point {
  const bit = model.graph.modeBit(mode)
  const node = model.grid.nearest(place.lon, place.lat, (n) => (model.graph.nodeFlags[n] & bit) !== 0)
  if (node < 0) throw new Error('No routable street corner was found here.')
  return { node, lon: model.graph.nodeLon(node), lat: model.graph.nodeLat(node), label: place.label || `near ${model.index.describe(node, model.grid)}` }
}

export function makeMember(model: Model, route: Pick<Route, 'arcs' | 'kind'>): RouteMember {
  return { arcs: route.arcs, coordinates: model.graph.geometry(route.arcs, model.geometry).map(([lat, lon]) => [lon, lat]), stats: model.graph.summarise(route.arcs), kind: route.kind }
}

// Preserve the original frontier thinning: keep both ends and spread the
// remaining members along normalized distance/climbing space.
function thinFrontier(members: RouteMember[], limit = 30): RouteMember[] {
  if (members.length <= limit) return members
  const d = members.map((m) => m.stats.distance_m), c = members.map((m) => m.stats.elev_gain_m)
  const dr = Math.max(1e-9, d[d.length - 1] - d[0]), cr = Math.max(1e-9, c[0] - c[c.length - 1])
  const cumulative = [0]
  for (let i = 1; i < members.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot((d[i] - d[i - 1]) / dr, (c[i] - c[i - 1]) / cr))
  const selected = new Set<number>()
  for (let k = 0; k < limit; k++) {
    const target = cumulative[cumulative.length - 1] * k / (limit - 1)
    let best = -1, error = Infinity
    for (let i = 0; i < members.length; i++) {
      const delta = Math.abs(cumulative[i] - target)
      if (!selected.has(i) && delta < error) { best = i; error = delta }
    }
    selected.add(best)
  }
  return [...selected].map((i) => members[i]).sort((a, b) => a.stats.distance_m - b.stats.distance_m)
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Route search cancelled.', 'AbortError')
}
async function finishSearch(search: { step(ms: number): boolean }, signal: AbortSignal) {
  for (;;) {
    checkAbort(signal)
    if (search.step(20)) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

export async function findFamily(model: Model, trip: Trip, signal: AbortSignal, onPartial?: (family: Family) => void, preview = false): Promise<Family> {
  checkAbort(signal)
  if (!trip.from || (!trip.loop && !trip.to)) throw new Error(trip.from ? 'Choose a destination or click the map.' : 'Choose a starting place or click the map.')
  const from = snapPoint(model, trip.from, trip.mode), g = model.graph
  const stress = trip.mode === 'bike' && trip.calm
  if (trip.loop) {
    const search = g.loops(from.node, trip.mode, { targetM: trip.loopMi * MILE, stress, outBack: trip.outBack, ...(preview ? { sectors: 6 } : {}) })
    let last: Route | undefined
    for (;;) {
      checkAbort(signal)
      const done = search.step(8)
      if (preview && search.last && search.last !== last) {
        last = search.last
        onPartial?.({ members: [makeMember(model, last)], partial: true, loop: true, tried: search.tried })
      }
      checkAbort(signal)
      if (preview && search.accepted.length) return { members: [makeMember(model, search.accepted[0])], partial: true, loop: true, tried: search.tried }
      if (done) break
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    if (!search.loops.length) throw new Error('No loop was found. Try another starting place or length.')
    return { members: search.loops.map((route) => makeMember(model, route)), loop: true, partial: false, tried: search.tried, shortfall: search.shortfall }
  }
  const to = snapPoint(model, trip.to!, trip.mode)
  if (from.node === to.node) throw new Error('Those places are on the same street corner.')
  const weights = (alpha: number) => ({ alpha, beta: 0, gamma: 0, penalties: [0, 0, 0, 0, 0], extreme: 0, use_class_multiplier: false, stress })
  const shortest = g.route(from.node, to.node, trip.mode, weights(0))
  if (!shortest) throw new Error(trip.mode === 'bike' ? 'No bikeable route connects these places.' : 'No route connects these places.')
  const first = makeMember(model, shortest)
  const flat = makeMember(model, g.route(from.node, to.node, trip.mode, weights(200)) || shortest)
  const same = flat.arcs.length === first.arcs.length && flat.arcs.every((arc, i) => arc === first.arcs[i])
  const partial = { members: same ? [first] : [first, flat], partial: true, loop: false }
  onPartial?.(partial)
  checkAbort(signal)
  if (preview) return partial
  const lengthKey = stress ? 'stress_m' : 'distance_m'
  const search = g.pareto(from.node, to.node, trip.mode, { eps: 50, epsNode: 10, stress, dCap: Math.round(flat.stats[lengthKey] * g.DM) + 1, gCap: Math.round(first.stats.elev_gain_m * g.CM) + 1 })
  await finishSearch(search, signal)
  const members = search.solutions.length ? search.solutions.map((route) => makeMember(model, route)) : [first]
  members.sort((a, b) => a.stats[lengthKey] - b.stats[lengthKey])
  if (flat.stats.elev_gain_m < members[members.length - 1].stats.elev_gain_m - 1e-6) members.push(flat)
  return { members: thinFrontier(members), partial: false, loop: false }
}

export function defaultTrip(city: CityId = 'sf'): Trip {
  return { from: CITIES[city].data.default[0], to: CITIES[city].data.default[1], mode: 'walk', calm: true, loop: false, outBack: false, loopMi: 4, t: 1, loopIndex: 0 }
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const decodeLabel = (s: string) => s.replace(/_u([0-9a-f]{4})|_([0-9a-f]{2})/gi, (_, u: string, b: string) => String.fromCharCode(parseInt(u || b, 16)))
function encodeLabel(label: string) {
  return label.split('').map((char) => /[A-Za-z0-9.-]/.test(char) ? char : char.charCodeAt(0) < 256 ? '_' + char.charCodeAt(0).toString(16).padStart(2, '0') : '_u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('')
}
export function isCityCoordinate(lon: number, lat: number, city: CityId = 'sf') {
  const [west, south, east, north] = CITIES[city].bounds
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= west && lon <= east && lat >= south && lat <= north
}
export function readTrip(hash: string, city: CityId = 'sf'): Trip {
  const trip = defaultTrip(city), p = hash.replace(/^#/, '').split('~')
  if (!['t', 'l'].includes(p[0]) || !isCityCoordinate(+p[1], +p[2], city)) return trip
  const loop = p[0] === 'l', mode = p[loop ? 3 : 5] || 'w'
  if (!loop && (!isCityCoordinate(+p[3], +p[4], city) || !Number.isFinite(+p[6]))) return trip
  if (loop && (!Number.isFinite(+p[4]) || !Number.isFinite(+p[5]))) return trip
  return { ...trip, loop, mode: mode.startsWith('b') ? 'bike' : 'walk', calm: !mode.startsWith('bx'), outBack: mode.endsWith('o'),
    from: { lon: +p[1], lat: +p[2], label: decodeLabel(p[loop ? 6 : 7] || '') },
    to: loop ? trip.to : { lon: +p[3], lat: +p[4], label: decodeLabel(p[8] || '') },
    loopMi: loop ? clamp(+p[4], 1, 15) : 4, loopIndex: loop ? Math.max(0, Math.floor(+p[5])) : 0, t: loop ? 1 : clamp(+p[6], 0, 1) }
}
export function tripHash(trip: Trip): string | null {
  if (!trip.from || (!trip.loop && !trip.to)) return null
  const coords = (p: Place) => `${p.lon.toFixed(5)}~${p.lat.toFixed(5)}`
  const mode = trip.mode === 'bike' ? trip.calm ? 'b' : 'bx' : 'w'
  return trip.loop
    ? `#l~${coords(trip.from)}~${mode}${trip.outBack ? 'o' : ''}~${+trip.loopMi.toFixed(3)}~${trip.loopIndex}~${encodeLabel(trip.from.label)}`
    : `#t~${coords(trip.from)}~${coords(trip.to!)}~${mode}~${trip.t.toFixed(3)}~${encodeLabel(trip.from.label)}~${encodeLabel(trip.to!.label)}`
}
export function distanceText(meters: number, units: Units) { return `${(meters / (units === 'mi' ? MILE : 1000)).toFixed(1)} ${units}` }
export function climbText(meters: number, units: Units) { return `${Math.round(units === 'mi' ? meters * 3.28084 : meters).toLocaleString()} ${units === 'mi' ? 'ft' : 'm'}` }
export function routeStreets(model: Model, member: RouteMember): string[] {
  const names: string[] = []
  for (const arc of member.arcs) {
    const index = model.geometry.name[model.graph.arcEdge[arc]]
    const name = index ? model.geometry.names[index - 1] : 'Unnamed path'
    if (names[names.length - 1] !== name) names.push(name)
  }
  return names
}

export function routeGpx(member: RouteMember, name: string, creator = 'PGMaps Flatten SF'): string {
  const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
  const cumulative = [0], points = member.coordinates
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i][0] - points[i - 1][0]) * 111320 * Math.cos(points[i][1] * Math.PI / 180)
    const dy = (points[i][1] - points[i - 1][1]) * 110540
    cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy))
  }
  const profile = member.stats.profile, total = cumulative[cumulative.length - 1] || 1
  let cursor = 0
  const samples = points.map(([lon, lat], i) => {
    const d = cumulative[i] / total * member.stats.distance_m
    while (cursor < profile.d.length - 2 && profile.d[cursor + 1] < d) cursor++
    const span = profile.d[cursor + 1] - profile.d[cursor]
    const t = span > 0 ? (d - profile.d[cursor]) / span : 0
    const elevation = profile.z[cursor] + (profile.z[cursor + 1] - profile.z[cursor]) * t
    return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${elevation.toFixed(2)}</ele></trkpt>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="${xml(creator)}" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${xml(name)}</name><trkseg>${samples.join('')}</trkseg></trk></gpx>`
}
