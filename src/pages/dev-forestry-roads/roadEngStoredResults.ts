/**
 * The results a RoadEng / Location design stores in itself, read so they can be set beside the
 * road's own without exporting anything from RoadEng (`softreeCompare.ts`,
 * `compareRoadEngDesignResults`).
 *
 * What a design holds, from Softree's samples (LongRoad, the cul-de-sac, Align_stage_1):
 *
 * - `.ds2` `110` records: the centreline's x, y, level and station at every calculated station.
 *   The import already sets the rebuilt plan and profile against every one (`roadEngImport.ts`,
 *   `RoadEngChecks`) and keeps only the first and last, so they are not read again here.
 * - `.dsn` `[OptAlignCost-k]`, one per vertical alignment option: `OptParms_CostSolution_v3`, the
 *   last costing of that vertical alignment, and `OptParms_FullSolution_v3`, laid out alike and
 *   unsolved in every sample. Fourteen fields: status (2 when solved; 0 or −9999 when not), two
 *   zeros, the first and last station costed (project units), then five costs in the design's
 *   currency, the solve time (s), a Unix time stamp, −1, and 0 or 1.
 * - `[OptAlignCost] OptCostSpacing`: the costing's section spacing (project units); a negative value
 *   is not a spacing (RoadEng's Auto) and is not reported.
 * - Nothing else: `.ds1` holds no results, `118` is a lone flag, and `[status]`, `[data]` and the
 *   reporting-area keys (`CostDispItems`) are display settings.
 *
 * The five costs are haul, cut, fill, pit opening and attributes, the columns of RoadEng's Optimal
 * Haul cost summary in that order ("Haul, Cut, Fill, Pit Opening, Attributes", Softree Optimal
 * manual, chapter 6). Haul, cut and fill are confirmed: Hart Rd (Softree's V10 Optimal tutorial)
 * stores 34,551.89, 384,040.47 and 56,386.42 at 5 m spacing, and the manual's spacing table
 * (chapter 3, Table 3-1) prints 34.56, 384.04 and 56.39 thousand for haul, cut and fill at 5 m, with
 * their sum as the total. RoadEng's cut includes the excavation of borrowed material, underflow
 * included (the same chapter: removing Hart Rd's rock pit changes the excavation cost, because
 * underflow is priced from the ground type table), and fill is each ground type's embankment cost
 * (`fillPlacement.ts`). All eleven costed designs (LongRoad, the cul-de-sac, Align stages 4, 7, 8
 * and 8a, bluff road ×2, Hart Rd ×4, Location 18 ×3; `roadEngCostedSamples.test.ts`) have status
 * 2, zeros in fields 1 and 2, −1 in field 12, and haul, cut and fill above zero. Still inferred:
 * pit opening (field 8) is 0 in every sample and every sample's pits have no site preparation
 * cost, so no sample shows it non-zero; attributes (field 9) is 0 in the RoadEng 11 designs and no
 * value (−9999) in the version 10 tutorials, never non-zero. Softree's complete public V9, V10 and
 * V11 tutorial sets and knowledge-base examples (`roadEngHuntSamples.test.ts` under `ROADENG_HUNT`)
 * add more than fifty solved costings and the same picture: every `OptParms_Pit-n` has site
 * preparation 0 (the Optimal tutorial's chapter 7, which types $10,000 on three pits, ends without
 * saving), and the two costed designs with an attribute table (`[AttribMastertable]`) list report
 * columns only (ditch elevations, a user column) and store 0 or no value. The time stamp is read as seconds since
 * 1970 (UTC), which dates each sample's solution to its RoadEng version (2015–2024); RoadEng 10
 * writes small counts there in unsolved slots. Field 13 (0 or 1; 1 in LongRoad and Location 18) and
 * fields 1, 2 and 12 are kept as read and not used.
 *
 * Reading never touches the project, and nothing here is written: the `.dsn` goes back to RoadEng
 * as read (`roadEngProjectExport.ts`), where RoadEng shows the solution greyed out once the design
 * changes. Checked by `roadEngStoredResults.test.ts`, with Softree's samples when `ROADENG_SAMPLES`
 * is set. Pure: no DOM or network access.
 */

import { ROADENG_UNITS } from './roadEngUnits'

/** The two solution keys of a vertical option, and what each is. */
export const ROADENG_SOLUTION_KEYS = {
  costing: 'OptParms_CostSolution_v3',
  optimization: 'OptParms_FullSolution_v3',
} as const
export type RoadEngSolutionKind = keyof typeof ROADENG_SOLUTION_KEYS
/** Status field value of a solved solution. */
export const ROADENG_SOLVED_STATUS = 2
/** RoadEng's "no value". */
const NO_VALUE = -9999
/** Vertical options read from one design. */
export const MAX_ROADENG_COST_OPTIONS = 100

const UNITS = ROADENG_UNITS

export interface RoadEngStoredCosts {
  haul: number | null
  cut: number | null
  fill: number | null
  pitOpening: number | null
  attributes: number | null
}

export interface RoadEngCostSolution {
  /** The `[OptAlignCost-k]` section. */
  section: string
  /** The vertical option's name (`OptParmsNew` field 31), when it has one. */
  option: string | null
  /** The option RoadEng names first in `OptParmsRefAlign`: the vertical alignment the road was read from. */
  active: boolean
  kind: RoadEngSolutionKind
  /** First and last station costed, m. */
  fromStationM: number | null
  toStationM: number | null
  /** In the design's currency, as stored. */
  costs: RoadEngStoredCosts
  /** The five costs added up (missing ones left out). */
  total: number
  seconds: number | null
  /** When RoadEng solved it, ISO 8601 UTC; null when the stamp is missing. */
  solvedAt: string | null
  raw: string[]
}

export interface RoadEngStoredResults {
  /** Metres per project unit. */
  unitM: number
  /** Solved solutions only, in section order. */
  solutions: RoadEngCostSolution[]
  /** The costing's section spacing, m; null when RoadEng chose it (Auto) or the key is absent. */
  spacingM: number | null
  /** The active vertical option's name, when the design names one. */
  activeOption: string | null
  /** Vertical options whose solutions are present but not solved. */
  unsolved: string[]
  warnings: string[]
}

interface IniSection {
  name: string
  keys: Map<string, string>
}
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
const num = (text: string | undefined) => (text === undefined || text.trim() === '' ? NaN : Number(text))
const value = (text: string | undefined) => {
  const v = num(text)
  return Number.isFinite(v) && v !== NO_VALUE ? v : null
}

/** Metres per project unit for a design's `[design] units` code; null for a code not known. */
export function roadEngUnitMOfCode(code: string | undefined): number | null {
  return code === undefined ? null : (UNITS[code.trim()] ?? null)
}

/** The solved cost solutions a design's `.dsn` stores, every vertical option's. */
export function readRoadEngStoredResults(dsnText: string, unitM: number): RoadEngStoredResults {
  const warnings: string[] = []
  const ini = readIni(dsnText)
  const sections = ini.filter((s) => /^OptAlignCost-\d+$/.test(s.name))
  if (sections.length > MAX_ROADENG_COST_OPTIONS)
    warnings.push(`Vertical options past ${MAX_ROADENG_COST_OPTIONS} are not read.`)
  const nameOf = (s: IniSection) => s.keys.get('OptParmsNew')?.split(',')[31]?.trim() || null
  const activeOption = sections[0]?.keys.get('OptParmsRefAlign')?.split(',')[0]?.trim() || null
  const solutions: RoadEngCostSolution[] = []
  const unsolved: string[] = []
  for (const s of sections.slice(0, MAX_ROADENG_COST_OPTIONS)) {
    const option = nameOf(s)
    for (const kind of ['costing', 'optimization'] as const) {
      const text = s.keys.get(ROADENG_SOLUTION_KEYS[kind])
      if (text === undefined) continue
      const f = text.split(',')
      if (num(f[0]) !== ROADENG_SOLVED_STATUS) {
        if (kind === 'costing') unsolved.push(option ?? s.name)
        continue
      }
      const costs: RoadEngStoredCosts = {
        haul: value(f[5]),
        cut: value(f[6]),
        fill: value(f[7]),
        pitOpening: value(f[8]),
        attributes: value(f[9]),
      }
      if (costs.haul === null && costs.cut === null && costs.fill === null) {
        warnings.push(`${option ?? s.name}: a solution with no costs is left out (${text.slice(0, 80)}).`)
        continue
      }
      const from = value(f[3]),
        to = value(f[4]),
        stamp = value(f[11]),
        seconds = value(f[10])
      solutions.push({
        section: s.name,
        option,
        active: activeOption !== null && option === activeOption,
        kind,
        fromStationM: from === null ? null : from * unitM,
        toStationM: to === null ? null : to * unitM,
        costs,
        total: Object.values(costs).reduce<number>((sum, v) => sum + (v ?? 0), 0),
        seconds: seconds !== null && seconds >= 0 ? seconds : null,
        solvedAt: stamp !== null && stamp > 0 && stamp < 1e11 ? new Date(stamp * 1000).toISOString() : null,
        raw: f,
      })
    }
  }
  // A design with one option and no name for it: that option is the active one.
  if (!solutions.some((s) => s.active) && sections.length === 1)
    for (const s of solutions) if (s.section === sections[0].name) s.active = true
  const spacing = num(
    ini
      .find((s) => s.name === 'OptAlignCost')
      ?.keys.get('OptCostSpacing')
      ?.split(',')[0],
  )
  return {
    unitM,
    solutions,
    spacingM: Number.isFinite(spacing) && spacing > 0 ? spacing * unitM : null,
    activeOption,
    unsolved,
    warnings,
  }
}

/** The active vertical option's costing, else its optimization; null when it has neither solved. */
export function activeRoadEngSolution(results: RoadEngStoredResults): RoadEngCostSolution | null {
  const active = results.solutions.filter((s) => s.active)
  return active.find((s) => s.kind === 'costing') ?? active[0] ?? null
}

/** A stored road part (`RoadEngSource`) as stored results; null when it holds no `.dsn` or its units are not known. */
export function storedResultsOfSource(
  source: { dsn: string; unitCode: string } | null | undefined,
): RoadEngStoredResults | null {
  if (!source?.dsn) return null
  const unitM = roadEngUnitMOfCode(source.unitCode)
  return unitM === null ? null : readRoadEngStoredResults(source.dsn, unitM)
}

const money = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const metres = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

/** "2024-05-22 16:53 UTC" */
export function solvedAtText(iso: string | null): string | null {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : null
}

/** A vertical option in words: its name in quotes, else its place in the design (`OptAlignCost-0` is 1). */
export function roadEngOptionLabel(solution: Pick<RoadEngCostSolution, 'option' | 'section'>): string {
  if (solution.option) return `"${solution.option}"`
  const n = /-(\d+)$/.exec(solution.section)?.[1]
  return n === undefined ? solution.section : String(Number(n) + 1)
}

/** What the solution is, in words: option, stations costed, when, spacing. */
export function roadEngSolutionText(solution: RoadEngCostSolution, results: Pick<RoadEngStoredResults, 'spacingM'>) {
  const what = solution.kind === 'costing' ? 'costing' : 'optimization'
  const range =
    solution.fromStationM !== null && solution.toStationM !== null
      ? ` over stations ${metres.format(solution.fromStationM)}–${metres.format(solution.toStationM)} m`
      : ''
  const when = solvedAtText(solution.solvedAt)
  const spacing = results.spacingM !== null && solution.kind === 'costing' ? ` at ${results.spacingM} m spacing` : ''
  return `RoadEng's last ${what} of vertical alignment ${roadEngOptionLabel(solution)}${range}${spacing}${when ? `, solved ${when}` : ''}`
}

/**
 * One sentence for the import notice: what the design stores and where it is compared; null when
 * it stores no solved costing of the active vertical alignment.
 */
export function roadEngStoredResultsNote(roadName: string, results: RoadEngStoredResults): string | null {
  const solution = activeRoadEngSolution(results)
  if (!solution) return null
  const c = solution.costs
  const parts = (
    [
      ['haul', c.haul],
      ['cut', c.cut],
      ['fill', c.fill],
      ['pit opening', c.pitOpening],
      ['attributes', c.attributes],
    ] as const
  )
    .filter(([k, v]) => v !== null && !((k === 'pit opening' || k === 'attributes') && v === 0))
    .map(([k, v]) => `${k} ${money.format(v!)}`)
  return `${roadName}: the design stores ${roadEngSolutionText(solution, results)}: ${parts.join(', ')}; total ${money.format(solution.total)}, in the design's currency. Compare with RoadEng… sets these beside the road's own costs.`
}
