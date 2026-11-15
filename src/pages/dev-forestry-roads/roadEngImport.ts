/**
 * Softree RoadEng / Location design files (`.dsnx`) brought in as roads, read-only.
 *
 * A `.dsnx` is a ZIP of one set of files per alignment (`Location1.*`, `Location2.*`, …). This
 * reads two of them and nothing else:
 *
 * - `LocationN.dsn`, INI text: `[Software] Version2`, `[design] units` (metres per project unit
 *   × 10,000: 10000 is metres, 3048 feet) and `[design] surface`, the terrain file it designs on;
 * - `LocationN.ds2`, comma-separated records. `108` is a horizontal intersection point
 *   (index, type, signed radius with negative turning left, X, Y, …); `109` is a vertical one
 *   (index, type, signed vertical-curve radius with negative a crest, station, elevation, …);
 *   `110` is a calculated station (type, X, Y, Z, station, …), whose first and last records are the
 *   alignment's ends.
 *
 * Where a design has `109` records, its profile runs from the first `110` record's level through
 * them to the last one's, each vertical curve as long as its radius times its change of grade; `110`
 * levels are then design levels. Without them `110` levels are ground and the road gets no profile.
 *
 * The layout was read from Softree's published sample projects (RoadEng 8, 9 and 11), not from a
 * specification, so every design is checked as it is read: the plan is rebuilt from its PIs as
 * tangents and circular curves and set against every `110` station, and the profile against every
 * `110` level. Where either does not rebuild within its limit (an alignment whose PIs are kept in a
 * part this does not read), the road follows the design's own stations instead: the plan fitted
 * with tangents and curves within {@link ROADENG_FIT_DEVIATION_M}, the profile the stations' levels
 * thinned to within {@link ROADENG_PROFILE_TOLERANCE_M}. The import notice says which, with the
 * measured figures; a design is never refused on them. The binary parts (`.ds1`, `.ds3`),
 * templates, sections and the `.terx` terrain are not read.
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, unzipSync } from 'fflate'
import {
  alignmentCrs,
  gridAlignmentRoad,
  gridToLonLat,
  placedAlignmentRoad,
  type GridAlignment,
  type XY,
} from './landXmlImport'
import { fitPolylineAlignment, MAX_FIT_SOURCE_POINTS } from './polylineFit'
import type { Alignment, Coordinate, RoadTemplate } from './types'

export const MAX_ROADENG_BYTES = 50_000_000
/** Uncompressed size allowed for one `.dsn` or `.ds2` inside the archive. */
export const MAX_ROADENG_ENTRY_BYTES = 100_000_000
export const MAX_ROADENG_ALIGNMENTS = 50
/** A road takes at most 2,000 horizontal points (the engine's limit), its two ends among them. */
export const MAX_ROADENG_PIS = 1998
/** A road takes at most 500 vertical points (the engine's limit), its two ends among them. */
export const MAX_ROADENG_VIPS = 498
/** A rebuilt station further than this from the design's own `110` record is reported outside. */
export const ROADENG_PLAN_TOLERANCE_M = 0.01
/** A rebuilt design level further than this from the `110` level is reported outside. */
export const ROADENG_PROFILE_TOLERANCE_M = 0.01
/** Deviation allowed when a plan that does not rebuild is fitted to the design's own stations. */
export const ROADENG_FIT_DEVIATION_M = 0.1
/**
 * Steeper than this between neighbouring stations is a step in the levels, not a grade: such a
 * level is left out of a profile that follows the stations. The cul-de-sac sample's first record
 * sits 0.46 m below the next one, 0.1 m away (482 %).
 */
export const ROADENG_LEVEL_STEP_GRADE = 0.5

/**
 * Whether the opening of a file is a RoadEng design: a ZIP whose first entry is one of a design's
 * parts. The content decides the reader, never the file's name.
 */
export function isRoadEngDesign(head: Uint8Array): boolean {
  if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return false
  const nameLength = head[26] | (head[27] << 8)
  const name = strFromU8(head.subarray(30, Math.min(head.length, 30 + nameLength)), true)
  return /^Location\d+\.ds[n123]$/i.test(name)
}

export interface RoadEngPi {
  xy: XY
  /** Metres; 0 is an angle point. */
  radiusM: number
  /** From the radius's sign: negative turns left. */
  turn: 'left' | 'right'
  /** The record's type field; 2 is the only one seen in the samples. */
  type: number
}

export interface RoadEngStation {
  station: number
  xy: XY
  /** Design level where the design has a profile, else ground. */
  z: number
  type: number
}

export interface RoadEngChecks {
  /** Stations set against the plan rebuilt from the PIs. */
  planStations: number
  /** Largest distance between a `110` station and the rebuilt plan at its chainage, m. */
  planOffsetM: number
  /** Rebuilt length less the design's stationed length, m. */
  lengthDifferenceM: number
  /** Levels set against the rebuilt profile; 0 when the design has no profile. */
  profileStations: number
  /** Largest difference between a `110` level and the rebuilt profile, m; null without a profile. */
  profileDifferenceM: number | null
}

export interface RoadEngAlignment {
  /** The part's name in the archive, `Location1`. */
  part: string
  /** The alignment's own name (`[HAlignOptions] Option, 1`), when its .dsn gives one. */
  name: string | null
  /**
   * What this workspace wrote into a design it exported (`[PGMaps]`, `roadEngExport.ts`): the
   * surfacing between RoadEng's finished-surface profile and the subgrade, and the road's section as
   * JSON, unchecked here. Null in a design RoadEng wrote.
   */
  pgmaps: { surfacingM: number; template: unknown; engineering: unknown; curveDesign: unknown } | null
  startStation: number
  endStation: number
  pis: RoadEngPi[]
  /** Stations as in the file, m. The first and last carry no curve. Empty without a profile. */
  profile: { station: number; elevation: number; curveLength: number }[]
  stations: RoadEngStation[]
  checks: RoadEngChecks
  /**
   * Where the PIs did not rebuild the design's own stations: `plan`, the road is fitted to the
   * stations; `profile`, its PVIs are the stations' levels thinned to {@link ROADENG_PROFILE_TOLERANCE_M}.
   */
  followsStations: { plan: boolean; profile: boolean }
  warnings: string[]
}

export interface RoadEngDesign {
  /** RoadEng's build, `11.0.673.0`, when the design states it. */
  version: string | null
  /** Metres per project unit. */
  unitM: number
  /** The terrain file the design was made on (`[design] surface`), which this does not read. */
  terrain: string | null
  alignments: RoadEngAlignment[]
}

// ---- Reading -------------------------------------------------------------------------------------

/** `[section] key=value` text; later keys win, keys keep their case. */
function readIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = sections.get(header[1]) ?? new Map()
      sections.set(header[1], current)
    } else if (current) {
      const eq = line.indexOf('=')
      if (eq > 0) current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    }
  }
  return sections
}

const UNITS: Record<string, number> = { '10000': 1, '3048': 0.3048 }

/** Reads a `.dsnx` archive's alignments. Coordinates stay in the design's grid, in metres. */
export function parseRoadEngDesign(bytes: Uint8Array): RoadEngDesign {
  if (bytes.length > MAX_ROADENG_BYTES) throw Error('The RoadEng design is over 50 MB.')
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (file) => /^Location\d+\.ds[n2]$/i.test(file.name) && file.originalSize <= MAX_ROADENG_ENTRY_BYTES,
    })
  } catch {
    throw Error('This RoadEng design could not be unpacked: the archive is damaged or not a .dsnx.')
  }
  const parts = new Map<number, { dsn?: string; ds2?: string }>()
  for (const [name, data] of Object.entries(entries)) {
    const match = /^Location(\d+)\.(ds[n2])$/i.exec(name)
    if (!match) continue
    const part = parts.get(Number(match[1])) ?? {}
    part[match[2].toLowerCase() as 'dsn' | 'ds2'] = strFromU8(data, true)
    parts.set(Number(match[1]), part)
  }
  const numbers = [...parts.keys()].filter((n) => parts.get(n)!.ds2 !== undefined).sort((a, b) => a - b)
  if (!numbers.length) throw Error('The RoadEng design holds no alignment (no LocationN.ds2 inside).')
  if (numbers.length > MAX_ROADENG_ALIGNMENTS)
    throw Error(`The RoadEng design holds ${numbers.length} alignments; at most ${MAX_ROADENG_ALIGNMENTS} are read.`)
  // Project-wide settings sit in the first alignment's .dsn; later ones may leave them out.
  const settings = numbers.map((n) => readIni(parts.get(n)!.dsn ?? ''))
  const first = <T>(read: (ini: Map<string, Map<string, string>>) => T | undefined) =>
    settings.map(read).find((value) => value !== undefined)
  const unitsText = first((ini) => ini.get('design')?.get('units'))
  if (unitsText === undefined) throw Error('The RoadEng design does not state its units ([design] units).')
  const unitM = UNITS[unitsText]
  if (unitM === undefined)
    throw Error(`The RoadEng design's units code ${unitsText} is not one this import reads (10000 metres, 3048 feet).`)
  const header = parts.get(numbers[0])!.ds2!.split(/\r?\n/, 1)[0].split(',')
  const version = first((ini) => ini.get('Software')?.get('Version2')) ?? (header[0] === '100' ? header[3] : undefined)
  const terrain = first((ini) => ini.get('design')?.get('surface')) ?? null
  return {
    version: version?.trim() || null,
    unitM,
    terrain,
    alignments: numbers.map((n, k) => ({
      ...readAlignment(`Location${n}`, parts.get(n)!.ds2!, unitM),
      name: settings[k].get('HAlignOptions')?.get('Option, 1')?.slice(0, 120) || null,
      pgmaps: readPgmaps(settings[k].get('PGMaps')),
    })),
  }
}

function readPgmaps(section: Map<string, string> | undefined): RoadEngAlignment['pgmaps'] {
  if (!section) return null
  const surfacingM = Number(section.get('SurfacingM'))
  if (!Number.isFinite(surfacingM) || surfacingM < 0 || surfacingM > 10) return null
  const json = (key: string): unknown => {
    try {
      return JSON.parse(section.get(key) ?? 'null')
    } catch {
      return null
    }
  }
  return { surfacingM, template: json('Template'), engineering: json('Engineering'), curveDesign: json('CurveDesign') }
}

function readAlignment(part: string, text: string, unitM: number): Omit<RoadEngAlignment, 'name' | 'pgmaps'> {
  const warnings: string[] = []
  const hips: { index: number; pi: RoadEngPi }[] = []
  const vips: { index: number; radius: number; station: number; elevation: number; stated: number }[] = []
  const stations: RoadEngStation[] = []
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(',')
    const n = (i: number) => (f[i] === undefined || f[i].trim() === '' ? NaN : Number(f[i]))
    if (f[0] === '108') {
      const radius = n(3)
      const xy: XY = [n(4) * unitM, n(5) * unitM]
      if (![n(1), radius, ...xy].every(Number.isFinite)) {
        warnings.push(`A horizontal PI record could not be read and is left out: ${line.slice(0, 80)}`)
        continue
      }
      hips.push({
        index: n(1),
        pi: { xy, radiusM: Math.abs(radius) * unitM, turn: radius < 0 ? 'left' : 'right', type: n(2) },
      })
    } else if (f[0] === '109') {
      const record = {
        index: n(1),
        radius: n(3) * unitM,
        station: n(4) * unitM,
        elevation: n(5) * unitM,
        stated: n(11),
      }
      if (![record.index, record.radius, record.station, record.elevation].every(Number.isFinite)) {
        warnings.push(`A vertical PI record could not be read and is left out: ${line.slice(0, 80)}`)
        continue
      }
      vips.push({ ...record, stated: Number.isFinite(record.stated) && record.stated > 0 ? record.stated * unitM : -1 })
    } else if (f[0] === '110') {
      const record = { type: n(1), xy: [n(2) * unitM, n(3) * unitM] as XY, z: n(4) * unitM, station: n(5) * unitM }
      if ([record.type, ...record.xy, record.z, record.station].every(Number.isFinite)) stations.push(record)
    }
  }
  if (hips.length > MAX_ROADENG_PIS)
    throw Error(`${part} has ${hips.length} PIs; a road takes at most ${MAX_ROADENG_PIS} between its ends.`)
  if (vips.length > MAX_ROADENG_VIPS)
    throw Error(`${part} has ${vips.length} vertical PIs; a road takes at most ${MAX_ROADENG_VIPS} between its ends.`)
  if (stations.length < 2) throw Error(`${part} has no calculated stations (110 records) to find its ends from.`)
  stations.sort((a, b) => a.station - b.station)
  const start = stations[0],
    end = stations[stations.length - 1]
  const pis = hips.sort((a, b) => a.index - b.index).map((h) => h.pi)
  const odd = [...new Set(pis.map((p) => p.type).filter((t) => t !== 2))]
  if (odd.length)
    warnings.push(
      `PI type ${odd.join(', ')} is not one seen in RoadEng's samples; it is read as a circular curve (spirals are not read).`,
    )

  // Profile: the ends' levels through the VIPs, each curve its radius times its change of grade.
  const profile: RoadEngAlignment['profile'] = []
  const curveWarnings: string[] = []
  if (vips.length) {
    const sorted = vips.sort((a, b) => a.index - b.index)
    const points = [
      { station: start.station, elevation: start.z, radius: 0, stated: -1 },
      ...sorted,
      { station: end.station, elevation: end.z, radius: 0, stated: -1 },
    ]
    for (let k = 0; k < points.length; k++) {
      const p = points[k]
      let curveLength = 0
      if (k > 0 && k < points.length - 1 && p.radius !== 0) {
        const into = (p.elevation - points[k - 1].elevation) / (p.station - points[k - 1].station)
        const out = (points[k + 1].elevation - p.elevation) / (points[k + 1].station - p.station)
        curveLength = Math.abs(p.radius * (out - into))
        if (p.stated > 0 && Math.abs(p.stated - curveLength) > 0.001)
          curveWarnings.push(
            `The vertical curve at station ${p.station.toFixed(3)} m states ${p.stated.toFixed(3)} m; its radius and grades give ${curveLength.toFixed(3)} m, which is used.`,
          )
      }
      profile.push({ station: p.station, elevation: p.elevation, curveLength })
    }
  }

  const plan = rebuildPlan(start, pis, end, warnings)
  let planOffsetM = 0
  for (const s of stations) {
    const at = plan.at(s.station)
    planOffsetM = Math.max(planOffsetM, Math.hypot(at[0] - s.xy[0], at[1] - s.xy[1]))
  }
  let profileDifferenceM: number | null = null
  if (profile.length) {
    profileDifferenceM = 0
    for (const s of stations)
      profileDifferenceM = Math.max(profileDifferenceM, Math.abs(profileAt(profile, s.station) - s.z))
  }
  const checks: RoadEngChecks = {
    planStations: stations.length,
    planOffsetM,
    lengthDifferenceM: plan.length - (end.station - start.station),
    profileStations: profile.length ? stations.length : 0,
    profileDifferenceM,
  }
  const followsStations = {
    plan: planOffsetM > ROADENG_PLAN_TOLERANCE_M,
    profile: profileDifferenceM !== null && profileDifferenceM > ROADENG_PROFILE_TOLERANCE_M,
  }
  if (followsStations.plan)
    warnings.push(
      pis.length
        ? `Its ${pis.length} readable PIs rebuild the plan only to within ${planOffsetM.toFixed(3)} m of the design's own stations (spirals, or PIs kept where this import does not read), so the road follows those stations instead.`
        : `Its PIs are not in the part of the file this import reads, so the road follows the design's own stations.`,
    )
  const thinned = followsStations.profile ? thinProfile(stations) : null
  if (!thinned) warnings.push(...curveWarnings)
  else {
    warnings.push(
      `Its ${vips.length} readable vertical PIs rebuild the profile only to within ${profileDifferenceM!.toFixed(3)} m of the design's own levels, so the road's PVIs are those levels thinned to within ${(thinned.toleranceM * 1000).toFixed(0)} mm, as straight grades with no vertical curves.`,
    )
    if (thinned.stepped.length)
      warnings.push(
        `The level at station${thinned.stepped.length > 1 ? 's' : ''} ${thinned.stepped.map((s) => s.toFixed(3)).join(', ')} m steps more than ${ROADENG_LEVEL_STEP_GRADE * 100} % from its neighbours and is left out of the profile.`,
      )
  }
  return {
    part,
    startStation: start.station,
    endStation: end.station,
    pis,
    profile: thinned ? thinned.profile : profile,
    stations,
    checks,
    followsStations,
    warnings,
  }
}

/**
 * The stations' levels as straight grades, thinned (Douglas–Peucker) to within the profile
 * tolerance, doubled until the PVIs fit a road.
 */
function thinProfile(stations: readonly RoadEngStation[]): {
  profile: RoadEngAlignment['profile']
  toleranceM: number
  /** Stations whose level steps from both neighbours (an end, from its one) and was left out, m. */
  stepped: number[]
} {
  const distinct = stations.filter((s, k) => k === 0 || s.station - stations[k - 1].station > 1e-6)
  const steep = (a: RoadEngStation | undefined, b: RoadEngStation | undefined) =>
    !a || !b || Math.abs((b.z - a.z) / (b.station - a.station)) > ROADENG_LEVEL_STEP_GRADE
  const stepped: number[] = []
  const points = distinct.filter((s, k) => {
    const out = steep(distinct[k - 1], s) && steep(s, distinct[k + 1])
    if (out) stepped.push(s.station)
    return !out
  })
  if (points.length < 2) return { profile: [], toleranceM: ROADENG_PROFILE_TOLERANCE_M, stepped }
  for (let toleranceM = ROADENG_PROFILE_TOLERANCE_M; ; toleranceM *= 2) {
    const profile = thinLevels(points, toleranceM)
    if (profile.length <= MAX_ROADENG_VIPS + 2) return { profile, toleranceM, stepped }
  }
}
function thinLevels(points: readonly RoadEngStation[], toleranceM: number): RoadEngAlignment['profile'] {
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const grade = (points[b].z - points[a].z) / (points[b].station - points[a].station)
    let worst = -1,
      far = toleranceM / 2
    for (let k = a + 1; k < b; k++) {
      const off = Math.abs(points[a].z + grade * (points[k].station - points[a].station) - points[k].z)
      if (off > far) {
        far = off
        worst = k
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return points.filter((_, k) => keep[k]).map((p) => ({ station: p.station, elevation: p.z, curveLength: 0 }))
}

// ---- Rebuilding the design to check it --------------------------------------------------------------

type Piece =
  | { kind: 'line'; from: XY; to: XY; s0: number; length: number }
  | { kind: 'arc'; centre: XY; radius: number; a0: number; sense: 1 | -1; s0: number; length: number }

/** The plan as tangents and circular curves through the PIs, positioned by the design's stations. */
export function rebuildPlan(
  start: Pick<RoadEngStation, 'xy' | 'station'>,
  pis: readonly RoadEngPi[],
  end: Pick<RoadEngStation, 'xy'>,
  warnings: string[] = [],
) {
  const tangentPoints: number[] = []
  const hip: { xy: XY; radius: number; turn?: 'left' | 'right' }[] = [
    { xy: start.xy, radius: 0 },
    ...pis.map((p) => ({ xy: p.xy, radius: p.radiusM, turn: p.turn })),
    { xy: end.xy, radius: 0 },
  ]
  const pieces: Piece[] = []
  let at: XY = start.xy,
    s = start.station
  const line = (to: XY) => {
    const length = Math.hypot(to[0] - at[0], to[1] - at[1])
    if (length > 0) pieces.push({ kind: 'line', from: at, to, s0: s, length })
    s += length
    at = to
  }
  for (let i = 1; i < hip.length - 1; i++) {
    const p = hip[i]
    const dIn = Math.atan2(p.xy[1] - hip[i - 1].xy[1], p.xy[0] - hip[i - 1].xy[0])
    const dOut = Math.atan2(hip[i + 1].xy[1] - p.xy[1], hip[i + 1].xy[0] - p.xy[0])
    const delta = Math.atan2(Math.sin(dOut - dIn), Math.cos(dOut - dIn))
    if (p.radius <= 0 || Math.abs(delta) < 1e-12) {
      line(p.xy)
      continue
    }
    if ((delta > 0 ? 'left' : 'right') !== p.turn)
      warnings.push(`PI ${i}'s radius sign says it turns ${p.turn}; its tangents turn the other way.`)
    const tangent = p.radius * Math.tan(Math.abs(delta) / 2)
    const pc: XY = [p.xy[0] - tangent * Math.cos(dIn), p.xy[1] - tangent * Math.sin(dIn)]
    const pt: XY = [p.xy[0] + tangent * Math.cos(dOut), p.xy[1] + tangent * Math.sin(dOut)]
    line(pc)
    tangentPoints.push(s)
    const sense = delta > 0 ? 1 : -1
    const normal = dIn + (sense * Math.PI) / 2
    const centre: XY = [pc[0] + p.radius * Math.cos(normal), pc[1] + p.radius * Math.sin(normal)]
    const length = p.radius * Math.abs(delta)
    pieces.push({
      kind: 'arc',
      centre,
      radius: p.radius,
      a0: Math.atan2(pc[1] - centre[1], pc[0] - centre[0]),
      sense,
      s0: s,
      length,
    })
    s += length
    tangentPoints.push(s)
    at = pt
  }
  line(end.xy)
  const position = (station: number): XY => {
    const piece = pieces.find((q) => station <= q.s0 + q.length) ?? pieces[pieces.length - 1]
    if (!piece) return start.xy
    const t = station - piece.s0
    if (piece.kind === 'line') {
      const f = piece.length > 0 ? t / piece.length : 0
      return [piece.from[0] + (piece.to[0] - piece.from[0]) * f, piece.from[1] + (piece.to[1] - piece.from[1]) * f]
    }
    const angle = piece.a0 + (piece.sense * t) / piece.radius
    return [piece.centre[0] + piece.radius * Math.cos(angle), piece.centre[1] + piece.radius * Math.sin(angle)]
  }
  /** `at` gives the position at a station; `tangentPoints` the stations where curves start and end. */
  return { at: position, length: s - start.station, tangentPoints }
}

/** Design level at a station: grade lines between PVIs, symmetric parabolas over each curve. */
function profileAt(profile: RoadEngAlignment['profile'], station: number): number {
  const k = Math.max(
    1,
    Math.min(
      profile.length - 1,
      profile.findIndex((p) => p.station >= station),
    ),
  )
  const grade = (i: number) =>
    (profile[i + 1].elevation - profile[i].elevation) / (profile[i + 1].station - profile[i].station)
  for (let i = 1; i < profile.length - 1; i++) {
    const p = profile[i]
    if (p.curveLength > 0 && Math.abs(station - p.station) <= p.curveLength / 2) {
      const gIn = grade(i - 1),
        gOut = grade(i)
      const x = station - (p.station - p.curveLength / 2)
      return p.elevation - (gIn * p.curveLength) / 2 + gIn * x + ((gOut - gIn) / (2 * p.curveLength)) * x * x
    }
  }
  const i = k - 1
  return profile[i].elevation + grade(i) * (station - profile[i].station)
}

// ---- To roads ------------------------------------------------------------------------------------

export interface RoadEngRoad {
  alignment: Alignment
  source: RoadEngAlignment
  stationScale: number
  /** Measured deviation of a plan fitted to the design's stations, m; null when built from its PIs. */
  fitDeviationM: number | null
  warnings: string[]
}

/**
 * Roads from a RoadEng design. A `.dsnx` states no coordinate system, so `epsg` must answer the
 * question {@link alignmentCrs} raises; it is never taken from the open terrain. Each road gets
 * `template` and a new id.
 */
export function roadEngRoads(
  bytes: Uint8Array,
  options: {
    fileName: string
    newId: () => string
    color: (index: number) => string
    template: RoadTemplate
    epsg?: number
    /**
     * Where the design's metres go, when the caller has placed it already: in its terrain's CRS
     * or on the local plane (`roadEngProject.ts`). `epsg` and the CRS question are then unused.
     */
    placement?: { epsg: number; toLonLat: (xy: XY) => Coordinate }
  },
): { roads: RoadEngRoad[]; design: RoadEngDesign; epsg: number } {
  const design = parseRoadEngDesign(bytes)
  const epsg =
    options.placement?.epsg ??
    alignmentCrs(null, options.epsg, {
      unitM: design.unitM,
      points: design.alignments.flatMap((a) => [a.stations[0].xy, ...a.pis.map((p) => p.xy)]),
      what: `The RoadEng design ${options.fileName}`,
    })
  const toLonLat = options.placement?.toLonLat ?? gridToLonLat(epsg)
  const base = options.fileName.replace(/\.dsnx$/i, '').slice(0, 160)
  const roads = design.alignments.map((source, index): RoadEngRoad => {
    const grid: GridAlignment = {
      name: source.name
        ? `${base} · ${source.name}`
        : design.alignments.length > 1
          ? `${base} · ${source.part.replace(/(\d+)$/, ' $1')}`
          : base,
      points: [
        { xy: source.stations[0].xy, radiusM: 0, spiralM: 0 },
        ...source.pis.map((p) => ({ xy: p.xy, radiusM: p.radiusM, spiralM: 0 })),
        { xy: source.stations[source.stations.length - 1].xy, radiusM: 0, spiralM: 0 },
      ],
      profile: source.profile,
      startStation: source.startStation,
      fileLengthM: source.endStation - source.startStation,
    }
    const target = { id: options.newId(), color: options.color(index), template: options.template }
    let fitDeviationM: number | null = null
    let road: ReturnType<typeof gridAlignmentRoad>
    if (source.followsStations.plan) {
      // Every station, or an even share of them with both ends, within what the fit takes.
      const all = source.stations.filter((s, k) => k === 0 || s.station - source.stations[k - 1].station > 1e-6)
      const step = Math.ceil(all.length / MAX_FIT_SOURCE_POINTS)
      const used = all.filter((_, k) => k % step === 0 || k === all.length - 1)
      const fit = fitPolylineAlignment(
        used.map((s) => toLonLat(s.xy)),
        { maxDeviationM: ROADENG_FIT_DEVIATION_M, minRadiusM: 0 },
      )
      fitDeviationM = fit.maxDeviationM
      road = placedAlignmentRoad(
        { ...grid, points: fit.points.map((p) => ({ coordinate: p.coordinate, radiusM: p.radiusM, spiralM: 0 })) },
        target,
      )
    } else road = gridAlignmentRoad(grid, toLonLat, target)
    // A road with no design profile: its station levels are the ground under its centreline.
    const fileGround = source.profile.length
      ? null
      : thinProfile(source.stations).profile.map((p): [number, number] => [
          Math.round((p.station - source.startStation) * road.stationScale * 1000) / 1000,
          Math.round(p.elevation * 1000) / 1000,
        ])
    return {
      alignment: {
        ...road.alignment,
        ...(fileGround && fileGround.length >= 2
          ? { fileGround: { source: `${options.fileName} station levels`, points: fileGround } }
          : {}),
      },
      source,
      stationScale: road.stationScale,
      fitDeviationM,
      warnings: [...source.warnings, ...road.warnings],
    }
  })
  return { roads, design, epsg }
}

/** One paragraph per road for the import notice: what was read, the checks and the scale. */
export function roadEngImportSummary(road: RoadEngRoad, design: RoadEngDesign): string {
  const c = road.source.checks
  const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`
  const parts = [
    `${road.alignment.name}: ${road.source.pis.length} PIs, ${road.alignment.vertical.length ? `${road.alignment.vertical.length} PVIs` : 'no design profile (its levels are ground)'}`,
    `stations ${road.source.startStation.toFixed(3)} to ${road.source.endStation.toFixed(3)} m (the road's own chainage starts at 0)`,
    road.fitDeviationM !== null
      ? `plan fitted to its ${c.planStations} design stations within ${road.fitDeviationM.toFixed(3)} m`
      : `plan rebuilt from its PIs within ${mm(c.planOffsetM)} of ${c.planStations} design stations (limit ${mm(ROADENG_PLAN_TOLERANCE_M)})`,
    ...(road.source.followsStations.profile
      ? ['profile follows their levels as straight grades']
      : c.profileDifferenceM !== null
        ? [`profile within ${mm(c.profileDifferenceM)} of their levels (limit ${mm(ROADENG_PROFILE_TOLERANCE_M)})`]
        : []),
    `road chainage ÷ design stations ${road.stationScale.toFixed(5)}`,
  ]
  const notes = [
    ...(design.version ? [`Written by RoadEng ${design.version}.`] : []),
    ...(design.terrain ? [`Its terrain, ${design.terrain}, is not read.`] : []),
  ]
  return `${parts.join('; ')}.${road.warnings.length ? ` ${road.warnings.join(' ')}` : ''}${notes.length ? ` ${notes.join(' ')}` : ''}`
}
