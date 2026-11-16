/**
 * The curve rule's lookup tables as text: RoadEng's `.tbl` layout (Softree's "Super-elevation table
 * facts"), so a table can be pasted, loaded from a RoadEng `.tbl` file or copied out to one. `#`
 * lines are comments, the first other line heads the speed columns (km/h; its first cell blank), and
 * each further line is a radius (m) and one value per speed, comma or tab delimited; a blank cell is a
 * combination the table does not allow. Superelevation is written as rise over run, as RoadEng keeps
 * it (0.054 is 5.4 %); runoff in metres; side friction as one row of largest friction, its first
 * cell unused.
 *
 * Also the starting table offered when a road switches to table mode with none: the formula
 * e = V²/(127 R) − f at the road's own speed range, blank where it would need more than e max.
 *
 * Pure: no DOM or network access.
 */
import {
  parseRoadEngTbl,
  ROADENG_RUNOFF_TABLE,
  ROADENG_SIDE_FRICTION_TABLE,
  ROADENG_SUPERELEVATION_TABLE,
  roadEngTableFromPgmaps,
  roadEngTableToPgmaps,
} from './roadEngDesignSettings'
import { writeRoadEngTbl } from './roadEngSectionExport'
import { validateCurveLookupTable } from './roadCriteria'
import type { CurveDesign, CurveLookupTable } from './types'

export type CurveTableKind = 'superelevation' | 'runoff'

const KINDS: Record<CurveTableKind, { index: number; scale: number; label: string; max: number }> = {
  superelevation: { index: ROADENG_SUPERELEVATION_TABLE, scale: 100, label: 'superelevation table', max: 50 },
  runoff: { index: ROADENG_RUNOFF_TABLE, scale: 1, label: 'runoff table', max: 10_000 },
}

/** A pasted or loaded `.tbl` as a superelevation (%) or runoff (m) table, checked. */
export function curveTableFromText(text: string, kind: CurveTableKind): CurveLookupTable {
  const k = KINDS[kind]
  const table = roadEngTableToPgmaps(parseRoadEngTbl(text, k.index), 1, k.scale)
  validateCurveLookupTable(table, k.label, k.max)
  return table
}

/** A table as `.tbl` text, the inverse of {@link curveTableFromText}. */
export function curveTableText(table: CurveLookupTable, kind: CurveTableKind): string {
  const k = KINDS[kind]
  return writeRoadEngTbl(roadEngTableFromPgmaps(table, k.index, 1, k.scale))
}

type FrictionTable = NonNullable<CurveDesign['sideFrictionTable']>

/** A side friction `.tbl` (speeds across, one row of largest side friction) as the road's table, checked. */
export function sideFrictionFromText(text: string): FrictionTable {
  const t = parseRoadEngTbl(text, ROADENG_SIDE_FRICTION_TABLE)
  const row = t.rows[0]
  const speedsKmh = t.speeds
  const values = speedsKmh.map((_, k) => row.e[k] ?? null)
  if (new Set(speedsKmh).size !== speedsKmh.length) throw Error('The side friction table repeats a speed.')
  if (!speedsKmh.every((v) => v > 0 && v <= 300)) throw Error('Side friction speeds must be between 0 and 300 km/h.')
  if (!values.every((v) => v === null || (v >= 0 && v <= 2))) throw Error('Side friction values must be 0–2 or blank.')
  if (!values.some((v) => v !== null)) throw Error('The side friction table has no values.')
  return { speedsKmh, values }
}

/** The road's side friction table as `.tbl` text. */
export function sideFrictionText(table: FrictionTable): string {
  return writeRoadEngTbl({
    index: ROADENG_SIDE_FRICTION_TABLE,
    description: [' First column is unused', ' First row is design speed (km/hr)', ' Body is maximum side friction'],
    speeds: table.speedsKmh,
    rows: [{ radius: 0, e: table.values }],
  })
}

/** Speeds and radii of the table built from the formula, km/h and m. */
export const FORMULA_TABLE_SPEEDS_KMH = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] as const
export const FORMULA_TABLE_RADII_M = [
  15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1200,
  1500, 2000, 3000, 5000,
] as const

/**
 * A superelevation table from the road's formula, e = V²/(127 R) − f at each radius and speed, held
 * at 0 and left blank where it would need more than e max: a starting table to edit, never a standard.
 */
export function curveTableFromFormula(design: CurveDesign): CurveLookupTable {
  const emax = design.maxSuperelevationPercent
  return {
    description: [
      ` Superelevation from e = V²/(127 R) − ${design.sideFrictionFactor}, e max ${emax} %`,
      ' First column is radius (meters)',
      ' First row is design speed (km/hr)',
      ' Body is superelevation (rise over run)',
    ],
    speedsKmh: [...FORMULA_TABLE_SPEEDS_KMH],
    rows: FORMULA_TABLE_RADII_M.map((radiusM) => ({
      radiusM,
      values: FORMULA_TABLE_SPEEDS_KMH.map((v) => {
        const e = 100 * ((v * v) / (127 * radiusM) - design.sideFrictionFactor)
        return e > emax + 1e-9 ? null : Math.round(Math.max(0, e) * 1000) / 1000
      }),
    })),
  }
}
