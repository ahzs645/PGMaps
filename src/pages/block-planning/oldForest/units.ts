/**
 * The 2004 order's old forest units (Map 2, Tables 1 to 6), each with the age that counts as old
 * (implementation policy p. 1), the non-pine minimum (policy Tables 8 to 10) and the Board's 2019
 * figures for it (FPB/IRC/235 Appendix 1, from the 2019 LLOWG analysis).
 *
 * The order's tables are the targets. DataBC's legal layer carries its own `OLD_RETEN` for each
 * polygon; where it disagrees with the order (A10: 0.12 against Table 3's 17%), the order wins and
 * the disagreement is reported (`gisDisagrees`). See docs/forestry-old-forest.md, decision 1.
 *
 * DOM- and network-free.
 */
import order from '../../../../packages/legal-rules/rules/bc/prince-george/2004-biodiversity-order.json'
import board from '../../../../packages/legal-rules/observations/fpb-irc-235.json'

export interface BoardOldForest2019 {
  cflbHa: number
  minimumAge: number
  requiredOldHa: number
  oldHa: number
  requiredInteriorHa: number
  interiorHa: number
}

export interface OldForestUnit {
  district: string
  unit: string
  ndu: string
  becAsPrinted: string
  /** Minimum percent of the CFLB retained as old forest (Tables 1 to 3). */
  oldPercent: number
  /** Minimum percent of the required old forest that must be interior (Tables 4 to 6). */
  interiorPercent: number
  /** Minimum percent of the CFLB retained as old non-pine-leading forest (policy Tables 8 to 10), where stated. */
  nonPinePercent: number | null
  /** A stand counts as old from this age (older than 120 or 140 years). */
  oldFromAge: number
  /** Why `oldFromAge` is what it is. */
  ageBasis: string
  board2019: BoardOldForest2019 | null
}

export const DISTRICT_ORG_CODES: Record<string, string> = {
  'Fort St. James': 'DJA',
  'Prince George': 'DPG',
  Vanderhoof: 'DVA',
}

/**
 * The policy (p. 1) defines old as older than 140 years, and older than 120 in Moist Interior –
 * Plateau (all variants), Omineca Valley SBS dk, SBS dw3, BWBS dk1, SBS mc2 and SBS mk1, and McGregor
 * Plateau SBS mk1 and SBS mh. Its footnote leaves the ICH undecided; the LLOWG and the Board used
 * 140 there (A22, A23, E13), and so does this (decision 4).
 */
export function oldAgeRule(unit: { ndu: string; becAsPrinted: string }): { age: number; basis: string } {
  const ndu = unit.ndu.toLowerCase().replace(/[–-]/g, '-')
  const becs = unit.becAsPrinted
    .toLowerCase()
    .split(',')
    .map((b) => b.replace(/\s+/g, ''))
    .filter(Boolean)
  const all = (list: string[]) => becs.length > 0 && becs.every((b) => list.includes(b))
  if (becs.some((b) => b.startsWith('ich')))
    return {
      age: 141,
      basis: 'Older than 140 years: the policy leaves the ICH undecided; the LLOWG and the Board used 140.',
    }
  // A13 is printed "Moist Interior - Plateau, Omineca - Mountain"; the Board counts it from 121, as Plateau.
  if (/moist interior\s*-?\s*plateau/.test(ndu))
    return { age: 121, basis: 'Older than 120 years: Moist Interior – Plateau (policy p. 1).' }
  if (/omineca\s*-\s*(valley|low elevation)/.test(ndu) && all(['sbsdk', 'sbsdw3', 'bwbsdk1', 'sbsmc2', 'sbsmk1']))
    return { age: 121, basis: 'Older than 120 years: Omineca Valley SBS dk, dw3, mc2, mk1 or BWBS dk1 (policy p. 1).' }
  if (/mcgregor plateau/.test(ndu) && all(['sbsmk1', 'sbsmh']))
    return { age: 121, basis: 'Older than 120 years: McGregor Plateau SBS mk1 and mh (policy p. 1).' }
  return { age: 141, basis: 'Older than 140 years (policy p. 1).' }
}

type OrderRow = (typeof order.oldAndInteriorForest)[number]
type BoardRow = (typeof board.oldForest2019.units)[number]

function asUnit(row: OrderRow): OldForestUnit {
  const b = (board.oldForest2019.units as BoardRow[]).find((u) => u.unit === row.unit && u.district === row.district)
  const rule = oldAgeRule(row)
  return {
    district: row.district,
    unit: row.unit,
    ndu: row.ndu,
    becAsPrinted: row.becAsPrinted,
    oldPercent: row.oldForestMinPct,
    interiorPercent: row.interiorOfRequiredOldForestMinPct,
    nonPinePercent: 'nonPineLeadingOldMinPctOfCflb' in row ? (row.nonPineLeadingOldMinPctOfCflb ?? null) : null,
    oldFromAge: rule.age,
    ageBasis: rule.basis,
    board2019: b
      ? {
          cflbHa: b.cflbHa,
          minimumAge: b.minimumAge,
          requiredOldHa: b.requiredOldHa,
          oldHa: b.oldHa,
          requiredInteriorHa: b.requiredInteriorHa,
          interiorHa: b.interiorHa,
        }
      : null,
  }
}

export const OLD_FOREST_UNITS: OldForestUnit[] = order.oldAndInteriorForest.map(asUnit)

export const unitsOf = (district: string) => OLD_FOREST_UNITS.filter((u) => u.district === district)

export const oldForestUnit = (district: string, unit: string) =>
  OLD_FOREST_UNITS.find((u) => u.district === district && u.unit === unit) ?? null

/** The order's percentage against the GIS layer's `OLD_RETEN` fraction, when they differ. */
export function gisDisagrees(unit: OldForestUnit, gisFraction: number | null): string | null {
  if (gisFraction === null || !Number.isFinite(gisFraction)) return null
  const gis = Math.round(gisFraction * 1000) / 10
  return Math.abs(gis - unit.oldPercent) < 0.05
    ? null
    : `DataBC’s legal layer records ${gis}% for ${unit.unit}; the order’s table says ${unit.oldPercent}%. The order’s figure is used.`
}

export const BOARD_2019_SOURCE = {
  url: board.source,
  label: `Forest Practices Board, FPB/IRC/235, Appendix ${board.oldForest2019.appendix} (2019 LLOWG analysis)`,
}
