/**
 * A block's visual-quality note as a file: the planner's Excel workbook or a
 * one-page PDF in the style of the report a GIS analyst ran at Canfor.
 *
 * Both carry the same thing: the block's header (block, licence, permit,
 * opening, area, EVQO classes under it), the Visuals paragraph — the
 * reviewer's, or the draft marked as one — the visual measures for the Site
 * Plan and Logging Plan, the landform and its percent alteration, the saved
 * views as captioned screenshots, and a plan map.
 *
 * - **Excel** mirrors the planner's own `*_Report.xlsx`: an "Other
 *   Considerations" sheet with the label in column B and the paragraph in C,
 *   screenshots and their captions below, so the row pastes into their
 *   workbook. A "Visual measures" sheet follows it in the same B/C layout, one
 *   measure per row, so the list pastes into the site plan and logging plan
 *   without moving anything on the first sheet. A "Block" sheet holds the
 *   header and figures, and "Basis" the measurement behind each drafted
 *   sentence and measure.
 * - **PDF** puts the first view large with the header and paragraph beside it,
 *   the measures under the paragraph when they fit (else on the next page),
 *   then the other views and the plan map. Where views carry their viewpoint
 *   record, a page per viewpoint follows in the layout consultants' VIA
 *   reports use (Forsite's Logan Lake assessment, pp. 8–11): the field
 *   photograph above the simulation from the same eye, with the settings that
 *   produced it beside them. Two views from the same pose under different
 *   design alternatives get a before-and-after page of their own.
 *
 * No DOM: the images arrive as JPEG (or, for a composed VIA figure, PNG) data
 * URLs with their pixel size, and
 * exceljs and jsPDF are passed in, so the tests write real files in Node.
 */
import type { NarrativeSentence } from './visualsNarrative'

export type NoteImage = {
  caption: string
  /** `data:image/jpeg;base64,…`, or `data:image/png;base64,…` for a composed VIA figure. */
  dataUrl: string
  width: number
  height: number
}

/** Whether a note image is a PNG (a composed figure) rather than a JPEG screenshot. */
export const isPngImage = (image: Pick<NoteImage, 'dataUrl'>) => image.dataUrl.startsWith('data:image/png')

/** A saved view's record for its own report page. */
export type ViewpointPage = {
  /** The view's caption, "View from <road> going <direction>". */
  title: string
  /** The design alternative the view was taken under, or null for the current design. */
  design: string | null
  harvestPhase: 'before' | 'after'
  /** Metres along the road, and the way the camera faced, for pairing views. */
  positionMeters: number
  bearingDegrees: number | null
  /** The road view as saved. */
  simulation: NoteImage
  /** The lined-up field photograph from the same eye, where one was showing. */
  photo: NoteImage | null
  /** What produced the simulation: eye height, lens, timber, shading and so on. */
  settings: Array<{ label: string; value: string }>
}

/**
 * Pairs of viewpoint pages from the same eye, looking the same way, under two
 * different designs — the before-and-after a redesign is judged on. Same
 * place within `positionToleranceMeters` along the road and the same facing
 * within `bearingToleranceDegrees`; each page pairs at most once, with the
 * first other design found, in the order the views were saved.
 */
export function designComparisonPairs(
  pages: ReadonlyArray<ViewpointPage>,
  positionToleranceMeters = 10,
  bearingToleranceDegrees = 5,
): Array<[ViewpointPage, ViewpointPage]> {
  const used = new Set<number>()
  const pairs: Array<[ViewpointPage, ViewpointPage]> = []
  const facing = (a: number | null, b: number | null) => {
    if (a === null || b === null) return a === b
    const difference = Math.abs(((((a - b) % 360) + 540) % 360) - 180)
    return difference <= bearingToleranceDegrees
  }
  pages.forEach((page, i) => {
    if (used.has(i)) return
    const j = pages.findIndex(
      (other, k) =>
        k > i &&
        !used.has(k) &&
        other.design !== page.design &&
        other.harvestPhase === page.harvestPhase &&
        Math.abs(other.positionMeters - page.positionMeters) <= positionToleranceMeters &&
        facing(other.bearingDegrees, page.bearingDegrees),
    )
    if (j < 0) return
    used.add(i)
    used.add(j)
    pairs.push([page, pages[j]])
  })
  return pairs
}

export type BlockNote = {
  blockName: string
  /** Label/value rows for the header, in order. */
  header: Array<{ label: string; value: string }>
  visuals: {
    text: string
    /** Not yet the reviewer's own text: the draft from the run. */
    drafted: boolean
  }
  /** The drafted sentences with their basis, for the "Basis" sheet. */
  sentences: ReadonlyArray<NarrativeSentence>
  /** The visual measures for the Site Plan and Logging Plan; left out when absent or empty. */
  measures?: {
    /** One measure each, without numbers: the files number them. */
    items: string[]
    /** Not yet the reviewer's own list: the draft. */
    drafted: boolean
    /** The drafted measures with what each was written from, for the "Basis" sheet. */
    basis: ReadonlyArray<{ text: string; basis: string }>
  }
  /** The landform figures, already worded. */
  landform: Array<{ label: string; value: string }>
  views: NoteImage[]
  /** Saved views without a screenshot (saved before screenshots were kept). */
  missingViews: string[]
  planMap: NoteImage | null
  /**
   * Each saved view with its viewpoint record, for the per-viewpoint pages.
   * Optional: a note built without them prints as before.
   */
  viewpoints?: ViewpointPage[]
  /**
   * The land status checks (`landStatusChecks.ts`) as read when the note was written: a screen, on
   * its own sheet and page. Optional: a note built without them prints as before.
   */
  landStatus?: { rows: Array<{ label: string; value: string; note: string }>; caveat: string }
  /** Provenance lines printed at the foot. */
  notes: string[]
  generatedAt: Date
}

const DATE = (date: Date) => date.toISOString().slice(0, 10)

export const MEASURES_TITLE = 'Visual measures'
export const LAND_STATUS_TITLE = 'Land status'
const MEASURES_FLAG = 'Draft from the assessment — not yet reviewed.'

/** The measures to print, numbered; empty when the note has none. */
export function numberedMeasures(note: BlockNote): string[] {
  return (note.measures?.items ?? []).map((item, i) => `${i + 1}. ${item}`)
}

/** The drafted pointer to the pictures, in the planner's wording. */
const SCREENSHOTS_SENTENCE = /\s*See (?:the )?screenshots? below\.?/i

/**
 * The paragraph as the file lays it out. The draft says "See screenshots below.",
 * which is true in the workbook; the PDF puts the first view beside the
 * paragraph and the rest on later pages, and a note with no screenshots has
 * nothing to point to. Only that sentence changes: the rest of the reviewer's
 * text is theirs.
 */
export function paragraphForLayout(note: BlockNote, format: 'xlsx' | 'pdf'): string {
  const text = note.visuals.text
  if (!SCREENSHOTS_SENTENCE.test(text)) return text
  if (!note.views.length) return text.replace(SCREENSHOTS_SENTENCE, '').trim()
  if (format === 'xlsx') return text
  const others = note.views.length - 1 + (note.planMap ? 1 : 0)
  // Two to a page after the first (see `blockNotePdf`).
  const pages = Math.ceil(others / 2)
  const pointer =
    note.views.length === 1
      ? 'See the view at left.'
      : `See the view at left and the others on the ${pages > 1 ? 'following pages' : 'next page'}.`
  return text.replace(SCREENSHOTS_SENTENCE, ` ${pointer}`).trim()
}

/** "CHU_26_1-visual-note-2026-11-10" */
export function blockNoteFileName(note: BlockNote, extension: 'xlsx' | 'pdf'): string {
  const safe = note.blockName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'block'
  return `${safe}-visual-note-${DATE(note.generatedAt)}.${extension}`
}

function base64Of(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

// ---------------------------------------------------------------------------
// Excel

type ExcelModule = typeof import('exceljs')

/** Rows of about 20 px each that an image of this pixel height spans. */
const rowsFor = (heightPx: number) => Math.ceil(heightPx / 20) + 1

export async function blockNoteWorkbook(note: BlockNote, ExcelJS: ExcelModule): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'PGMaps visual quality'
  workbook.created = note.generatedAt

  // The planner's layout: label in B, text in C, screenshots below.
  const other = workbook.addWorksheet('Other Considerations')
  other.getColumn(1).width = 2
  other.getColumn(2).width = 20
  other.getColumn(3).width = 110
  const label = other.getCell('B2')
  label.value = 'Visuals'
  label.font = { bold: true }
  label.alignment = { vertical: 'top' }
  const paragraph = other.getCell('C2')
  const text = paragraphForLayout(note, 'xlsx')
  paragraph.value = text
  paragraph.alignment = { wrapText: true, vertical: 'top' }
  other.getRow(2).height = Math.max(30, Math.ceil(text.length / 115) * 15 + 6)
  let row = 3
  if (note.visuals.drafted) {
    const flag = other.getCell(`C${row}`)
    flag.value = 'Draft from the run — not yet reviewed.'
    flag.font = { italic: true, color: { argb: 'FF92400E' } }
    row += 1
  }
  row += 1
  const placeImage = (image: NoteImage, widthPx: number) => {
    const heightPx = Math.round((image.height / image.width) * widthPx)
    const id = workbook.addImage({ base64: base64Of(image.dataUrl), extension: isPngImage(image) ? 'png' : 'jpeg' })
    // exceljs anchors are zero-based: column 1 is B.
    other.addImage(id, { tl: { col: 1, row: row - 1 }, ext: { width: widthPx, height: heightPx } })
    row += rowsFor(heightPx)
    const caption = other.getCell(`B${row}`)
    caption.value = image.caption
    caption.font = { italic: true }
    row += 2
  }
  for (const view of note.views) placeImage(view, 720)
  for (const caption of note.missingViews) {
    other.getCell(`B${row}`).value = `${caption} (no screenshot: reopen the view and save it again)`
    row += 1
  }
  if (note.planMap) placeImage(note.planMap, 720)

  // The measures on a sheet of their own, in the same B/C layout, so the first
  // sheet's cells and screenshots stay exactly where the planner's report has them.
  const measures = numberedMeasures(note)
  if (measures.length) {
    const sheet = workbook.addWorksheet(MEASURES_TITLE)
    sheet.getColumn(1).width = 2
    sheet.getColumn(2).width = 20
    sheet.getColumn(3).width = 110
    const title = sheet.getCell('B2')
    title.value = MEASURES_TITLE
    title.font = { bold: true }
    title.alignment = { vertical: 'top' }
    measures.forEach((text, i) => {
      const cell = sheet.getCell(`C${i + 2}`)
      cell.value = text
      cell.alignment = { wrapText: true, vertical: 'top' }
      sheet.getRow(i + 2).height = Math.max(15, Math.ceil(text.length / 115) * 15 + 3)
    })
    sheet.getCell('B3').value = 'Site Plan and Logging Plan'
    sheet.getCell('B3').font = { italic: true, color: { argb: 'FF6B7280' } }
    if (note.measures?.drafted) {
      const flag = sheet.getCell(`C${measures.length + 2}`)
      flag.value = MEASURES_FLAG
      flag.font = { italic: true, color: { argb: 'FF92400E' } }
    }
  }

  const block = workbook.addWorksheet('Block')
  block.getColumn(1).width = 34
  block.getColumn(2).width = 80
  block.addRow([note.blockName]).font = { bold: true, size: 13 }
  block.addRow([])
  for (const entry of [...note.header, ...note.landform]) {
    const added = block.addRow([entry.label, entry.value])
    added.getCell(1).font = { bold: true }
    added.getCell(2).alignment = { wrapText: true, vertical: 'top' }
  }
  block.addRow([])
  for (const line of note.notes) block.addRow([line]).getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }
  block.addRow([`Generated ${DATE(note.generatedAt)} by PGMaps visual quality.`])

  if (note.viewpoints?.length) {
    // One row per viewpoint: what produced each simulation, beside its caption.
    const sheet = workbook.addWorksheet('Viewpoints')
    const labels = [...new Set(note.viewpoints.flatMap((page) => page.settings.map((entry) => entry.label)))]
    sheet.getColumn(1).width = 46
    sheet.getColumn(2).width = 22
    sheet.getColumn(3).width = 10
    sheet.getColumn(4).width = 14
    labels.forEach((_, i) => (sheet.getColumn(5 + i).width = 18))
    sheet.addRow(['View', 'Design', 'Phase', 'Field photo', ...labels]).font = { bold: true }
    for (const page of note.viewpoints) {
      const values = new Map(page.settings.map((entry) => [entry.label, entry.value]))
      sheet.addRow([
        page.title,
        page.design ?? 'Current design',
        page.harvestPhase === 'after' ? 'After' : 'Before',
        page.photo ? 'Lined up' : '—',
        ...labels.map((label) => values.get(label) ?? ''),
      ])
    }
  }

  if (note.landStatus?.rows.length) {
    const sheet = workbook.addWorksheet(LAND_STATUS_TITLE)
    sheet.getColumn(1).width = 28
    sheet.getColumn(2).width = 30
    sheet.getColumn(3).width = 100
    sheet.addRow([LAND_STATUS_TITLE]).font = { bold: true, size: 13 }
    sheet.addRow([note.landStatus.caveat]).getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }
    sheet.addRow([])
    sheet.addRow(['Check', 'Result', 'Detail']).font = { bold: true }
    for (const entry of note.landStatus.rows) {
      const added = sheet.addRow([entry.label, entry.value, entry.note])
      added.alignment = { wrapText: true, vertical: 'top' }
    }
  }

  const basis = workbook.addWorksheet('Basis')
  basis.getColumn(1).width = 70
  basis.getColumn(2).width = 80
  basis.addRow(['Drafted sentence', 'Written from']).font = { bold: true }
  for (const sentence of note.sentences) {
    const added = basis.addRow([sentence.text, sentence.basis])
    added.alignment = { wrapText: true, vertical: 'top' }
  }
  if (note.measures?.basis.length) {
    basis.addRow([])
    basis.addRow(['Drafted visual measure', 'Written from']).font = { bold: true }
    for (const measure of note.measures.basis) {
      const added = basis.addRow([measure.text, measure.basis])
      added.alignment = { wrapText: true, vertical: 'top' }
    }
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

// ---------------------------------------------------------------------------
// PDF

type PdfModule = typeof import('jspdf')
type Pdf = InstanceType<PdfModule['jsPDF']>

/** Letter landscape, millimetres. */
const PAGE = { width: 279.4, height: 215.9, margin: 12 }

function fitImage(image: NoteImage, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
  return { width: image.width * scale, height: image.height * scale }
}

/** Body text at 9 pt with a 1.35 line height, in millimetres. */
const LINE_MM = 4.3

/** The measures as wrapped lines, each item's continuation indented under its number. */
function measureLines(pdf: Pdf, note: BlockNote, width: number): string[][] {
  return numberedMeasures(note).map((text) => pdf.splitTextToSize(text, width) as string[])
}

/** Millimetres the measures block takes: title, flag, items. */
function measuresHeight(note: BlockNote, lines: string[][]): number {
  if (!lines.length) return 0
  return 6 + (note.measures?.drafted ? 5 : 0) + lines.reduce((sum, item) => sum + item.length * LINE_MM + 1, 0)
}

function drawMeasures(pdf: Pdf, note: BlockNote, lines: string[][], x: number, top: number): number {
  let y = top
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(`${MEASURES_TITLE} · Site Plan and Logging Plan`, x, y + 3)
  y += 6
  if (note.measures?.drafted) {
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(8)
    pdf.setTextColor(146, 64, 14)
    pdf.text(MEASURES_FLAG, x, y + 2)
    pdf.setTextColor(17, 24, 39)
    y += 5
  }
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  for (const item of lines) {
    pdf.text(item, x, y + 3, { lineHeightFactor: 1.35 })
    y += item.length * LINE_MM + 1
  }
  return y
}

function drawImage(pdf: Pdf, image: NoteImage, x: number, y: number, maxWidth: number, maxHeight: number): number {
  const size = fitImage(image, maxWidth, maxHeight)
  pdf.addImage(image.dataUrl, isPngImage(image) ? 'PNG' : 'JPEG', x, y, size.width, size.height)
  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(9)
  pdf.setTextColor(55, 65, 81)
  pdf.text(pdf.splitTextToSize(image.caption, maxWidth), x, y + size.height + 4.5)
  pdf.setTextColor(17, 24, 39)
  return y + size.height + 10
}

export function blockNotePdf(note: BlockNote, { jsPDF }: PdfModule): ArrayBuffer {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' })
  const { width, height, margin } = PAGE

  const footer = () => {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(107, 114, 128)
    const lines = pdf.splitTextToSize(
      [...note.notes, `Generated ${DATE(note.generatedAt)} by PGMaps visual quality.`].join('  ·  '),
      width - 2 * margin,
    )
    pdf.text(lines, margin, height - margin + 2 - (lines.length - 1) * 3)
    pdf.setTextColor(17, 24, 39)
  }

  // Page 1: the view from the viewpoint, with the block's note beside it.
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text(`${note.blockName} · Visual quality note`, margin, margin + 4)
  const top = margin + 10
  const sideWidth = 92
  const mainWidth = width - 2 * margin - sideWidth - 6
  const bodyHeight = height - top - margin - 12
  const [first, ...rest] = note.views
  const lead = first ?? note.planMap
  if (lead) drawImage(pdf, lead, margin, top, mainWidth, bodyHeight - 12)
  else {
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(10)
    pdf.text('No saved view yet: save one from the road view to include it.', margin, top + 6)
  }

  let y = top
  const sideX = width - margin - sideWidth
  pdf.setFontSize(8.5)
  for (const entry of [...note.header, ...note.landform]) {
    pdf.setFont('helvetica', 'bold')
    pdf.text(entry.label, sideX, y + 3)
    pdf.setFont('helvetica', 'normal')
    const value = pdf.splitTextToSize(entry.value, sideWidth - 34)
    pdf.text(value, sideX + 34, y + 3)
    y += Math.max(1, value.length) * 3.8 + 1.2
  }
  y += 3
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text('Visuals', sideX, y + 3)
  y += 6
  if (note.visuals.drafted) {
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(8)
    pdf.setTextColor(146, 64, 14)
    pdf.text('Draft from the run — not yet reviewed.', sideX, y + 2)
    pdf.setTextColor(17, 24, 39)
    y += 5
  }
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  const paragraph = pdf.splitTextToSize(paragraphForLayout(note, 'pdf'), sideWidth)
  const room = Math.floor((height - margin - 14 - y) / 4.2)
  const shown = paragraph.slice(0, room)
  pdf.text(shown, sideX, y + 3, { lineHeightFactor: 1.35 })
  const overflow = paragraph.slice(room)
  // The measures follow the paragraph: beside the view when they fit, else on the next page.
  const sideMeasures = measureLines(pdf, note, sideWidth)
  const measuresBeside =
    sideMeasures.length > 0 &&
    !overflow.length &&
    y + 3 + shown.length * LINE_MM + 4 + measuresHeight(note, sideMeasures) <= height - margin - 14
  if (measuresBeside) drawMeasures(pdf, note, sideMeasures, sideX, y + 3 + shown.length * LINE_MM + 4)
  const measuresLater = sideMeasures.length > 0 && !measuresBeside
  footer()

  // Then the rest: the paragraph's overflow and the measures, every other view, the plan map.
  const pages: Array<NoteImage | 'overflow'> = [
    ...(overflow.length || measuresLater ? (['overflow'] as const) : []),
    ...rest,
    ...(lead === note.planMap || !note.planMap ? [] : [note.planMap]),
  ]
  let cursor = Infinity
  for (const item of pages) {
    if (item === 'overflow') {
      pdf.addPage()
      footer()
      let top = margin
      if (overflow.length) {
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.text(overflow, margin, margin + 4, { lineHeightFactor: 1.35 })
        top += overflow.length * LINE_MM + 6
      }
      if (measuresLater) {
        const lines = measureLines(pdf, note, width - 2 * margin)
        // A list too long for what is left of the page starts a page of its own.
        if (top + measuresHeight(note, lines) > height - margin - 12 && top > margin) {
          pdf.addPage()
          footer()
          top = margin
        }
        drawMeasures(pdf, note, lines, margin, top)
      }
      cursor = Infinity
      continue
    }
    // Two to a page: each image, its caption, and the footer's room.
    const maxHeight = (height - 3 * margin - 20) / 2 - 2
    const size = fitImage(item, width - 2 * margin, maxHeight)
    if (cursor + size.height + 10 > height - margin - 12) {
      pdf.addPage()
      cursor = margin
      footer()
    }
    cursor = drawImage(pdf, item, margin, cursor, width - 2 * margin, maxHeight)
  }
  // A page per viewpoint, field photograph over simulation, settings beside.
  const heading = (text: string, sub: string) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text(text, margin, margin + 4)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(75, 85, 99)
    pdf.text(sub, margin, margin + 9)
    pdf.setTextColor(17, 24, 39)
  }
  const settingsTable = (page: ViewpointPage, x: number, y: number, tableWidth: number) => {
    pdf.setFontSize(8.5)
    for (const entry of [
      { label: 'Design', value: page.design ?? 'Current design' },
      { label: 'Harvest', value: page.harvestPhase === 'after' ? 'After harvest (simulated)' : 'Before harvest' },
      ...page.settings,
    ]) {
      pdf.setFont('helvetica', 'bold')
      pdf.text(entry.label, x, y + 3)
      pdf.setFont('helvetica', 'normal')
      const value = pdf.splitTextToSize(entry.value, tableWidth - 32)
      pdf.text(value, x + 32, y + 3)
      y += Math.max(1, value.length) * 3.8 + 1.2
    }
    return y
  }
  const viewpointPages = note.viewpoints ?? []
  viewpointPages.forEach((page, index) => {
    pdf.addPage()
    heading(
      `Viewpoint ${index + 1} · ${page.title}`,
      page.photo
        ? 'Field photograph (top) and simulation from the same eye (bottom).'
        : 'Simulation. No field photograph was lined up when this view was saved.',
    )
    const top = margin + 14
    const tableWidth = 84
    const imageWidth = width - 2 * margin - tableWidth - 6
    const available = height - top - margin - 14
    if (page.photo) {
      const half = available / 2 - 6
      const next = drawImage(
        pdf,
        { ...page.photo, caption: `Field photograph. ${page.photo.caption}` },
        margin,
        top,
        imageWidth,
        half,
      )
      drawImage(
        pdf,
        { ...page.simulation, caption: `Simulation. ${page.simulation.caption}` },
        margin,
        next,
        imageWidth,
        half,
      )
    } else {
      drawImage(
        pdf,
        { ...page.simulation, caption: `Simulation. ${page.simulation.caption}` },
        margin,
        top,
        imageWidth,
        available - 8,
      )
    }
    settingsTable(page, width - margin - tableWidth, top, tableWidth)
    footer()
  })

  // Before and after a redesign, from the same eye.
  for (const [first, second] of designComparisonPairs(viewpointPages)) {
    pdf.addPage()
    heading(
      `Design comparison · ${first.title}`,
      `${first.design ?? 'Current design'} (top) and ${second.design ?? 'current design'} (bottom), from the same eye.`,
    )
    const top = margin + 14
    const half = (height - top - margin - 14) / 2 - 6
    const next = drawImage(
      pdf,
      { ...first.simulation, caption: `${first.design ?? 'Current design'}. ${first.simulation.caption}` },
      margin,
      top,
      width - 2 * margin,
      half,
    )
    drawImage(
      pdf,
      { ...second.simulation, caption: `${second.design ?? 'Current design'}. ${second.simulation.caption}` },
      margin,
      next,
      width - 2 * margin,
      half,
    )
    footer()
  }

  if (note.landStatus?.rows.length) {
    pdf.addPage()
    heading(`${LAND_STATUS_TITLE} checks`, 'Each layer measured against the blocks and the landform.')
    const caveat = pdf.splitTextToSize(note.landStatus.caveat, width - 2 * margin) as string[]
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(8.5)
    pdf.text(caveat, margin, margin + 15)
    const labelWidth = 48
    const valueWidth = 52
    const noteWidth = width - 2 * margin - labelWidth - valueWidth
    let y = margin + 17 + caveat.length * 3.8
    for (const entry of note.landStatus.rows) {
      pdf.setFontSize(8.5)
      const value = pdf.splitTextToSize(entry.value, valueWidth - 4) as string[]
      const detail = pdf.splitTextToSize(entry.note, noteWidth) as string[]
      const rowHeight = Math.max(value.length, detail.length, 1) * 3.8 + 2
      if (y + rowHeight > height - margin - 12) {
        footer()
        pdf.addPage()
        y = margin
      }
      pdf.setFont('helvetica', 'bold')
      pdf.text(entry.label, margin, y + 3)
      pdf.setFont('helvetica', 'normal')
      pdf.text(value, margin + labelWidth, y + 3)
      pdf.setTextColor(75, 85, 99)
      pdf.text(detail, margin + labelWidth + valueWidth, y + 3)
      pdf.setTextColor(17, 24, 39)
      y += rowHeight
    }
    footer()
  }

  if (note.missingViews.length) {
    pdf.addPage()
    pdf.setFont('helvetica', 'italic')
    pdf.setFontSize(9)
    pdf.text(
      ['Saved views without a screenshot (reopen each and save it again):', ...note.missingViews],
      margin,
      margin + 4,
    )
    footer()
  }
  return pdf.output('arraybuffer')
}
