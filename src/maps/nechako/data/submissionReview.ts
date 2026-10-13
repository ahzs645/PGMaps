import { checkedPortalAttributes } from '@/lib/nechakoPortal'
import { escapeHtml } from '@/lib/escapeHtml'
import { csvExport } from './monitoring'
import { collectionSourceUrl } from './portalCollections'

export type ReviewField = { id: string; label: string; type: string; required: boolean; source: unknown }
export type ReviewForm = { id: string; title: string; fields: ReviewField[]; original: unknown; staticNodes: string[] }
export function reviewObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function unwrapReview(value: unknown): unknown {
  return reviewObject(value) && 'attributes' in value ? checkedPortalAttributes(value) : value
}
export function reviewText(value: unknown): string {
  return value === null
    ? 'null'
    : value === undefined
      ? 'Not supplied'
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value)
}
function identifier(value: unknown): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    String(value).length > 200 ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  )
    throw new Error('A source field ID is missing or invalid.')
  return String(value)
}
/** Verified getForm nodes/field_* and getSchemaFields attr_* contracts, plus a declared local form. */
export function parseReviewForm(input: unknown): ReviewForm {
  const data = unwrapReview(input)
  const source = Array.isArray(data) ? data : reviewObject(data) ? (data.nodes ?? data.fields) : undefined
  if (!Array.isArray(source) || source.length > 200)
    throw new Error('Expected at most 200 form nodes or schema fields.')
  const fields: ReviewField[] = [],
    staticNodes: string[] = []
  source.forEach((value) => {
    if (!reviewObject(value)) throw new Error('Invalid form field.')
    const info = reviewObject(value.nodeInfo) ? value.nodeInfo : undefined
    if (info && ![true, 1, '1', 'true', 't'].includes(info.node_is_dynamic as string)) {
      staticNodes.push(String(info.node_name ?? value.field_label ?? 'Source form node'))
      return
    }
    fields.push({
      id: identifier(value.field_id ?? value.attr_id ?? value.id),
      label: String(value.field_label ?? value.attr_name ?? value.label ?? value.name ?? value.id),
      type: String(value.field_type ?? value.attr_type ?? value.type ?? 'text'),
      required: value.required === true,
      source: value,
    })
  })
  if (new Set(fields.map((field) => field.id)).size !== fields.length) throw new Error('Form field IDs must be unique.')
  return {
    id: reviewObject(data) ? String(data.form_id ?? data.id ?? '') : '',
    title: reviewObject(data)
      ? String(data.form_name ?? data.name ?? data.title ?? 'Imported form')
      : 'Imported schema fields',
    fields,
    staticNodes,
    original: input,
  }
}

export function fieldIssue(field: ReviewField, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '')
    return field.required ? 'Required value missing' : undefined
  const text = String(value)
  if (['bigint', 'integer', 'int', 'smallint'].includes(field.type.toLowerCase()) && !/^[+-]?\d+$/.test(text))
    return 'Use a whole-number integer'
  if (
    ['number', 'integer', 'int', 'real', 'double precision', 'numeric', 'float'].includes(field.type.toLowerCase()) &&
    (!text.trim() || !Number.isFinite(Number(text)))
  )
    return 'Invalid numeric value'
  if (
    field.type === 'date' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text)
  )
    return 'Use a valid YYYY-MM-DD date'
  if (
    ['checkbox', 'boolean', 'bool'].includes(field.type.toLowerCase()) &&
    !['true', 'false', 'yes', 'no', 'on', 'off', '0', '1'].includes(text.toLowerCase())
  )
    return 'Use true/false, yes/no, on/off or 1/0'
  return undefined
}
export type DraftReview = ReturnType<typeof buildDraftReview>
export function buildDraftReview(
  form: ReviewForm,
  mapping: Record<string, string>,
  rows: Record<string, unknown>[],
  sourceName: string,
  duplicateColumn = '',
) {
  if (rows.length > 10_000) throw new Error('Review at most 10,000 local drafts.')
  if (Object.keys(mapping).some((id) => !form.fields.some((field) => field.id === id)))
    throw new Error('Mapping contains an unknown target field ID.')
  const duplicates = new Map<string, number>()
  if (duplicateColumn)
    rows.forEach((row) => {
      const key = String(row[duplicateColumn] ?? '').trim()
      if (key) duplicates.set(key, (duplicates.get(key) ?? 0) + 1)
    })
  const drafts = rows.map((source, index) => {
    const values: Record<string, unknown> = {},
      issues: string[] = []
    for (const field of form.fields) {
      const column = Object.prototype.hasOwnProperty.call(mapping, field.id) ? mapping[field.id] : undefined
      if (column && !(column in source)) issues.push(`${field.label}: mapped column missing`)
      const value = column ? source[column] : undefined
      if (value !== undefined) Object.defineProperty(values, field.id, { value, enumerable: true, writable: true })
      const issue = fieldIssue(field, value)
      if (issue) issues.push(`${field.label}: ${issue}`)
    }
    if (!Object.keys(values).length) issues.push('No source values are mapped to target fields')
    const duplicate = duplicateColumn ? String(source[duplicateColumn] ?? '').trim() : ''
    if (duplicate && (duplicates.get(duplicate) ?? 0) > 1) issues.push(`Repeated source identifier: ${duplicate}`)
    return { localId: `row-${index + 1}`, sourceRow: index + 1, source, values, issues }
  })
  return {
    schema: 'nechako-local-draft-review-v1' as const,
    publication: 'not-submitted' as const,
    sourceName,
    formId: form.id,
    formTitle: form.title,
    formOriginal: form.original,
    mapping,
    duplicateColumn,
    drafts,
  }
}

/** GetFormStatistics.php attributes.rows is keyed by genuine source submission ID. */
export function formReportRows(input: unknown): Record<string, unknown>[] {
  const data = unwrapReview(input)
  if (!reviewObject(data) || !reviewObject(data.rows))
    throw new Error('Expected native form statistics with rows keyed by submission ID.')
  if (Object.keys(data.rows).length > 10_000) throw new Error('Review at most 10,000 source report records.')
  return Object.entries(data.rows).map(([id, value]) => {
    if (!reviewObject(value)) throw new Error('A source report row is invalid.')
    return { ...value, 'Submission ID': id }
  })
}
export type FormReport = {
  title: string
  source: string
  formId: string
  mapping: Record<string, string>
  rows: Record<string, unknown>[]
  original: unknown
}
export function formReportStatistics(report: FormReport): unknown {
  const original = unwrapReview(report.original)
  return reviewObject(original) ? original.statistics : undefined
}
export function formReportCsv(report: FormReport): string {
  const headers = [
    'Submission ID',
    'Submitted Time',
    'Submission Title',
    'Submission Name',
    ...Object.values(report.mapping),
  ]
  return csvExport(
    [...new Set(headers)],
    report.rows.map((row) => [...new Set(headers)].map((key) => row[key])),
  )
}
export function formReportHtml(report: FormReport): string {
  const e = escapeHtml,
    headers = [
      ...new Set([
        'Submission ID',
        'Submitted Time',
        'Submission Title',
        'Submission Name',
        ...Object.values(report.mapping),
      ]),
    ]
  const statistics = formReportStatistics(report)
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(report.title)}</title><style>body{font:14px/1.5 system-ui;margin:30px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #aaa;padding:8px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}thead{display:table-header-group}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{@page{size:landscape;margin:15mm}body{margin:0}}</style><body><h1>${e(report.title)}</h1><p>Source: ${e(report.source)}. Form ID: ${e(report.formId)}. ${report.rows.length} returned source rows. This export does not establish complete database coverage or change the original submissions.</p><table><thead><tr>${headers.map((header) => `<th>${e(header)}</th>`).join('')}</tr></thead><tbody>${report.rows.map((row) => `<tr>${headers.map((key) => `<td>${e(reviewText(row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table>${statistics === undefined ? '' : `<h2>Source-returned statistics</h2><p>Native values are retained without redefining their result/count semantics.</p><pre>${e(JSON.stringify(statistics, null, 2))}</pre>`}</body></html>`
}
export function fieldLinks(label: string, value: unknown): string[] {
  if (typeof value !== 'string') return []
  const links = (value.match(/https:\/\/[^\s<>"'\\]+/g) ?? []).flatMap(
    (candidate) => collectionSourceUrl(candidate) || [],
  )
  if (/\bdoi\b/i.test(label)) {
    const doi = value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    if (/^10\.\d{4,9}\/\S+$/i.test(doi)) links.push(`https://doi.org/${encodeURI(doi)}`)
  }
  return [...new Set(links)]
}
