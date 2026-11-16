/**
 * RoadEng's own traverse files: the `.tr1` a P-line survey is saved as (and the `.tr2` window
 * settings beside it), read for the survey field book and for a design that takes its ground layers
 * from the P-line (`roadEngPLine.ts`). The format is not published: what follows was read from
 * Softree's tutorial and knowledge-base samples (a 4.x guard-rail traverse, 4.0 and 4.0x survey
 * traverses, a 7.0 resource spur) and checked against the stations' own coordinates. The ASCII
 * traverse format Softree publishes (`softreeTraverse.ts`) is its nearest relative, and its field
 * meanings are taken where the positions line up.
 *
 * - **Records.** One comma-separated record a line, its first field the record family:
 *   `100` the header (`100,100,<version>, <title>`), `101` a station, `102` and `103` its left and
 *   right side shots, `104` a ground type (code, description, then RoadEng's ground-type fields as
 *   in a design's `104`), `116` the unit (metres per unit × 10,000: `3048` is feet; absent in the
 *   older samples) and `117` a projection (kept as read, not interpreted). Any other family is kept
 *   and counted.
 * - **Station (`101`).** `101,<index>,` then: station, foreshot and backshot azimuth, HD, SD, slope
 *   %, two labels, X, Y, Z, a TYPE word, the CREEK field (as in the ASCII format: thousandths of a
 *   unit, `x`-separated), three ground layers with the first two's depths from the surface
 *   (`OB,0.5,FR,,`), HI, HT, the ground's slope % left and right of the centreline, and a levelling
 *   field. A TYPE with bit 8 makes the station's foreshot an intermediate foresight: the next
 *   record is a point shot from this station (a creek bottom, say), and the record after that goes
 *   on from this station, as its station value and HD show in every sample; the field book takes
 *   such a point as a located point, not a leg. X, Y and Z are the station's calculated coordinates (every sample's later stations carry
 *   TYPE 0 and still hold them, matching the azimuths and distances), so the field book takes its
 *   legs from them: the traverse RoadEng built, without reading HI, HT or the other TYPE bits, whose use
 *   in this format the samples leave open (the guard-rail traverse levels its stations from a
 *   benchmark in the last field through HI and HT; the resource spur's HI and HT are 0).
 * - **Side shots (`102`/`103`).** `<family>,<index>,` then groups of seven: slope distance, slope %,
 *   the two layer depths, a type word and two fields the samples leave blank. Each is measured from
 *   the one before it, as in the ASCII format; a slope distance of 0 or less ends the side, and a
 *   slope given with it is the ground's slope beyond the last shot. A station without shots on a
 *   side takes the station's own slope on that side as the ground beyond the centreline.
 * - **Units.** `116` states them; without it the caller's unit is used (a design gives its own).
 *
 * The field book keeps what it has no field for as the ASCII reader does (labels, ground layers,
 * culverts, side-shot depths, slopes beyond the shots): the CREEK and ground-layer fields share the
 * ASCII format's conventions, so the details are kept as ASCII details and an ASCII traverse
 * written from the book carries them. A `.tr1` is not written: the file as read goes back with a
 * RoadEng design that names it (`roadEngProjectExport.ts`).
 *
 * Pure: no DOM or network access.
 */
import { asciiLines, asciiNumber } from './softreeAscii'
import {
  groundLayers,
  MAX_SIDE_SHOTS_PER_SIDE,
  MAX_TRAVERSE_RECORDS,
  nameStations,
  parseCreek,
  sideShotMeasure,
  type SoftreeCreek,
  type SoftreeStationExtras,
  type SoftreeTraverseImport,
  type SoftreeTraversePoint,
} from './softreeTraverse'
import { fieldStation, type StationEquation } from './stationEquations'
import type { TraverseInput, TraverseLeg } from './surveyInterchange'

/** Fields of one side shot in a `102`/`103` record. */
const SHOT_FIELDS = 7
/** Characters a `.tr1` may hold. */
export const MAX_NATIVE_TRAVERSE_CHARS = 20_000_000

export interface NativeSideShot {
  sd: number | null
  slope: number | null
  depth1: number | null
  depth2: number | null
  /** The shot's type word, as written. */
  type: string
}

export interface NativeTraverseStation {
  /** The record's index field. */
  index: number
  /** Station, file units. */
  station: number
  stationText: string
  foreshot: number | null
  backshot: number | null
  hd: number | null
  sd: number | null
  slope: number | null
  label1: string
  label2: string
  /** Calculated coordinates, file units, and X and Y as written. */
  xText: string
  yText: string
  x: number
  y: number
  z: number
  type: number | null
  creek: SoftreeCreek | null
  /** Ground layers as written: up to three types, the first two with their bottom depths (file units). */
  ground: Array<{ type: string; depth: number | null }>
  hi: number | null
  ht: number | null
  /** The ground's slope (%) left and right of the centreline. */
  slopeLeft: number | null
  slopeRight: number | null
  left: NativeSideShot[]
  right: NativeSideShot[]
  /** The record as written. */
  line: string
}

export interface NativeGroundType {
  code: string
  description: string
  /** The record's fields after the description, as written. */
  fields: string[]
}

export interface NativeTraverse {
  /** The `100` header line as written. */
  header: string
  version: string
  /** Metres per file unit from the `116` record; null when the file has none. */
  unitM: number | null
  /** The `117` record's fields after the family, as written; null when absent. */
  projection: string[] | null
  stations: NativeTraverseStation[]
  groundTypes: NativeGroundType[]
  /** Records of families this reader does not use, counted by family. */
  otherRecords: Record<string, number>
  warnings: string[]
}

/** Whether a text is RoadEng's own traverse (`.tr1`): a `100,100,` header naming a traverse data file. */
export function isNativeTraverse(text: string): boolean {
  const first =
    text
      .slice(0, 400)
      .replace(/^\uFEFF/, '')
      .split(/\r\n|\r|\n/)[0] ?? ''
  return /^100,100,[\d.]+,/.test(first) && /traverse data file/i.test(first)
}

/** Whether a text is the `.tr2` settings file RoadEng keeps beside a traverse: INI text with a `[Traverse]` section. */
export function isNativeTraverseSettings(text: string): boolean {
  const head = text.slice(0, 64_000)
  return /^\[[^\]\r\n]+\]\r?$/m.test(head.split(/\r\n|\r|\n/)[0] ?? '') && /^\[Traverse\]\r?$/im.test(head)
}

/** Decimals of the coarsest number written among some texts (blank ones aside). */
/** TYPE bit 8: the record's foreshot is an intermediate foresight (as in the ASCII format's IFS bit). */
const NATIVE_IFS = 8
/** Whether a station record's foreshot is an intermediate foresight: the next record is a shot from it. */
export const isForesightShot = (s: Pick<NativeTraverseStation, 'type'>) => ((s.type ?? 0) & NATIVE_IFS) !== 0

const decimalsOf = (texts: readonly string[]) =>
  Math.min(9, ...texts.filter((t) => t.trim()).map((t) => (t.trim().split('.')[1] ?? '').replace(/[eE].*$/, '').length))

const number = (f: string[], k: number) => {
  const v = asciiNumber(f[k])
  return typeof v === 'number' ? v : null
}

/** Reads RoadEng's own traverse file. Throws when it is not one or has no stations. */
export function parseNativeTraverse(text: string): NativeTraverse {
  if (text.length > MAX_NATIVE_TRAVERSE_CHARS)
    throw Error(`The traverse is over ${MAX_NATIVE_TRAVERSE_CHARS / 1e6} million characters.`)
  if (!isNativeTraverse(text)) throw Error('This is not a RoadEng traverse file (.tr1).')
  const lines = asciiLines(text)
  const header = lines[0]
  const version = (header.split(',')[2] ?? '').trim()
  const warnings: string[] = []
  const stations: NativeTraverseStation[] = []
  const byIndex = new Map<number, NativeTraverseStation>()
  const groundTypes: NativeGroundType[] = []
  const otherRecords: Record<string, number> = {}
  let unitM: number | null = null,
    projection: string[] | null = null
  const pendingShots: Array<{ side: 'left' | 'right'; index: number; shots: NativeSideShot[]; line: number }> = []
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return
    const f = line.split(',')
    const family = f[0].trim()
    const at = i + 2
    if (family === '101') {
      if (stations.length >= MAX_TRAVERSE_RECORDS)
        throw Error(`The traverse has over ${MAX_TRAVERSE_RECORDS.toLocaleString('en-CA')} stations.`)
      const index = number(f, 1),
        station = number(f, 2),
        x = number(f, 10),
        y = number(f, 11),
        z = number(f, 12)
      if (index === null || station === null || x === null || y === null || z === null) {
        warnings.push(`The station on line ${at} has no station or coordinates and is left out.`)
        return
      }
      const s: NativeTraverseStation = {
        index,
        station,
        stationText: f[2].trim(),
        foreshot: number(f, 3),
        backshot: number(f, 4),
        hd: number(f, 5),
        sd: number(f, 6),
        slope: number(f, 7),
        label1: (f[8] ?? '').trim(),
        label2: (f[9] ?? '').trim(),
        xText: f[10].trim(),
        yText: f[11].trim(),
        x,
        y,
        z,
        type: number(f, 13),
        creek: parseCreek(f[14] ?? ''),
        ground: [
          { type: (f[15] ?? '').trim(), depth: number(f, 16) },
          { type: (f[17] ?? '').trim(), depth: number(f, 18) },
          { type: (f[19] ?? '').trim(), depth: null },
        ],
        hi: number(f, 20),
        ht: number(f, 21),
        slopeLeft: number(f, 22),
        slopeRight: number(f, 23),
        left: [],
        right: [],
        line,
      }
      stations.push(s)
      byIndex.set(index, s)
    } else if (family === '102' || family === '103') {
      const index = number(f, 1)
      const body = f.slice(2)
      // A record padded with one trailing comma still holds whole shots.
      if (body.length % SHOT_FIELDS && !body[body.length - 1].trim()) body.pop()
      const shots: NativeSideShot[] = []
      for (let k = 0; k + 1 < body.length && shots.length < MAX_SIDE_SHOTS_PER_SIDE + 1; k += SHOT_FIELDS) {
        const g = body.slice(k, k + SHOT_FIELDS)
        shots.push({
          sd: number(g, 0),
          slope: number(g, 1),
          depth1: number(g, 2),
          depth2: number(g, 3),
          type: (g[4] ?? '').trim(),
        })
      }
      if (index === null) warnings.push(`The side shots on line ${at} name no station and are left out.`)
      else pendingShots.push({ side: family === '102' ? 'left' : 'right', index, shots, line: at })
    } else if (family === '104') {
      const code = (f[1] ?? '').trim()
      if (code) groundTypes.push({ code, description: (f[2] ?? '').trim(), fields: f.slice(3) })
    } else if (family === '116') {
      const v = number(f, 1)
      if (v !== null && v > 0) unitM = v / 10_000
      else warnings.push(`The unit record on line ${at} could not be read.`)
    } else if (family === '117') projection = f.slice(1)
    else otherRecords[family] = (otherRecords[family] ?? 0) + 1
  })
  for (const p of pendingShots) {
    const s = byIndex.get(p.index)
    if (!s) {
      warnings.push(`The side shots on line ${p.line} name station ${p.index}, which the file does not hold.`)
      continue
    }
    s[p.side] = p.shots
  }
  if (!stations.length) throw Error('The traverse has no stations.')
  stations.sort((a, b) => a.index - b.index)
  return { header, version, unitM, projection, stations, groundTypes, otherRecords, warnings }
}

/**
 * A station's side shots as offsets from the centreline (file units, left negative) and heights
 * above the station, each measured from the one before; and the ground's slope beyond the last.
 */
export function nativeSideShots(
  s: NativeTraverseStation,
  side: 'left' | 'right',
): { shots: Array<{ n: number; offset: number; dz: number; shot: NativeSideShot }>; beyond: number | null } {
  const sign = side === 'left' ? -1 : 1
  const out: Array<{ n: number; offset: number; dz: number; shot: NativeSideShot }> = []
  let h = 0,
    dz = 0,
    beyond: number | null = null
  const list = s[side]
  for (let j = 0; j < list.length && out.length < MAX_SIDE_SHOTS_PER_SIDE; j++) {
    const shot = list[j]
    if (shot.sd === null || shot.sd <= 0) {
      beyond = shot.slope
      break
    }
    const d = sideShotMeasure(shot.sd, shot.slope ?? 0, false)
    h += d.h
    dz += d.dz
    out.push({ n: j + 1, offset: sign * h, dz, shot })
  }
  if (!list.length) beyond = side === 'left' ? s.slopeLeft : s.slopeRight
  return { shots: out, beyond }
}

/**
 * RoadEng's own traverse as a survey field book: the start at the first station's coordinates, a leg
 * between each pair of stations from their coordinates, the side shots, and the station equations the
 * station column carries. `unitM` is used where the file states no unit.
 */
export function nativeTraverseToFieldBook(
  t: NativeTraverse,
  options: { unitM: number },
): SoftreeTraverseImport & { fileUnitM: number } {
  const unitM = t.unitM ?? options.unitM
  if (!(unitM > 0)) throw Error('State the traverse’s units: the file does not.')
  const notes: string[] = [...t.warnings]
  if (t.unitM !== null && Math.abs(t.unitM - options.unitM) > 1e-9)
    notes.push(`The file states its unit (${t.unitM === 0.3048 ? 'feet' : `${t.unitM} m`}), which was used.`)
  // An intermediate foresight is a point shot from the station before it, off the line: the record
  // after it goes on from that station. Stations at the same place as the one before are one station.
  const stations: NativeTraverseStation[] = []
  const foresights: Array<{ record: NativeTraverseStation; from: number }> = []
  let merged = 0
  for (const [k, s] of t.stations.entries()) {
    const before = t.stations[k - 1]
    if (before && isForesightShot(before)) {
      foresights.push({ record: s, from: stations.length - 1 })
      continue
    }
    const last = stations[stations.length - 1]
    if (last && Math.hypot(s.x - last.x, s.y - last.y) * unitM < 1e-6) {
      merged++
      continue
    }
    stations.push(s)
  }
  if (merged) notes.push(`${merged} stations at the same place as the one before were taken as that station.`)
  if (stations.length < 2) throw Error('The traverse has no leg.')
  const distances = stations.slice(1).map((s, i) => Math.hypot(s.x - stations[i].x, s.y - stations[i].y))
  // The station column runs along the stations' coordinates, skipping intermediate foresights. A
  // jump past the rounding of the stations and coordinates as written is a station equation.
  const startStation = stations[0].station
  const equations: StationEquation[] = []
  for (let i = 1, chain = startStation; i < stations.length; i++) {
    chain += distances[i - 1]
    const a = stations[i - 1],
      b = stations[i]
    const tolerance =
      1e-6 +
      1.5 * 10 ** -decimalsOf([a.stationText, b.stationText]) +
      3 * 10 ** -decimalsOf([a.xText, a.yText, b.xText, b.yText])
    if (Math.abs(b.station - (a.station + distances[i - 1])) > tolerance)
      equations.push({ back: chain, ahead: b.station })
  }
  const calc = [startStation]
  for (const d of distances) calc.push(calc[calc.length - 1] + d)
  const ids = nameStations(
    calc.map((c) => fieldStation(c, equations)),
    stations.map((s) => s.label1),
    'station',
  )
  if (equations.length) notes.push(`${equations.length} station equations were read from the station column.`)
  const legs: TraverseLeg[] = stations.slice(1).map((s, i) => {
    const a = stations[i]
    const dx = s.x - a.x,
      dy = s.y - a.y
    const h = Math.hypot(dx, dy)
    return {
      id: ids[i + 1],
      bearingDegrees: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
      horizontalDistanceM: h * unitM,
      gradePercent: ((s.z - a.z) / h) * 100,
    }
  })
  const sideShots: NonNullable<TraverseInput['sideShots']> = []
  const extras: SoftreeStationExtras[] = []
  stations.forEach((s, station) => {
    const extra: SoftreeStationExtras = { station }
    if (s.label1) extra.label = s.label1
    if (s.label2) extra.label2 = s.label2
    const ground = groundLayers(s.ground)
    if (ground.length) extra.ground = ground
    if (s.creek) extra.culvert = { ...s.creek }
    if (s.backshot !== null) extra.backshot = s.backshot
    for (const side of ['left', 'right'] as const) {
      const { shots, beyond } = nativeSideShots(s, side)
      for (const shot of shots) {
        sideShots.push({
          id: `${ids[station]} ${side === 'left' ? 'L' : 'R'}${shot.n}`,
          station,
          offsetM: shot.offset * unitM,
          heightDifferenceM: shot.dz * unitM,
        })
        if (shot.shot.depth1 !== null || shot.shot.depth2 !== null)
          (extra.sideShots ??= []).push({ side, n: shot.n, depths: [shot.shot.depth1, shot.shot.depth2] })
      }
      if (beyond !== null) (extra.extensionSlope ??= {})[side] = beyond
    }
    if (Object.keys(extra).length > 1) extras.push(extra)
  })
  const first = stations[0]
  const input: TraverseInput = {
    start: [first.x * unitM, first.y * unitM, first.z * unitM],
    adjustment: 'none',
    legs,
    sideShots,
  }
  notes.push("The legs are taken from the stations' own coordinates in the file.")
  const points: SoftreeTraversePoint[] = foresights.map(({ record, from }) => ({
    id: record.label1 || `${ids[Math.max(0, from)]} IFS ${record.index}`,
    from: ids[Math.max(0, from)],
    station: Math.max(0, from),
    coordinate: [record.x * unitM, record.y * unitM, record.z * unitM],
  }))
  if (points.length) {
    const held = foresights.filter((f) => f.record.creek || f.record.ground[0].type).length
    notes.push(
      `${points.length} intermediate foresights are located points, not legs${held ? `; the culverts and ground layers of ${held} of them are not kept in the field book` : ''}.`,
    )
  }
  const kept = extras.filter((e) => e.ground || e.culvert || e.sideShots || e.extensionSlope || e.label).length
  if (kept)
    notes.push(
      `${kept} stations carry labels, ground layers, culverts or side-shot depths the field book does not hold.`,
    )
  if (t.stations.some((s) => s.hi || s.ht))
    notes.push('Its heights of instrument and target are not kept: the stations’ elevations already include them.')
  const others = Object.entries(t.otherRecords)
  if (others.length)
    notes.push(
      `Records of kinds this reader does not use were left out: ${others.map(([k, n]) => `${n} × ${k}`).join(', ')}.`,
    )
  return {
    input,
    startStation: startStation * unitM,
    equations: equations.map((e) => ({ back: e.back * unitM, ahead: e.ahead * unitM })),
    stationIds: ids,
    extras,
    points,
    fileCheck: null,
    notes,
    fileUnitM: unitM,
  }
}
