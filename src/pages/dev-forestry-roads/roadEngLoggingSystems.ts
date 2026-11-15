/**
 * RoadEng's logging systems: section 8 of a `Terrain1.ter`, read and written back exactly, with
 * values in SI units. RoadEng's Logging Systems dialog lists them ("1 Highlead", "2 Shotgun"…);
 * each copies its equipment (the yarder and its lines) into itself, and a D-line names its system
 * by number (`roadEngDLines.ts`). The `.tlt` also keeps an equipment library (`[EQUIPn]`), which
 * {@link roadEngEquipmentEdits} keeps in step with the systems written.
 *
 * The layout was worked out from Softree's cable tutorial terrains (`Terrain_cables.zip`: four
 * systems in the base file, a fifth "LC550 w T-MAR 86" Grapple" added in the next) and checked
 * against the values in Softree's dialog screenshots for that system, not from a specification.
 * The section is an array of 312-byte records, nothing else; its size is 312 × the system count.
 *
 * | +off | type | field |
 * |---|---|---|
 * | 0 | char[10] | system number as text ("1"…"5"); stale bytes after the NUL |
 * | 10 | char[54] | system name |
 * | 64 | char[50] | configuration ("Highlead with butt rigging", …) |
 * | 114 | u16 | configuration code (1–4 in the samples) |
 * | 116 | u16 × 8 | per-configuration options, 0 or 1 (meaning not known) |
 * | 136 | f64 | carriage weight, lb |
 * | 144 | char[48] | equipment (yarder) name |
 * | 192 | u16 | 1 in every sample (meaning not known) |
 * | 200 | f64 | spar (tower) height, ft |
 * | 208 | u16 | 3 in every sample, as the `.tlt`'s `Machine=…,3` |
 * | 216 | f64 × 4 | maximum working tension, lb: skyline, mainline, haulback, fourth line |
 * | 248 | f64 × 4 | rope weight, lb/ft, same order |
 * | 280 | f64 × 4 | maximum length, ft, same order |
 *
 * The rest is padding holding stale memory. Values are stored in pounds and feet, as Softree's
 * cable tutorial says equipment inputs are, whatever the project's units. The fourth line
 * (slackpulling or strawline) is 0 on two- and three-line systems.
 *
 * A record read from a file keeps its original bytes (`raw`), and writing it back changes only the
 * fields whose values changed, so an unedited library goes back byte for byte, stale padding
 * included. A new record starts from zeros with the configuration's code and options as Softree's
 * samples hold them ({@link ROADENG_CONFIGURATIONS}).
 *
 * Inferred, not documented: the configuration code and options, the two constant `u16`s, and the
 * fourth line's meaning. Pure: no DOM or network access.
 */
import type { CableRigging } from './cableMechanics'
import { base64ToBytes, bytesToBase64, cString, putCString } from './roadEngText'

/** Bytes per logging-system record in `.ter` section 8. */
export const ROADENG_LOGGING_SYSTEM_BYTES = 312
/** Systems read or written at most. */
export const MAX_ROADENG_LOGGING_SYSTEMS = 200

const LB_TO_KN = 0.45359237 * 9.80665e-3
const LB_TO_KG = 0.45359237
const FT_TO_M = 0.3048
const LB_PER_FT_TO_KG_PER_M = LB_TO_KG / FT_TO_M

const ID = [0, 10] as const
const NAME = [10, 54] as const
const CONFIG = [64, 50] as const
const CONFIG_CODE = 114
const OPTIONS = 116
const OPTION_COUNT = 8
const CARRIAGE = 136
const EQUIPMENT = [144, 48] as const
const CONST_192 = 192
const SPAR = 200
const MACHINE = 208
const TENSIONS = 216
const WEIGHTS = 248
const LENGTHS = 280
const LINES = ['skyline', 'mainline', 'haulback', 'fourth'] as const

export interface RoadEngRopeLine {
  /** Maximum working tension, kN. */
  maxTensionKN: number
  /** Rope weight, kg/m. */
  weightKgPerM: number
  /** Maximum length, m. */
  maxLengthM: number
}

export interface RoadEngEquipment {
  name: string
  /** Spar or tower height, m. */
  sparHeightM: number
  skyline: RoadEngRopeLine
  mainline: RoadEngRopeLine
  haulback: RoadEngRopeLine
  /** The fourth line (slackpulling or strawline); zeros on systems without one. */
  fourth: RoadEngRopeLine
  /** The integer after the spar height (3 in every sample; `.tlt` `Machine=<spar>,<this>`). */
  machineCode: number
}

export interface RoadEngLoggingSystem {
  /** RoadEng's system number as text ("1", "2"…); a D-line names its system by it. */
  id: string
  name: string
  configuration: string
  /** RoadEng's code for the configuration (1–4 in the samples). */
  configurationCode: number
  /** Eight 0/1 options RoadEng stores per configuration; their meaning is not known. */
  options: number[]
  carriageKg: number
  equipment: RoadEngEquipment
  /** The record as read, base64: what this does not interpret is written back from it. */
  raw?: string
}

/**
 * The configurations seen in Softree's samples, with the code and options each record holds for
 * it; a new system takes them from here by configuration name.
 */
export const ROADENG_CONFIGURATIONS: readonly { name: string; code: number; options: readonly number[] }[] = [
  { name: 'Highlead with butt rigging', code: 1, options: [0, 0, 1, 1, 1, 0, 0, 0] },
  { name: 'Skyline - motorized dropline car - ML', code: 2, options: [1, 0, 0, 0, 1, 1, 0, 1] },
  { name: 'Running Skyline - grapple', code: 3, options: [0, 1, 0, 1, 1, 0, 0, 0] },
  { name: 'Skyline - butt rigging - HB, ML', code: 4, options: [0, 0, 1, 1, 1, 1, 0, 1] },
]

const toKN = (lb: number) => lb * LB_TO_KN
const toKg = (lb: number) => lb * LB_TO_KG
const toM = (ft: number) => ft * FT_TO_M
const toKgPerM = (lbPerFt: number) => lbPerFt * LB_PER_FT_TO_KG_PER_M

/**
 * An SI value back in RoadEng's unit: the stored value itself when it still converts to exactly
 * this value (so an unedited field keeps its bits), otherwise the conversion to 12 significant
 * digits (so 2.89 lb/ft entered as kg/m comes back as 2.89, not 2.8899999999999997).
 */
export function fromSi(value: number, factor: number, stored?: number): number {
  if (stored !== undefined && stored * factor === value) return stored
  return Number((value / factor).toPrecision(12))
}

const ropeLine = (view: DataView, k: number): RoadEngRopeLine => ({
  maxTensionKN: toKN(view.getFloat64(TENSIONS + 8 * k, true)),
  weightKgPerM: toKgPerM(view.getFloat64(WEIGHTS + 8 * k, true)),
  maxLengthM: toM(view.getFloat64(LENGTHS + 8 * k, true)),
})

/** Decodes section 8. A section that is not a whole number of records is refused. */
export function roadEngLoggingSystems(bytes: Uint8Array): RoadEngLoggingSystem[] {
  if (bytes.length % ROADENG_LOGGING_SYSTEM_BYTES)
    throw Error(
      `The logging-system section is ${bytes.length} bytes, not a whole number of ${ROADENG_LOGGING_SYSTEM_BYTES}-byte systems.`,
    )
  const count = bytes.length / ROADENG_LOGGING_SYSTEM_BYTES
  if (count > MAX_ROADENG_LOGGING_SYSTEMS)
    throw Error(`The terrain lists ${count} logging systems; at most ${MAX_ROADENG_LOGGING_SYSTEMS} are read.`)
  const systems: RoadEngLoggingSystem[] = []
  for (let i = 0; i < count; i++) {
    const record = bytes.slice(i * ROADENG_LOGGING_SYSTEM_BYTES, (i + 1) * ROADENG_LOGGING_SYSTEM_BYTES)
    const view = new DataView(record.buffer)
    systems.push({
      id: cString(record, ...ID),
      name: cString(record, ...NAME),
      configuration: cString(record, ...CONFIG),
      configurationCode: view.getUint16(CONFIG_CODE, true),
      options: Array.from({ length: OPTION_COUNT }, (_, k) => view.getUint16(OPTIONS + 2 * k, true)),
      carriageKg: toKg(view.getFloat64(CARRIAGE, true)),
      equipment: {
        name: cString(record, ...EQUIPMENT),
        sparHeightM: toM(view.getFloat64(SPAR, true)),
        skyline: ropeLine(view, 0),
        mainline: ropeLine(view, 1),
        haulback: ropeLine(view, 2),
        fourth: ropeLine(view, 3),
        machineCode: view.getUint16(MACHINE, true),
      },
      raw: bytesToBase64(record),
    })
  }
  return systems
}

/** Section 8 for these systems: each from its `raw` record with only changed fields rewritten. */
export function encodeRoadEngLoggingSystems(systems: readonly RoadEngLoggingSystem[]): Uint8Array {
  if (systems.length > MAX_ROADENG_LOGGING_SYSTEMS)
    throw Error(`At most ${MAX_ROADENG_LOGGING_SYSTEMS} logging systems can be written.`)
  const out = new Uint8Array(systems.length * ROADENG_LOGGING_SYSTEM_BYTES)
  systems.forEach((system, i) => out.set(encodeSystem(system), i * ROADENG_LOGGING_SYSTEM_BYTES))
  return out
}

function encodeSystem(system: RoadEngLoggingSystem): Uint8Array {
  let record = new Uint8Array(ROADENG_LOGGING_SYSTEM_BYTES)
  let fresh = true
  if (system.raw) {
    const raw = base64ToBytes(system.raw)
    if (raw.length === ROADENG_LOGGING_SYSTEM_BYTES) {
      record = raw
      fresh = false
    }
  }
  const view = new DataView(record.buffer)
  const text = ([start, width]: readonly [number, number], value: string) => {
    if (fresh || cString(record, start, width) !== value) putCString(record, start, width, value)
  }
  const f64 = (at: number, value: number, factor: number) => {
    const stored = fresh ? undefined : view.getFloat64(at, true)
    const next = fromSi(finite(value), factor, stored)
    if (!Object.is(next, stored)) view.setFloat64(at, next, true)
  }
  const u16 = (at: number, value: number) => {
    const v = Math.max(0, Math.min(0xffff, Math.round(finite(value))))
    if (fresh || view.getUint16(at, true) !== v) view.setUint16(at, v, true)
  }
  text(ID, system.id)
  text(NAME, system.name)
  text(CONFIG, system.configuration)
  u16(CONFIG_CODE, system.configurationCode)
  for (let k = 0; k < OPTION_COUNT; k++) u16(OPTIONS + 2 * k, system.options[k] ?? 0)
  f64(CARRIAGE, system.carriageKg, LB_TO_KG)
  const e = system.equipment
  text(EQUIPMENT, e.name)
  if (fresh) view.setUint16(CONST_192, 1, true)
  f64(SPAR, e.sparHeightM, FT_TO_M)
  u16(MACHINE, e.machineCode)
  LINES.forEach((line, k) => {
    f64(TENSIONS + 8 * k, e[line].maxTensionKN, LB_TO_KN)
    f64(WEIGHTS + 8 * k, e[line].weightKgPerM, LB_PER_FT_TO_KG_PER_M)
    f64(LENGTHS + 8 * k, e[line].maxLengthM, FT_TO_M)
  })
  return record
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0)

/**
 * A new system (no `raw`), its configuration code and options taken from
 * {@link ROADENG_CONFIGURATIONS} when the configuration is one of Softree's.
 */
export function newRoadEngLoggingSystem(
  input: Omit<RoadEngLoggingSystem, 'raw' | 'configurationCode' | 'options'> &
    Partial<Pick<RoadEngLoggingSystem, 'configurationCode' | 'options'>>,
): RoadEngLoggingSystem {
  const known = ROADENG_CONFIGURATIONS.find((c) => c.name.toLowerCase() === input.configuration.trim().toLowerCase())
  return {
    ...input,
    configurationCode: input.configurationCode ?? known?.code ?? 0,
    options: input.options ?? [...(known?.options ?? new Array(OPTION_COUNT).fill(0))],
  }
}

/**
 * What a system says about a PGMaps rigging (`CableRigging`): the skyline's weight, the carriage,
 * the running lines' weight (mainline plus haulback), and the skyline's maximum working tension as
 * an allowable tension (breaking force = tension × 3 with a safety factor of 3, which gives the
 * same allowable tension). Rope diameter, fill, modulus and the payload are not in a system.
 */
export function roadEngLoggingSystemRigging(
  system: RoadEngLoggingSystem,
): Pick<
  CableRigging,
  'tensionMode' | 'ropeMassKgPerM' | 'carriageKg' | 'runningLinesKgPerM' | 'breakingForceKN' | 'safetyFactor'
> {
  const e = system.equipment
  return {
    tensionMode: 'allowable',
    ropeMassKgPerM: e.skyline.weightKgPerM,
    carriageKg: system.carriageKg,
    runningLinesKgPerM: e.mainline.weightKgPerM + e.haulback.weightKgPerM,
    breakingForceKN: e.skyline.maxTensionKN * 3,
    safetyFactor: 3,
  }
}

// ---- The .tlt equipment library ----------------------------------------------------------------------

const f6 = (v: number) => v.toFixed(6)

/** One `[EQUIPn]` section's keys for an equipment, in the order and format RoadEng writes them. */
export function roadEngEquipmentEntries(e: RoadEngEquipment): [string, string][] {
  const lines = LINES.map((line) => e[line])
  return [
    ['Desc', e.name],
    ['Lengths', lines.map((l) => f6(fromSi(l.maxLengthM, FT_TO_M))).join(',')],
    ['Machine', `${fromSi(e.sparHeightM, FT_TO_M).toFixed(1)},${e.machineCode}`],
    ['Tensions', lines.map((l) => f6(fromSi(l.maxTensionKN, LB_TO_KN))).join(',')],
    ['UnitWts', lines.map((l) => f6(fromSi(l.weightKgPerM, LB_PER_FT_TO_KG_PER_M))).join(',')],
  ]
}

/**
 * The `.tlt` edits that keep its equipment library in step with these systems: each equipment a
 * system uses updates the `[EQUIPn]` section of the same name (`Desc`) in place, or is added as the
 * next `[EQUIPn]` at the end of the file; equipment no system uses stays in the library as it was.
 */
export function roadEngEquipmentEdits(
  sections: readonly { name: string; entries: [string, string][] }[],
  systems: readonly RoadEngLoggingSystem[],
): { section: string; set: [string, string][] }[] {
  const existing = sections
    .map((s) => ({ n: /^EQUIP(\d+)$/i.exec(s.name), s }))
    .filter((x): x is { n: RegExpExecArray; s: (typeof sections)[number] } => x.n !== null)
  let next = existing.reduce((m, x) => Math.max(m, Number(x.n[1])), 0) + 1
  const edits: { section: string; set: [string, string][] }[] = []
  const done = new Set<string>()
  for (const system of systems) {
    const key = system.equipment.name.trim().toLowerCase()
    if (!key || done.has(key)) continue
    done.add(key)
    const match = existing.find((x) => (x.s.entries.find(([k]) => /^desc$/i.test(k))?.[1] ?? '').toLowerCase() === key)
    edits.push({ section: match ? match.s.name : `EQUIP${next++}`, set: roadEngEquipmentEntries(system.equipment) })
  }
  return edits
}
