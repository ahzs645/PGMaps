/**
 * An Excel workbook as an HTML page for Save & export's preview: each sheet as a table of its cells' text, merged
 * cells drawn once across their span, and its pictures in the cell their top-left corner sits in. The preview shows
 * the downloaded file itself, read back with exceljs (passed in), never a second rendering of the note. No DOM or
 * network access.
 */

type ExcelModule = Pick<typeof import('exceljs'), 'Workbook'>

/** Cells past these are left out of the preview (the download is whole); a block note is far smaller. */
export const WORKBOOK_PREVIEW_MAX_ROWS = 400
export const WORKBOOK_PREVIEW_MAX_COLUMNS = 40

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function base64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}

/** The image's bytes as a data URL, whatever exceljs keeps them as (a base64 string, a Buffer or an ArrayBuffer). */
function imageUrl(image: { base64?: string; buffer?: ArrayBuffer | Uint8Array; extension?: string }): string | null {
  const type = `image/${image.extension === 'jpg' ? 'jpeg' : (image.extension ?? 'png')}`
  if (image.base64) return image.base64.startsWith('data:') ? image.base64 : `data:${type};base64,${image.base64}`
  if (!image.buffer) return null
  const bytes = image.buffer instanceof Uint8Array ? image.buffer : new Uint8Array(image.buffer)
  return `data:${type};base64,${base64(bytes)}`
}

/** The workbook in `data` (an .xlsx file's bytes) as one HTML page. */
export async function workbookPreviewHtml(data: ArrayBuffer, excel: ExcelModule): Promise<string> {
  const workbook = new excel.Workbook()
  await workbook.xlsx.load(data)
  const sheets: string[] = []
  workbook.eachSheet((sheet) => {
    // Pictures by the cell their top-left corner is in (rows and columns from 1).
    const pictures = new Map<string, string[]>()
    let lastPictureRow = 0
    for (const placed of sheet.getImages()) {
      const tl = placed.range.tl as { nativeRow?: number; nativeCol?: number; row?: number; col?: number }
      const row = Math.floor(tl.nativeRow ?? tl.row ?? 0) + 1
      const col = Math.floor(tl.nativeCol ?? tl.col ?? 0) + 1
      const url = imageUrl(workbook.getImage(Number(placed.imageId)) as Parameters<typeof imageUrl>[0])
      if (!url) continue
      const key = `${row}:${col}`
      pictures.set(key, [...(pictures.get(key) ?? []), url])
      lastPictureRow = Math.max(lastPictureRow, row)
    }
    const rows = Math.min(WORKBOOK_PREVIEW_MAX_ROWS, Math.max(sheet.rowCount, lastPictureRow))
    const columns = Math.min(WORKBOOK_PREVIEW_MAX_COLUMNS, Math.max(1, sheet.columnCount))
    const body: string[] = []
    for (let r = 1; r <= rows; r++) {
      const row = sheet.getRow(r)
      const cells: string[] = []
      for (let c = 1; c <= columns; c++) {
        const cell = row.getCell(c)
        // A merged cell other than its top-left one is drawn by that one's span.
        if (cell.isMerged && cell.master.address !== cell.address) continue
        let span = ''
        if (cell.isMerged) {
          let right = c
          while (
            right < columns &&
            row.getCell(right + 1).isMerged &&
            row.getCell(right + 1).master.address === cell.address
          )
            right++
          let down = r
          while (down < rows && sheet.getRow(down + 1).getCell(c).master.address === cell.address) down++
          span = `${right > c ? ` colspan="${right - c + 1}"` : ''}${down > r ? ` rowspan="${down - r + 1}"` : ''}`
        }
        const text = cell.text ?? ''
        const images = (pictures.get(`${r}:${c}`) ?? []).map((url) => `<img src="${url}" alt="">`).join('')
        const bold = cell.font?.bold ? ' class="b"' : ''
        cells.push(`<td${span}${bold}>${escape(text).replace(/\n/g, '<br>')}${images}</td>`)
      }
      body.push(`<tr><th>${r}</th>${cells.join('')}</tr>`)
    }
    const cut =
      sheet.rowCount > WORKBOOK_PREVIEW_MAX_ROWS || sheet.columnCount > WORKBOOK_PREVIEW_MAX_COLUMNS
        ? '<p class="note">The preview stops here; the download is complete.</p>'
        : ''
    sheets.push(`<section><h2>${escape(sheet.name)}</h2><table>${body.join('')}</table>${cut}</section>`)
  })
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:12px system-ui,sans-serif;margin:12px;color:#111;background:#fff}
h2{font-size:13px;margin:16px 0 6px}
table{border-collapse:collapse}
td,th{border:1px solid #d4d4d4;padding:3px 6px;vertical-align:top;text-align:left}
th{background:#f4f4f5;color:#71717a;font-weight:400}
td.b{font-weight:600}
img{display:block;max-width:480px;height:auto;margin-top:4px}
.note{color:#71717a}
</style></head><body><p class="note">Each sheet of the workbook as its cells read; pictures sit in the cell their corner is in. The download is the workbook itself.</p>${sheets.join('')}</body></html>`
}
