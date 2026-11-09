/**
 * Map notes: sketches, pins, lines and areas drawn on the plan. They are kept in their own project
 * collection and no calculation reads them. No DOM or network access.
 */
import type { Coordinate } from './types'

export type MapNoteKind = 'sketch' | 'pin' | 'line' | 'area'

export interface MapNote {
  id: string
  kind: MapNoteKind
  /** A pin has one point, a sketch or line two or more, an area three or more (an open ring). */
  points: Coordinate[]
  text: string
  color: string
  /** A line only: ends in an arrowhead. */
  arrow?: boolean
  createdAt: string
}

export const MAP_NOTE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0f172a'] as const
export const MAX_MAP_NOTES = 300
export const MAX_NOTE_POINTS = 2000
export const MAX_TOTAL_NOTE_POINTS = 20000
export const MAX_NOTE_TEXT = 1000
const MIN_POINTS: Record<MapNoteKind, number> = { pin: 1, sketch: 2, line: 2, area: 3 }
const KINDS = Object.keys(MIN_POINTS) as MapNoteKind[]

const RAD = Math.PI / 180,
  EARTH_M = 6371008.8

function fail(message: string): never {
  throw Error(message)
}

function coordinate(value: unknown, label: string): Coordinate {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !value.slice(0, 2).every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[1]) > 90
  )
    fail(`${label} must be a longitude/latitude pair.`)
  return [value[0], value[1]]
}

/** Validates notes read from a project file; anything malformed is rejected, never repaired. */
export function parseMapNotes(raw: unknown): MapNote[] {
  if (!Array.isArray(raw)) fail('Map notes must be a list.')
  if (raw.length > MAX_MAP_NOTES) fail(`A project holds at most ${MAX_MAP_NOTES} map notes.`)
  const ids = new Set<string>()
  let total = 0
  const notes = raw.map((entry, index): MapNote => {
    const label = `Map note ${index + 1}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${label} must be an object.`)
    const r = entry as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || r.id.length > 100) fail(`${label} needs an ID.`)
    if (ids.has(r.id)) fail(`Map note IDs must be unique: ${r.id}.`)
    ids.add(r.id)
    if (!KINDS.includes(r.kind as MapNoteKind)) fail(`${label} has an unknown kind.`)
    const kind = r.kind as MapNoteKind
    if (!Array.isArray(r.points)) fail(`${label} needs points.`)
    if (r.points.length < MIN_POINTS[kind] || r.points.length > (kind === 'pin' ? 1 : MAX_NOTE_POINTS))
      fail(`${label} has the wrong number of points for a ${kind}.`)
    const points = r.points.map((p) => coordinate(p, `${label} point`))
    total += points.length
    if (typeof r.text !== 'string' || r.text.length > MAX_NOTE_TEXT)
      fail(`${label} text must be at most ${MAX_NOTE_TEXT} characters.`)
    if (typeof r.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(r.color)) fail(`${label} needs a #rrggbb colour.`)
    if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) fail(`${label} needs a date.`)
    return {
      id: r.id,
      kind,
      points,
      text: r.text,
      color: r.color.toLowerCase(),
      ...(kind === 'line' && r.arrow === true ? { arrow: true } : {}),
      createdAt: r.createdAt,
    }
  })
  if (total > MAX_TOTAL_NOTE_POINTS) fail(`Map notes hold at most ${MAX_TOTAL_NOTE_POINTS} points in total.`)
  return notes
}

/** Metres east and north of `origin`; accurate over the few kilometres a note spans. */
function local(origin: Coordinate) {
  const kx = Math.cos(origin[1] * RAD) * RAD * EARTH_M,
    ky = RAD * EARTH_M
  return {
    to: (p: Coordinate): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    from: ([x, y]: [number, number]): Coordinate => [origin[0] + x / kx, origin[1] + y / ky],
  }
}

export function pathLengthM(points: Coordinate[]): number {
  if (points.length < 2) return 0
  const { to } = local(points[0])
  let length = 0
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = to(points[i - 1]),
      [bx, by] = to(points[i])
    length += Math.hypot(bx - ax, by - ay)
  }
  return length
}

/** Area of an open or closed ring on the sphere, in square metres (the method Turf's `area` uses). */
export function ringAreaM2(ring: Coordinate[]): number {
  const points =
    ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  if (points.length < 3) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      c = points[(i + 2) % points.length]
    total += (c[0] - a[0]) * RAD * Math.sin(b[1] * RAD)
  }
  return Math.abs((total * EARTH_M * EARTH_M) / 2)
}

/** Polygon area: the outer ring less its holes, in square metres. */
export function polygonAreaM2(polygon: GeoJSON.Polygon): number {
  const [outer, ...holes] = polygon.coordinates as Coordinate[][]
  return Math.max(0, ringAreaM2(outer ?? []) - holes.reduce((sum, hole) => sum + ringAreaM2(hole), 0))
}

/**
 * Thins a freehand stroke to the points that change its shape (Ramer–Douglas–Peucker in local
 * metres), so a drawn line keeps its look without storing every pointer event.
 */
export function simplifyPath(points: Coordinate[], toleranceM: number): Coordinate[] {
  if (points.length < 3) return points
  const { to } = local(points[0])
  const xy = points.map(to)
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    const [ax, ay] = xy[start],
      [bx, by] = xy[end]
    const dx = bx - ax,
      dy = by - ay,
      span = Math.hypot(dx, dy)
    let worst = -1,
      worstDistance = 0
    for (let i = start + 1; i < end; i++) {
      const [px, py] = xy[i]
      const d = span ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / span : Math.hypot(px - ax, py - ay)
      if (d > worstDistance) {
        worst = i
        worstDistance = d
      }
    }
    if (worst > 0 && worstDistance > toleranceM) {
      keep[worst] = 1
      stack.push([start, worst], [worst, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** The two barbs of an arrowhead at a line's end, sized to the line: about an eighth of it, 4–60 m. */
export function arrowHead(points: Coordinate[]): Coordinate[] | null {
  if (points.length < 2) return null
  const tip = points.at(-1)!
  const { to, from } = local(tip)
  const before = [...points.slice(0, -1)].reverse().find((p) => Math.hypot(...to(p)) > 0.01)
  if (!before) return null
  const [bx, by] = to(before)
  const back = Math.hypot(bx, by)
  const size = Math.min(60, Math.max(4, pathLengthM(points) / 8))
  const ux = bx / back,
    uy = by / back
  const spread = Math.tan((28 * Math.PI) / 180)
  const barb = (side: 1 | -1) => from([size * (ux - side * spread * uy), size * (uy + side * spread * ux)])
  return [barb(1), tip, barb(-1)]
}

/** Where a note's label sits: a pin's point, a line's end, an area's vertex centroid. */
export function noteAnchor(note: MapNote): Coordinate {
  if (note.kind === 'area') {
    const sum = note.points.reduce<[number, number]>((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0])
    return [sum[0] / note.points.length, sum[1] / note.points.length]
  }
  return note.points.at(-1)!
}

/** One-line measure for a note: an area's hectares, a line's length, nothing for a pin. */
export function noteMeasure(note: MapNote): string {
  if (note.kind === 'area') {
    const m2 = ringAreaM2(note.points)
    return m2 >= 1000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`
  }
  if (note.kind === 'pin') return ''
  const m = pathLengthM(note.points)
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

/** Notes as GeoJSON for the plan and for export. Arrowheads are separate `arrow` features. */
export function mapNotesGeoJson(notes: MapNote[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const note of notes) {
    const properties = {
      id: note.id,
      kind: note.kind,
      text: note.text,
      color: note.color,
      createdAt: note.createdAt,
      ...(note.arrow ? { arrow: true } : {}),
    }
    const geometry: GeoJSON.Geometry =
      note.kind === 'pin'
        ? { type: 'Point', coordinates: note.points[0] }
        : note.kind === 'area'
          ? { type: 'Polygon', coordinates: [[...note.points, note.points[0]]] }
          : { type: 'LineString', coordinates: note.points }
    features.push({ type: 'Feature', id: note.id, properties, geometry })
    const head = note.kind === 'line' && note.arrow ? arrowHead(note.points) : null
    if (head)
      features.push({
        type: 'Feature',
        properties: { id: note.id, kind: 'arrow', color: note.color },
        geometry: { type: 'LineString', coordinates: head },
      })
  }
  return { type: 'FeatureCollection', features }
}
