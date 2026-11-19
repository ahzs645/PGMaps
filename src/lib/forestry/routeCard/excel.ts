/**
 * The route card report as the planners' own workbook: a "Route Card Tool Assessment" sheet with
 * the title in B2, each section a coloured band and each row's label, Y/N/Within and names in B, C
 * and D at the rows the route card tool writes them, Y rows in bold; then an "Other Considerations"
 * sheet with each topic in B and its paragraph in C from row 2, its figures under the text in
 * the same row, as their sheets have them. So a row or a paragraph pastes into their workbook where
 * it belongs. PGMaps' notes on the route card (why a row was not read, who entered it) go in column
 * E, outside the tool's columns; the "Notes" sheet says what the file is.
 *
 * The paragraphs are the ones the report renders (`report.ts`), so the workbook, the Word file and
 * the sidebar say the same. exceljs is passed in. No DOM or network access.
 */
import type { DraftedConsideration } from './report'
import type { RouteCardSheet } from './results'
import type { ConsiderationId, RouteCardPreset } from './rows'

type ExcelModule = Pick<typeof import('exceljs'), 'Workbook'>

/** The section bands' fills, in order, as the tool's sheet has them. */
export const SECTION_FILLS = ['FFCBD5E8', 'FFF4CAE4', 'FFE6F5C9', 'FFB3E2CD', 'FFFDCDAC'] as const
const TITLE_FILL = 'FFB3E2CD'

const thin = { style: 'thin' as const }
const box = { top: thin, left: thin, bottom: thin, right: thin }
const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

/** About how many characters a column of Excel width `width` holds on a line, for row heights. */
const charsPerLine = (width: number) => Math.max(10, Math.floor(width * 1.15))
const lineHeight = 15

/** Excel's tallest row, points. */
const MAX_ROW_POINTS = 409
/** How tall a figure is drawn when the row has room, points. */
const FIGURE_POINTS = 300
const CONSIDERATION_COLUMN_WIDTH = 174
const EMU_PER_POINT = 12_700
const EMU_PER_PIXEL = 9_525

/** A picture for a consideration: a map of its features, or a saved view under Visuals. */
export type RouteCardFigure = {
  consideration: ConsiderationId
  caption: string
  bytes: Uint8Array
  format: 'png' | 'jpeg'
  width: number
  height: number
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export type RouteCardWorkbookInput = {
  preset: RouteCardPreset
  sheet: RouteCardSheet
  considerations: readonly DraftedConsideration[]
  /** Provenance and caveats, one per line. */
  notes: readonly string[]
  /** Pictures under each consideration's paragraph, in its own row. */
  figures?: readonly RouteCardFigure[]
}

export async function routeCardWorkbook(input: RouteCardWorkbookInput, ExcelJS: ExcelModule): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'PGMaps'
  const font = { name: 'Calibri', size: 11 }

  const card = workbook.addWorksheet(input.preset.sheet.routeCard)
  card.columns = [{ width: 3 }, { width: 56 }, { width: 23 }, { width: 120 }, { width: 70 }]
  card.mergeCells('B2:D2')
  const title = card.getCell('B2')
  title.value = input.sheet.title
  title.font = { ...font, size: 13, bold: true }
  title.fill = solid(TITLE_FILL)
  title.border = box
  let row = 4
  input.sheet.sections.forEach((section, index) => {
    card.mergeCells(`B${row}:D${row}`)
    const band = card.getCell(`B${row}`)
    band.value = section.title
    band.font = { ...font, bold: true }
    band.fill = solid(SECTION_FILLS[index % SECTION_FILLS.length])
    band.border = box
    row += 1
    for (const printed of section.rows) {
      const cells = [
        ['B', printed.label],
        ['C', printed.value],
        ['D', printed.names || null],
      ] as const
      for (const [column, value] of cells) {
        const cell = card.getCell(`${column}${row}`)
        cell.value = value
        cell.font = { ...font, bold: printed.flagged }
        cell.border = box
      }
      if (printed.note) {
        const note = card.getCell(`E${row}`)
        note.value = printed.note
        note.font = { ...font, size: 9, italic: true, color: { argb: 'FF595959' } }
      }
      row += 1
    }
  })
  card.getCell('E3').value = 'PGMaps note'
  card.getCell('E3').font = { ...font, size: 9, bold: true, color: { argb: 'FF595959' } }

  const other = workbook.addWorksheet(input.preset.sheet.considerations)
  other.columns = [{ width: 3 }, { width: 40 }, { width: CONSIDERATION_COLUMN_WIDTH }]
  input.considerations.forEach((item, index) => {
    const at = index + 2
    const label = other.getCell(`B${at}`)
    label.value = item.title
    label.font = { ...font, bold: true }
    label.alignment = { vertical: 'top', wrapText: true }
    const paragraph = other.getCell(`C${at}`)
    paragraph.value = item.text
    paragraph.font = font
    paragraph.alignment = { vertical: 'top', wrapText: true }
    const lines = item.text
      .split('\n')
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine(CONSIDERATION_COLUMN_WIDTH))), 0)
    const textPoints = lines * lineHeight + 4
    const figures = input.figures?.filter((figure) => figure.consideration === item.id) ?? []
    if (!figures.length) {
      other.getRow(at).height = Math.max(lineHeight * 2, textPoints)
      return
    }
    // The planners' sheets carry a topic's figures in its own row, under the paragraph: side by side, as tall as
    // Excel lets a row be once the text has its lines.
    const imagePoints = Math.max(120, Math.min(FIGURE_POINTS, MAX_ROW_POINTS - textPoints - 6))
    const imagePixels = Math.round(imagePoints / 0.75)
    let left = 0
    for (const figure of figures) {
      const width = Math.round((figure.width / figure.height) * imagePixels)
      const id = workbook.addImage({ base64: base64Of(figure.bytes), extension: figure.format })
      other.addImage(id, {
        tl: {
          nativeCol: 2,
          nativeColOff: left * EMU_PER_PIXEL,
          nativeRow: at - 1,
          nativeRowOff: Math.round(textPoints * EMU_PER_POINT),
        },
        ext: { width, height: imagePixels },
      } as unknown as Parameters<typeof other.addImage>[1])
      left += width + 8
    }
    other.getRow(at).height = Math.min(MAX_ROW_POINTS, textPoints + imagePoints + 6)
  })

  const notes = workbook.addWorksheet('Notes')
  notes.columns = [{ width: 3 }, { width: 140 }]
  notes.getCell('B2').value = `${input.sheet.title} — ${input.preset.name}`
  notes.getCell('B2').font = { ...font, bold: true }
  input.notes.forEach((line, index) => {
    const cell = notes.getCell(`B${index + 4}`)
    cell.value = line
    cell.font = font
    cell.alignment = { wrapText: true, vertical: 'top' }
  })

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer
}
