/**
 * The Block Volume Inputs table, column for column as the Dunkley workbook
 * has it (A–K), shared by the Excel export and the paste-into-an-existing-
 * sheet clipboard text. Pure: no DOM or network access.
 */
import { roundTo } from './report'
import type { CandidateSummary, RunSummary } from './types'

export const BLOCK_COLUMNS = [
  'Operating Area',
  'Block ID',
  'Merch Area (ha)',
  'AVAST Area (ha)',
  'Preferred VPH (m³/ha)',
  'Direct Est. Vol (m³)',
  'Reported Gross Vol (m³)',
  'Estimate Source',
  'Constraints / Planning Notes',
  'AVAST-only Ref. (m³)',
  'Duplicate Check',
] as const

/** First data row of the Block Volume Inputs sheet; the duplicate check counts from here. */
export const FIRST_DATA_ROW = 6

export const reportedVolumeFormula = (row: number) =>
  `IF(F${row}<>"",F${row},IF(AND(ISNUMBER(D${row}),ISNUMBER(E${row})),D${row}*E${row},""))`

export const duplicateCheckFormula = (row: number, firstRow = FIRST_DATA_ROW) =>
  `IF(B${row}="","",IF(COUNTIF($B$${firstRow}:B${row},B${row})>1,"DUPLICATE","OK"))`

export type BlockRow = {
  operatingArea: string
  blockId: string
  merchHa: number
  avastHa: number
  preferredVph: number | null
  directVolume: number
  estimateSource: string
  notes: string
  avastReference: number
}

export function blockRow(summary: CandidateSummary): BlockRow {
  return {
    operatingArea: summary.operatingArea,
    blockId: summary.id,
    merchHa: summary.grossHa,
    avastHa: summary.avastCoveredHa,
    preferredVph: summary.preferredVph,
    directVolume: summary.reportedVolume,
    estimateSource: summary.estimateSource,
    notes: summary.notes,
    avastReference: summary.avastRawVolume,
  }
}

/** What G and K evaluate to, for previews and for formula results cached in the file. */
export function evaluatedChecks(rows: BlockRow[]): Array<{ reported: number; duplicate: 'OK' | 'DUPLICATE' | '' }> {
  const seen = new Set<string>()
  return rows.map((row) => {
    const id = row.blockId
    const duplicate = id === '' ? '' : seen.has(id) ? 'DUPLICATE' : 'OK'
    seen.add(id)
    return { reported: row.directVolume, duplicate }
  })
}

const number = (value: number | null, decimals: number) =>
  value === null || !Number.isFinite(value) ? '' : String(Number(value.toFixed(decimals)))
/** Tabs and line breaks would split a cell when pasted. */
const text = (value: string) => value.replace(/[\t\r\n]+/g, ' ').trim()

/**
 * Tab-separated rows for pasting straight into an existing Block Volume Inputs
 * sheet at `startRow`. With formulas, G and K carry that sheet's own formulas
 * rewritten for the rows they land on, so a paste over the pre-filled formula
 * rows changes nothing about how the sheet totals or flags duplicates.
 */
export function blockRowsTsv(
  rows: BlockRow[],
  options: { startRow: number; formulas: boolean; header?: boolean },
): string {
  const checks = evaluatedChecks(rows)
  const lines = rows.map((row, index) => {
    const sheetRow = options.startRow + index
    return [
      text(row.operatingArea),
      text(row.blockId),
      number(row.merchHa, 6),
      number(row.avastHa, 6),
      number(row.preferredVph, 4),
      number(row.directVolume, 4),
      options.formulas ? `=${reportedVolumeFormula(sheetRow)}` : number(checks[index].reported, 4),
      text(row.estimateSource),
      text(row.notes),
      number(row.avastReference, 4),
      options.formulas ? `=${duplicateCheckFormula(sheetRow)}` : checks[index].duplicate,
    ].join('\t')
  })
  return [...(options.header ? [BLOCK_COLUMNS.join('\t')] : []), ...lines].join('\n')
}

/** Per-block VRI what-if figures from step 4; `WhatIfRow` in the panel has this shape. */
export type VriExportRow = {
  avastVolume: number
  withVriAudit: number
}

/**
 * Step 4's opt-in export: Direct Est. Vol (F) becomes the AVAST volume plus the
 * VRI fill scaled by the Prince George TSA audit ratios. J keeps the AVAST-only
 * volume, and E is restated as F ÷ merch area, the convention the workbook
 * already uses for blocks whose volume does not come from AVAST.
 */
export function withVriVolume(row: BlockRow, vri: VriExportRow | undefined, vphDecimals: number): BlockRow {
  const fill = vri ? vri.withVriAudit - vri.avastVolume : 0
  if (fill <= 0) return row
  const directVolume = row.directVolume + fill
  return {
    ...row,
    directVolume,
    preferredVph: row.merchHa > 0 ? roundTo(directVolume / row.merchHa, vphDecimals) : row.preferredVph,
    estimateSource: `${row.estimateSource} + VRI fill (audit-adjusted)`,
    notes: `${row.notes} VRI fill adds ${Math.round(fill).toLocaleString('en-CA')} m³ (audit-adjusted) where AVAST is empty or 0 m³/ha.`,
  }
}

/** The Block Volume Inputs rows the workbook and the paste text share, with their candidate keys. */
export function exportBlockRows(
  summary: RunSummary,
  settings: { duplicates: 'flag' | 'drop'; vphDecimals: number },
  vri?: Map<string, VriExportRow>,
): Array<{ key: string; row: BlockRow }> {
  return summary.candidates
    .filter((candidate) => !candidate.excluded && !(candidate.duplicate && settings.duplicates === 'drop'))
    .map((candidate) => ({
      key: candidate.key,
      row: withVriVolume(blockRow(candidate), vri?.get(candidate.key), settings.vphDecimals),
    }))
}
