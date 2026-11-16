import * as ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { blockNoteWorkbook, type BlockNote } from './blockNote'
import { workbookPreviewHtml } from './workbookPreview'

/** A 4 × 4 white PNG. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAD0lEQVR4nGP4jwQYiOMAANuQL9FuRbCyAAAAAElFTkSuQmCC'

const note: BlockNote = {
  blockName: 'Block <A> & co',
  header: [{ label: 'Block', value: 'Block <A> & co' }],
  visuals: { text: 'The block is not visible from Viewpoint 3.', drafted: false },
  sentences: [],
  landform: [{ label: 'Landform alteration', value: '0.3% perspective' }],
  views: [{ caption: 'Viewpoint 3, toward Block A.', dataUrl: PNG, width: 4, height: 4 }],
  missingViews: [],
  planMap: null,
  notes: ['Terrain: AWS Open Data (CDEM/SRTM).'],
  generatedAt: new Date('2026-11-15T12:00:00Z'),
}

describe('the workbook preview', () => {
  it('shows each sheet of the written workbook as its cells and pictures, never its zipped bytes', async () => {
    const buffer = await blockNoteWorkbook(note, ExcelJS)
    const html = await workbookPreviewHtml(buffer as ArrayBuffer, ExcelJS)
    expect(html).toContain('<h2>Other Considerations</h2>')
    expect(html).toContain('<td class="b">Visuals</td>')
    expect(html).toContain('The block is not visible from Viewpoint 3.')
    // Cell text is escaped, and the picture is drawn from the file's own media.
    expect(html).toContain('Block &lt;A&gt; &amp; co')
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+"/)
    // Not the zip container read as text.
    expect(html).not.toContain('PK\u0003\u0004')
    expect(html).not.toContain('[Content_Types].xml')
  })
})
