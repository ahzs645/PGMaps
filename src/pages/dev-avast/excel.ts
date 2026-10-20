/**
 * The planning workbook. The first three sheets copy the shape, order,
 * formulas and styling of Dunkley_Volume_Summary_All_Blocks.xlsx so rows can
 * be pasted between the two; the sheets after them carry the procedure's own
 * summary tables (Parts 1–3) and the intersect pieces.
 */
import type { Workbook, Worksheet, Style } from 'exceljs'
import { slopeClassLabel } from './slope'
import { reportRows } from './report'
import { BLOCK_COLUMNS, FIRST_DATA_ROW, blockRow, duplicateCheckFormula, evaluatedChecks, reportedVolumeFormula } from './workbookRows'
import type { AvastSettings, Piece, RunSummary } from './types'

export type WorkbookContext = {
  projectName: string
  candidateSources: string[]
  avastLayerNames: string[]
  lidarLayerNames: string[]
  densityField: string
  lidarDensityField: string | null
  slopeDescription: string | null
  generatedAt: Date
  avastPieces: Piece[]
  candidateIds: Map<string, { id: string; operatingArea: string }>
}

const FONT = 'Carlito'
const DARK = 'FF193F35'
const HEADER = 'FF226759'
const PALE = 'FFEAF4F0'
const BLUE_PALE = 'FFEAF2F8'
const fill = (argb: string): Style['fill'] => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const font = (size: number, extra: Partial<Style['font']> = {}): Partial<Style['font']> => ({ name: FONT, size, ...extra })

function titleRows(sheet: Worksheet, title: string, subtitle: string | null, lastColumn: string, titleSize: number) {
  sheet.mergeCells(`A1:${lastColumn}2`)
  const cell = sheet.getCell('A1')
  cell.value = title
  cell.font = font(titleSize, { bold: true, color: { argb: 'FFFFFFFF' } })
  cell.fill = fill(DARK)
  cell.alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 24
  sheet.getRow(2).height = 24
  if (subtitle !== null) {
    sheet.mergeCells(`A3:${lastColumn}3`)
    const sub = sheet.getCell('A3')
    sub.value = subtitle
    sub.font = font(10, { color: { argb: DARK } })
    sub.fill = fill(PALE)
    sub.alignment = { vertical: 'middle', wrapText: true }
    sheet.getRow(3).height = 27.95
  }
}

function headerRow(sheet: Worksheet, rowNumber: number, labels: readonly string[], size = 10) {
  const row = sheet.getRow(rowNumber)
  labels.forEach((label, index) => {
    const cell = row.getCell(index + 1)
    cell.value = label
    cell.font = font(size, { bold: true, color: { argb: 'FFFFFFFF' } })
    cell.fill = fill(HEADER)
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  row.height = rowNumber === 5 && size === 10 ? 42.95 : 30
}

function plainTable(
  workbook: Workbook,
  name: string,
  title: string,
  columns: Array<{ header: string; width: number; format?: string }>,
  rows: Array<Array<string | number | null>>,
) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] })
  const last = String.fromCharCode(64 + Math.min(26, columns.length))
  titleRows(sheet, title, null, last, 15)
  headerRow(sheet, 4, columns.map((column) => column.header))
  sheet.getRow(4).height = 30
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width
  })
  rows.forEach((values, rowIndex) => {
    const row = sheet.getRow(5 + rowIndex)
    values.forEach((value, index) => {
      const cell = row.getCell(index + 1)
      cell.value = value === null || (typeof value === 'number' && !Number.isFinite(value)) ? null : value
      cell.font = font(10)
      if (columns[index].format) cell.numFmt = columns[index].format!
    })
  })
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: columns.length } }
  return sheet
}

const pct = (value: number | null) => (value === null ? null : value / 100)

export async function buildWorkbook(summary: RunSummary, settings: AvastSettings, context: WorkbookContext): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'PGMaps AVAST volume utility'
  workbook.created = context.generatedAt
  const project = (context.projectName || 'Project').toUpperCase()
  const rows = reportRows(summary, settings).map(blockRow)
  const checks = evaluatedChecks(rows)
  const areas = summary.byOperatingArea.map((entry) => entry.operatingArea)
  const allAreas = [...new Set([...areas, ...rows.map((row) => row.operatingArea)])].filter(Boolean)
  const lastRow = Math.max(205, FIRST_DATA_ROW + rows.length + 100)
  const inputs = `'Block Volume Inputs'`
  const breaks = settings.slopeBreaks
  const avastName = context.avastLayerNames.join(' + ') || 'AVAST'
  const factorText = summary.factor === null ? null : summary.factor.toFixed(4)

  // ── Management Summary ────────────────────────────────────────────────
  const management = workbook.addWorksheet('Management Summary', { views: [{ state: 'frozen', ySplit: 5 }] })
  const excluded = settings.excludedOperatingAreas.filter(Boolean)
  titleRows(
    management,
    `${project} | OPERATING AREA VOLUME SUMMARY`,
    `All candidate blocks in ${allAreas.join(', ') || 'the candidate layer'}.${excluded.length ? ` ${excluded.join(', ')} excluded.` : ''}`,
    'E',
    16,
  )
  management.getCell('A1').alignment = { vertical: 'middle' }
  headerRow(management, 5, ['OPERATING AREA', 'BLOCKS', 'ESTIMATED GROSS VOLUME (m³)'], 11)
  management.getRow(5).height = 30
  ;[25, 14, 35, 21].forEach((width, index) => { management.getColumn(index + 1).width = width })
  areas.forEach((area, index) => {
    const rowNumber = 6 + index
    const row = management.getRow(rowNumber)
    const entry = summary.byOperatingArea[index]
    row.getCell(1).value = area
    row.getCell(2).value = {
      formula: `COUNTIFS(${inputs}!$A$${FIRST_DATA_ROW}:$A$${lastRow},A${rowNumber},${inputs}!$K$${FIRST_DATA_ROW}:$K$${lastRow},"OK")`,
      result: entry.blocks,
    }
    row.getCell(3).value = {
      formula: `SUMIFS(${inputs}!$G$${FIRST_DATA_ROW}:$G$${lastRow},${inputs}!$A$${FIRST_DATA_ROW}:$A$${lastRow},A${rowNumber},${inputs}!$K$${FIRST_DATA_ROW}:$K$${lastRow},"OK")`,
      result: entry.volume,
    }
    for (const column of [1, 2, 3]) {
      const cell = row.getCell(column)
      cell.font = font(11)
      cell.fill = fill('FFFFFFFF')
      if (column > 1) cell.numFmt = '#,##0'
    }
    row.height = 24.95
  })
  const totalRow = 6 + areas.length
  const total = management.getRow(totalRow)
  total.getCell(1).value = 'TOTAL'
  total.getCell(2).value = { formula: areas.length ? `SUM(B6:B${totalRow - 1})` : '0', result: summary.totals.blocks }
  total.getCell(3).value = { formula: areas.length ? `SUM(C6:C${totalRow - 1})` : '0', result: summary.totals.volume }
  for (const column of [1, 2, 3]) {
    const cell = total.getCell(column)
    cell.font = font(12, { bold: true, color: { argb: DARK } })
    cell.fill = fill(PALE)
    if (column > 1) cell.numFmt = '#,##0'
  }
  total.height = 27.95
  const targetRow = totalRow + 2
  management.getCell(`A${targetRow}`).value = 'REFERENCE TARGET (m³)'
  management.getCell(`B${targetRow}`).value = settings.referenceTargetM3
  management.getCell(`A${targetRow + 1}`).value = 'VOLUME ABOVE TARGET (m³)'
  management.getCell(`B${targetRow + 1}`).value = {
    formula: `IF(ISNUMBER(B${targetRow}),C${totalRow}-B${targetRow},"")`,
    result: settings.referenceTargetM3 === null ? '' : summary.totals.volume - settings.referenceTargetM3,
  }
  for (const rowNumber of [targetRow, targetRow + 1]) {
    management.getCell(`A${rowNumber}`).font = font(10, { bold: true, color: { argb: DARK } })
    management.getCell(`B${rowNumber}`).font = font(11)
    management.getCell(`B${rowNumber}`).numFmt = '#,##0'
    management.getRow(rowNumber).height = 24
  }
  const basis = summary.factor !== null
    ? `Reporting basis: ${avastName} ${context.densityField} × intersected area${context.lidarLayerNames.length ? `; LiDAR volume (${context.lidarLayerNames.join(' + ')}) used directly where it covers ≥${settings.directLidarMinCoveragePct}% of a block` : ''}; other blocks AVAST × LiDAR factor ${factorText}.`
    : `Reporting basis: ${avastName} ${context.densityField} × intersected area (raw AVAST, no LiDAR adjustment).`
  const caveat = settings.volumeBasis === 'total'
    ? 'Planning-level gross volume only — not confirmed net merchantable/operable volume. Further slope, access and constraint screening is required.'
    : `Planning-level volume on ${settings.volumeBasis === 'class1' ? slopeClassLabel(1, breaks) : `≤${breaks[1]}%`} slope only — a desktop screen, not confirmed operable volume. Access, constraint and field review are still required.`
  const notes: Array<[string, string, string, number]> = [
    [basis, DARK, BLUE_PALE, 30],
    [caveat, 'FF684A22', 'FFFFF5DF', 33.95],
  ]
  notes.forEach(([value, color, background, height], index) => {
    const rowNumber = targetRow + 4 + index
    management.mergeCells(`A${rowNumber}:E${rowNumber}`)
    const cell = management.getCell(`A${rowNumber}`)
    cell.value = value
    cell.font = font(10, { color: { argb: color } })
    cell.fill = fill(background)
    cell.alignment = { wrapText: true, vertical: 'middle' }
    management.getRow(rowNumber).height = height
  })
  const footRow = targetRow + 7
  management.mergeCells(`A${footRow}:E${footRow}`)
  management.getCell(`A${footRow}`).value = 'Summary excludes duplicate Block IDs automatically. Detailed calculation inputs are on the next tab.'
  management.getCell(`A${footRow}`).font = font(10, { color: { argb: 'FF657B76' } })
  management.getRow(footRow).height = 24

  // ── Block Volume Inputs ───────────────────────────────────────────────
  const blocks = workbook.addWorksheet('Block Volume Inputs', { views: [{ state: 'frozen', ySplit: 5 }] })
  titleRows(
    blocks,
    `${project} | BLOCK-LEVEL VOLUME INPUTS`,
    `All unique blocks from the ${allAreas.length} included Operating Area${allAreas.length === 1 ? '' : 's'}. Enter a direct estimate in F, or enter AVAST area + VPH in D/E; G calculates the reported estimate. New Block IDs must be unique.`,
    'K',
    15,
  )
  headerRow(blocks, 5, BLOCK_COLUMNS)
  ;[20, 13, 19, 13, 22, 23, 13, 44, 59, 22, 19].forEach((width, index) => { blocks.getColumn(index + 1).width = width })
  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= lastRow; rowNumber += 1) {
    const index = rowNumber - FIRST_DATA_ROW
    const data = rows[index]
    const row = blocks.getRow(rowNumber)
    if (data) {
      row.getCell(1).value = data.operatingArea
      row.getCell(2).value = data.blockId
      row.getCell(3).value = data.merchHa
      row.getCell(4).value = data.avastHa
      row.getCell(5).value = data.preferredVph
      row.getCell(6).value = data.directVolume
      row.getCell(8).value = data.estimateSource
      row.getCell(9).value = data.notes
      row.getCell(10).value = data.avastReference
      for (const column of [1, 2]) {
        row.getCell(column).font = font(10, { bold: true, color: { argb: DARK } })
        row.getCell(column).fill = fill(BLUE_PALE)
      }
    }
    row.getCell(7).value = { formula: reportedVolumeFormula(rowNumber), result: data ? checks[index].reported : '' }
    row.getCell(7).fill = fill(PALE)
    row.getCell(11).value = { formula: duplicateCheckFormula(rowNumber), result: data ? checks[index].duplicate : '' }
    row.getCell(11).fill = fill('FFF6F9F8')
    for (let column = 1; column <= 11; column += 1) {
      const cell = row.getCell(column)
      if (!cell.font?.bold) cell.font = font(10)
    }
    for (const column of [3, 4, 5]) row.getCell(column).numFmt = '#,##0.0'
    for (const column of [6, 7, 10]) row.getCell(column).numFmt = '#,##0'
  }
  const list = `"${allAreas.join(',')}"`
  // Excel caps an inline list at 255 characters; past that, typing stays free.
  if (allAreas.length && list.length <= 255) {
    for (let rowNumber = FIRST_DATA_ROW; rowNumber <= lastRow; rowNumber += 1) {
      blocks.getCell(`A${rowNumber}`).dataValidation = { type: 'list', allowBlank: true, formulae: [list] }
    }
  }
  blocks.addConditionalFormatting({
    ref: `K${FIRST_DATA_ROW}:K${lastRow}`,
    rules: [{
      type: 'expression', priority: 1, formulae: [`$K${FIRST_DATA_ROW}="DUPLICATE"`],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } }, font: { color: { argb: 'FF9C0006' }, bold: true } },
    }],
  })

  // ── Method & QA ───────────────────────────────────────────────────────
  const method = workbook.addWorksheet('Method & QA', { views: [{ state: 'frozen', ySplit: 3 }] })
  titleRows(method, `${project} | VOLUME METHODOLOGY & QA`, null, 'D', 15)
  method.getColumn(1).width = 26
  method.getColumn(2).width = 102
  method.getColumn(3).width = 12
  const reportable = reportRows(summary, settings)
  const zeroCoverage = reportable.filter((row) => row.avastCoveredHa === 0).map((row) => row.id)
  const counts = summary.byOperatingArea.map((entry) => `${entry.operatingArea || '(blank)'} (${entry.blocks})`).join(', ')
  const lowerSlope = slopeClassLabel(1, breaks)
  const methodRows: Array<[string, string]> = [
    ['PURPOSE', `Planning-level AVAST timber volume for ${context.projectName || 'the candidate'} blocks, built with the AVAST Volume Calculation procedure (Parts 1–3).`],
    ['INCLUDED', `${counts || 'No blocks'}${summary.totals.blocks ? `; ${summary.totals.blocks} unique blocks counted.` : '.'}`],
    ['EXCLUDED', excluded.length ? `${excluded.join(', ')} left out of Block Volume Inputs and the Management Summary.` : 'No operating areas excluded.'],
    ['SOURCE', `Candidates: ${context.candidateSources.join(', ') || '—'}. AVAST: ${avastName} (${context.densityField}).${context.lidarLayerNames.length ? ` LiDAR: ${context.lidarLayerNames.join(', ')} (${context.lidarDensityField}).` : ''}`],
    ['VOLUME BASIS', `Candidates pairwise-intersected with AVAST; each piece's planar BC Albers area (ha) × ${context.densityField}, summed per block. Never SUM(${context.densityField}), one density × gross area, or a simple average.`],
    ['PRIMARY VOLUME INPUT', 'F is the precomputed direct volume. For new blocks without this value, leave F blank and enter AVAST area (D) and preferred VPH (E); G calculates D×E.'],
    ['REPORTED VOLUME', settings.volumeBasis === 'total' ? 'F holds each block\'s total planning volume across all slope classes.' : `F holds only the ${settings.volumeBasis === 'class1' ? lowerSlope : `≤${breaks[1]}%`} slope portion; E is that portion's volume ÷ its area. The full split is on Slope Volume Summary.`],
    ['MANAGEMENT TOTAL', 'SUMIFS of block-level G volume grouped by OA, only rows whose Duplicate Check (K) is OK. No Priority or Include flag is used.'],
    ['NO DOUBLE COUNT', settings.duplicates === 'drop' ? 'Duplicate Block IDs in the candidate layers were dropped (first occurrence kept). Future duplicates are marked DUPLICATE in K and not counted.' : 'Duplicate Block IDs are kept and marked DUPLICATE in K; they are not counted in the Management Summary.'],
    ['AVAST REFERENCE', 'Column J retains the raw AVAST-only volume; it does not enter the reported volume calculation.'],
    ['LIDAR FACTOR', summary.factor === null
      ? 'No LiDAR adjustment applied; AVAST volumes are raw.'
      : `LiDAR Adjustment Factor = ${factorText} (${(summary.factor * 100).toFixed(2)}%). ${settings.lidarMode === 'calibrate' ? `Derived as total LiDAR ÷ total AVAST over the common footprint of ${summary.calibration?.rows.length ?? 0} block(s); see LiDAR Calibration.` : `Source: ${settings.lidarFactorNote || 'entered manually'}.`} Applied to AVAST volume only — never to area or to direct LiDAR volume. Project-specific, not a universal correction.`],
    ['SLOPE CLASSES', context.slopeDescription ? `${context.slopeDescription} Classes: ${lowerSlope}, ${slopeClassLabel(2, breaks)} inclusive, ${slopeClassLabel(3, breaks)} (percent rise). A planning screen, not a harvestability rule.` : 'Slope classes not assessed in this run.'],
    ['COVERAGE NOTES', `AVAST coverage = AVAST area ÷ merch area. Good ≥ ${settings.coverageGoodPct}%, Moderate ≥ ${settings.coverageModeratePct}%, Low ≥ ${settings.coverageLowPct}%, otherwise Little/no.`],
    ['GROSS AREA', settings.grossArea === 'field' ? 'Merch area from the candidate attribute; polygon area where the attribute is blank or zero.' : 'Merch area is the candidate polygon\'s planar BC Albers area.'],
    ['ZERO AVAST COVERAGE', zeroCoverage.length ? `${zeroCoverage.join(', ')} have no AVAST area.` : 'Every block has some AVAST coverage.'],
    ['QA FLAGS', summary.qa.join(' ') || 'No QA flags raised.'],
    ['LIMITATIONS', 'Planning gross estimate only. Not a timber cruise volume or confirmed operable/net harvestable volume. Review access, slope, constraints and area adjustments.'],
    ['PRE-REPORT REVIEW', 'Verify the AVAST vintage and gross/net assumptions are the ones intended, and that any LiDAR factor is suitable for these operating areas.'],
    ['GENERATED', `${context.generatedAt.toLocaleString('en-CA')} · PGMaps /dev/forestry/avast-volume`],
  ]
  methodRows.forEach(([label, value], index) => {
    const row = method.getRow(4 + index)
    row.getCell(1).value = label
    row.getCell(1).font = font(10, { bold: true, color: { argb: DARK } })
    row.getCell(1).fill = fill(PALE)
    row.getCell(1).alignment = { vertical: 'middle' }
    row.getCell(2).value = value
    row.getCell(2).font = font(10, { color: { argb: 'FF334155' } })
    row.getCell(2).alignment = { vertical: 'middle', wrapText: true }
    row.height = Math.max(33.95, Math.ceil(value.length / 110) * 14 + 6)
  })

  // ── Procedure tables ──────────────────────────────────────────────────
  plainTable(workbook, 'AVAST Volume Summary', `${project}_AVAST_Volume_Summary`, [
    { header: 'Candidate_ID', width: 14 },
    { header: 'Operating_Area', width: 18 },
    { header: 'Source_Type', width: 20 },
    { header: 'Gross_HA', width: 11, format: '#,##0.00' },
    { header: 'AVAST_Covered_HA', width: 13, format: '#,##0.00' },
    { header: 'AVAST_Coverage_Pct', width: 13, format: '0.0%' },
    { header: 'AVAST_Raw_Volume_m3', width: 15, format: '#,##0' },
    { header: 'Weighted_AVAST_m3ha', width: 15, format: '#,##0.0' },
    { header: 'LiDAR_Volume_m3', width: 14, format: '#,##0' },
    { header: 'LiDAR_Factor', width: 11, format: '0.0000' },
    { header: 'Final_Planning_Volume_m3', width: 16, format: '#,##0' },
    { header: 'Volume_Source', width: 22 },
    { header: 'Duplicate', width: 10 },
  ], reportable.map((row) => [
    row.id, row.operatingArea, row.sourceType, row.grossHa, row.avastCoveredHa, pct(row.avastCoveragePct), row.avastRawVolume,
    row.weightedAvastM3ha, row.lidarVolume, row.factor, row.finalVolume, row.volumeSource, row.duplicate ? 'DUPLICATE' : 'OK',
  ]))

  if (context.slopeDescription) {
    plainTable(workbook, 'Slope Volume Summary', `${project}_Slope_Volume_Summary`, [
      { header: 'Candidate_ID', width: 14 },
      { header: 'Operating_Area', width: 18 },
      { header: 'Source_Type', width: 20 },
      { header: 'Gross_HA', width: 11, format: '#,##0.00' },
      { header: 'Volume_Source', width: 22 },
      { header: 'LiDAR_Adjustment_Factor', width: 14, format: '0.0000' },
      { header: `Area_lt${breaks[0]}_HA`, width: 12, format: '#,##0.00' },
      { header: `Area_${breaks[0]}_${breaks[1]}_HA`, width: 12, format: '#,##0.00' },
      { header: `Area_gt${breaks[1]}_HA`, width: 12, format: '#,##0.00' },
      { header: `Vol_lt${breaks[0]}_m3`, width: 13, format: '#,##0' },
      { header: `Vol_${breaks[0]}_${breaks[1]}_m3`, width: 13, format: '#,##0' },
      { header: `Vol_gt${breaks[1]}_m3`, width: 13, format: '#,##0' },
      { header: 'No_Slope_Data_m3', width: 13, format: '#,##0' },
      { header: 'Total_Planning_Vol_m3', width: 15, format: '#,##0' },
      { header: `Pct_Vol_lt${breaks[0]}`, width: 11, format: '0.0%' },
    ], reportable.map((row) => [
      row.id, row.operatingArea, row.sourceType, row.grossHa, row.volumeSource, row.factor,
      row.classAreaHa?.[0] ?? null, row.classAreaHa?.[1] ?? null, row.classAreaHa?.[2] ?? null,
      row.classVolume?.[0] ?? null, row.classVolume?.[1] ?? null, row.classVolume?.[2] ?? null,
      row.unclassifiedVolume, row.finalVolume,
      row.classVolume && row.finalVolume > 0 ? row.classVolume[0] / row.finalVolume : null,
    ]))
  }

  if (summary.calibration?.rows.length) {
    const calibration = summary.calibration
    const sheet = plainTable(workbook, 'LiDAR Calibration', `${project}_LiDAR_Calibration_Summary`, [
      { header: 'Calibration_Area', width: 22 },
      { header: 'Operating_Area', width: 18 },
      { header: 'Common_Area_HA', width: 13, format: '#,##0.00' },
      { header: 'AVAST_Volume_m3', width: 14, format: '#,##0' },
      { header: 'AVAST_Weighted_m3ha', width: 14, format: '#,##0.0' },
      { header: 'LiDAR_Volume_m3', width: 14, format: '#,##0' },
      { header: 'LiDAR_Weighted_m3ha', width: 14, format: '#,##0.0' },
      { header: 'LiDAR_Factor', width: 12, format: '0.0000' },
    ], [
      ...calibration.rows.map((row) => [row.id, row.operatingArea, row.commonAreaHa, row.avastVolume, row.commonAreaHa > 0 ? row.avastVolume / row.commonAreaHa : null,
        row.lidarVolume, row.commonAreaHa > 0 ? row.lidarVolume / row.commonAreaHa : null, row.factor]),
      ['TOTAL (aggregate)', '', calibration.commonAreaHa, calibration.avastVolume, calibration.avastWeighted, calibration.lidarVolume, calibration.lidarWeighted, calibration.factor],
    ])
    const totalLine = sheet.getRow(5 + calibration.rows.length)
    totalLine.eachCell((cell) => { cell.font = font(10, { bold: true, color: { argb: DARK } }); cell.fill = fill(PALE) })
  }

  plainTable(workbook, 'AVAST Intersect', `${project}_AVAST_Volume_Intersect`, [
    { header: 'Candidate_ID', width: 14 },
    { header: 'Operating_Area', width: 18 },
    { header: 'AVAST_Source', width: 26 },
    { header: 'AVAST_FID', width: 11 },
    { header: context.densityField, width: 12, format: '#,##0.0' },
    { header: 'Piece_HA', width: 11, format: '#,##0.0000' },
    { header: 'AVAST_Vol_m3', width: 13, format: '#,##0.0' },
    { header: 'Density_Missing', width: 12 },
  ], context.avastPieces.map((piece) => {
    const owner = context.candidateIds.get(piece.candidateKey)
    return [owner?.id ?? '', owner?.operatingArea ?? '', context.avastLayerNames[piece.layerIndex] ?? '', piece.fid, piece.density, piece.areaHa, piece.volume, piece.densityMissing ? 'YES' : '']
  }))

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}
