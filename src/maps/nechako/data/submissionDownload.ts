import { downloadBlob } from '@/lib/download'
import {
  submissionFormLayout,
  submissionRecordCsv,
  type SubmissionFormDefinition,
  type SubmissionFormDefinitions,
} from './submissionFormLayout'
import { snapshotFieldText, type SubmissionRecord, type SubmissionSnapshot } from './submissionSnapshot'
import { reviewText } from './submissionReview'

/** A portable public dataset. Source-only permissions/history and remote file bodies are absent. */
export async function buildPublicSubmissionArchive(
  snapshot: SubmissionSnapshot,
  forms: SubmissionFormDefinitions,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file(
    'submissions.json',
    JSON.stringify({
      schema: 'nechako-public-content-v1',
      source: snapshot.manifest.source,
      capturedAt: snapshot.manifest.capturedAt,
      records: snapshot.records,
    }),
  )
  zip.file('forms.json', JSON.stringify(forms))
  zip.file('manifest.json', JSON.stringify(snapshot.manifest, null, 2))
  zip.file(
    'README.txt',
    `Nechako public submissions\n${snapshot.records.length} captured submissions. Source: ${snapshot.manifest.source}\nCaptured: ${snapshot.manifest.capturedAt}\nThis archive contains sanitized public form content, form definitions, attachment/layer inventories and original media references. Binary attachments, spatial files, embedded media bytes, live permissions, history and private records are excluded. Source references can require portal access. The manifest's hashes describe the original compressed deployment files, not the decompressed copies in this archive.\n`,
  )
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/** Browser raster pages retain Unicode without relying on jsPDF's limited built-in font. */
export async function exportSubmissionPdf(
  record: SubmissionRecord,
  capturedAt: string,
  form?: SubmissionFormDefinition,
): Promise<void> {
  const lines: { text: string; heading?: boolean }[] = [
    { text: record.title || `Submission ${record.id}`, heading: true },
    { text: `Submission ID ${record.id} | ${record.formName} | Form ID ${record.formId}` },
    { text: `Captured: ${capturedAt}` },
    { text: `Original portal: ${record.sourceUrl}` },
    { text: `Submission name: ${record.name || '(empty string)'}` },
    { text: `Date: ${record.date} | Submitted by: ${record.submittedBy ?? 'Not supplied'}` },
  ]
  for (const section of submissionFormLayout(record, form)) {
    lines.push({ text: section.label, heading: true })
    for (const { field, definition } of section.fields) {
      lines.push({ text: `${definition?.label ?? field.label} (Field ${field.id})`, heading: true })
      lines.push({ text: snapshotFieldText(field.value, field.type) || '(empty string)' })
    }
  }
  for (const kind of ['attachments', 'layers'] as const) {
    lines.push({
      text: `${kind === 'attachments' ? 'Attachment' : 'Spatial layer'} references (${record[kind].length})`,
      heading: true,
    })
    for (const reference of record[kind])
      lines.push({
        text: `${reviewText(reference.name)} | Source ID ${reviewText(reference.id)}${reference.kind ? ` | ${reference.kind}` : ''}`,
      })
  }
  lines.push({ text: 'Media references', heading: true })
  for (const media of record.media)
    lines.push({
      text: `Field ${media.fieldId}, item ${media.ordinal}: ${media.url ?? `embedded media remains in original submission ${record.id}`}`,
    })
  lines.push({
    text: 'Public captured content only. Attachment/spatial bodies, embedded media bytes, live permissions and history are excluded. JSON and HTML preserve searchable text.',
  })
  if (lines.reduce((count, line) => count + line.text.length, 0) > 1_000_000)
    throw new Error('This submission is too large for PDF. Download JSON, HTML or CSV for the complete content.')
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ format: 'a4', unit: 'mm', compress: true })
  const canvas = document.createElement('canvas')
  canvas.width = 1240
  canvas.height = 1754
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The browser cannot render PDF pages. Use HTML or JSON.')
  let y = 95,
    page = 0
  const reset = () => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#28665d'
    ctx.font = '20px sans-serif'
    ctx.fillText('NECHAKO WATERSHED | PUBLIC SUBMISSION', 65, 48)
    y = 100
  }
  const flush = () => {
    if (++page > 200) throw new Error('PDF exceeds 200 pages. Use the complete HTML or JSON download.')
    ctx.fillStyle = '#666'
    ctx.font = '18px sans-serif'
    ctx.fillText(`Submission ${record.id} | PGMaps public content export | Page ${page}`, 65, 1710)
    if (page > 1) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
    reset()
  }
  reset()
  for (const item of lines) {
    if (item.heading) {
      if (y + 100 > 1650) flush()
      y += 14
    }
    for (const paragraph of item.text.split(/\r?\n/)) {
      let line = ''
      const draw = (value: string) => {
        if (y > 1650) flush()
        ctx.font = item.heading ? 'bold 23px sans-serif' : '22px sans-serif'
        ctx.fillStyle = item.heading ? '#183f38' : '#222'
        ctx.fillText(value, 65, y)
        y += 32
      }
      ctx.font = item.heading ? 'bold 23px sans-serif' : '22px sans-serif'
      for (const word of paragraph.split(/\s+/)) {
        if (line && ctx.measureText(`${line} ${word}`).width > 1110) {
          draw(line)
          line = ''
        }
        // Only long unbroken URLs/identifiers need character wrapping.
        if (ctx.measureText(word).width > 1110) {
          if (line) {
            draw(line)
            line = ''
          }
          for (const char of word) {
            if (ctx.measureText(line + char).width > 1110) {
              draw(line)
              line = ''
            }
            line += char
          }
        } else line += `${line ? ' ' : ''}${word}`
      }
      draw(line)
    }
    y += 8
  }
  flush()
  downloadBlob(pdf.output('blob'), `nechako-submission-${record.id}.pdf`)
}

export { submissionRecordCsv }
