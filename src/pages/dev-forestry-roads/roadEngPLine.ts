/**
 * A RoadEng design's P-line: the survey traverse its `[design] roadname` names (`Traverse.tr1`),
 * read when the `.tr1` is opened with the design (`softreeNativeTraverse.ts` reads the file).
 *
 * - **What it gives.** RoadEng Location takes ground layers from the P-line where a range's ground
 *   is `**` (Softree help, *Sub Horizons Assignments*): "**" means the P-line survey's layers when
 *   the design has a P-line, and OB when it has none; a range that names its own layers overrides
 *   the P-line there. So a design with no `roadname` keeps the OB rule (`roadEngMaterialsFor`), a
 *   design whose P-line was read takes the survey's layers along it ({@link pLineStrataPieces}), and
 *   a design whose named P-line was not given leaves that ground unclassified and says so: it is
 *   never read as OB.
 * - **Survey layers.** Each surveyed station holds up to three ground types, the first two with the
 *   depth of their bottom below the surface. A station with no type inherits the station before it,
 *   and a first station with none (or `**`) is OB, as in Survey/Map (help, *Ground Type column*).
 * - **Between or Ahead** (help, *Alignment Setup*): survey properties apply to the cross sections
 *   nearest each surveyed station (Between), or from each station up to the next (Ahead). Which one
 *   a design uses is read from `[design] GndRange` (0 Between, 1 Ahead). This is inferred: the key
 *   is the design's only two-valued setting beside the P-line keys that no help page names, and the
 *   samples hold one design with a P-line (GuardRail, GndRange=0); no sample shows Ahead.
 * - **Where a station falls on the road.** A design's calculated stations (`110`) carry the P-line
 *   station of each design station in field 6 (-1 in every design without a P-line; equal to the
 *   design station in GuardRail, whose L-line is its P-line). Those pairs are kept
 *   ({@link roadEngPStations}); a design whose stations carry none takes them by projecting its
 *   stations onto the P-line's coordinates.
 * - **Units.** The `.tr1` states its unit (`116`) or takes the design's.
 * - **Kept for writing back.** The `.tr1` and `.tr2` as read, Latin-1 text
 *   ({@link RoadEngPLineSource}), go back beside the design in a RoadEng project export unchanged,
 *   and a changed Between/Ahead choice writes `GndRange` (`roadEngPLineDsnOverrides`).
 *
 * Pure: no DOM or network access. The `.tr1` itself is read by `parseNativeTraverse`
 * (`softreeNativeTraverse.ts`), which callers pass in.
 */
// Types only: `project.ts` checks a kept P-line through this module, and the traverse readers stay
// out of the page's first load.
import type { NativeTraverse } from './softreeNativeTraverse'

/** How survey properties apply along the road: to the nearest surveyed station, or ahead to the next. */
export type PLineApply = 'between' | 'ahead'
/** Ids of horizons made from a P-line's ground layers start with this. */
export const ROADENG_PLINE_STRATUM_PREFIX = 'roadeng-pline-'
export const isPLineStratum = (s: { id: string }) => s.id.startsWith(ROADENG_PLINE_STRATUM_PREFIX)
/** Characters a kept P-line (both files) may take in a project. */
export const MAX_PLINE_SOURCE_CHARS = 2_000_000
/** Station pairs a kept P-line holds at most. */
export const MAX_PLINE_STATION_PAIRS = 20_000
/** A station pair dropped when the pairs either side give its P-line station within this, m. */
const PAIR_TOLERANCE_M = 1e-3

/** The P-line a design names, and how it applies its survey. */
export interface RoadEngPLineReference {
  /** The file `[design] roadname` names. */
  name: string
  /** `[design] GndRange` as read: 0 Between, 1 Ahead; Between when absent. */
  apply: PLineApply
  /** The key's text as read, null when absent. */
  gndRange: string | null
}

const designKeys = (dsnText: string): Map<string, string> => {
  const out = new Map<string, string>()
  let inDesign = false
  for (const line of dsnText.split(/\r\n|\r|\n/)) {
    const section = /^\[([^\]]*)\]\s*$/.exec(line)
    if (section) {
      inDesign = section[1] === 'design'
      continue
    }
    if (!inDesign) continue
    const eq = line.indexOf('=')
    if (eq > 0 && !out.has(line.slice(0, eq))) out.set(line.slice(0, eq), line.slice(eq + 1))
  }
  return out
}

/** The P-line a design's `.dsn` names; null when it names none. */
export function roadEngPLineReference(dsnText: string): RoadEngPLineReference | null {
  const keys = designKeys(dsnText)
  const name = keys.get('roadname')?.trim()
  if (!name) return null
  const gnd = keys.get('GndRange')
  return {
    name: name.split(/[\\/]/).pop()!.slice(0, 200),
    apply: gnd?.trim() === '1' ? 'ahead' : 'between',
    gndRange: gnd ?? null,
  }
}

/** A P-line kept with a road read from RoadEng (`RoadEngSource.pLine`). Plain JSON. */
export interface RoadEngPLineSource {
  /** The file the design names. */
  name: string
  /** The `.tr1` as read, Latin-1 text with its line endings; null when it was not given with the design. */
  tr1: string | null
  /** The `.tr2` kept beside it, as read; null when not given. */
  tr2: { name: string; text: string } | null
  /** Design station → P-line station, m, from the design's calculated stations (thinned where linear). */
  stations: Array<[number, number]>
  /** Between or Ahead as chosen in PGMaps; absent while it is the design's own. */
  apply?: PLineApply
}

/** The size a kept P-line takes in a project file, characters. */
export const roadEngPLineChars = (p: RoadEngPLineSource) =>
  p.name.length + (p.tr1?.length ?? 0) + (p.tr2 ? p.tr2.name.length + p.tr2.text.length : 0) + p.stations.length * 24

/** A stored {@link RoadEngPLineSource} checked for shape and size; null when it is not one. */
export function parseRoadEngPLineSource(value: unknown): RoadEngPLineSource | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const tr2 = v.tr2 as Record<string, unknown> | null | undefined
  if (
    typeof v.name !== 'string' ||
    !v.name.trim() ||
    v.name.length > 200 ||
    (v.tr1 !== null && (typeof v.tr1 !== 'string' || !/^\uFEFF?100,100,/.test(v.tr1))) ||
    (tr2 !== null && (!tr2 || typeof tr2.name !== 'string' || typeof tr2.text !== 'string' || tr2.name.length > 200)) ||
    !Array.isArray(v.stations) ||
    v.stations.length > MAX_PLINE_STATION_PAIRS ||
    !v.stations.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)),
    ) ||
    (v.apply !== undefined && v.apply !== 'between' && v.apply !== 'ahead')
  )
    return null
  const source: RoadEngPLineSource = {
    name: v.name,
    tr1: v.tr1 as string | null,
    tr2: tr2 ? { name: tr2.name as string, text: tr2.text as string } : null,
    stations: (v.stations as number[][]).map(([l, p]) => [l, p] as [number, number]),
    ...(v.apply !== undefined ? { apply: v.apply as PLineApply } : {}),
  }
  return roadEngPLineChars(source) <= MAX_PLINE_SOURCE_CHARS ? source : null
}

/** How a kept P-line applies its survey: the choice made here, else the design's. */
export const pLineApplyOf = (source: RoadEngPLineSource, dsnText: string): PLineApply =>
  source.apply ?? roadEngPLineReference(dsnText)?.apply ?? 'between'

/** The P-line read from a kept source with `parse` (`parseNativeTraverse`), and its unit; null when the `.tr1` was not kept. */
export function keptPLine(
  source: RoadEngPLineSource,
  designUnitM: number,
  parse: (text: string) => NativeTraverse,
): { traverse: NativeTraverse; unitM: number } | null {
  if (!source.tr1) return null
  const traverse = parse(source.tr1)
  return { traverse, unitM: traverse.unitM ?? designUnitM }
}

// ---- Station pairs --------------------------------------------------------------------------------

/** Pairs thinned where the ones either side give the P-line station within {@link PAIR_TOLERANCE_M}. */
function thinPairs(pairs: Array<[number, number]>): Array<[number, number]> {
  if (pairs.length <= 2) return pairs
  const out: Array<[number, number]> = [pairs[0]]
  let anchor = 0
  for (let k = 2; k < pairs.length; k++) {
    const [l0, p0] = pairs[anchor],
      [l1, p1] = pairs[k]
    let fits = l1 > l0
    for (let j = anchor + 1; fits && j < k; j++) {
      const [l, p] = pairs[j]
      fits = Math.abs(p0 + ((p1 - p0) * (l - l0)) / (l1 - l0) - p) <= PAIR_TOLERANCE_M
    }
    if (!fits) {
      out.push(pairs[k - 1])
      anchor = k - 1
    }
  }
  out.push(pairs[pairs.length - 1])
  return out.length > MAX_PLINE_STATION_PAIRS
    ? out.filter((_, i) => i % Math.ceil(out.length / MAX_PLINE_STATION_PAIRS) === 0)
    : out
}

/**
 * Design station → P-line station (m) for each of a design's calculated stations: field 6 of its
 * `110` records, or, where those hold none, the station's projection onto the P-line's coordinates.
 * Empty when neither gives any.
 */
export function roadEngPStations(
  ds2Text: string,
  designUnitM: number,
  pLine: { traverse: NativeTraverse; unitM: number } | null,
): { pairs: Array<[number, number]>; from: 'design' | 'projection' | null } {
  const rows: Array<{ l: number; p: number; x: number; y: number }> = []
  for (const line of ds2Text.split(/\r\n|\r|\n/)) {
    if (!line.startsWith('110,')) continue
    const f = line.split(',')
    const l = Number(f[5]),
      p = f[6]?.trim() ? Number(f[6]) : NaN,
      x = Number(f[2]),
      y = Number(f[3])
    if (Number.isFinite(l))
      rows.push({ l: l * designUnitM, p: p * designUnitM, x: x * designUnitM, y: y * designUnitM })
  }
  rows.sort((a, b) => a.l - b.l)
  const given = rows.filter((r) => Number.isFinite(r.p) && r.p >= 0)
  if (given.length >= 2 && given.length === rows.length)
    return { pairs: thinPairs(given.map((r) => [r.l, r.p])), from: 'design' }
  if (!pLine || pLine.traverse.stations.length < 2) return { pairs: [], from: null }
  const u = pLine.unitM
  const pts = pLine.traverse.stations.map((s) => ({ x: s.x * u, y: s.y * u, st: s.station * u }))
  const pairs: Array<[number, number]> = rows.map((r) => {
    let best = Infinity,
      at = pts[0].st
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k],
        b = pts[k + 1]
      const dx = b.x - a.x,
        dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((r.x - a.x) * dx + (r.y - a.y) * dy) / len2)) : 0
      const d = Math.hypot(a.x + t * dx - r.x, a.y + t * dy - r.y)
      if (d < best) {
        best = d
        at = a.st + t * (b.st - a.st)
      }
    }
    return [r.l, at]
  })
  return { pairs: pairs.length >= 2 ? thinPairs(pairs) : [], from: pairs.length >= 2 ? 'projection' : null }
}

// ---- Survey ground layers -------------------------------------------------------------------------

export interface PLineLayer {
  code: string
  topDepthM: number
  bottomDepthM: number | null
}
export interface PLineGroundStation {
  /** P-line station, m. */
  station: number
  layers: PLineLayer[]
  /** Whether the station gives its own layers (else it inherits the one before). */
  given: boolean
}

/**
 * Each surveyed station's ground layers, m: a station without a type takes the one before it, the
 * first without one is `defaultCode` (RoadEng's OB), and `**` is `defaultCode`.
 */
export function pLineGroundStations(
  traverse: NativeTraverse,
  unitM: number,
  defaultCode: string,
): PLineGroundStation[] {
  const out: PLineGroundStation[] = []
  let last: PLineLayer[] = [{ code: defaultCode, topDepthM: 0, bottomDepthM: null }]
  const code = (t: string) => (t === '**' ? defaultCode : t)
  for (const s of [...traverse.stations].sort((a, b) => a.station - b.station)) {
    const [g1, g2, g3] = s.ground
    if (!g1?.type) {
      out.push({ station: s.station * unitM, layers: last, given: false })
      continue
    }
    const d1 = g1.depth !== null && g1.depth > 0 ? g1.depth * unitM : null
    const d2 = g2?.depth !== null && g2?.depth !== undefined && g2.depth * unitM > (d1 ?? 0) ? g2.depth * unitM : null
    const t2 = d1 !== null && g2?.type ? g2.type : null
    const t3 = t2 && d2 !== null && g3?.type ? g3.type : null
    const layers: PLineLayer[] = [{ code: code(g1.type), topDepthM: 0, bottomDepthM: t2 ? d1 : null }]
    if (t2) layers.push({ code: code(t2), topDepthM: d1!, bottomDepthM: t3 ? d2 : null })
    if (t3) layers.push({ code: code(t3), topDepthM: d2!, bottomDepthM: null })
    out.push({ station: s.station * unitM, layers, given: true })
    last = layers
  }
  return out
}

const sameLayers = (a: readonly PLineLayer[], b: readonly PLineLayer[]) =>
  a.length === b.length &&
  a.every((x, i) => x.code === b[i].code && x.topDepthM === b[i].topDepthM && x.bottomDepthM === b[i].bottomDepthM)

/** The design station where the pairs reach a P-line station (first crossing), m; ends extend. */
function designStationAt(pairs: ReadonlyArray<[number, number]>, p: number): number {
  for (let k = 0; k + 1 < pairs.length; k++) {
    const [l0, p0] = pairs[k],
      [l1, p1] = pairs[k + 1]
    if ((p >= p0 && p <= p1) || (p <= p0 && p >= p1)) return p1 === p0 ? l0 : l0 + ((p - p0) * (l1 - l0)) / (p1 - p0)
  }
  const first = pairs[0],
    last = pairs[pairs.length - 1]
  const rising = last[1] >= first[1]
  return (rising ? p < first[1] : p > first[1]) ? -Infinity : Infinity
}

export interface PLineGround {
  stations: readonly PLineGroundStation[]
  /** Design station → P-line station, m. */
  pairs: ReadonlyArray<[number, number]>
  apply: PLineApply
}

/**
 * The P-line's ground layers over a stretch of road chainage `[start, end]`: one piece per run of
 * stations with the same layers, Between (to the cross sections nearest each station) or Ahead
 * (from each station to the next).
 */
export function pLineStrataPieces(
  ground: PLineGround,
  stretch: { start: number; end: number },
  frame: { startStation: number; stationScale?: number },
): Array<{ start: number; end: number; layers: PLineLayer[] }> {
  const { stations, pairs } = ground
  if (!stations.length || pairs.length < 2) return []
  const scale = frame.stationScale ?? 1
  // Each station's reach along the P-line, then along the road.
  const reach = stations.map((s, i) => {
    const next = stations[i + 1]
    const prev = stations[i - 1]
    const from = !prev ? -Infinity : ground.apply === 'between' ? (prev.station + s.station) / 2 : s.station
    const to = !next ? Infinity : ground.apply === 'between' ? (s.station + next.station) / 2 : next.station
    return { from, to, layers: s.layers }
  })
  const chain = (p: number) =>
    p === -Infinity || p === Infinity ? p : (designStationAt(pairs, p) - frame.startStation) * scale
  const out: Array<{ start: number; end: number; layers: PLineLayer[] }> = []
  for (const r of reach) {
    let a = chain(r.from),
      b = chain(r.to)
    if (a > b) [a, b] = [b, a]
    const start = Math.max(stretch.start, a),
      end = Math.min(stretch.end, b)
    if (!(end > start + 1e-6)) continue
    out.push({ start, end, layers: r.layers })
  }
  out.sort((x, y) => x.start - y.start)
  const joined: typeof out = []
  for (const piece of out) {
    const last = joined[joined.length - 1]
    if (last && sameLayers(last.layers, piece.layers) && Math.abs(last.end - piece.start) < 1e-6) last.end = piece.end
    else joined.push({ ...piece })
  }
  return joined
}

// ---- Writing back ---------------------------------------------------------------------------------

/** `.dsn` keys a road's P-line writes: `GndRange` only where the choice was changed here. */
export function roadEngPLineDsnOverrides(
  source: RoadEngPLineSource | undefined,
  dsnText: string | undefined,
): Record<string, Record<string, string | null>> {
  if (!source?.apply || dsnText === undefined) return {}
  const read = roadEngPLineReference(dsnText)
  if (!read || read.apply === source.apply) return {}
  return { design: { GndRange: source.apply === 'ahead' ? '1' : '0' } }
}

/** The files a kept P-line goes back as, by name, Latin-1 bytes as read. */
export function roadEngPLineFiles(source: RoadEngPLineSource | undefined): Record<string, Uint8Array> {
  if (!source?.tr1) return {}
  const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff)
  return {
    [source.name]: bytes(source.tr1),
    ...(source.tr2 ? { [source.tr2.name]: bytes(source.tr2.text) } : {}),
  }
}

// ---- Summary --------------------------------------------------------------------------------------

/** What a kept `.tr1` holds, for the panel: read from its station records alone. */
export function pLineSummary(
  tr1: string,
  designUnitM: number,
): {
  stations: number
  firstM: number | null
  lastM: number | null
  /** The file's own unit, m; null when it states none (the design's is used). */
  fileUnitM: number | null
  /** Each distinct ground-layer entry as written (`OB 0.5 FR`, blank for none), with its station count. */
  layers: Array<{ text: string; count: number }>
} {
  let fileUnitM: number | null = null
  const stations: number[] = []
  const layers = new Map<string, number>()
  for (const line of tr1.split(/\r\n|\r|\n/)) {
    const f = line.split(',')
    if (f[0] === '116' && Number(f[1]) > 0) fileUnitM = Number(f[1]) / 10_000
    if (f[0] !== '101') continue
    const station = Number(f[2])
    if (Number.isFinite(station)) stations.push(station)
    const text = f
      .slice(15, 20)
      .map((x) => (x ?? '').trim())
      .filter(Boolean)
      .join(' ')
    layers.set(text, (layers.get(text) ?? 0) + 1)
  }
  const unit = fileUnitM ?? designUnitM
  return {
    stations: stations.length,
    firstM: stations.length ? Math.min(...stations) * unit : null,
    lastM: stations.length ? Math.max(...stations) * unit : null,
    fileUnitM,
    layers: [...layers].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
  }
}
