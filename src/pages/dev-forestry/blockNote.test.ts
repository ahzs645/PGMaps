import { describe, expect, it } from 'vitest'
import * as ExcelJS from 'exceljs'
import * as jspdf from 'jspdf'

import {
  blockNoteFileName,
  blockNotePdf,
  blockNoteWorkbook,
  paragraphForLayout,
  type BlockNote,
  type NoteImage,
} from './blockNote'

/** A 16 × 9 grey-green JPEG. */
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ0ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAJABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCeiiivOOY//9k='

const image = (caption: string): NoteImage => ({ caption, dataUrl: JPEG, width: 1600, height: 900 })

const note = (extra: Partial<BlockNote> = {}): BlockNote => ({
  blockName: 'CHU_26_1',
  header: [
    { label: 'Block', value: 'CHU_26_1' },
    { label: 'Licence', value: 'A00000' },
    { label: 'EVQO under the block', value: "Partial Retention 'PR' 34% · Retention 'R' 1%" },
  ],
  visuals: {
    text: "The eastern portion of the block overlaps EVQO Partial Retention 'PR' and Retention 'R' polygons. Block may be visible from Hwy 97 and from Davie Lake South Rec Site.",
    drafted: true,
  },
  sentences: [{ id: 'overlap', text: 'Block overlaps …', basis: 'PR 34% of the block (20.0 ha)' }],
  landform: [{ label: 'Landform alteration', value: '15.3% perspective (PR range 1.6–7%)' }],
  views: [
    image('View from Hwy 97 looking west toward CHU_26_1.'),
    image('View of CHU_26_1 from Davie Lake South Rec Site.'),
  ],
  missingViews: [],
  planMap: image('Plan: CHU_26_1, EVQO polygons and viewpoints.'),
  notes: ['Terrain: AWS Open Data (CDEM/SRTM).'],
  generatedAt: new Date('2026-11-10T12:00:00Z'),
  ...extra,
})

describe('block note export', () => {
  it('writes the Visuals row where the planner keeps it, with the screenshots under it', async () => {
    const buffer = await blockNoteWorkbook(note(), ExcelJS)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Other Considerations', 'Block', 'Basis'])
    const other = workbook.getWorksheet('Other Considerations')!
    expect(other.getCell('B2').value).toBe('Visuals')
    expect(String(other.getCell('C2').value)).toContain('Davie Lake South Rec Site')
    expect(other.getCell('C3').value).toBe('Draft from the run — not yet reviewed.')
    // Two views and the plan map.
    expect(other.getImages()).toHaveLength(3)
    const captions: string[] = []
    other.eachRow((row) => {
      const value = row.getCell(2).value
      if (typeof value === 'string' && value.startsWith('View')) captions.push(value)
    })
    expect(captions).toEqual([
      'View from Hwy 97 looking west toward CHU_26_1.',
      'View of CHU_26_1 from Davie Lake South Rec Site.',
    ])
    const block = workbook.getWorksheet('Block')!
    const labels: string[] = []
    block.eachRow((row) => labels.push(String(row.getCell(1).value)))
    expect(labels).toContain('Licence')
    expect(labels).toContain('Landform alteration')
  })

  it('leaves the draft flag off once the paragraph is the reviewer’s', async () => {
    const buffer = await blockNoteWorkbook(note({ visuals: { text: 'Reviewed.', drafted: false } }), ExcelJS)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    expect(workbook.getWorksheet('Other Considerations')!.getCell('C3').value).toBeNull()
  })

  it('writes a PDF: the lead view with the note beside it, then the rest', () => {
    const bytes = new Uint8Array(blockNotePdf(note(), jspdf))
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF')).toBe(true)
    // Page 1 carries the lead view; page 2 the second view and the plan map.
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2)
    // Both views and the plan map are drawn (jsPDF stores the identical fixture image once).
    expect((text.match(/\/I\d+ Do/g) ?? []).length).toBe(3)
  })

  it('still writes a note with no views', () => {
    const bytes = new Uint8Array(blockNotePdf(note({ views: [], planMap: null, missingViews: ['View 1'] }), jspdf))
    expect(new TextDecoder('latin1').decode(bytes).startsWith('%PDF')).toBe(true)
  })

  it('names the file by block and date', () => {
    expect(blockNoteFileName(note({ blockName: 'CHU 26/1' }), 'xlsx')).toBe('CHU_26_1-visual-note-2026-11-10.xlsx')
  })

  it('points to the pictures where each file puts them', () => {
    const text = { text: 'Block may be visible from Hwy 97. See screenshots below.', drafted: false }
    // The workbook puts them below.
    expect(paragraphForLayout(note({ visuals: text }), 'xlsx')).toBe(text.text)
    // The PDF puts the first beside the paragraph, the second and the plan map on one more page.
    expect(paragraphForLayout(note({ visuals: text }), 'pdf')).toBe(
      'Block may be visible from Hwy 97. See the view at left and the others on the next page.',
    )
    expect(paragraphForLayout(note({ visuals: text, views: [image('One.')], planMap: null }), 'pdf')).toBe(
      'Block may be visible from Hwy 97. See the view at left.',
    )
    const many = [image('1'), image('2'), image('3'), image('4')]
    expect(paragraphForLayout(note({ visuals: text, views: many }), 'pdf')).toContain('on the following pages.')
    // Nothing to point to.
    expect(paragraphForLayout(note({ visuals: text, views: [] }), 'pdf')).toBe('Block may be visible from Hwy 97.')
    expect(paragraphForLayout(note({ visuals: text, views: [] }), 'xlsx')).toBe('Block may be visible from Hwy 97.')
    // The reviewer's own wording is left alone.
    const own = { text: 'Photos are attached separately.', drafted: false }
    expect(paragraphForLayout(note({ visuals: own }), 'pdf')).toBe(own.text)
  })
})
