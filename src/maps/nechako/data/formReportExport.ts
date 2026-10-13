import { downloadBlob } from '@/lib/download'
import { formReportCsv, formReportHtml, formReportStatistics, reviewText, type FormReport } from './submissionReview'

export async function buildFormReportArchive(report: FormReport): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('report.html', formReportHtml(report))
  zip.file('report.csv', formReportCsv(report))
  zip.file('returned-source-attributes.json', JSON.stringify(report.original, null, 2))
  zip.file(
    'report-preset.json',
    JSON.stringify(
      { schema: 'nechako-form-report-preset-v1', formId: report.formId, title: report.title, mapping: report.mapping },
      null,
      2,
    ),
  )
  zip.file(
    'README.txt',
    `${report.title}\n${report.rows.length} returned source rows. Source: ${report.source}\nThis is a PGMaps review export, not the original portal attachment/spatial ZIP. It contains no downloaded external attachments or GIS files. No source records are changed.\n`,
  )
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/** Raster pages preserve Unicode without assuming a bundled PDF font supports the source text. */
export async function exportFormReportPdf(report: FormReport) {
  if (report.rows.length > 1_000)
    throw new Error('PDF review is limited to 1,000 returned records. CSV/HTML/ZIP retain all report rows.')
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ format: 'a4', unit: 'mm', compress: true })
  const canvas = document.createElement('canvas')
  canvas.width = 1240
  canvas.height = 1754
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser cannot render PDF pages.')
  const headers = [
    ...new Set([
      'Submission ID',
      'Submitted Time',
      'Submission Title',
      'Submission Name',
      ...Object.values(report.mapping),
    ]),
  ]
  const text = [
    report.title,
    `Source: ${report.source}`,
    `Form ${report.formId}; ${report.rows.length} returned source rows. No source changes.`,
    ...report.rows.flatMap((row, index) => [
      `Record ${index + 1}`,
      ...headers.map((key) => `${key}: ${reviewText(row[key])}`),
      '',
    ]),
  ]
  const statistics = formReportStatistics(report)
  if (statistics !== undefined)
    text.push('Source-returned statistics (native semantics retained)', JSON.stringify(statistics, null, 2))
  if (text.reduce((sum, line) => sum + line.length, 0) > 1_000_000)
    throw new Error('PDF text exceeds one million characters. Use the complete HTML/CSV/ZIP exports.')
  let y = 75,
    page = 0
  const reset = () => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#142b27'
    ctx.font = '22px sans-serif'
    y = 75
  }
  const flush = () => {
    if (++page > 200) throw new Error('PDF exceeds 200 pages. Use complete HTML/CSV/ZIP exports.')
    if (page > 1) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
    reset()
  }
  reset()
  for (const value of text)
    for (const paragraph of value.split(/\r?\n/)) {
      let line = ''
      const draw = (part: string) => {
        if (y > 1680) flush()
        ctx.fillText(part, 65, y)
        y += 31
      }
      for (const character of paragraph) {
        if (ctx.measureText(line + character).width > 1110) {
          draw(line)
          line = ''
        }
        line += character
      }
      draw(line)
    }
  flush()
  downloadBlob(pdf.output('blob'), 'source-form-report.pdf')
}
