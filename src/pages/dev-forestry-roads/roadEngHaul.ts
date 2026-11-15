/**
 * A Softree RoadEng / Location design's materials, haul costs and borrow/waste pits, read into the
 * road designer's haul settings and written back.
 *
 * Read from each alignment's two text parts (`roadEngDesignSettings.ts` reads the rest of them):
 *
 * - `LocationN.ds2` `104`, one ground type: code, description, fill and cut slope (%), cut and fill
 *   expansion factors, excavation and embankment cost per project volume (m³ or yd³), then three
 *   (loading, hauling) cost pairs for freehaul, overhaul and endhaul (fields 9–14: loading per
 *   volume, hauling per volume and km, or per yd³ and mile), the quality class (field 15) and three
 *   fields no sample sets (16–18). RoadEng 8 adds an `8` and RoadEng 9 writes one field fewer; every
 *   field is kept as read.
 * - `LocationN.dsn` `[design]`: `MHlengths` (the mass-haul graphic's free-haul and overhaul
 *   distances, project units), `MHcutItems`/`MHfillItems` and `ReCost`; `[OptAlignCost-k]`, one per
 *   vertical alignment option, named by `OptParmsNew` field 31, the active one named first in
 *   `OptParmsRefAlign`: its `OptParms_Pit-n` keys are the pits, `access station, access distance,
 *   excavation cost, site preparation cost, volume or capacity, borrow (1) / waste (0), identifier,
 *   material code, ?, ?, elevation, ?`. No sample holds a pit record in the `.ds2`.
 *
 * What is confirmed and what is inferred:
 *
 * - The haul pairs are (loading, hauling): Softree's defaults (0, 8), (0.6, 4), (2.6, 2) are in
 *   every sample, and RoadEng's Resource manual (V10, chapter 10) gives 792 ft and 5,280 ft as the
 *   class changes for them in a foot design, which are where loading + hauling × distance lines
 *   cross (0.15 and 1 mile). LongRoad's `MHlengths=150,1000` is the same pair in metres. Softree's
 *   help says the class distances follow from where the lines cross and that movement costs are
 *   common to all materials, so a haul is priced over its whole distance at its class's line.
 * - Quality (field 15) is inferred from four ordered values (0 overburden, 1 hard pan, 2 gravel,
 *   3 rock) and Softree's "same or higher quality can be used as fill"; only the order is used,
 *   because Softree's documents name the classes in opposite orders (Q1 best in the Optimal API, Q1
 *   worst in the Resource manual's pit dialog).
 * - Field 16 as RoadEng's *Bedrock* tick is inferred from the help's column list (Quality, then
 *   Bedrock); no sample sets it. It is only offered (`bedrockCandidates`), never applied: rock is the
 *   user's marking. It is not written.
 * - The pit fields are inferred by matching Softree's pit dialog against the samples (LongRoad:
 *   borrow pits on SR at 45 $/m³, waste pits, capacity 1,000,000, access 7,000 m). RoadEng balances
 *   material in cut (bank) volumes, so a pit's volume and excavation cost are taken per bank volume
 *   of its material, and a borrow site's capacity and rate are converted to PGMaps' compacted m³
 *   with the material's compacted/bank factor. A capacity of 10³⁰ or more is unbounded.
 *
 * The mapping (`roadEngHaulFor`) puts the class distances where RoadEng's cost lines cross and
 * folds the hauling over the free-haul distance into the overhaul and endhaul loading rates, because
 * PGMaps charges those classes only past it (`haulCharge`, `engineering.ts`); every haul then costs
 * what RoadEng charges. Costs stay in the currency entered in RoadEng, never converted or escalated;
 * a foot design's yd³ and miles become m³ and km. `roadEngHaulRecords` is the inverse: it rewrites
 * only the fields PGMaps models, keeps every other field and line as read, and leaves a value's text
 * untouched where PGMaps did not change it, so an unedited road writes back the lines it was read
 * from. Everything left behind is listed, in plain words, in `unmapped` or the write's `notes`.
 *
 * Checked by `roadEngHaul.test.ts`: synthetic records, PGMaps' own parsers, read → write → read,
 * and Softree's sample designs when `ROADENG_SAMPLES` is set.
 *
 * Pure: no DOM or network access.
 */
import { DEFAULT_HAUL_SETTINGS } from './engineeringTypes'
import type { AlignmentEngineering, GroundMaterial, HaulSettings, HaulSite } from './engineeringTypes'
import { ROADENG_MATERIAL_COLORS, type RoadEngRangeOptions } from './roadEngDesignSettings'

/** Ground type records read from one alignment. */
export const MAX_ROADENG_GROUND_TYPES = 200
/** Pits read from one alignment; PGMaps holds 100 sites per road. */
export const MAX_ROADENG_PITS = 100
/** A pit volume at or past this is unbounded (RoadEng shows "inf"). */
export const ROADENG_UNBOUNDED_VOLUME = 1e30
/** How an unbounded pit is written (single-precision maximum, RoadEng's "no limit" elsewhere). */
export const ROADENG_UNBOUNDED_TEXT = '3.40282346639e+38'
/** PGMaps' longest free-haul and overhaul distance (`validateEngineering`). */
export const MAX_HAUL_DISTANCE_M = 100_000
/** RoadEng's default overburden ground type, as the design writer writes it. */
export const ROADENG_DEFAULT_GROUND_TYPE = '104,OB,Overburden (Default),100,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,'
/** Highest RoadEng quality class (four classes, 0–3). */
export const ROADENG_QUALITY_CLASSES = 4

const M3_PER_YD3 = 0.764554857984
const M_PER_MILE = 1609.344
const UNITS: Record<string, number> = { '10000': 1, '3048': 0.3048 }
const PIT_KEY = /^OptParms_Pit-(\d+)$/
const COST_SECTION = /^OptAlignCost-(\d+)$/

// ---- What is read ---------------------------------------------------------------------------------

/** One haul class's cost line: `loading + hauling × distance`. */
export interface RoadEngHaulLine {
  /** Per project volume (m³ or yd³). */
  loading: number
  /** Per project volume and km (metric) or mile (foot design). */
  hauling: number
}

export interface RoadEngGroundTypeRecord {
  code: string
  description: string
  fillSlopePercent: number
  cutSlopePercent: number
  cutExpansion: number
  fillExpansion: number
  /** Per project volume, in the design's currency. */
  excavationCost: number
  embankmentCost: number
  haul: { freehaul: RoadEngHaulLine; overhaul: RoadEngHaulLine; endhaul: RoadEngHaulLine }
  /** Inferred: 0–3, higher is better fill. */
  qualityClass: number
  /** Inferred: field 16 set (RoadEng's Bedrock tick). Offered only. */
  bedrock: boolean
  /** The record as read, split at commas (field 0 is `104`). */
  raw: string[]
}

export interface RoadEngPit {
  /** `OptParms_Pit-n` */
  key: string
  index: number
  /** Project units. */
  station: number
  accessDistance: number
  /** Per project volume; RoadEng uses it for borrow only. */
  excavationCost: number
  sitePreparationCost: number
  /** Project volume; null is unbounded. */
  volume: number | null
  kind: 'borrow' | 'waste'
  identifier: string
  materialCode: string | null
  elevation: number | null
  raw: string[]
}

export interface RoadEngHaulData {
  /** Metres per project unit. */
  unitM: number
  groundTypes: RoadEngGroundTypeRecord[]
  /** `[design] MHlengths` free-haul and overhaul distances, project units; null when absent. */
  massHaulLengths: [number, number] | null
  massHaulCutItems: string | null
  massHaulFillItems: string | null
  /** `[design] ReCost=1`: the design was costed. */
  reCost: boolean
  /** The `[OptAlignCost-k]` section pits were read from, and its option name. */
  costSection: { section: string; name: string | null } | null
  /** Other vertical options holding pits, by name. */
  otherOptionsWithPits: string[]
  pits: RoadEngPit[]
  warnings: string[]
}

interface IniSection {
  name: string
  keys: Map<string, string>
}

/** `[section] key=value` text in order; later keys win, names keep their case. */
function readIni(text: string): IniSection[] {
  const sections: IniSection[] = []
  let current: IniSection | null = null
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      current = sections.find((s) => s.name === header[1]) ?? null
      if (!current) {
        current = { name: header[1], keys: new Map() }
        sections.push(current)
      }
      continue
    }
    const eq = line.indexOf('=')
    if (current && eq > 0) current.keys.set(line.slice(0, eq), line.slice(eq + 1))
  }
  return sections
}
const section = (ini: IniSection[], name: string) => ini.find((s) => s.name.toLowerCase() === name.toLowerCase())

const num = (text: string | undefined) => (text === undefined || text.trim() === '' ? NaN : Number(text))

/** The design's metres per project unit from `[design] units`, or null. */
export function roadEngUnitM(dsnText: string): number | null {
  const units = section(readIni(dsnText), 'design')?.keys.get('units')?.trim()
  return units === undefined ? null : (UNITS[units] ?? null)
}

/**
 * Reads one alignment's ground types, mass-haul keys and pits. `unitM` defaults to the `.dsn`'s
 * own `[design] units`, then `projectDsnText`'s (a later alignment's `.dsn` may not state it).
 */
export function parseRoadEngHaul(
  dsnText: string,
  ds2Text: string,
  options: { unitM?: number; projectDsnText?: string } = {},
): RoadEngHaulData {
  const warnings: string[] = []
  let unitM = options.unitM ?? roadEngUnitM(dsnText) ?? roadEngUnitM(options.projectDsnText ?? '')
  if (!(unitM !== null && unitM > 0)) {
    warnings.push('The design does not state its units; metres are used.')
    unitM = 1
  }
  const groundTypes: RoadEngGroundTypeRecord[] = []
  for (const line of ds2Text.split(/\r?\n/)) {
    const f = line.split(',')
    if (f[0] !== '104') continue
    const values = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => num(f[i]))
    if (!f[1]?.trim() || !values.every(Number.isFinite)) {
      warnings.push(`A ground type record could not be read and is left out: ${line.slice(0, 80)}`)
      continue
    }
    if (groundTypes.length >= MAX_ROADENG_GROUND_TYPES) {
      warnings.push(`Ground types past ${MAX_ROADENG_GROUND_TYPES} are left out.`)
      break
    }
    const [fill, cut, cutExp, fillExp, excavation, embankment, l1, h1, l2, h2, l3, h3, quality] = values
    groundTypes.push({
      code: f[1].trim(),
      description: f[2]?.trim() || f[1].trim(),
      fillSlopePercent: fill,
      cutSlopePercent: cut,
      cutExpansion: cutExp,
      fillExpansion: fillExp,
      excavationCost: excavation,
      embankmentCost: embankment,
      haul: {
        freehaul: { loading: l1, hauling: h1 },
        overhaul: { loading: l2, hauling: h2 },
        endhaul: { loading: l3, hauling: h3 },
      },
      qualityClass: quality,
      bedrock: num(f[16]) === 1,
      raw: f,
    })
  }

  const ini = readIni(dsnText)
  const design = section(ini, 'design')?.keys
  const lengths = design?.get('MHlengths')?.split(',').map(num)
  const massHaulLengths: [number, number] | null =
    lengths && Number.isFinite(lengths[0]) && Number.isFinite(lengths[1]) ? [lengths[0], lengths[1]] : null

  const costSections = ini.filter((s) => COST_SECTION.test(s.name))
  const nameOf = (s: IniSection) => s.keys.get('OptParmsNew')?.split(',')[31]?.trim() || null
  const active = costSections[0]?.keys.get('OptParmsRefAlign')?.split(',')[0]?.trim()
  const chosen =
    costSections.find((s) => active && nameOf(s) === active) ??
    costSections.find((s) => [...s.keys.keys()].some((k) => PIT_KEY.test(k))) ??
    costSections[0]
  const pits: RoadEngPit[] = []
  if (chosen)
    for (const [key, value] of chosen.keys) {
      const match = PIT_KEY.exec(key)
      if (!match) continue
      const f = value.split(',')
      const [station, access, excavation, prep, volume, kind] = [0, 1, 2, 3, 4, 5].map((i) => num(f[i]))
      if (![station, access, excavation, prep, volume].every(Number.isFinite) || (kind !== 0 && kind !== 1)) {
        warnings.push(`A pit could not be read and is left out: ${key}=${value.slice(0, 80)}`)
        continue
      }
      if (pits.length >= MAX_ROADENG_PITS) {
        warnings.push(`Pits past ${MAX_ROADENG_PITS} are left out.`)
        break
      }
      const elevation = num(f[10])
      pits.push({
        key,
        index: Number(match[1]),
        station,
        accessDistance: access,
        excavationCost: excavation,
        sitePreparationCost: prep,
        volume: volume >= ROADENG_UNBOUNDED_VOLUME ? null : volume,
        kind: kind === 1 ? 'borrow' : 'waste',
        identifier: f[6]?.trim() ?? '',
        materialCode: f[7]?.trim() || null,
        elevation: Number.isFinite(elevation) && elevation > -9999 ? elevation : null,
        raw: f,
      })
    }
  pits.sort((a, b) => a.index - b.index)
  const otherOptionsWithPits = costSections
    .filter((s) => s !== chosen && [...s.keys.keys()].some((k) => PIT_KEY.test(k)))
    .map((s) => nameOf(s) ?? s.name)
  return {
    unitM,
    groundTypes,
    massHaulLengths,
    massHaulCutItems: design?.get('MHcutItems') ?? null,
    massHaulFillItems: design?.get('MHfillItems') ?? null,
    reCost: design?.get('ReCost')?.trim() === '1',
    costSection: chosen ? { section: chosen.name, name: nameOf(chosen) } : null,
    otherOptionsWithPits,
    pits,
    warnings,
  }
}

// ---- Shared arithmetic ----------------------------------------------------------------------------

/** Rounded to the micrometre or 10⁻⁹, which clears float noise and keeps every figure RoadEng stores. */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const r9 = (v: number) => Math.round(v * 1e9) / 1e9
const fmt = (v: number) => Number(v.toFixed(2)).toLocaleString('en-CA')
const safeId = (code: string) => code.replace(/[^a-zA-Z0-9_.:-]/g, '_') || 'template'
/** PGMaps' material id for a RoadEng ground type, as `roadEngMaterialsFor` names it. */
export const roadEngMaterialId = (code: string) => `roadeng-${safeId(code)}`

/** Volume, cost-per-volume and haul-distance conversions for a design's units. */
function unitsOf(unitM: number) {
  const metric = Math.abs(unitM - 1) < 1e-9
  const m3 = metric ? 1 : M3_PER_YD3
  // Hauling is per km in a metric design and per mile in a foot design (Softree's help).
  const haulM = metric ? 1000 : M_PER_MILE
  return { metric, m3, haulM }
}

type HaulClass = 'freehaul' | 'overhaul' | 'endhaul'
const CLASSES: HaulClass[] = ['freehaul', 'overhaul', 'endhaul']

/**
 * Where RoadEng's three cost lines change class: the free-haul and overhaul distances in the
 * lines' distance unit (km or mile), or Infinity where a class never gives way. The cheapest line
 * wins at each distance; `ordered` is false when the winners do not run freehaul → overhaul → endhaul.
 */
export function roadEngClassDistances(lines: Record<HaulClass, RoadEngHaulLine>): {
  freeHaul: number
  overhaul: number
  ordered: boolean
} {
  const ls = CLASSES.map((c) => lines[c])
  const cuts = new Set<number>([0])
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++) {
      const dh = ls[i].hauling - ls[j].hauling
      if (Math.abs(dh) < 1e-15) continue
      const d = (ls[j].loading - ls[i].loading) / dh
      if (d > 0 && Number.isFinite(d)) cuts.add(d)
    }
  const points = [...cuts].sort((a, b) => a - b)
  const winners: { cls: number; from: number; to: number }[] = []
  for (let k = 0; k < points.length; k++) {
    const from = points[k],
      to = k + 1 < points.length ? points[k + 1] : Infinity
    const probe = Number.isFinite(to) ? (from + to) / 2 : from + 1 + from
    let best = 0
    for (let c = 1; c < 3; c++)
      if (ls[c].loading + ls[c].hauling * probe < ls[best].loading + ls[best].hauling * probe - 1e-12) best = c
    const last = winners[winners.length - 1]
    if (last && last.cls === best) last.to = to
    else winners.push({ cls: best, from, to })
  }
  const ordered = winners.every((w, k) => k === 0 || w.cls > winners[k - 1].cls)
  const end = (cls: number, fallback: number) => winners.find((w) => w.cls === cls)?.to ?? fallback
  const freeHaul = winners[0].cls === 0 ? winners[0].to : 0
  const overhaul = Math.max(freeHaul, end(1, freeHaul))
  return { freeHaul, overhaul, ordered }
}

// ---- To PGMaps ------------------------------------------------------------------------------------

export interface RoadEngHaulMapping {
  /** `base` (or PGMaps' defaults) with RoadEng's distances, class rates and on/off. */
  haul: HaulSettings
  sites: HaulSite[]
  /** The given materials with RoadEng's quality class set (0, 33⅓, 66⅔ or 100). */
  materials: GroundMaterial[]
  /** Quality by material id, for every ground type read. */
  quality: Record<string, number>
  /** RoadEng's embankment cost per m³ when every ground type gives the same one; else null. */
  fillRate: number | null
  /** Materials RoadEng's (inferred) Bedrock field marks: offer "Mark as rock", never apply it. */
  bedrockCandidates: string[]
  unmapped: string[]
  notes: string[]
  read: RoadEngHaulData
}

export interface RoadEngHaulOptions extends RoadEngRangeOptions {
  unitM?: number
  /** The road's materials (`roadEngMaterialsFor`): sites name these, quality is set on these. */
  materials?: GroundMaterial[]
  /** Haul settings to start from; PGMaps' defaults when omitted. */
  base?: HaulSettings
}

/**
 * RoadEng's haul costs, quality classes, embankment cost and the active vertical option's pits as
 * PGMaps haul settings, material quality, fill rate and borrow/waste sites, for one alignment.
 */
export function roadEngHaulFor(
  text: { dsnText: string; ds2Text: string; projectDsnText?: string },
  options: RoadEngHaulOptions,
): RoadEngHaulMapping {
  const read = parseRoadEngHaul(text.dsnText, text.ds2Text, {
    unitM: options.unitM,
    projectDsnText: text.projectDsnText,
  })
  return roadEngHaulFromData(read, options)
}

/** As {@link roadEngHaulFor}, from records already read. */
export function roadEngHaulFromData(read: RoadEngHaulData, options: RoadEngHaulOptions): RoadEngHaulMapping {
  const unmapped: string[] = [...read.warnings]
  const notes: string[] = []
  const u = unitsOf(read.unitM)
  const volume = u.metric ? 'm³' : 'yd³'
  const haul: HaulSettings = { ...(options.base ?? DEFAULT_HAUL_SETTINGS) }
  const types = read.groundTypes

  // Haul classes. RoadEng keeps one cost table for every ground type.
  const first = types[0]
  if (first) {
    const lines = first.haul
    const differ = types.some((t) =>
      CLASSES.some((c) => !same(t.haul[c].loading, lines[c].loading) || !same(t.haul[c].hauling, lines[c].hauling)),
    )
    if (differ)
      unmapped.push(
        `Ground types with haul costs other than ${first.code}'s: RoadEng's movement costs are common to all materials, so ${first.code}'s are used.`,
      )
    const d = roadEngClassDistances(lines)
    const capped = (km: number) =>
      Number.isFinite(km) ? Math.min(MAX_HAUL_DISTANCE_M, r6(km * u.haulM)) : MAX_HAUL_DISTANCE_M
    const fhd = capped(d.freeHaul),
      ohd = Math.max(fhd, capped(d.overhaul))
    const perM3 = (v: number) => r9(v / u.m3)
    const perM3Km = (v: number) => r9((v / u.m3 / u.haulM) * 1000)
    const fhdKm = fhd / 1000
    haul.freeHaulDistanceM = fhd
    haul.overhaulDistanceM = ohd
    haul.freeHaulRate = Math.max(0, perM3Km(lines.freehaul.hauling))
    haul.freeHaulLoadingRate = Math.max(0, perM3(lines.freehaul.loading))
    haul.overhaulRate = Math.max(0, perM3Km(lines.overhaul.hauling))
    haul.overhaulLoadingRate = Math.max(0, r9(perM3(lines.overhaul.loading) + haul.overhaulRate * fhdKm))
    haul.endHaulRate = Math.max(0, perM3Km(lines.endhaul.hauling))
    haul.endHaulLoadingRate = Math.max(0, r9(perM3(lines.endhaul.loading) + haul.endHaulRate * fhdKm))
    if (CLASSES.some((c) => lines[c].loading < 0 || lines[c].hauling < 0))
      unmapped.push('Negative haul or loading costs, which this workspace takes as zero.')
    if (!d.ordered)
      unmapped.push(
        "RoadEng's haul cost lines do not change class in the order freehaul, overhaul, endhaul; the distances are taken where freehaul and overhaul stop being cheapest.",
      )
    if (!Number.isFinite(d.freeHaul) || !Number.isFinite(d.overhaul))
      notes.push(
        `Haul: a class RoadEng never changes from runs to this workspace's ${MAX_HAUL_DISTANCE_M.toLocaleString('en-CA')} m limit.`,
      )
    notes.push(
      `Haul: RoadEng's freehaul, overhaul and endhaul costs (loading + hauling × distance) cross at ${fmt(fhd)} m and ${fmt(ohd)} m, which become the free-haul and overhaul distances. Overhaul and endhaul loading include their hauling over the first ${fmt(fhd)} m, because this workspace charges those classes only past the free-haul distance, so each haul costs what RoadEng charges${u.metric ? '' : ' (converted from per yd³ and per yd³·mile)'}. Costs are in the currency entered in RoadEng, not converted. RoadEng prices haul per volume in its mass haul; this workspace per transported m³ (compacted for fill and borrow, bank for waste).`,
    )
    if (read.massHaulLengths) {
      const [a, b] = read.massHaulLengths.map((v) => r6(v * read.unitM))
      if (Math.abs(a - fhd) > 0.01 || Math.abs(b - ohd) > 0.01)
        unmapped.push(
          `The mass-haul graphic's own free-haul and overhaul distances (${fmt(a)} m and ${fmt(b)} m), a display setting in RoadEng that its cost lines do not follow.`,
        )
    }
  } else if (read.massHaulLengths) {
    const [a, b] = read.massHaulLengths.map((v) => Math.min(MAX_HAUL_DISTANCE_M, Math.max(0, r6(v * read.unitM))))
    haul.freeHaulDistanceM = a
    haul.overhaulDistanceM = Math.max(a, b)
    notes.push(
      `Haul: the design has no ground types, so the free-haul and overhaul distances (${fmt(a)} m and ${fmt(Math.max(a, b))} m) come from its mass-haul graphic, with no haul rates.`,
    )
  }
  for (const [items, which] of [
    [read.massHaulCutItems, 'cut'],
    [read.massHaulFillItems, 'fill'],
  ] as const)
    if (items !== null && items.trim() !== (which === 'cut' ? '1,SG' : '0,SG'))
      unmapped.push(`The section items RoadEng's mass haul counts as ${which} (${items}).`)

  // Embankment cost → the one fill-placement rate.
  let fillRate: number | null = null
  if (first) {
    if (types.every((t) => same(t.embankmentCost, first.embankmentCost))) {
      fillRate = Math.min(10000, Math.max(0, r9(first.embankmentCost / u.m3)))
      notes.push(
        `RoadEng's embankment cost (${first.embankmentCost} per ${volume}, the same for every ground type) becomes the fill rate.`,
      )
    } else
      unmapped.push(
        `Each ground type's own embankment cost (${types.map((t) => `${t.code} ${t.embankmentCost}`).join(', ')} per ${volume}): this workspace has one fill rate.`,
      )
  }

  // Quality and the Bedrock offer.
  const quality: Record<string, number> = {}
  for (const t of types) {
    const q = Math.min(ROADENG_QUALITY_CLASSES - 1, Math.max(0, Math.round(t.qualityClass)))
    quality[roadEngMaterialId(t.code)] = r6((q / (ROADENG_QUALITY_CLASSES - 1)) * 100)
  }
  const materials = (options.materials ?? []).map((m) =>
    quality[m.id] === undefined ? m : { ...m, quality: quality[m.id] },
  )
  if (types.length)
    notes.push(
      "Quality: RoadEng's four quality classes become 0, 33, 67 and 100, in the same order; a fill that needs a quality takes that class or better, as in RoadEng.",
    )
  const known = new Set((options.materials ?? types.map((t) => ({ id: roadEngMaterialId(t.code) }))).map((m) => m.id))
  const bedrockCandidates = types
    .filter((t) => t.bedrock && known.has(roadEngMaterialId(t.code)))
    .map((t) => roadEngMaterialId(t.code))
  const bedrockCodes = types.filter((t) => t.bedrock).map((t) => t.code)
  if (bedrockCodes.length)
    notes.push(
      `RoadEng marks ${bedrockCodes.join(', ')} as bedrock. No material is marked rock here: mark rock materials yourself for the rock cut to apply.`,
    )

  // Pits → sites.
  const sites: HaulSite[] = []
  const scale = options.stationScale ?? 1
  const length = (options.endStation - options.startStation) * scale
  const factorOf = (code: string | null) => {
    if (!code) return null
    const id = roadEngMaterialId(code)
    const given = options.materials?.find((m) => m.id === id)
    if (given) return given.compactionFactor
    if (options.materials) return null
    const t = types.find((g) => g.code === code)
    return t && t.fillExpansion > 0 ? t.cutExpansion / t.fillExpansion : null
  }
  for (const pit of read.pits) {
    const label =
      pit.identifier || `${pit.kind === 'borrow' ? 'Borrow' : 'Waste'} pit at ${fmt(pit.station * read.unitM)}`
    const chainage = r6((pit.station * read.unitM - options.startStation) * scale)
    if (chainage < -1e-6 || chainage > length + 1e-6) {
      unmapped.push(
        `${label}: its access station ${fmt(pit.station * read.unitM)} m is off this road (${fmt(options.startStation)}–${fmt(options.endStation)} m); it stays in the design file.`,
      )
      continue
    }
    const factor = pit.kind === 'borrow' ? factorOf(pit.materialCode) : 1
    const materialId =
      pit.kind === 'borrow' && pit.materialCode && factor !== null ? roadEngMaterialId(pit.materialCode) : undefined
    if (pit.kind === 'borrow' && pit.materialCode && factor === null)
      unmapped.push(`${label}: its material ${pit.materialCode}, which this road's materials do not hold.`)
    const f = factor ?? 1
    const bankM3 = pit.volume === null ? null : pit.volume * u.m3
    const site: HaulSite = {
      id: `roadeng-pit-${pit.index}`,
      name: label.slice(0, 200),
      kind: pit.kind,
      chainage: Math.max(0, Math.min(length, chainage)),
      accessDistanceM: Math.min(100000, Math.max(0, r6(pit.accessDistance * read.unitM))),
      capacityM3: bankM3 === null ? null : Math.min(1e12, r6(pit.kind === 'borrow' ? bankM3 * f : bankM3)),
      unitRate: pit.kind === 'borrow' ? Math.min(100000, Math.max(0, r9(pit.excavationCost / u.m3 / f))) : 0,
      fixedCost: Math.min(1e9, Math.max(0, pit.sitePreparationCost)),
      ...(materialId ? { materialId } : {}),
    }
    if (pit.kind === 'waste' && pit.excavationCost !== 0)
      unmapped.push(`${label}: an excavation cost on a waste pit, which RoadEng does not use.`)
    sites.push(site)
  }
  if (sites.length) {
    notes.push(
      `Pits: ${sites.length} borrow and waste pit${sites.length === 1 ? '' : 's'} of RoadEng's ${read.costSection?.name ? `"${read.costSection.name}" ` : ''}vertical option become sites at their access station, with RoadEng's access (dead-haul) distance, site preparation cost and volume. A borrow pit's volume and excavation cost are per bank volume of its material in RoadEng and per compacted m³ here, converted with the material's compacted/bank factor; a waste pit has no disposal cost in RoadEng. A pit RoadEng fills to an exact volume is a capacity limit here.`,
    )
    unmapped.push("Each pit's elevation and waste quality: this workspace's sites have neither.")
  }
  if (read.otherOptionsWithPits.length)
    unmapped.push(
      `Pits of RoadEng's other vertical options (${read.otherOptionsWithPits.join(', ')}); they stay in the design file.`,
    )
  haul.enabled = read.reCost || sites.length > 0 || haul.enabled
  if (haul.enabled && !options.base?.enabled)
    notes.push(
      read.reCost
        ? 'Haul is on: the design was costed in RoadEng.'
        : 'Haul is on: the design has borrow or waste pits.',
    )
  return {
    haul,
    sites,
    materials,
    quality,
    fillRate,
    bedrockCandidates,
    unmapped: dedupe(unmapped),
    notes: dedupe(notes),
    read,
  }
}

// ---- Back to RoadEng ------------------------------------------------------------------------------

export interface RoadEngHaulWriteInput {
  engineering: Pick<AlignmentEngineering, 'materials' | 'haul' | 'sites' | 'surfacingSupply'>
  /** The project's fill-placement rate (`RoadSettings.fillRate`), per m³. */
  fillRate?: number
}

export interface RoadEngHaulWriteOptions {
  /** Metres per project unit of the file written; the original's units, else metres. */
  unitM?: number
  /** The alignment's parts as read, whose lines and keys are kept where PGMaps changed nothing. */
  original?: { dsnText?: string; ds2Text?: string; projectDsnText?: string }
  /** Design station of chainage 0, m (default 0), and chainage ÷ station (default 1). */
  startStation?: number
  stationScale?: number
  /** Last design station, m. An original pit off [start, end] was not imported and is kept as read. */
  endStation?: number
  /** Level for a new pit's elevation field (RoadEng's "Get from alignment"); 0 when not given. */
  levelAt?: (chainageM: number) => number | null
}

export interface RoadEngHaulRecords {
  /** Replacement for every record of the code: `{ '104': lines }`. */
  recordOverrides: Record<string, string[]>
  /** `.dsn` keys to set, by section; null removes the key. Pits are `.dsn` keys. */
  dsnOverrides: Record<string, Record<string, string | null>>
  /**
   * What RoadEng has no field for, as `[PGMaps]` keys for the design's `.dsn` (`Costs`, the JSON of
   * a {@link RoadEngCostCarryover}); empty when every value is one RoadEng holds or the default.
   */
  pgmaps: Record<string, string>
  notes: string[]
}

/**
 * The cost and haul settings a RoadEng design has no field for, kept in its `[PGMaps]` section so
 * they come back when the design is opened here again, after a trip through RoadEng. Each part is
 * keyed by what RoadEng keeps: a pit by its place in the written list (`OptParms_Pit-<n>`, read back
 * as `roadeng-pit-<n>`), a material by its ground type code. Only values that differ from what a
 * plain RoadEng read gives are kept.
 */
export interface RoadEngCostCarryover {
  version: 1
  /** Haul settings with no RoadEng field (waste and default borrow rates, mobilization, contingency, allocation, ranges). */
  haul?: Partial<Pick<HaulSettings, CarriedHaulKey>>
  /** Per written pit: a waste site's disposal rate and the site's notes. */
  pits?: Record<string, { unitRate?: number; sourceNotes?: string }>
  /** Sites RoadEng's pits cannot hold (switched off, or past its pit limit), whole. */
  sites?: HaulSite[]
  /** Per ground type code: material values RoadEng's ground types have no field for. */
  materials?: Record<string, Partial<Pick<GroundMaterial, CarriedMaterialKey>>>
  surfacingSupply?: AlignmentEngineering['surfacingSupply']
}
/** Haul settings RoadEng has no field for. */
export const ROADENG_CARRIED_HAUL_KEYS = [
  'borrowRate',
  'wasteRate',
  'mobilizationCost',
  'contingencyPercent',
  'allocation',
  'siteSelection',
  'directionRanges',
  'sidecastRanges',
  'deferExternalSupply',
] as const
type CarriedHaulKey = (typeof ROADENG_CARRIED_HAUL_KEYS)[number]
/** Material values RoadEng's ground types have no field for. */
export const ROADENG_CARRIED_MATERIAL_KEYS = [
  'color',
  'reusableFraction',
  'purpose',
  'rock',
  'shallowCutRate',
  'overbreakRate',
  'volumeFactorProvenance',
] as const
type CarriedMaterialKey = (typeof ROADENG_CARRIED_MATERIAL_KEYS)[number]
/** Longest `Costs` value written; a larger one is left out with a note. */
export const MAX_ROADENG_CARRYOVER_CHARS = 200_000

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The road's engineering with a `[PGMaps] Costs` carryover put back over what was read from
 * RoadEng's own records (`roadEngHaulFor`). A part that no longer matches (a pit or ground type
 * RoadEng no longer has, a range past the road's end) is left out and said; a result the project's
 * checks refuse is not applied.
 */
export function applyRoadEngCostCarryover(
  engineering: AlignmentEngineering,
  raw: unknown,
  options: { lengthM: number; validate?: (engineering: AlignmentEngineering) => void },
): { engineering: AlignmentEngineering; notes: string[] } {
  const notes: string[] = []
  const carry = parseRoadEngCostCarryover(raw)
  if (!carry) {
    if (raw !== null && raw !== undefined)
      notes.push("The design's [PGMaps] cost settings could not be read; RoadEng's own are used.")
    return { engineering, notes }
  }
  const inside = (r: { start: number; end: number }) => r.start >= -1e-6 && r.end <= options.lengthM + 1e-6
  const haul: HaulSettings = { ...engineering.haul }
  for (const key of ROADENG_CARRIED_HAUL_KEYS) {
    const value = carry.haul?.[key]
    if (value === undefined) continue
    if (key === 'directionRanges' || key === 'sidecastRanges') {
      const ranges = value as { start: number; end: number }[]
      const kept = ranges.filter(inside)
      if (kept.length < ranges.length)
        notes.push(
          `${ranges.length - kept.length} haul ${key === 'directionRanges' ? 'direction' : 'sidecast'} range(s) past the road's end are left out.`,
        )
      ;(haul as unknown as Record<string, unknown>)[key] = kept
    } else (haul as unknown as Record<string, unknown>)[key] = value
  }
  let missingPits = 0
  const sites = engineering.sites.map((site) => {
    const n = /^roadeng-pit-(\d+)$/.exec(site.id)?.[1]
    const extra = n === undefined ? undefined : carry.pits?.[n]
    if (!extra) return site
    return {
      ...site,
      ...(site.kind === 'waste' && extra.unitRate !== undefined ? { unitRate: extra.unitRate } : {}),
      ...(extra.sourceNotes !== undefined ? { sourceNotes: extra.sourceNotes } : {}),
    }
  })
  for (const n of Object.keys(carry.pits ?? {})) if (!sites.some((s) => s.id === `roadeng-pit-${n}`)) missingPits++
  if (missingPits)
    notes.push(
      `${missingPits} pit${missingPits === 1 ? '' : 's'} with saved costs or notes are no longer in the design.`,
    )
  // A site RoadEng could not hold keeps its id unless a pit read back now has it.
  const taken = new Set(sites.map((x) => x.id))
  const extraSites = (carry.sites ?? []).map((s, k) => {
    let id = s.id
    for (let n = k; taken.has(id); n++) id = `${s.id}-pgmaps-${n}`
    taken.add(id)
    return { ...s, id }
  })
  const placed = extraSites.filter((s) => s.chainage >= 0 && s.chainage <= options.lengthM + 1e-6)
  if (placed.length < extraSites.length)
    notes.push(`${extraSites.length - placed.length} saved site(s) past the road's end are left out.`)
  let missingMaterials = 0
  const materials = engineering.materials.map((m) => {
    const code = /^roadeng-(.+)$/.exec(m.id)?.[1]
    const extra = code === undefined ? undefined : carry.materials?.[code]
    return extra ? { ...m, ...extra } : m
  })
  for (const code of Object.keys(carry.materials ?? {}))
    if (!materials.some((m) => m.id === `roadeng-${code}`)) missingMaterials++
  if (missingMaterials)
    notes.push(
      `${missingMaterials} ground type${missingMaterials === 1 ? '' : 's'} with saved values are no longer in the design.`,
    )
  const next: AlignmentEngineering = {
    ...engineering,
    haul,
    sites: [...sites, ...placed],
    materials,
    ...(carry.surfacingSupply && !engineering.surfacingSupply ? { surfacingSupply: carry.surfacingSupply } : {}),
  }
  try {
    options.validate?.(next)
  } catch (error) {
    notes.push(
      `The design's [PGMaps] cost settings no longer fit the road (${error instanceof Error ? error.message : 'invalid'}); RoadEng's own are used.`,
    )
    return { engineering, notes }
  }
  notes.push("Costs RoadEng has no field for came back from the design's [PGMaps] section.")
  return { engineering: next, notes }
}

/** A carryover read from `[PGMaps] Costs` JSON; null when it is not one. Values are checked when applied. */
export function parseRoadEngCostCarryover(raw: unknown): RoadEngCostCarryover | null {
  const value = typeof raw === 'string' ? safeJson(raw) : raw
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null
  const v = value as Record<string, unknown>
  const object = (x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined
  const carry: RoadEngCostCarryover = { version: 1 }
  const haul = object(v.haul)
  if (haul) carry.haul = Object.fromEntries(ROADENG_CARRIED_HAUL_KEYS.filter((k) => k in haul).map((k) => [k, haul[k]]))
  const pits = object(v.pits)
  if (pits)
    carry.pits = Object.fromEntries(
      Object.entries(pits).flatMap(([k, x]) => {
        const p = object(x)
        if (!/^\d+$/.test(k) || !p) return []
        return [
          [
            k,
            {
              ...(typeof p.unitRate === 'number' ? { unitRate: p.unitRate } : {}),
              ...(typeof p.sourceNotes === 'string' ? { sourceNotes: p.sourceNotes } : {}),
            },
          ],
        ]
      }),
    )
  if (Array.isArray(v.sites)) carry.sites = v.sites.filter((x) => object(x)) as HaulSite[]
  const materials = object(v.materials)
  if (materials)
    carry.materials = Object.fromEntries(
      Object.entries(materials).flatMap(([code, x]) => {
        const m = object(x)
        return m
          ? [[code, Object.fromEntries(ROADENG_CARRIED_MATERIAL_KEYS.filter((k) => k in m).map((k) => [k, m[k]]))]]
          : []
      }),
    )
  if (object(v.surfacingSupply)) carry.surfacingSupply = v.surfacingSupply as AlignmentEngineering['surfacingSupply']
  return carry
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Up to nine decimals, no exponent below 10¹⁵, no trailing zeros. */
function out(value: number): string {
  if (!Number.isFinite(value)) return ROADENG_UNBOUNDED_TEXT
  if (Math.abs(value) >= 1e15) return value.toPrecision(12)
  const text = value.toFixed(9).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}
/** Equal within a part per million (or 10⁻⁹ near zero): float noise from unit conversions, not an edit. */
function same(a: number, b: number) {
  return Math.abs(a - b) <= 1e-6 * Math.max(1e-3, Math.abs(a), Math.abs(b))
}
/** Sets field `i` to `value` unless the field already reads as it. */
function put(f: string[], i: number, value: number) {
  while (f.length <= i) f.push('0')
  if (!same(num(f[i]), value)) f[i] = out(value)
}
const clean = (text: string) => text.replace(/[\r\n,=[\]]+/g, ' ').trim()

/** A two-character ground type code for a material PGMaps made, unique among `used`. */
function newCode(m: GroundMaterial, used: Set<string>): string {
  const words = m.name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const tries = [
    words.length > 1 ? words[0][0] + words[1][0] : '',
    (words[0] ?? '').slice(0, 2),
    ...Array.from({ length: 99 }, (_, k) => `M${k + 1}`),
  ]
  const code = tries.find((c) => c.length === 2 && !used.has(c)) ?? `X${used.size}`
  used.add(code)
  return code
}

/**
 * The road's materials, haul settings and sites as RoadEng `104` lines and `.dsn` keys. Lines and
 * keys of the original are kept, field by field, wherever PGMaps holds the same value; ground types
 * the road no longer lists are kept as read (station ranges may name them).
 */
export function roadEngHaulRecords(
  input: RoadEngHaulWriteInput,
  options: RoadEngHaulWriteOptions = {},
): RoadEngHaulRecords {
  const notes: string[] = []
  const original = options.original
  const read =
    original && (original.ds2Text !== undefined || original.dsnText !== undefined)
      ? parseRoadEngHaul(original.dsnText ?? '', original.ds2Text ?? '', {
          unitM: options.unitM,
          projectDsnText: original.projectDsnText,
        })
      : null
  const unitM = options.unitM ?? read?.unitM ?? 1
  const u = unitsOf(unitM)
  const { materials, haul, sites } = input.engineering
  // What the original reads as here: a figure equal to it was not edited, and its text is kept.
  const before = read ? roadEngHaulFromData({ ...read, pits: [] }, { startStation: 0, endStation: 0 }) : null

  // The six cost figures RoadEng keeps, from PGMaps' classes (the inverse of the import).
  const fhdKm = haul.freeHaulDistanceM / 1000
  const perVol = (v: number) => v * u.m3
  const perVolDist = (v: number) => (v * u.m3 * u.haulM) / 1000
  const desired: Record<HaulClass, RoadEngHaulLine> = {
    freehaul: { loading: perVol(haul.freeHaulLoadingRate), hauling: perVolDist(haul.freeHaulRate) },
    overhaul: {
      loading: perVol(haul.overhaulLoadingRate - haul.overhaulRate * fhdKm),
      hauling: perVolDist(haul.overhaulRate),
    },
    endhaul: {
      loading: perVol(haul.endHaulLoadingRate - haul.endHaulRate * fhdKm),
      hauling: perVolDist(haul.endHaulRate),
    },
  }
  if (desired.overhaul.loading < -1e-9 || desired.endhaul.loading < -1e-9) {
    notes.push(
      "The overhaul or endhaul loading rate is below that class's hauling over the free-haul distance, which RoadEng's cost lines cannot hold; RoadEng's loading is written as zero there.",
    )
    desired.overhaul.loading = Math.max(0, desired.overhaul.loading)
    desired.endhaul.loading = Math.max(0, desired.endhaul.loading)
  }
  const crossing = roadEngClassDistances(desired)
  const toM = (d: number) => (Number.isFinite(d) ? Math.min(MAX_HAUL_DISTANCE_M, d * u.haulM) : MAX_HAUL_DISTANCE_M)
  if (
    Math.abs(toM(crossing.freeHaul) - haul.freeHaulDistanceM) > 0.5 ||
    Math.abs(toM(crossing.overhaul) - haul.overhaulDistanceM) > 0.5
  )
    notes.push(
      `RoadEng changes haul class where its cost lines cross, at ${fmt(toM(crossing.freeHaul))} m and ${fmt(toM(crossing.overhaul))} m for these rates, not at this road's ${fmt(haul.freeHaulDistanceM)} m and ${fmt(haul.overhaulDistanceM)} m: make each class's cost equal at its distance for RoadEng to keep them.`,
    )
  const haulKeys = [
    'freeHaulDistanceM',
    'overhaulDistanceM',
    'freeHaulRate',
    'freeHaulLoadingRate',
    'overhaulRate',
    'overhaulLoadingRate',
    'endHaulRate',
    'endHaulLoadingRate',
  ] as const
  const haulChanged = !before?.read.groundTypes.length || haulKeys.some((k) => !same(before.haul[k], haul[k]))

  // Ground types.
  const originals = read?.groundTypes ?? []
  const used = new Set(originals.map((t) => t.code))
  const fillChanged =
    input.fillRate !== undefined && (before?.fillRate === null || !same(before?.fillRate ?? NaN, input.fillRate))
  if (fillChanged && before && before.fillRate === null && originals.length)
    notes.push("The fill rate is not written over RoadEng's own embankment cost for each ground type.")
  const writeFill = fillChanged && !(before && before.fillRate === null && originals.length)
  const lines: string[] = []
  const codeById = new Map<string, string>()
  let unknownQuality = 0
  const typeLine = (m: GroundMaterial | null, t: RoadEngGroundTypeRecord | null): string => {
    const f = t ? [...t.raw] : ROADENG_DEFAULT_GROUND_TYPE.split(',')
    if (m) {
      if (!t) {
        f[1] = newCode(m, used)
        f[2] = clean(m.name.replace(/^[A-Za-z0-9]{1,2} · /, '')).slice(0, 50) || f[1]
        f.splice(16, f.length - 16, '0', '0', '0', '')
      }
      codeById.set(m.id, f[1])
      if (m.fillSlope !== undefined) put(f, 3, 100 / m.fillSlope)
      if (m.cutSlope !== undefined) put(f, 4, 100 / m.cutSlope)
      put(f, 6, (num(f[5]) > 0 ? num(f[5]) : 1) / m.compactionFactor)
      put(f, 7, m.cutRate * u.m3)
      if (m.quality !== undefined) put(f, 15, Math.round((m.quality / 100) * (ROADENG_QUALITY_CLASSES - 1)))
      else if (!t) unknownQuality++
    }
    if (writeFill || (!t && input.fillRate !== undefined)) put(f, 8, input.fillRate! * u.m3)
    if (haulChanged || !t)
      CLASSES.forEach((c, k) => {
        put(f, 9 + 2 * k, desired[c].loading)
        put(f, 10 + 2 * k, desired[c].hauling)
      })
    return f.join(',')
  }
  for (const t of originals) lines.push(typeLine(materials.find((m) => m.id === roadEngMaterialId(t.code)) ?? null, t))
  for (const m of materials) if (!codeById.has(m.id)) lines.push(typeLine(m, null))
  if (!lines.some((l) => l.split(',')[1] === 'OB')) lines.unshift(typeLine(null, null))
  if (unknownQuality)
    notes.push(
      `${unknownQuality} material${unknownQuality === 1 ? '' : 's'} with no quality ${unknownQuality === 1 ? 'is' : 'are'} written in RoadEng's lowest quality class.`,
    )

  // `.dsn` keys. The mass-haul graphic is a display choice in RoadEng: it follows the road's
  // distances only where they changed.
  const dsnOverrides: Record<string, Record<string, string | null>> = {}
  const set = (sectionName: string, key: string, value: string | null) => {
    ;(dsnOverrides[sectionName] ??= {})[key] = value
  }
  const ini = original?.dsnText !== undefined ? readIni(original.dsnText) : []
  const designSection = section(ini, 'design')
  const designName = designSection?.name ?? 'design'
  const mh = designSection?.keys.get('MHlengths')
  const distancesChanged =
    !before ||
    !same(before.haul.freeHaulDistanceM, haul.freeHaulDistanceM) ||
    !same(before.haul.overhaulDistanceM, haul.overhaulDistanceM)
  if (mh === undefined || distancesChanged) {
    const value = `${out(r6(haul.freeHaulDistanceM / unitM))},${out(r6(haul.overhaulDistanceM / unitM))},${mh?.split(',')[2] ?? '0'}`
    if (mh !== value) set(designName, 'MHlengths', value)
  }
  if (!designSection?.keys.has('MHcutItems')) set(designName, 'MHcutItems', '1,SG')
  if (!designSection?.keys.has('MHfillItems')) set(designName, 'MHfillItems', '0,SG')

  // Pits, in the vertical option they were read from.
  const target = read?.costSection?.section ?? 'OptAlignCost-0'
  const targetKeys = ini.find((s) => s.name === target)?.keys
  const start = options.startStation ?? 0,
    scale = options.stationScale ?? 1
  const offRoad = (p: RoadEngPit) =>
    options.endStation !== undefined &&
    (p.station * unitM < start - 1e-6 || p.station * unitM > options.endStation + 1e-6)
  const factorOf = (id: string | undefined) => materials.find((m) => m.id === id)?.compactionFactor ?? 1
  const pitLine = (s: HaulSite, p: RoadEngPit | null): string => {
    const f = p ? [...p.raw] : ['0', '0', '0', '0', '0', '0', ' ', ' ', '0', '0', '0', '0']
    while (f.length < 12) f.push('0')
    put(f, 0, (start + s.chainage / scale) / unitM)
    put(f, 1, s.accessDistanceM / unitM)
    const factor = s.kind === 'borrow' ? factorOf(s.materialId) : 1
    if (s.kind === 'borrow') put(f, 2, s.unitRate * factor * u.m3)
    put(f, 3, s.fixedCost)
    if (s.capacityM3 === null) {
      if (!(num(f[4]) >= ROADENG_UNBOUNDED_VOLUME)) f[4] = ROADENG_UNBOUNDED_TEXT
    } else put(f, 4, s.capacityM3 / factor / u.m3)
    f[5] = s.kind === 'borrow' ? '1' : '0'
    const label = clean(s.name)
    const generated = !p?.identifier && /^(Borrow|Waste) pit at /.test(s.name)
    if (!generated && clean(p?.identifier ?? '') !== label) f[6] = label || ' '
    if (s.kind === 'borrow') {
      const code = s.materialId ? codeById.get(s.materialId) : undefined
      if (code && code !== p?.materialCode) f[7] = code
      // A material the road holds was taken off the site; one it never held stays as read.
      else if (!s.materialId && p?.materialCode && codeById.has(roadEngMaterialId(p.materialCode))) f[7] = ' '
    }
    if (!p) {
      const level = options.levelAt?.(s.chainage)
      f[10] = level !== null && level !== undefined && Number.isFinite(level) ? out(r6(level / unitM)) : '0'
    }
    return f.join(',')
  }
  const pitValues: string[] = []
  // The site each written pit holds, by its place: the pit a re-read names `roadeng-pit-<n>`.
  const pitSites: (HaulSite | null)[] = []
  const placed = new Set<string>()
  for (const p of read?.pits ?? []) {
    const site = sites.find((s) => s.id === `roadeng-pit-${p.index}`)
    if (site && site.enabled !== false) {
      pitValues.push(pitLine(site, p))
      pitSites.push(site)
      placed.add(site.id)
    } else if (!site && offRoad(p)) {
      pitValues.push(p.raw.join(','))
      pitSites.push(null)
    }
  }
  let disabled = 0,
    over = 0
  const unplaced: HaulSite[] = []
  for (const s of sites) {
    if (placed.has(s.id)) continue
    if (s.enabled === false) {
      disabled++
      unplaced.push(s)
    } else if (pitValues.length >= MAX_ROADENG_PITS) {
      over++
      unplaced.push(s)
    } else {
      pitValues.push(pitLine(s, null))
      pitSites.push(s)
    }
  }
  if (disabled)
    notes.push(
      `${disabled} switched-off site${disabled === 1 ? ' is' : 's are'} left out of RoadEng's pits, which have no off switch.`,
    )
  if (over) notes.push(`${over} site${over === 1 ? '' : 's'} past RoadEng's ${MAX_ROADENG_PITS} pits left out of them.`)
  if (pitValues.length && !targetKeys) notes.push("Pits are written into RoadEng's first vertical option.")
  const existing = new Map<string, string>()
  for (const [k, v] of targetKeys ?? []) if (PIT_KEY.test(k)) existing.set(k, v)
  pitValues.forEach((value, k) => {
    const key = `OptParms_Pit-${k}`
    if (existing.get(key) !== value) set(target, key, value)
    existing.delete(key)
  })
  for (const key of existing.keys()) set(target, key, null)
  if (pitValues.length && !ini.some((s) => s.name === 'OptAlignCost')) set('OptAlignCost', 'nOptCostParameters', '1,0')

  // What RoadEng has no field for travels in the design's [PGMaps] section (`RoadEngCostCarryover`).
  const carry: RoadEngCostCarryover = { version: 1 }
  const carried: string[] = []
  const haulExtra = Object.fromEntries(
    ROADENG_CARRIED_HAUL_KEYS.filter(
      (k) =>
        haul[k] !== undefined &&
        !sameJson(haul[k], DEFAULT_HAUL_SETTINGS[k]) &&
        !(Array.isArray(haul[k]) && !(haul[k] as unknown[]).length),
    ).map((k) => [k, haul[k]]),
  )
  if (Object.keys(haulExtra).length) carry.haul = haulExtra
  if (haul.wasteRate > 0 || sites.some((s) => s.kind === 'waste' && s.unitRate > 0))
    carried.push('waste disposal rates')
  if (haul.borrowRate > 0) carried.push('the default borrow rate')
  if (haul.mobilizationCost > 0 || haul.contingencyPercent > 0) carried.push('mobilization and contingency')
  if (haul.allocation === 'economic' || haul.siteSelection === 'delivered-cost') carried.push('economic allocation')
  if (haul.directionRanges?.length || haul.sidecastRanges?.length) carried.push('haul directions and sidecast ranges')
  const pits: NonNullable<RoadEngCostCarryover['pits']> = {}
  pitSites.forEach((site, k) => {
    if (!site) return
    const extra = {
      ...(site.kind === 'waste' && site.unitRate > 0 ? { unitRate: site.unitRate } : {}),
      ...(site.sourceNotes ? { sourceNotes: site.sourceNotes } : {}),
    }
    if (Object.keys(extra).length) pits[String(k)] = extra
  })
  if (Object.keys(pits).length) carry.pits = pits
  if (sites.some((s) => s.sourceNotes)) carried.push('site notes')
  if (unplaced.length) {
    carry.sites = unplaced
    carried.push(disabled ? 'switched-off sites' : 'sites past the pit limit')
  }
  // A material's values a plain read of its ground type would not give (`roadEngMaterialsFor`).
  const materialExtras: NonNullable<RoadEngCostCarryover['materials']> = {}
  const order = lines.map((l) => l.split(',')[1])
  for (const m of materials) {
    const code = codeById.get(m.id)
    if (!code) continue
    const index = order.indexOf(code)
    const extra: Partial<Pick<GroundMaterial, CarriedMaterialKey>> = {}
    if (m.color !== ROADENG_MATERIAL_COLORS[index % ROADENG_MATERIAL_COLORS.length]) extra.color = m.color
    if (m.reusableFraction !== 1) extra.reusableFraction = m.reusableFraction
    if (m.purpose !== undefined && m.purpose !== 'earthwork') extra.purpose = m.purpose
    if (m.rock) extra.rock = true
    if (m.shallowCutRate !== undefined) extra.shallowCutRate = m.shallowCutRate
    if (m.overbreakRate !== undefined) extra.overbreakRate = m.overbreakRate
    if (Object.keys(extra).length) materialExtras[code] = extra
  }
  if (Object.keys(materialExtras).length) carry.materials = materialExtras
  if (materials.some((m) => m.rock))
    notes.push(
      "Rock materials are not marked Bedrock in RoadEng: that field's place in its ground types is not known. The rock marking travels in the design's [PGMaps] section.",
    )
  if (materials.some((m) => m.reusableFraction < 1 || m.purpose === 'stripping'))
    carried.push('reusable fractions and stripping materials')
  if (materials.some((m) => m.shallowCutRate !== undefined || m.overbreakRate !== undefined))
    carried.push('shallow-rock and overbreak rates')
  if (input.engineering.surfacingSupply) {
    carry.surfacingSupply = input.engineering.surfacingSupply
    carried.push('the gravel source')
  }
  const pgmaps: Record<string, string> = {}
  if (Object.keys(carry).length > 1) {
    const json = JSON.stringify(carry)
    if (json.length <= MAX_ROADENG_CARRYOVER_CHARS) pgmaps.Costs = json
    else
      notes.push(
        `The cost settings RoadEng has no field for are over ${MAX_ROADENG_CARRYOVER_CHARS.toLocaleString('en-CA')} characters and are not written.`,
      )
  }
  if (carried.length && pgmaps.Costs) {
    const list = carried.join(', ')
    const one = carried.length === 1
    notes.push(
      `${list[0].toUpperCase()}${list.slice(1)}: RoadEng has no field for ${one ? 'this' : 'these'}, so ${one ? 'it travels' : 'they travel'} in the design's [PGMaps] section and ${one ? 'comes' : 'come'} back when it is opened here.`,
    )
  }
  if (materials.some((m) => m.shallowCutRate !== undefined || m.overbreakRate !== undefined))
    notes.push('Shallow-rock and overbreak rates: RoadEng has one excavation cost per ground type.')
  return { recordOverrides: { '104': lines }, dsnOverrides, pgmaps, notes: dedupe(notes) }
}

function dedupe(items: string[]) {
  return [...new Set(items)]
}
