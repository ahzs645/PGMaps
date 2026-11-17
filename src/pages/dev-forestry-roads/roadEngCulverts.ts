/**
 * RoadEng's culverts and a road's culverts, both ways.
 *
 * **Where RoadEng keeps culverts.** RoadEng places a culvert on the L-line by station (its Culvert
 * Editor) and fills it from the P-line traverse: *Culverts Re-Import* reads every culvert the
 * traverse holds between a From and a To P-line station, deletes the existing culverts within a
 * tolerance of each one read (or all of them, *Remove All*) and adds the culverts read. A
 * traverse's culvert is the `CREEK` field of the Softree ASCII and IPD formats and Polycorder's
 * culvert width (`softreeCulvert.ts`), kept with the survey field book read from the file
 * (`SoftreeStationExtras.culvert`). This module does the same between a field book and a road:
 *
 * - {@link culvertsFromTraverse} reads the book's culverts onto the road. Each sits at the road
 *   station square to its traverse station; its size is the pipe diameter (a box's height, its width
 *   kept); a downstream azimuth (flag 0) sets the skew against the road there, flags 1 and 3 (square,
 *   downstream right or left) and 5 (from side shots) cross square. A culvert keeps what PGMaps'
 *   model has no field for in `Culvert.roadEng`: book, station, P-station, box width, gradient,
 *   azimuth, flag, slope distance and the field as written.
 * - {@link traverseWithRoadCulverts} writes the road's culverts into the book, each at the traverse
 *   station nearest square to it within a tolerance, so the book's traverse export carries them to
 *   RoadEng's re-import. A culvert read from that book and station and not changed since goes back
 *   as it was written; the book's other culverts in the road's span are replaced, as the re-import's
 *   tolerance replaces RoadEng's.
 *
 * A culvert placed inside a RoadEng design (`.dsnx`, its `.ds1`) is read and written by
 * `roadEngPlacedCulverts.ts`. The design's default drain and stream culverts
 * (`[Culvert] DefDrainCulvert`/`DefStreamCulvert`) give a new culvert its diameter
 * ({@link roadEngNewCulvertDiameterM}).
 *
 * Checked by `roadEngCulverts.test.ts`. Pure: no DOM or network access (projections passed in).
 */
import { culvertFromMetres, culvertInMetres, type CulvertFormat, type SoftreeCulvert } from './softreeCulvert'
import type { SoftreeStationExtras, SoftreeTraverseDetails } from './softreeTraverse'
import { reduceTraverse, surveyFieldStation, type SurveyBookRecord } from './surveyInterchange'
import type { Culvert } from './engineeringTypes'
import type { Coordinate } from './types'

/** RoadEng's default for *Remove existing culverts tolerance*, m: a culvert read replaces those this close. */
export const ROADENG_CULVERT_REPLACE_M = 5
/** A road culvert is written to a traverse station at most this far along the road from it, m. */
export const ROADENG_CULVERT_MATCH_M = 10
/** A traverse station further than this from the road, m, places no culvert on it. */
export const ROADENG_CULVERT_MAX_OFFSET_M = 50
/** PGMaps' skew limit, degrees from square. */
const MAX_SKEW_DEG = 80

/** What a culvert read from a RoadEng (Softree) traverse held that PGMaps' culvert has no field for. */
export interface RoadEngCulvertRecord {
  /** The field book it was read from, and its station there (0 is the start). */
  bookId: string
  traverseStation: number
  /** P-line station, m (the book's field station). */
  pStationM: number
  /** Box width, m; absent for a pipe. */
  boxWidthM?: number
  /** Downstream gradient, %, as surveyed. */
  gradientPercent?: number
  /** Downstream azimuth, degrees from grid north. */
  azimuthDeg?: number
  /** 0 explicit, 1 square downstream right, 3 square downstream left, 5 from side shots. */
  flag?: number
  /** Slope distance the gradient was measured over, m. */
  sdM?: number
  /** The field as the file wrote it, written back while the culvert is unchanged. */
  raw?: string
}

/** One culvert a field book holds, located. */
export interface TraverseCulvert {
  station: number
  pStationM: number
  /** Grid coordinate of the traverse station in the book's CRS. */
  xy: [number, number]
  metres: ReturnType<typeof culvertInMetres>
  culvert: SoftreeCulvert
  label?: string
}

const bookFormat = (details: SoftreeTraverseDetails): CulvertFormat => details.sourceFormat

/** Every culvert a field book holds, with its traverse station's place and P-line station. */
export function traverseCulverts(book: SurveyBookRecord): TraverseCulvert[] {
  const details = book.softree
  if (!details) return []
  const reduced = reduceTraverse(book.input)
  return details.extras
    .filter((e): e is SoftreeStationExtras & { culvert: SoftreeCulvert } => !!e.culvert)
    .filter((e) => e.station >= 0 && e.station < reduced.stations.length)
    .map((e) => {
      const s = reduced.stations[e.station]
      return {
        station: e.station,
        pStationM: surveyFieldStation(s.chainage, book),
        xy: [s.adjusted[0], s.adjusted[1]] as [number, number],
        metres: culvertInMetres(e.culvert, bookFormat(details), details.unitM),
        culvert: e.culvert,
        ...(e.label ? { label: e.label } : {}),
      }
    })
}

/**
 * Where a point lies against the road (`projectOntoRoad`, `pointQuery.ts`), its `bearing` the road's
 * up-station direction as an azimuth on the book's grid: a traverse's azimuths are grid azimuths,
 * and a true bearing differs from them by the grid's convergence (about 0.15° near Prince George).
 */
export type RoadLocator = (
  point: Coordinate,
) => { chainage: number; offset: number; bearing: number; beyond: 'start' | 'end' | null } | null

const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180

/**
 * A culvert's skew from square (PGMaps' sign: clockwise from the right-facing perpendicular) from a
 * downstream azimuth, and whether it flows to the road's left.
 */
export function skewFromAzimuth(azimuthDeg: number, roadBearingDeg: number): { skew: number; flowsLeft: boolean } {
  const d = wrap180(azimuthDeg - (roadBearingDeg + 90))
  if (Math.abs(d) <= 90) return { skew: d, flowsLeft: false }
  return { skew: wrap180(d - 180), flowsLeft: true }
}

/** The downstream azimuth of a culvert crossing at `skew`, flowing right (or left). */
export function azimuthFromSkew(skewDeg: number, roadBearingDeg: number, flowsLeft = false): number {
  return (((roadBearingDeg + 90 + skewDeg + (flowsLeft ? 180 : 0)) % 360) + 360) % 360
}

export interface CulvertImportOptions {
  /** P-line stations to read between, m; absent reads the whole book. */
  fromM?: number
  toM?: number
  /** An existing culvert this close along the road to one read is removed, m. */
  replaceWithinM?: number
  /** Remove every existing culvert first (RoadEng's *Remove All*). */
  removeAll?: boolean
}

/**
 * The road's culverts after reading a field book's culverts onto it, as RoadEng's *Culverts
 * Re-Import* does. `locate` places a point against the road; `toLonLat` takes the book's grid to
 * longitude and latitude; `make` gives a new culvert's PGMaps fields (length, cover, costs) at a
 * chainage.
 */
export function culvertsFromTraverse(
  book: SurveyBookRecord,
  existing: readonly Culvert[],
  options: CulvertImportOptions & {
    locate: RoadLocator
    toLonLat: (xy: [number, number]) => Coordinate
    newId: () => string
    make: (chainage: number) => Pick<Culvert, 'lengthM' | 'minCoverM' | 'unitCost' | 'fixedCost' | 'diameterM'>
    maxCulverts?: number
  },
): { culverts: Culvert[]; added: number; removed: number; notes: string[] } {
  const notes: string[] = []
  if (!book.softree)
    return { culverts: [...existing], added: 0, removed: 0, notes: [`${book.name} holds no culverts.`] }
  const from = options.fromM ?? -Infinity,
    to = options.toM ?? Infinity
  const read: Culvert[] = []
  let offRoad = 0
  for (const t of traverseCulverts(book)) {
    if (t.pStationM < from - 1e-6 || t.pStationM > to + 1e-6) continue
    const at = options.locate(options.toLonLat(t.xy))
    if (!at || at.beyond || Math.abs(at.offset) > ROADENG_CULVERT_MAX_OFFSET_M) {
      offRoad++
      continue
    }
    const m = t.metres
    let skew = 0
    let flowsLeft = m.flag === 3
    if ((m.flag === 0 || m.flag === null) && m.azimuth !== null) {
      const turned = skewFromAzimuth(m.azimuth, at.bearing)
      skew = turned.skew
      flowsLeft = turned.flowsLeft
    }
    if (Math.abs(skew) > MAX_SKEW_DEG) {
      notes.push(
        `The culvert at P-station ${pLabel(t.pStationM)} crosses ${Math.abs(skew).toFixed(0)}° from square; it is placed at ${MAX_SKEW_DEG}°.`,
      )
      skew = Math.sign(skew) * MAX_SKEW_DEG
    }
    const made = options.make(at.chainage)
    const record: RoadEngCulvertRecord = {
      bookId: book.id,
      traverseStation: t.station,
      pStationM: Math.round(t.pStationM * 1000) / 1000,
      ...(m.sizeXM !== null ? { boxWidthM: m.sizeXM } : {}),
      ...(m.gradientPercent !== null ? { gradientPercent: m.gradientPercent } : {}),
      ...(m.azimuth !== null ? { azimuthDeg: m.azimuth } : {}),
      ...(m.flag !== null ? { flag: m.flag } : {}),
      ...(m.sdM !== null ? { sdM: m.sdM } : {}),
      ...(t.culvert.raw !== undefined ? { raw: t.culvert.raw } : {}),
    }
    read.push({
      id: options.newId(),
      name: t.label?.trim() ? t.label.trim().slice(0, 200) : `Creek at P-${pLabel(t.pStationM)}`,
      kind: 'stream',
      chainage: Math.round(at.chainage * 1000) / 1000,
      skewDegrees: Math.round(skew * 100) / 100,
      // Flowing to the road's left puts the inlet on the right.
      ...(flowsLeft ? { inletSide: 'right' as const } : {}),
      lengthM: made.lengthM,
      diameterM: m.sizeYM !== null && m.sizeYM > 0 ? Math.min(20, Math.max(0.1, m.sizeYM)) : made.diameterM,
      inletInvertM: null,
      outletInvertM: null,
      minCoverM: made.minCoverM,
      unitCost: made.unitCost,
      fixedCost: made.fixedCost,
      roadEng: record,
    })
  }
  if (offRoad)
    notes.push(
      `${offRoad} culvert${offRoad === 1 ? ' lies' : 's lie'} off the road (beyond its ends or over ${ROADENG_CULVERT_MAX_OFFSET_M} m from it) and ${offRoad === 1 ? 'is' : 'are'} not read.`,
    )
  const within = options.replaceWithinM ?? ROADENG_CULVERT_REPLACE_M
  const kept = options.removeAll
    ? []
    : existing.filter((c) => !read.some((r) => Math.abs(r.chainage - c.chainage) < within))
  const limit = options.maxCulverts ?? 100
  const room = Math.max(0, limit - kept.length)
  if (read.length > room) notes.push(`${read.length - room} culverts are not read: a road holds ${limit}.`)
  const added = read.slice(0, room)
  return {
    culverts: [...kept, ...added].sort((a, b) => a.chainage - b.chainage),
    added: added.length,
    removed: existing.length - kept.length,
    notes,
  }
}

/**
 * The field book with the road's culverts written into it: each culvert at the traverse station
 * square to the road nearest it, within {@link ROADENG_CULVERT_MATCH_M} along the road. Culverts the
 * book held at stations inside the road's span are replaced; those beyond it stay. A culvert read
 * from this book's station and unchanged since goes back as written.
 */
export function traverseWithRoadCulverts(
  book: SurveyBookRecord,
  culverts: readonly Culvert[],
  options: {
    locate: RoadLocator
    toLonLat: (xy: [number, number]) => Coordinate
    /** The road's length, m: the span whose culverts the book takes from the road. */
    lengthM: number
    matchWithinM?: number
  },
): { book: SurveyBookRecord; written: number; notWritten: string[]; removed: number } {
  const details: SoftreeTraverseDetails = book.softree ?? { sourceFormat: 'asc', unitM: 1, extras: [], points: [] }
  if (details.sourceFormat === 'unit-survey' || details.sourceFormat === 'laser-raw')
    throw Error(
      `${book.name} is a unit survey, which has no culvert field. Read a Softree ASCII, IPD or Polycorder traverse.`,
    )
  const reduced = reduceTraverse(book.input)
  const stations = reduced.stations.map((s, index) => {
    const at = options.locate(options.toLonLat([s.adjusted[0], s.adjusted[1]]))
    return { index, at }
  })
  const onRoad = (k: number) => {
    const at = stations[k]?.at
    return !!at && !at.beyond && Math.abs(at.offset) <= ROADENG_CULVERT_MAX_OFFSET_M
  }
  const within = options.matchWithinM ?? ROADENG_CULVERT_MATCH_M
  const placed = new Map<number, SoftreeCulvert>()
  const notWritten: string[] = []
  for (const c of culverts) {
    let best: { index: number; gap: number } | null = null
    for (const s of stations) {
      if (!onRoad(s.index)) continue
      const gap = Math.abs(s.at!.chainage - c.chainage)
      if (gap <= within && (!best || gap < best.gap)) best = { index: s.index, gap }
    }
    if (!best) {
      notWritten.push(`${c.name} (no traverse station within ${within} m along the road)`)
      continue
    }
    if (placed.has(best.index)) {
      notWritten.push(`${c.name} (its traverse station already takes another culvert)`)
      continue
    }
    placed.set(best.index, softreeCulvertFor(c, book, best.index, stations[best.index].at!.bearing, details))
  }
  let removed = 0
  const extras: SoftreeStationExtras[] = details.extras.map((e) => {
    if (placed.has(e.station)) return { ...e, culvert: placed.get(e.station)! }
    if (e.culvert && onRoad(e.station)) {
      removed++
      const { culvert: _gone, ...rest } = e
      void _gone
      return rest
    }
    return e
  })
  for (const [station, culvert] of placed)
    if (!extras.some((e) => e.station === station)) extras.push({ station, culvert })
  extras.sort((a, b) => a.station - b.station)
  return {
    book: { ...book, softree: { ...details, extras: extras.filter((e) => Object.keys(e).length > 1) } },
    written: placed.size,
    notWritten,
    removed,
  }
}

/** A road culvert as the book's format writes it; the culvert as read when nothing changed. */
function softreeCulvertFor(
  c: Culvert,
  book: SurveyBookRecord,
  station: number,
  bearing: number,
  details: SoftreeTraverseDetails,
): SoftreeCulvert {
  const record = c.roadEng?.bookId === book.id && c.roadEng.traverseStation === station ? c.roadEng : undefined
  const original = record ? details.extras.find((e) => e.station === station)?.culvert : undefined
  // A culvert with its inlet on the right flows to the road's left; one read before `inletSide`
  // existed keeps the direction its record states.
  const flowsLeft =
    c.inletSide === 'right' ||
    record?.flag === 3 ||
    (record?.azimuthDeg !== undefined && skewFromAzimuth(record.azimuthDeg, bearing).flowsLeft)
  const metres = {
    sizeYM: c.diameterM,
    sizeXM: record?.boxWidthM ?? null,
    gradientPercent: record?.gradientPercent ?? null,
    azimuth:
      record && record.flag !== undefined && record.flag !== 0 && Math.abs(c.skewDegrees) < 1e-9
        ? (record.azimuthDeg ?? null)
        : Math.round(azimuthFromSkew(c.skewDegrees, bearing, flowsLeft) * 1000) / 1000,
    flag: record && record.flag !== undefined && record.flag !== 0 && Math.abs(c.skewDegrees) < 1e-9 ? record.flag : 0,
    sdM: record?.sdM ?? null,
  }
  if (original) {
    const was = culvertInMetres(original, details.sourceFormat, details.unitM)
    const same = (a: number | null, b: number | null, tol: number) =>
      a === null || b === null ? a === b : Math.abs(a - b) <= tol
    const wasFlag = was.flag ?? 0
    const orientation =
      metres.flag !== 0
        ? metres.flag === wasFlag
        : wasFlag === 0 &&
          // The skew is held to 0.01°; the azimuth read back from it may differ by that.
          (was.azimuth === null || Math.abs(wrap180(was.azimuth - (metres.azimuth ?? 0))) <= 0.02)
    const unchanged = same(was.sizeYM, metres.sizeYM, 1e-6) && same(was.sizeXM, metres.sizeXM, 1e-6) && orientation
    if (unchanged) return original
  }
  return culvertFromMetres(metres, details.sourceFormat, details.unitM)
}

const pLabel = (station: number) => {
  const rounded = Math.round(Math.abs(station) * 10) / 10
  const whole = Math.floor(rounded / 1000 + 1e-9)
  return `${station < 0 ? '−' : ''}${whole}+${(rounded - whole * 1000).toFixed(1).padStart(5, '0')}`
}

/**
 * A new culvert's diameter from a RoadEng design's default culvert of that kind
 * (`roadEngDesignSettings.ts`, `culvertDefaults`), else PGMaps' own.
 */
export function roadEngNewCulvertDiameterM(
  defaults: readonly { kind: 'drain' | 'stream'; diameterM: number | null }[],
  kind: 'stream' | 'cross-drain',
  fallbackM: number,
): number {
  const d = defaults.find((x) => x.kind === (kind === 'stream' ? 'stream' : 'drain'))?.diameterM
  return d !== null && d !== undefined && d >= 0.1 && d <= 20 ? Math.round(d * 1000) / 1000 : fallbackM
}

/** A culvert's kept RoadEng record from a project file: refused, never repaired, when malformed. */
export function parseRoadEngCulvertRecord(raw: unknown): RoadEngCulvertRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('A culvert’s RoadEng record must be an object.')
  const r = raw as Record<string, unknown>
  const finite = (v: unknown, label: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e7)
      throw Error(`A culvert’s RoadEng ${label} must be a number.`)
    return v
  }
  const optional = (key: string, label: string) => (r[key] === undefined ? {} : { [key]: finite(r[key], label) })
  if (typeof r.bookId !== 'string' || !r.bookId || r.bookId.length > 200)
    throw Error('A culvert’s RoadEng record needs its field book.')
  const station = finite(r.traverseStation, 'traverse station')
  if (!Number.isInteger(station) || station < 0)
    throw Error('A culvert’s RoadEng traverse station must be a whole number.')
  if (r.raw !== undefined && (typeof r.raw !== 'string' || r.raw.length > 1000))
    throw Error('A culvert’s RoadEng field as written must be text.')
  return {
    bookId: r.bookId,
    traverseStation: station,
    pStationM: finite(r.pStationM, 'P-station'),
    ...optional('boxWidthM', 'box width'),
    ...optional('gradientPercent', 'gradient'),
    ...optional('azimuthDeg', 'azimuth'),
    ...optional('flag', 'flag'),
    ...optional('sdM', 'slope distance'),
    ...(r.raw === undefined ? {} : { raw: r.raw as string }),
  } as RoadEngCulvertRecord
}
