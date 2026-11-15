/**
 * The open cable-logging equipment library and its bridges to PGMaps' rigging sets and RoadEng's
 * logging systems.
 *
 * **Reads** `skylineXl.generated.json`, built by `scripts/forestry/cable-equipment/build-library.mjs`
 * from the USDA Forest Service's SkylineXL 25.0 `Database` sheet (public domain; database updated
 * 2024-11-01): 25 yarders (21 machines and 4 SkylineXL class averages), 23 carriages and the
 * sheet's wire-rope table (EIPS and swaged; breaking strength, safe working load at a factor of 3,
 * weight). Every record carries its source cells, version and retrieval date, and the row as the
 * sheet gives it beside the SI values. `parseCableEquipmentLibrary` refuses a library with a record
 * out of range or without a source.
 *
 * **Writes** PGMaps rigging sets (`RiggingSet`, `dline/riggingSets.ts`) from a yarder, carriage and
 * rope choice, and from a RoadEng logging system (the structural shape the `.ter` section-8 reader
 * produces, in SI), and the RoadEng logging system back from a set. A set carries only what the
 * rope mechanics use, so each conversion also returns a `RiggingSetEquipment` record: the yarder's
 * lines (tension, weight, length), spar height and RoadEng's system name and configuration. Kept
 * beside the set, it lets a RoadEng system be written back exactly as it was read.
 * `roadEngSystemFromDecoded` / `applyRoadEngSystemToDecoded` bridge to the section-8 reader's own
 * record (`roadEngLoggingSystems.ts`: kN, kg/m, a `fourth` line) structurally, keeping every stored
 * value that an edit did not change.
 *
 * What a source gives and what it does not:
 * - SkylineXL gives the skyline's diameter, type, weight and design tension (the rope table's safe
 *   working load, breaking strength ÷ 3), so the set's breaking force is the rope table's and its
 *   safety factor 3; the running lines' weight; the carriage's weight; the tower height.
 * - RoadEng gives each line's maximum working tension, weight per length and length, the carriage
 *   weight and spar height. It gives no diameter or breaking force: the set's breaking force is the
 *   working tension × `ROADENG_SAFETY_FACTOR`, so its allowable tension is RoadEng's, and the
 *   diameter is read from the skyline's weight as an EIPS rope's (`EIPS_KG_PER_M_PER_MM2`, the
 *   SkylineXL table's own ratio). Both are listed in `derived`.
 * - Neither gives payload, load clearance, metallic fill factor, elastic modulus, base tension or
 *   rope beyond the span. Values the caller does not enter are PGMaps' example rigging
 *   (`EXAMPLE_RIGGING`) and are listed in `toConfirm`, following the vehicle-preset rule: a preset
 *   is a named dimension set with a stated source, and what the source does not give is marked.
 *
 * Inferred: the RoadEng record's fourth line (`slackpulling`) is the slackpulling or dropline line
 * (Softree's tutorial files hold 8,000 lbf / 0.5 lb/ft / 500 ft on a four-line yarder and zeros on
 * three-line ones). The configuration suggested for a SkylineXL set is the closest of the four
 * configuration names seen in Softree's tutorial files, chosen from the yarder's size class and the
 * carriage's slackpulling, not an equivalence; a set read from RoadEng keeps its own.
 *
 * Left out: drum widths, diameters and brake torques are kept in the library but not used; the
 * slackpulling line and the dropline do not load the skyline in PGMaps' mechanics; a running
 * skyline (no standing skyline drum) is not modelled, so such a yarder needs a skyline rope chosen.
 * No set carries saddle-angle limits (SkylineXL and RoadEng give none).
 *
 * Pure: no DOM or network access. The library is loaded lazily (`loadSkylineXlLibrary`) so its
 * JSON stays out of the route's bundle. Checked by `cableEquipment.test.ts`.
 */
import { EXAMPLE_RIGGING, parseRigging, riggingErrors, STANDARD_GRAVITY, type CableRigging } from '../cableMechanics'
import { MAX_RIGGING_SET_NAME } from '../dline/riggingSetName'
import type { RiggingSet } from '../dline/riggingSets'

export const CABLE_EQUIPMENT_SCHEMA = 'pgmaps-cable-equipment-v1'

/** Safety factor of SkylineXL's safe working loads and design tensions. */
export const SKYLINEXL_SAFETY_FACTOR = 3
/** Safety factor a RoadEng maximum working tension is turned into a breaking force with. */
export const ROADENG_SAFETY_FACTOR = 3
/**
 * Mass per metre of an EIPS rope per mm² of nominal diameter squared: SkylineXL's EIPS table runs
 * 0.00422–0.00446 kg/m/mm² (0.00426 from 3/8" up). A RoadEng skyline's diameter is read from its
 * weight with it.
 */
export const EIPS_KG_PER_M_PER_MM2 = 0.00426
/** Relative difference under which a recomputed value is written back as the stored one. */
export const ROUND_TRIP_TOLERANCE = 1e-9

/** Ranges every library record is checked against, [low, high] inclusive. */
export const CABLE_EQUIPMENT_LIMITS = {
  towerHeightM: [0, 60],
  powerKW: [0, 2000],
  diameterMm: [3, 100],
  lengthM: [0, 5000],
  massKgPerM: [0.05, 50],
  forceN: [1_000, 10_000_000],
  carriageKg: [0, 10_000],
  drums: [1, 4],
} as const

export type RopeType = 'swaged' | 'eips'
export type CableLineRole = 'skyline' | 'mainline' | 'haulback' | 'slackpulling'
export const CABLE_LINE_ROLES: readonly CableLineRole[] = ['skyline', 'mainline', 'haulback', 'slackpulling']

/** Where a record was read from. */
export interface EquipmentRecordSource {
  dataset: string
  version: string
  databaseUpdated: string
  retrieved: string
  /** Cells of the source sheet, e.g. `Database!A9:AE9`. */
  cells: string
}

export interface WireRope {
  id: string
  type: RopeType
  diameterIn: number
  /** As the trade names it: 3/4", 1-1/8". */
  diameterLabel: string
  diameterMm: number
  massKgPerM: number
  breakingForceN: number
  safeWorkingLoadN: number
  safeWorkingLoadFactor: number
  sheet: Record<string, number>
  source: EquipmentRecordSource
  notes: string[]
}

export interface YarderLine {
  diameterIn: number
  diameterMm: number
  ropeType: RopeType
  /** The rope-table entry of that type and diameter. */
  ropeId?: string
  /** Rope on the drum, m. */
  lengthM: number
  massKgPerM: number
  /** SkylineXL's design tension: the rope's safe working load at a factor of 3, N. */
  designTensionN: number
}

export interface Yarder {
  id: string
  name: string
  sheetId: number
  /** A `class-average` row is SkylineXL's average of the machines in its size class. */
  kind: 'machine' | 'class-average'
  sizeClass: 'small' | 'medium' | 'large' | 'running'
  towerHeightM: number
  powerKW: number
  lines: Partial<Record<CableLineRole, YarderLine>>
  /** Running-skyline yarders only. */
  drums?: Partial<Record<'mainline' | 'haulback', { widthMm: number; diameterMm: number; brakeTorqueNm: number }>>
  sheet: Record<string, number | string | null>
  source: EquipmentRecordSource
  notes: string[]
}

export interface Carriage {
  id: string
  name: string
  sheetId: number
  massKg: number
  /** 0 where the sheet lists no carriage engine. */
  powerKW: number
  skylineClamp: boolean
  slackpulling: 'carriage' | 'hand' | 'yarder' | 'none'
  multispan: boolean
  /** Yarder drums the carriage needs. */
  yarderDrumsRequired: number
  skylineDiameterMm: [number, number]
  mainlineDiameterMm: [number, number]
  dropline?: { lengthM: number; diameterMm: number }
  sheet: Record<string, number | string | null>
  source: EquipmentRecordSource
  notes: string[]
}

export interface CableEquipmentLibrary {
  schema: typeof CABLE_EQUIPMENT_SCHEMA
  source: {
    id: string
    title: string
    publisher: string
    version: string
    databaseUpdated: string
    retrieved: string
    url: string
    licence: string
    sha256: string
    sheet: string
    [key: string]: string
  }
  units: Record<string, string>
  ropes: WireRope[]
  yarders: Yarder[]
  carriages: Carriage[]
}

// ---------------------------------------------------------------------------------------------
// Reading the library

function obj(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${label} must be text.`)
  return value
}
function num(value: unknown, label: string, [low, high]: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
    throw Error(`${label} must be between ${low} and ${high}.`)
  return value
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw Error(`${label} must be true or false.`)
  return value
}
function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw Error(`${label} must be one of ${options.join(', ')}.`)
  return value as T
}
function notes(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((n) => typeof n !== 'string')) throw Error(`${label} notes must be text.`)
  return [...(value as string[])]
}
function sheetRow<T extends number | string | null>(value: unknown, label: string): Record<string, T> {
  const row = obj(value, `${label} sheet row`)
  for (const [key, v] of Object.entries(row))
    if (v !== null && typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v)))
      throw Error(`${label} sheet value ${key} is not a number or text.`)
  return { ...(row as Record<string, T>) }
}
function recordSource(value: unknown, label: string): EquipmentRecordSource {
  const s = obj(value, `${label} source`)
  const date = (v: unknown, what: string) => {
    const text = str(v, `${label} ${what}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Error(`${label} ${what} must be a date (YYYY-MM-DD).`)
    return text
  }
  return {
    dataset: str(s.dataset, `${label} source dataset`),
    version: str(s.version, `${label} source version`),
    databaseUpdated: date(s.databaseUpdated, 'database date'),
    retrieved: date(s.retrieved, 'retrieval date'),
    cells: str(s.cells, `${label} source cells`),
  }
}
const L = CABLE_EQUIPMENT_LIMITS
const g = STANDARD_GRAVITY
const range = (value: unknown, label: string): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw Error(`${label} must be a [min, max] pair.`)
  const low = num(value[0], `${label} min`, L.diameterMm)
  const high = num(value[1], `${label} max`, L.diameterMm)
  if (low > high) throw Error(`${label} min is above its max.`)
  return [low, high]
}

function parseRope(raw: unknown): WireRope {
  const r = obj(raw, 'Wire rope')
  const label = `Rope ${String(r.id)}`
  const rope: WireRope = {
    id: str(r.id, 'Rope id'),
    type: oneOf(r.type, ['swaged', 'eips'] as const, `${label} type`),
    diameterIn: num(r.diameterIn, `${label} diameter (in)`, [0.1, 4]),
    diameterLabel: str(r.diameterLabel, `${label} diameter label`),
    diameterMm: num(r.diameterMm, `${label} diameter`, L.diameterMm),
    massKgPerM: num(r.massKgPerM, `${label} mass`, L.massKgPerM),
    breakingForceN: num(r.breakingForceN, `${label} breaking force`, L.forceN),
    safeWorkingLoadN: num(r.safeWorkingLoadN, `${label} safe working load`, L.forceN),
    safeWorkingLoadFactor: num(r.safeWorkingLoadFactor, `${label} safe working load factor`, [1, 10]),
    sheet: sheetRow<number>(r.sheet, label),
    source: recordSource(r.source, label),
    notes: notes(r.notes, label),
  }
  if (rope.safeWorkingLoadN >= rope.breakingForceN)
    throw Error(`${label}: safe working load is not below breaking force.`)
  return rope
}

function parseYarder(raw: unknown, ropes: readonly WireRope[]): Yarder {
  const r = obj(raw, 'Yarder')
  const label = `Yarder ${String(r.id)}`
  const rawLines = obj(r.lines, `${label} lines`)
  const lines: Yarder['lines'] = {}
  for (const role of CABLE_LINE_ROLES) {
    if (rawLines[role] === undefined) continue
    const l = obj(rawLines[role], `${label} ${role}`)
    const line: YarderLine = {
      diameterIn: num(l.diameterIn, `${label} ${role} diameter (in)`, [0.1, 4]),
      diameterMm: num(l.diameterMm, `${label} ${role} diameter`, L.diameterMm),
      ropeType: oneOf(l.ropeType, ['swaged', 'eips'] as const, `${label} ${role} rope type`),
      ...(l.ropeId !== undefined ? { ropeId: str(l.ropeId, `${label} ${role} rope`) } : {}),
      lengthM: num(l.lengthM, `${label} ${role} length`, L.lengthM),
      massKgPerM: num(l.massKgPerM, `${label} ${role} mass`, L.massKgPerM),
      designTensionN: num(l.designTensionN, `${label} ${role} design tension`, L.forceN),
    }
    if (line.ropeId && !ropes.some((rope) => rope.id === line.ropeId))
      throw Error(`${label} ${role}: rope ${line.ropeId} is not in the library.`)
    lines[role] = line
  }
  if (!Object.keys(lines).length) throw Error(`${label} has no lines.`)
  let drums: Yarder['drums']
  if (r.drums !== undefined) {
    const d = obj(r.drums, `${label} drums`)
    drums = {}
    for (const role of ['mainline', 'haulback'] as const) {
      if (d[role] === undefined) continue
      const x = obj(d[role], `${label} ${role} drum`)
      drums[role] = {
        widthMm: num(x.widthMm, `${label} ${role} drum width`, [0, 5000]),
        diameterMm: num(x.diameterMm, `${label} ${role} drum diameter`, [0, 5000]),
        brakeTorqueNm: num(x.brakeTorqueNm, `${label} ${role} brake torque`, [0, 1e7]),
      }
    }
  }
  return {
    id: str(r.id, 'Yarder id'),
    name: str(r.name, `${label} name`),
    sheetId: num(r.sheetId, `${label} sheet id`, [1, 1000]),
    kind: oneOf(r.kind, ['machine', 'class-average'] as const, `${label} kind`),
    sizeClass: oneOf(r.sizeClass, ['small', 'medium', 'large', 'running'] as const, `${label} size class`),
    towerHeightM: num(r.towerHeightM, `${label} tower height`, L.towerHeightM),
    powerKW: num(r.powerKW, `${label} power`, L.powerKW),
    lines,
    ...(drums ? { drums } : {}),
    sheet: sheetRow(r.sheet, label),
    source: recordSource(r.source, label),
    notes: notes(r.notes, label),
  }
}

function parseCarriage(raw: unknown): Carriage {
  const r = obj(raw, 'Carriage')
  const label = `Carriage ${String(r.id)}`
  let dropline: Carriage['dropline']
  if (r.dropline !== undefined) {
    const d = obj(r.dropline, `${label} dropline`)
    dropline = {
      lengthM: num(d.lengthM, `${label} dropline length`, L.lengthM),
      diameterMm: num(d.diameterMm, `${label} dropline diameter`, L.diameterMm),
    }
  }
  return {
    id: str(r.id, 'Carriage id'),
    name: str(r.name, `${label} name`),
    sheetId: num(r.sheetId, `${label} sheet id`, [1, 1000]),
    massKg: num(r.massKg, `${label} mass`, L.carriageKg),
    powerKW: num(r.powerKW, `${label} power`, L.powerKW),
    skylineClamp: bool(r.skylineClamp, `${label} skyline clamp`),
    slackpulling: oneOf(r.slackpulling, ['carriage', 'hand', 'yarder', 'none'] as const, `${label} slackpulling`),
    multispan: bool(r.multispan, `${label} multispan`),
    yarderDrumsRequired: num(r.yarderDrumsRequired, `${label} drums required`, L.drums),
    skylineDiameterMm: range(r.skylineDiameterMm, `${label} skyline diameter`),
    mainlineDiameterMm: range(r.mainlineDiameterMm, `${label} mainline diameter`),
    ...(dropline ? { dropline } : {}),
    sheet: sheetRow(r.sheet, label),
    source: recordSource(r.source, label),
    notes: notes(r.notes, label),
  }
}

/** Reads a library file, refusing any record out of range, without a source, or with a repeated id. */
export function parseCableEquipmentLibrary(raw: unknown): CableEquipmentLibrary {
  const r = obj(raw, 'Cable equipment library')
  if (r.schema !== CABLE_EQUIPMENT_SCHEMA)
    throw Error(`Cable equipment library schema must be ${CABLE_EQUIPMENT_SCHEMA}.`)
  const s = obj(r.source, 'Library source')
  const source = {} as CableEquipmentLibrary['source']
  for (const [key, value] of Object.entries(s)) source[key] = str(value, `Library source ${key}`)
  for (const key of [
    'id',
    'title',
    'publisher',
    'version',
    'databaseUpdated',
    'retrieved',
    'url',
    'licence',
    'sha256',
    'sheet',
  ])
    str(source[key], `Library source ${key}`)
  const units = obj(r.units, 'Library units')
  for (const [key, value] of Object.entries(units)) str(value, `Library unit ${key}`)
  const list = (value: unknown, label: string) => {
    if (!Array.isArray(value) || !value.length || value.length > 500) throw Error(`${label} must be a list of 1–500.`)
    return value
  }
  const ropes = list(r.ropes, 'Ropes').map(parseRope)
  const yarders = list(r.yarders, 'Yarders').map((y) => parseYarder(y, ropes))
  const carriages = list(r.carriages, 'Carriages').map(parseCarriage)
  for (const [label, items] of [
    ['rope', ropes],
    ['yarder', yarders],
    ['carriage', carriages],
  ] as const) {
    const ids = new Set<string>()
    for (const item of items) {
      if (ids.has(item.id)) throw Error(`Two ${label}s share the id ${item.id}.`)
      ids.add(item.id)
      if (item.source.dataset !== source.id) throw Error(`${label} ${item.id} names another dataset.`)
    }
  }
  return {
    schema: CABLE_EQUIPMENT_SCHEMA,
    source,
    units: { ...(units as Record<string, string>) },
    ropes,
    yarders,
    carriages,
  }
}

/** SkylineXL's library, loaded on first use so its JSON stays out of the route's bundle. */
export const loadSkylineXlLibrary = (): Promise<CableEquipmentLibrary> =>
  import('./skylineXl.generated.json').then((m) => parseCableEquipmentLibrary(m.default))

// ---------------------------------------------------------------------------------------------
// Lookups

export const yarderById = (lib: CableEquipmentLibrary, id: string) => lib.yarders.find((y) => y.id === id) ?? null
export const carriageById = (lib: CableEquipmentLibrary, id: string) => lib.carriages.find((c) => c.id === id) ?? null
export const ropeById = (lib: CableEquipmentLibrary, id: string) => lib.ropes.find((r) => r.id === id) ?? null

/** The rope of that type within 0.5 mm of the diameter, or null. */
export function ropeFor(lib: CableEquipmentLibrary, type: RopeType, diameterMm: number): WireRope | null {
  let best: WireRope | null = null
  for (const rope of lib.ropes)
    if (rope.type === type && Math.abs(rope.diameterMm - diameterMm) <= 0.5)
      if (!best || Math.abs(rope.diameterMm - diameterMm) < Math.abs(best.diameterMm - diameterMm)) best = rope
  return best
}

/** Ropes a yarder's skyline could be replaced with on a carriage: within its skyline diameter range. */
export const skylineRopesFor = (lib: CableEquipmentLibrary, carriage: Carriage | null) =>
  lib.ropes.filter(
    (rope) =>
      !carriage ||
      (rope.diameterMm >= carriage.skylineDiameterMm[0] - 0.05 &&
        rope.diameterMm <= carriage.skylineDiameterMm[1] + 0.05),
  )

/** Lines the yarder has a drum for. */
export const yarderDrumCount = (yarder: Yarder) => Object.keys(yarder.lines).length

const inRange = (value: number, [low, high]: readonly [number, number]) => value >= low - 0.05 && value <= high + 0.05

/**
 * Why the yarder, carriage and skyline do not go together, in the form's words (SkylineXL's own
 * checks: line diameters inside the carriage's range, and the drums the carriage needs). Empty when
 * they do. Information only: a set can still be made.
 */
export function equipmentCompatibility(yarder: Yarder, carriage: Carriage | null, skyline?: WireRope | null): string[] {
  const issues: string[] = []
  const skylineMm = skyline?.diameterMm ?? yarder.lines.skyline?.diameterMm
  if (skylineMm === undefined) issues.push(`${yarder.name} has no standing skyline (a running skyline yarder).`)
  if (!carriage) return issues
  const mm = (v: number) => `${Math.round(v * 10) / 10} mm`
  if (skylineMm !== undefined && !inRange(skylineMm, carriage.skylineDiameterMm))
    issues.push(
      `The ${mm(skylineMm)} skyline is outside ${carriage.name}'s ${mm(carriage.skylineDiameterMm[0])}–${mm(carriage.skylineDiameterMm[1])}.`,
    )
  const mainline = yarder.lines.mainline
  if (mainline && !inRange(mainline.diameterMm, carriage.mainlineDiameterMm))
    issues.push(
      `The ${mm(mainline.diameterMm)} mainline is outside ${carriage.name}'s ${mm(carriage.mainlineDiameterMm[0])}–${mm(carriage.mainlineDiameterMm[1])}.`,
    )
  if (yarderDrumCount(yarder) < carriage.yarderDrumsRequired)
    issues.push(
      `${carriage.name} needs ${carriage.yarderDrumsRequired} yarder drums; ${yarder.name} has ${yarderDrumCount(yarder)}.`,
    )
  return issues
}

// ---------------------------------------------------------------------------------------------
// Equipment kept beside a rigging set

/** One line of the equipment a set was made from. Forces N, lengths m. */
export interface EquipmentLine {
  maxTensionN: number
  weightNPerM: number
  /** Rope on the drum; null where the source gives none. */
  maxLengthM: number | null
  diameterMm?: number
  ropeType?: RopeType
  /** The rope table's breaking strength, N, where the source gives one (SkylineXL's skyline). */
  breakingForceN?: number
}

/**
 * What a rigging set was made from that the set itself does not hold. Keep it beside the set (a
 * project field), so the set's provenance can be printed and a RoadEng system written back as read.
 */
export interface RiggingSetEquipment {
  origin: 'skylinexl' | 'roadeng'
  /** One line to print beside the set: where its values came from and what the source leaves out. */
  provenance: string
  equipmentName: string
  /** RoadEng's logging-system name, where the set came from one. */
  systemName?: string
  /** RoadEng's rigging configuration (read, or suggested for a SkylineXL set). */
  configuration?: string
  sparHeightM: number
  carriageName?: string
  carriageWeightN: number
  lines: Partial<Record<CableLineRole, EquipmentLine>>
  /** SkylineXL record ids, when it came from the library. */
  yarderId?: string
  carriageId?: string
  skylineRopeId?: string
}

/** Longest name or configuration kept in an equipment record. */
export const MAX_EQUIPMENT_TEXT = 200
/** Longest provenance line kept in an equipment record. */
export const MAX_PROVENANCE_TEXT = 600

/** Reads a saved equipment record (project file), refusing anything out of range. */
export function parseRiggingSetEquipment(raw: unknown): RiggingSetEquipment {
  const r = obj(raw, 'Rigging set equipment')
  const text = (v: unknown, label: string, max = MAX_EQUIPMENT_TEXT) => {
    if (typeof v !== 'string' || v.length > max) throw Error(`${label} must be text of at most ${max} characters.`)
    return v
  }
  const optional = (key: string) =>
    r[key] !== undefined ? { [key]: text(r[key], `Rigging set equipment ${key}`) } : {}
  const rawLines = obj(r.lines, 'Rigging set equipment lines')
  const lines: RiggingSetEquipment['lines'] = {}
  for (const role of CABLE_LINE_ROLES) {
    if (rawLines[role] === undefined) continue
    const l = obj(rawLines[role], `Equipment ${role}`)
    lines[role] = {
      maxTensionN: num(l.maxTensionN, `Equipment ${role} tension`, [0, L.forceN[1]]),
      weightNPerM: num(l.weightNPerM, `Equipment ${role} weight`, [0, 500]),
      maxLengthM: l.maxLengthM === null ? null : num(l.maxLengthM, `Equipment ${role} length`, L.lengthM),
      ...(l.diameterMm !== undefined
        ? { diameterMm: num(l.diameterMm, `Equipment ${role} diameter`, L.diameterMm) }
        : {}),
      ...(l.ropeType !== undefined
        ? { ropeType: oneOf(l.ropeType, ['swaged', 'eips'] as const, `Equipment ${role} rope`) }
        : {}),
      ...(l.breakingForceN !== undefined
        ? { breakingForceN: num(l.breakingForceN, `Equipment ${role} breaking force`, L.forceN) }
        : {}),
    }
  }
  return {
    origin: oneOf(r.origin, ['skylinexl', 'roadeng'] as const, 'Rigging set equipment origin'),
    provenance: text(r.provenance, 'Rigging set equipment provenance', MAX_PROVENANCE_TEXT),
    equipmentName: text(r.equipmentName, 'Rigging set equipment name'),
    ...optional('systemName'),
    ...optional('configuration'),
    sparHeightM: num(r.sparHeightM, 'Rigging set equipment spar height', [0, 200]),
    ...optional('carriageName'),
    carriageWeightN: num(r.carriageWeightN, 'Rigging set equipment carriage weight', [0, 1e6]),
    lines,
    ...optional('yarderId'),
    ...optional('carriageId'),
    ...optional('skylineRopeId'),
  } as RiggingSetEquipment
}

/** Rigging values a set takes from its equipment record, with how the provenance line names them. */
export const EQUIPMENT_RIGGING_FIELDS = {
  ropeDiameterMm: 'skyline diameter',
  ropeMassKgPerM: 'skyline mass',
  breakingForceKN: 'breaking force',
  safetyFactor: 'safety factor',
  carriageKg: 'carriage mass',
  runningLinesKgPerM: 'running lines',
} as const satisfies Partial<Record<keyof CableRigging, string>>
export type EquipmentRiggingField = keyof typeof EQUIPMENT_RIGGING_FIELDS

/** Relative difference under which a rigging value still reads as the equipment's own. */
export const EQUIPMENT_EDIT_TOLERANCE = 1e-6

/**
 * The rigging values the equipment record would give, read back from it: the skyline's weight and
 * breaking strength (the rope table's, else its working tension × the source's safety factor of 3),
 * the carriage and the mainline plus haulback.
 * A RoadEng record's diameter is read from the skyline's weight as an EIPS rope's, as on import.
 */
export function equipmentRigging(equipment: RiggingSetEquipment): Record<EquipmentRiggingField, number> | null {
  const skyline = equipment.lines.skyline
  if (!skyline) return null
  const mass = skyline.weightNPerM / g
  const factor = equipment.origin === 'skylinexl' ? SKYLINEXL_SAFETY_FACTOR : ROADENG_SAFETY_FACTOR
  return {
    ropeDiameterMm: skyline.diameterMm ?? Math.sqrt(mass / EIPS_KG_PER_M_PER_MM2),
    ropeMassKgPerM: mass,
    breakingForceKN: (skyline.breakingForceN ?? skyline.maxTensionN * factor) / 1000,
    safetyFactor: factor,
    carriageKg: equipment.carriageWeightN / g,
    runningLinesKgPerM:
      ((equipment.lines.mainline?.weightNPerM ?? 0) + (equipment.lines.haulback?.weightNPerM ?? 0)) / g,
  }
}

/**
 * The rigging values changed since the set was made from its equipment, in
 * `EQUIPMENT_RIGGING_FIELDS` order. Payload, clearance and the other values no equipment source
 * gives are never counted. Every field when the record has no skyline to compare with.
 */
export function equipmentRiggingEdits(rigging: CableRigging, equipment: RiggingSetEquipment): EquipmentRiggingField[] {
  const fields = Object.keys(EQUIPMENT_RIGGING_FIELDS) as EquipmentRiggingField[]
  const from = equipmentRigging(equipment)
  if (!from) return fields
  return fields.filter(
    (key) => Math.abs(rigging[key] - from[key]) > EQUIPMENT_EDIT_TOLERANCE * Math.max(Math.abs(from[key]), 1e-9),
  )
}

/**
 * The provenance line to print under a set made from equipment: the record's own line, and which
 * of its values have been changed in the project since.
 */
export function equipmentProvenanceText(rigging: CableRigging, equipment: RiggingSetEquipment): string {
  const edits = equipmentRiggingEdits(rigging, equipment)
  if (!edits.length) return equipment.provenance
  const names = edits.map((key) => EQUIPMENT_RIGGING_FIELDS[key])
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return `${equipment.provenance} Changed in this project since: ${list}.`
}

// ---------------------------------------------------------------------------------------------
// Rigging sets from equipment

/** Rigging values no equipment source gives; the caller enters them or they stay PGMaps' example. */
export const NOT_FROM_EQUIPMENT = [
  'tensionMode',
  'payloadKg',
  'minClearanceM',
  'metallicFillFactor',
  'elasticModulusKNPerMm2',
  'baseTensionKN',
  'extraRopeM',
] as const
export type EnteredRiggingField = (typeof NOT_FROM_EQUIPMENT)[number]
export type EnteredRigging = Partial<Pick<CableRigging, EnteredRiggingField>>

/** Where each value of a converted set came from. */
export type RiggingValueOrigin = 'source' | 'derived' | 'entered' | 'example'

export type EquipmentRiggingResult =
  | {
      ok: true
      set: RiggingSet
      equipment: RiggingSetEquipment
      origin: Record<keyof CableRigging, RiggingValueOrigin>
      /** Fields holding PGMaps' example value because the source does not give them: replace them. */
      toConfirm: (keyof CableRigging)[]
      /** Fields computed from the source rather than read (named in `equipment.provenance`). */
      derived: (keyof CableRigging)[]
      /** Compatibility and physical warnings; the set is still valid. */
      issues: string[]
    }
  | { ok: false; error: string }

const clampName = (name: string) => {
  const value = name.replace(/\s+/g, ' ').trim()
  return value.length > MAX_RIGGING_SET_NAME ? value.slice(0, MAX_RIGGING_SET_NAME - 1).trimEnd() + '…' : value
}
const idPart = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '')

function fillEntered(
  sourced: Omit<CableRigging, EnteredRiggingField>,
  entered: EnteredRigging,
  derived: (keyof CableRigging)[],
) {
  const rigging = { ...sourced } as CableRigging
  const origin = {} as Record<keyof CableRigging, RiggingValueOrigin>
  for (const key of Object.keys(sourced) as (keyof CableRigging)[])
    origin[key] = derived.includes(key) ? 'derived' : 'source'
  const toConfirm: (keyof CableRigging)[] = []
  for (const key of NOT_FROM_EQUIPMENT) {
    const value = entered[key]
    if (value !== undefined) {
      ;(rigging as unknown as Record<string, unknown>)[key] = value
      origin[key] = 'entered'
    } else {
      ;(rigging as unknown as Record<string, unknown>)[key] = EXAMPLE_RIGGING[key]
      origin[key] = 'example'
      // Base tension and rope beyond the span matter only in base-tension mode.
      if ((key !== 'baseTensionKN' && key !== 'extraRopeM') || rigging.tensionMode === 'base') toConfirm.push(key)
    }
  }
  // Tension mode is chosen in the form; its default is not a value to confirm.
  return { rigging, origin, toConfirm: toConfirm.filter((k) => k !== 'tensionMode') }
}

function finish(
  set: RiggingSet,
  equipment: RiggingSetEquipment,
  origin: Record<keyof CableRigging, RiggingValueOrigin>,
  toConfirm: (keyof CableRigging)[],
  derived: (keyof CableRigging)[],
  issues: string[],
): EquipmentRiggingResult {
  try {
    set.rigging = parseRigging(set.rigging)
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
  return { ok: true, set, equipment, origin, toConfirm, derived, issues: [...issues, ...riggingErrors(set.rigging)] }
}

const NOT_GIVEN_TEXT = 'Payload, load clearance, fill factor and elastic modulus are not given'

/**
 * The closest of RoadEng's rigging configurations (names seen in Softree's tutorial files) for a
 * SkylineXL yarder and carriage: a running yarder runs a grapple, a powered carriage that pulls
 * slack is a motorized dropline carriage, anything else is rigged on haulback and mainline.
 */
export function suggestRoadEngConfiguration(yarder: Yarder, carriage: Carriage | null): string {
  if (yarder.sizeClass === 'running') return 'Running Skyline - grapple'
  if (carriage && carriage.slackpulling === 'carriage' && carriage.powerKW > 0)
    return 'Skyline - motorized dropline car - ML'
  return 'Skyline - butt rigging - HB, ML'
}

export interface EquipmentChoice {
  yarderId: string
  carriageId?: string
  /** Carriage mass when no carriage is chosen, kg. */
  carriageKg?: number
  /** A skyline from the rope table in place of the yarder's own (needed for a running yarder). */
  skylineRopeId?: string
  /** Values no equipment source gives; the rest stay PGMaps' example and are listed in `toConfirm`. */
  entered?: EnteredRigging
  name?: string
  id?: string
}

/**
 * A rigging set from a SkylineXL yarder, carriage and skyline. The skyline's breaking force and
 * mass come from the rope table (its safe working load is the yarder's design tension), the safety
 * factor is SkylineXL's 3, the running lines are the mainline and haulback, and the carriage mass is
 * the carriage's. Set the D-line's yarder height to `equipment.sparHeightM` when applying it.
 */
export function riggingSetFromEquipment(lib: CableEquipmentLibrary, choice: EquipmentChoice): EquipmentRiggingResult {
  const yarder = yarderById(lib, choice.yarderId)
  if (!yarder) return { ok: false, error: `No yarder ${choice.yarderId} in the library.` }
  const carriage = choice.carriageId ? carriageById(lib, choice.carriageId) : null
  if (choice.carriageId && !carriage) return { ok: false, error: `No carriage ${choice.carriageId} in the library.` }
  if (!carriage && choice.carriageKg === undefined) return { ok: false, error: 'Choose a carriage or enter its mass.' }
  const ownSkyline = yarder.lines.skyline
  const skylineRope = choice.skylineRopeId
    ? ropeById(lib, choice.skylineRopeId)
    : ownSkyline?.ropeId
      ? ropeById(lib, ownSkyline.ropeId)
      : null
  if (choice.skylineRopeId && !skylineRope)
    return { ok: false, error: `No rope ${choice.skylineRopeId} in the library.` }
  if (!skylineRope)
    return {
      ok: false,
      error: ownSkyline
        ? `${yarder.name}'s skyline rope is not in the rope table; choose a skyline rope.`
        : `${yarder.name} has no standing skyline (a running skyline yarder); choose the skyline rope to model.`,
    }
  const replaced = !!choice.skylineRopeId && skylineRope.id !== ownSkyline?.ropeId
  const runningKgPerM = (yarder.lines.mainline?.massKgPerM ?? 0) + (yarder.lines.haulback?.massKgPerM ?? 0)
  const carriageKg = carriage ? carriage.massKg : choice.carriageKg!
  const { rigging, origin, toConfirm } = fillEntered(
    {
      ropeMassKgPerM: skylineRope.massKgPerM,
      ropeDiameterMm: skylineRope.diameterMm,
      breakingForceKN: skylineRope.breakingForceN / 1000,
      safetyFactor: SKYLINEXL_SAFETY_FACTOR,
      carriageKg,
      runningLinesKgPerM: runningKgPerM,
    },
    choice.entered ?? {},
    [],
  )
  if (!carriage) origin.carriageKg = 'entered'
  const lines: RiggingSetEquipment['lines'] = {}
  for (const role of CABLE_LINE_ROLES) {
    const line = yarder.lines[role]
    if (role === 'skyline' && (replaced || !line)) {
      lines.skyline = {
        maxTensionN: skylineRope.safeWorkingLoadN,
        weightNPerM: skylineRope.massKgPerM * g,
        maxLengthM: line?.lengthM ?? null,
        diameterMm: skylineRope.diameterMm,
        ropeType: skylineRope.type,
        breakingForceN: skylineRope.breakingForceN,
      }
      continue
    }
    if (!line) continue
    const rope = role === 'skyline' ? skylineRope : null
    lines[role] = {
      maxTensionN: line.designTensionN,
      weightNPerM: line.massKgPerM * g,
      maxLengthM: line.lengthM,
      diameterMm: line.diameterMm,
      ropeType: line.ropeType,
      ...(rope ? { breakingForceN: rope.breakingForceN } : {}),
    }
  }
  const src = lib.source
  const parts = [
    `yarder ${yarder.name}`,
    carriage ? `carriage ${carriage.name}` : null,
    `${skylineRope.diameterLabel} ${skylineRope.type === 'eips' ? 'EIPS' : 'swaged'} skyline`,
  ]
  const provenance =
    `From ${src.publisher} SkylineXL ${src.version} (database updated ${src.databaseUpdated}, public domain, retrieved ${src.retrieved}): ` +
    `${parts.filter(Boolean).join(', ')}. ${NOT_GIVEN_TEXT} by SkylineXL.`
  const equipment: RiggingSetEquipment = {
    origin: 'skylinexl',
    provenance,
    equipmentName: yarder.name,
    configuration: suggestRoadEngConfiguration(yarder, carriage),
    sparHeightM: yarder.towerHeightM,
    ...(carriage ? { carriageName: carriage.name, carriageId: carriage.id } : {}),
    carriageWeightN: carriageKg * g,
    lines,
    yarderId: yarder.id,
    ...(replaced || !ownSkyline ? { skylineRopeId: skylineRope.id } : {}),
  }
  const name = clampName(choice.name ?? [yarder.name, carriage?.name].filter(Boolean).join(' + '))
  const id = (
    choice.id ?? ['skylinexl', yarder.id, carriage?.id, replaced ? skylineRope.id : null].filter(Boolean).join('--')
  ).slice(0, 100)
  const issues = equipmentCompatibility(yarder, carriage, skylineRope)
  if (yarder.kind === 'class-average')
    issues.unshift(`${yarder.name} is SkylineXL's average of its size class, not one machine.`)
  if (replaced && ownSkyline)
    issues.push(`The skyline is not ${yarder.name}'s own ${ownSkyline.diameterMm} mm rope; its drum length is kept.`)
  return finish({ id, name, rigging }, equipment, origin, toConfirm, [], issues)
}

// ---------------------------------------------------------------------------------------------
// RoadEng logging systems

/** Per-line values of a RoadEng logging system. `slackpulling` is the record's fourth line (inferred). */
export interface RoadEngLineValues {
  skyline: number
  mainline: number
  haulback: number
  slackpulling?: number
}

/** A RoadEng logging system (`.ter` section 8) in SI, as the section-8 reader produces it. */
export interface RoadEngLoggingSystem {
  name: string
  configuration: string
  carriageWeightN: number
  equipmentName: string
  sparHeightM: number
  /** Maximum working tension of each line, N. */
  tensionsN: RoadEngLineValues
  /** Weight per length of each line, N/m. */
  ropeWeightNPerM: RoadEngLineValues
  /** Maximum length of each line, m. */
  maxLengthM: RoadEngLineValues
}

const ROADENG_ROLES = ['skyline', 'mainline', 'haulback', 'slackpulling'] as const

/**
 * A rigging set from a RoadEng logging system. The set's allowable tension is the skyline's maximum
 * working tension (breaking force = it × `ROADENG_SAFETY_FACTOR`), its mass the skyline's weight,
 * its running lines the mainline and haulback, and its carriage RoadEng's. The diameter is read from
 * the weight as an EIPS rope's. Everything else in the system goes into `equipment`.
 */
export function roadEngLoggingSystemToRiggingSet(
  system: RoadEngLoggingSystem,
  options: { entered?: EnteredRigging; id?: string } = {},
): EquipmentRiggingResult {
  const label = system.name || system.equipmentName || 'RoadEng logging system'
  const tension = system.tensionsN.skyline
  const weight = system.ropeWeightNPerM.skyline
  if (!(tension > 0) || !(weight > 0))
    return { ok: false, error: `"${label}" has no skyline tension or weight, so it has no rope to model.` }
  const mass = weight / g
  const derived: (keyof CableRigging)[] = ['ropeDiameterMm', 'breakingForceKN', 'safetyFactor']
  const { rigging, origin, toConfirm } = fillEntered(
    {
      ropeMassKgPerM: mass,
      ropeDiameterMm: Math.sqrt(mass / EIPS_KG_PER_M_PER_MM2),
      breakingForceKN: (tension * ROADENG_SAFETY_FACTOR) / 1000,
      safetyFactor: ROADENG_SAFETY_FACTOR,
      carriageKg: system.carriageWeightN / g,
      runningLinesKgPerM: (system.ropeWeightNPerM.mainline + system.ropeWeightNPerM.haulback) / g,
    },
    options.entered ?? {},
    derived,
  )
  const lines: RiggingSetEquipment['lines'] = {}
  for (const role of ROADENG_ROLES) {
    const t = system.tensionsN[role]
    if (t === undefined) continue
    lines[role] = {
      maxTensionN: t,
      weightNPerM: system.ropeWeightNPerM[role] ?? 0,
      maxLengthM: system.maxLengthM[role] ?? 0,
    }
  }
  const equipment: RiggingSetEquipment = {
    origin: 'roadeng',
    provenance:
      `From RoadEng logging system "${label}" (equipment ${system.equipmentName || 'unnamed'}). ` +
      `Breaking force is its maximum working tension × ${ROADENG_SAFETY_FACTOR}; the diameter is read from the skyline's weight as an EIPS rope's. ` +
      `${NOT_GIVEN_TEXT} by RoadEng.`,
    equipmentName: system.equipmentName,
    systemName: system.name,
    configuration: system.configuration,
    sparHeightM: system.sparHeightM,
    carriageWeightN: system.carriageWeightN,
    lines,
  }
  const id = (options.id ?? `roadeng-${idPart(label) || 'system'}`).slice(0, 100)
  // RoadEng keeps the skyline line's values on every system; only a skyline configuration runs it
  // as a standing skyline, which is what the rope mechanics model.
  const issues = /^skyline\b/i.test(system.configuration.trim())
    ? []
    : [
        `RoadEng rigs "${label}" as ${system.configuration || 'an unnamed configuration'}; the set models its skyline line as a standing skyline.`,
      ]
  return finish({ id, name: clampName(label), rigging }, equipment, origin, toConfirm, derived, issues)
}

/** The stored value when the recomputed one equals it to `ROUND_TRIP_TOLERANCE`, else the recomputed. */
const keep = (recomputed: number, stored: number | undefined) =>
  stored !== undefined && Math.abs(recomputed - stored) <= ROUND_TRIP_TOLERANCE * Math.max(Math.abs(stored), 1e-12)
    ? stored
    : recomputed

export type RoadEngSystemResult =
  | { ok: true; system: RoadEngLoggingSystem; notes: string[] }
  | { ok: false; error: string }

/**
 * The RoadEng logging system for a rigging set. The set's rope, allowable tension, running lines and
 * carriage win; the equipment record supplies what the set does not hold (spar height, the other
 * lines' tensions and lengths, the configuration and names). A set read from RoadEng and not edited
 * comes back exactly as it was read. Without equipment, or without a line RoadEng needs, it refuses.
 */
export function riggingSetToRoadEngLoggingSystem(
  set: RiggingSet,
  equipment?: RiggingSetEquipment | null,
): RoadEngSystemResult {
  if (!equipment)
    return {
      ok: false,
      error: `"${set.name}" has no yarder record: RoadEng needs the spar height and each line's tension and length.`,
    }
  const { lines } = equipment
  const missing = (['skyline', 'mainline', 'haulback'] as const).filter((role) => lines[role]?.maxLengthM == null)
  if (missing.length)
    return { ok: false, error: `"${set.name}" has no ${missing.join(', ')} length; RoadEng needs every line's length.` }
  const r = set.rigging
  const notes: string[] = []
  const skylineTension = keep((r.breakingForceKN * 1000) / r.safetyFactor, lines.skyline!.maxTensionN)
  const skylineWeight = keep(r.ropeMassKgPerM * g, lines.skyline!.weightNPerM)
  const mainline = lines.mainline!
  const haulback = lines.haulback!
  const runningWeight = r.runningLinesKgPerM * g
  const storedRunning = mainline.weightNPerM + haulback.weightNPerM
  let mainlineWeight = mainline.weightNPerM
  let haulbackWeight = haulback.weightNPerM
  if (keep(runningWeight, storedRunning) !== storedRunning) {
    const share = storedRunning > 0 ? mainline.weightNPerM / storedRunning : 0.5
    mainlineWeight = runningWeight * share
    haulbackWeight = runningWeight - mainlineWeight
    notes.push(
      'The running lines were changed in the set; their weight is shared between mainline and haulback as the yarder record shares it.',
    )
  }
  const fourth = lines.slackpulling
  const system: RoadEngLoggingSystem = {
    name: equipment.systemName ?? set.name,
    configuration: equipment.configuration ?? '',
    carriageWeightN: keep(r.carriageKg * g, equipment.carriageWeightN),
    equipmentName: equipment.equipmentName,
    sparHeightM: equipment.sparHeightM,
    tensionsN: {
      skyline: skylineTension,
      mainline: mainline.maxTensionN,
      haulback: haulback.maxTensionN,
      ...(fourth ? { slackpulling: fourth.maxTensionN } : {}),
    },
    ropeWeightNPerM: {
      skyline: skylineWeight,
      mainline: mainlineWeight,
      haulback: haulbackWeight,
      ...(fourth ? { slackpulling: fourth.weightNPerM } : {}),
    },
    maxLengthM: {
      skyline: lines.skyline!.maxLengthM!,
      mainline: mainline.maxLengthM!,
      haulback: haulback.maxLengthM!,
      ...(fourth ? { slackpulling: fourth.maxLengthM ?? 0 } : {}),
    },
  }
  if (!system.configuration) notes.push('The yarder record names no RoadEng configuration.')
  if (equipment.origin === 'skylinexl' && equipment.configuration)
    notes.push(
      `"${equipment.configuration}" is the closest RoadEng configuration to this SkylineXL yarder and carriage.`,
    )
  return { ok: true, system, notes }
}

// ---------------------------------------------------------------------------------------------
// The section-8 reader's own record shape (`roadEngLoggingSystems.ts`), structurally

/** One line as the section-8 reader gives it: kN, kg/m, m. */
export interface DecodedRoadEngLine {
  maxTensionKN: number
  weightKgPerM: number
  maxLengthM: number
}

/** The part of the section-8 reader's record this module reads and writes; other fields pass through. */
export interface DecodedRoadEngSystem {
  name: string
  configuration: string
  carriageKg: number
  equipment: {
    name: string
    sparHeightM: number
    skyline: DecodedRoadEngLine
    mainline: DecodedRoadEngLine
    haulback: DecodedRoadEngLine
    fourth: DecodedRoadEngLine
  }
}

/** A decoded section-8 record as the SI logging system the rigging conversions take. */
export function roadEngSystemFromDecoded(decoded: DecodedRoadEngSystem): RoadEngLoggingSystem {
  const e = decoded.equipment
  const lines = (pick: (line: DecodedRoadEngLine) => number): RoadEngLineValues => ({
    skyline: pick(e.skyline),
    mainline: pick(e.mainline),
    haulback: pick(e.haulback),
    slackpulling: pick(e.fourth),
  })
  return {
    name: decoded.name,
    configuration: decoded.configuration,
    carriageWeightN: decoded.carriageKg * g,
    equipmentName: e.name,
    sparHeightM: e.sparHeightM,
    tensionsN: lines((l) => l.maxTensionKN * 1000),
    ropeWeightNPerM: lines((l) => l.weightKgPerM * g),
    maxLengthM: lines((l) => l.maxLengthM),
  }
}

/**
 * The decoded record with a logging system's values written in. A value that converts back to the
 * stored one (to `ROUND_TRIP_TOLERANCE`) keeps the stored one, so an unedited record is unchanged
 * to the bit; fields this module does not know are kept as they are.
 */
export function applyRoadEngSystemToDecoded<T extends DecodedRoadEngSystem>(
  decoded: T,
  system: RoadEngLoggingSystem,
): T {
  const e = decoded.equipment
  const line = (role: 'skyline' | 'mainline' | 'haulback', stored: DecodedRoadEngLine): DecodedRoadEngLine => ({
    maxTensionKN: keep(system.tensionsN[role] / 1000, stored.maxTensionKN),
    weightKgPerM: keep(system.ropeWeightNPerM[role] / g, stored.weightKgPerM),
    maxLengthM: keep(system.maxLengthM[role], stored.maxLengthM),
  })
  const fourth: DecodedRoadEngLine = {
    maxTensionKN: keep((system.tensionsN.slackpulling ?? 0) / 1000, e.fourth.maxTensionKN),
    weightKgPerM: keep((system.ropeWeightNPerM.slackpulling ?? 0) / g, e.fourth.weightKgPerM),
    maxLengthM: keep(system.maxLengthM.slackpulling ?? 0, e.fourth.maxLengthM),
  }
  return {
    ...decoded,
    name: system.name,
    configuration: system.configuration,
    carriageKg: keep(system.carriageWeightN / g, decoded.carriageKg),
    equipment: {
      ...e,
      name: system.equipmentName,
      sparHeightM: keep(system.sparHeightM, e.sparHeightM),
      skyline: line('skyline', e.skyline),
      mainline: line('mainline', e.mainline),
      haulback: line('haulback', e.haulback),
      fourth,
    },
  }
}
