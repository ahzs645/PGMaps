/**
 * How the appraisal manual in force for a project treats one culvert: inside the road's subgrade
 * allowance, a separate allowance from the manual's table, or an engineered cost estimate.
 *
 * This is evidence read beside the estimate. It never prices the culvert, never replaces its
 * installed cost and never enters a total: a pipe "inside the subgrade allowance" still costs money
 * to build. The rules are data (`appraisalPacks.ts`); this file only applies them.
 *
 * Free of DOM and network access.
 */
import { BC_COST_REGIONS } from '../bcCostReferences'
import { regionLocalId, regionScheme, type CostPlace } from '../costPlaces/places'
import type { Culvert } from '../engineeringTypes'
import {
  BC_COAST_2026,
  BC_INTERIOR_2026,
  type CulvertAppraisalPack,
  type InstalledByLengthTable,
  type PerMetreTable,
} from './appraisalPacks'
import { CULVERT_SHAPES, culvertBarrels, culvertShapeOf, type CulvertShape } from './culvertShape'

export type AppraisalTreatmentKind = 'in-subgrade' | 'table' | 'engineered-estimate' | 'not-determined'

export const APPRAISAL_TREATMENT_LABELS: Record<AppraisalTreatmentKind, string> = {
  'in-subgrade': 'In the subgrade allowance',
  table: 'Table allowance',
  'engineered-estimate': 'Engineered estimate',
  'not-determined': 'Not determined',
}

/** A size or length within this of a table entry is that entry. */
const ENTRY_TOLERANCE_M = 0.0005
/** A threshold is crossed only past this margin, so a 1.8 m pipe carried as 1.8000000001 stays in the table. */
const THRESHOLD_TOLERANCE_M = 1e-6

export interface CulvertAppraisalInput {
  shape: CulvertShape
  /** Round pipe diameter, m; another shape's rise. */
  diameterM: number
  barrels: number
  /** A closed-bottom culvert with a streambed built inside it. */
  embedded: boolean
  /** The pipe length the allowance is read at, m. */
  lengthM: number
  /** Where `lengthM` came from: the inclined barrel, or the horizontal span while inverts are missing. */
  lengthBasis: 'barrel' | 'span'
}

export interface AppraisalTableCell {
  diameterM: number
  /** Null for a per-metre table. */
  lengthM: number | null
  amountCad: number
}

export interface CulvertAppraisalTreatment {
  kind: AppraisalTreatmentKind
  packId: CulvertAppraisalPack['id']
  /** "Interior Appraisal Manual, effective 1 July 2026". */
  manual: string
  /** One line a schedule can print: "Table 4-3, Part A: $6,728 installed (1.2 m × 12 m)". */
  summary: string
  /** Each rule that decided the treatment, in the order it applied. */
  reasons: string[]
  locator: string
  /**
   * The published allowance, where exactly one table entry applies. An appraisal figure on the
   * manual's cost base, never a construction price.
   */
  allowanceCad: number | null
  /**
   * The lowest and highest neighbouring entries where the diameter or length falls between two:
   * the manual does not interpolate, so no single figure is given.
   */
  between: { lowCad: number; highCad: number; cells: AppraisalTableCell[] } | null
  /** What the reader still has to supply or confirm for this treatment. */
  toConfirm: string[]
}

const WHOLE = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const money = (value: number) => '$' + WHOLE.format(value)
const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

/** Index of the entry equal to `value`, or the entries either side of it (either may be absent). */
function locate(
  entries: readonly number[],
  value: number,
): { at: number } | { below: number | null; above: number | null } {
  const at = entries.findIndex((entry) => Math.abs(entry - value) <= ENTRY_TOLERANCE_M)
  if (at >= 0) return { at }
  let below: number | null = null,
    above: number | null = null
  entries.forEach((entry, index) => {
    if (entry < value) below = index
    else if (above === null) above = index
  })
  return { below, above }
}
const indexes = (found: ReturnType<typeof locate>): number[] =>
  'at' in found ? [found.at] : [found.below, found.above].filter((index): index is number => index !== null)

function installedByLength(table: InstalledByLengthTable, input: CulvertAppraisalInput): AppraisalTableCell[] {
  const cells: AppraisalTableCell[] = []
  for (const row of indexes(locate(table.lengthsM, input.lengthM)))
    for (const column of indexes(locate(table.diametersM, input.diameterM)))
      cells.push({
        diameterM: table.diametersM[column],
        lengthM: table.lengthsM[row],
        amountCad: table.installedCad[row][column],
      })
  return cells
}
function perMetre(table: PerMetreTable, input: CulvertAppraisalInput): AppraisalTableCell[] {
  return indexes(locate(table.diametersM, input.diameterM)).map((column) => ({
    diameterM: table.diametersM[column],
    lengthM: null,
    amountCad: table.installedPerMCad[column] * input.lengthM,
  }))
}

/** What the appraisal reads from a culvert: its opening and the pipe length. */
export function culvertAppraisalInput(
  culvert: Pick<Culvert, 'diameterM' | 'lengthM' | 'shape' | 'barrels' | 'embedmentM'>,
  barrelLengthM: number | null | undefined,
  embeddedStructure = false,
): CulvertAppraisalInput {
  return {
    shape: culvertShapeOf(culvert),
    diameterM: culvert.diameterM,
    barrels: culvertBarrels(culvert),
    embedded: embeddedStructure || (culvert.embedmentM ?? 0) > 0,
    lengthM: barrelLengthM ?? culvert.lengthM,
    lengthBasis: barrelLengthM === null || barrelLengthM === undefined ? 'span' : 'barrel',
  }
}

export function culvertAppraisalTreatment(
  input: CulvertAppraisalInput,
  pack: CulvertAppraisalPack,
): CulvertAppraisalTreatment {
  const manual = `${pack.manual}, ${pack.edition}`
  const size = `${trim(input.diameterM, 3)} m × ${trim(input.lengthM)} m`
  const toConfirm: string[] = []
  if (input.lengthBasis === 'span') toConfirm.push('Pipe length is the horizontal span until both inverts are entered.')
  const base = { packId: pack.id, manual, allowanceCad: null, between: null, toConfirm }
  // `causes` name the triggers in a few words for the one-line summary; `reasons` state each in full.
  const engineered = (causes: string[], reasons: string[], locator: string): CulvertAppraisalTreatment => ({
    ...base,
    kind: 'engineered-estimate',
    summary: `Engineered cost estimate (${causes.join(', ')})`,
    reasons,
    locator,
    toConfirm: [
      ...toConfirm,
      ...(pack.engineeredScope.length
        ? [`An estimate may hold: ${pack.engineeredScope.join('; ').toLowerCase()} (${pack.engineeredScopeLocator}).`]
        : []),
    ],
  })

  // 1. Installations that are engineered estimates at any size.
  const special: string[] = [],
    specialCauses: string[] = []
  const shapeLabel = CULVERT_SHAPES.find((shape) => shape.value === input.shape)!.label.toLowerCase()
  if (input.shape !== 'round' && pack.special?.shapes.includes(input.shape)) {
    special.push(`A ${shapeLabel} is a special structure.`)
    specialCauses.push(shapeLabel)
  }
  if (input.barrels > 1 && pack.special?.multipleBarrels) {
    special.push(`${input.barrels} barrels at one site are a multiple-culvert installation, a special structure.`)
    specialCauses.push(`${input.barrels} barrels`)
  }
  if (input.embedded && pack.special?.embedded) {
    special.push('An embedded culvert needs a detailed embedment design at any diameter.')
    specialCauses.push('embedded')
  }
  if (special.length) return engineered(specialCauses, special, pack.special!.locator)

  // 2. A manual whose treatment of this installation was not read decides nothing about it.
  if (!pack.special && (input.shape !== 'round' || input.barrels > 1 || input.embedded)) {
    const what = [
      input.shape !== 'round' ? `a ${shapeLabel}` : '',
      input.barrels > 1 ? 'more than one barrel' : '',
      input.embedded ? 'an embedded culvert' : '',
    ].filter(Boolean)
    return {
      ...base,
      kind: 'not-determined',
      summary: `Not determined: ${pack.tableName} lists single round pipes`,
      reasons: [
        `${pack.tableName} lists single round pipes, and the ${pack.short} manual's treatment of ${what.join(' with ')} was not read.`,
      ],
      locator: pack.tableLocator,
      toConfirm: [...toConfirm, 'Confirm the treatment with the manual or the district.'],
    }
  }

  // 3. Size and length past the table.
  const over: string[] = [],
    overCauses: string[] = []
  if (input.diameterM > pack.engineeredAboveDiameterM + THRESHOLD_TOLERANCE_M) {
    over.push(`Diameter ${trim(input.diameterM, 3)} m is larger than ${trim(pack.engineeredAboveDiameterM)} m.`)
    overCauses.push(`over ${trim(pack.engineeredAboveDiameterM)} m in diameter`)
  }
  if (pack.engineeredAboveLengthM !== null && input.lengthM > pack.engineeredAboveLengthM + THRESHOLD_TOLERANCE_M) {
    over.push(`Length ${trim(input.lengthM)} m is longer than ${trim(pack.engineeredAboveLengthM)} m, at any diameter.`)
    overCauses.push(`over ${trim(pack.engineeredAboveLengthM)} m long`)
  }
  if (over.length) return engineered(overCauses, over, pack.engineeredLocator)

  // 4. Small pipes the road allowance already holds.
  if (pack.inSubgradeBelowDiameterM !== null && input.diameterM < pack.inSubgradeBelowDiameterM - THRESHOLD_TOLERANCE_M)
    return {
      ...base,
      kind: 'in-subgrade',
      summary: `In the subgrade allowance: no separate culvert allowance (${size})`,
      reasons: [
        `A pipe under ${trim(pack.inSubgradeBelowDiameterM * 1000, 0)} mm is part of the tabular subgrade allowance.`,
      ],
      locator: pack.inSubgradeLocator,
      toConfirm: [
        ...toConfirm,
        'Applies where the road is costed from the tabular subgrade allowance; inside a road’s own engineered estimate the pipe is itemized.',
      ],
    }

  // 5. The table.
  const cells =
    pack.table.kind === 'installed-by-length' ? installedByLength(pack.table, input) : perMetre(pack.table, input)
  const evidence = 'Field evidence has to show the structure is needed.'
  if (cells.length === 1 && isEntry(pack, input))
    return {
      ...base,
      kind: 'table',
      summary:
        pack.table.kind === 'installed-by-length'
          ? `${pack.tableName}: ${money(cells[0].amountCad)} installed (${size})`
          : `${pack.tableName}: ${money(cells[0].amountCad)} installed (${trim(input.diameterM, 3)} m at ${money(cells[0].amountCad / input.lengthM)}/m × ${trim(input.lengthM)} m)`,
      reasons: [tableReason(pack)],
      locator: pack.tableLocator,
      allowanceCad: cells[0].amountCad,
      toConfirm: [...toConfirm, evidence],
    }
  const amounts = cells.map((cell) => cell.amountCad)
  const lowCad = Math.min(...amounts),
    highCad = Math.max(...amounts)
  return {
    ...base,
    kind: 'table',
    summary:
      lowCad === highCad
        ? `${pack.tableName}: nearest entry ${money(lowCad)}; ${size} is not an entry`
        : `${pack.tableName}: between entries, ${money(lowCad)} to ${money(highCad)} (${size})`,
    reasons: [tableReason(pack), `${size} is not an entry of the table. ${pack.betweenEntries}`],
    locator: pack.tableLocator,
    between: cells.length ? { lowCad, highCad, cells } : null,
    toConfirm: [...toConfirm, 'Confirm which table entry the appraisal uses.', evidence],
  }
}

/** Whether the diameter, and the length where the table has lengths, are entries of the table. */
function isEntry(pack: CulvertAppraisalPack, input: CulvertAppraisalInput): boolean {
  if (!('at' in locate(pack.table.diametersM, input.diameterM))) return false
  return pack.table.kind === 'per-metre' || 'at' in locate(pack.table.lengthsM, input.lengthM)
}

function tableReason(pack: CulvertAppraisalPack): string {
  const from = pack.inSubgradeBelowDiameterM ?? pack.table.diametersM[0]
  const length = pack.engineeredAboveLengthM === null ? '' : ` up to ${trim(pack.engineeredAboveLengthM)} m long`
  return `A pipe of ${trim(from, 3)} m to ${trim(pack.engineeredAboveDiameterM)} m${length} is costed from ${pack.tableName}.`
}

export interface AppraisalPackChoice {
  pack: CulvertAppraisalPack
  /** Why this manual: the project's cost region, or the default where none is set. */
  basis: string
}

/**
 * The appraisal manual a project's cost location points to. A BC location with no region, and a
 * project with no location, read the Interior manual and say that it is a default. A location
 * outside BC has no appraisal rules here.
 */
export function appraisalPackForPlace(place: CostPlace | undefined): AppraisalPackChoice | null {
  if (!place)
    return { pack: BC_INTERIOR_2026, basis: 'No cost location is set: the Interior manual is shown by default.' }
  if (place.country !== 'CA' || place.subdivision !== 'CA-BC') return null
  const region =
    place.region && regionScheme(place.region) === 'bc-nr'
      ? BC_COST_REGIONS.find((item) => item.id === regionLocalId(place.region!))
      : undefined
  if (!region)
    return { pack: BC_INTERIOR_2026, basis: 'No BC cost region is set: the Interior manual is shown by default.' }
  if (region.method === 'coast') return { pack: BC_COAST_2026, basis: `${region.name} is a Coast appraisal region.` }
  return {
    pack: BC_INTERIOR_2026,
    basis:
      region.method === 'mixed'
        ? `${region.name} spans both manuals: the Interior manual is shown. Confirm which applies to this road.`
        : `${region.name} is an Interior appraisal region.`,
  }
}
