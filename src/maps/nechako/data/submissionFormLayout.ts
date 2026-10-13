import { fetchJson } from '@/lib/fetchJson'
import { escapeHtml } from '@/lib/escapeHtml'
import { csvExport } from './monitoring'
import { fieldLinks, reviewObject, reviewText } from './submissionReview'
import {
  SUBMISSION_SNAPSHOT_BASE,
  snapshotFieldText,
  snapshotSourceUrl,
  type SnapshotField,
  type SubmissionRecord,
} from './submissionSnapshot'

export type SubmissionFormNode = {
  fieldId?: string
  label: string
  type: string
  dynamic: boolean
  page: number | string
  nodeRank: number | string
  fieldRank: number | string
  nodeType: string
  nodeName?: string
  semanticType: string
  content?: string
}
export type SubmissionFormDefinition = {
  id: string
  name: string
  pages: { id: number | string; label?: string }[]
  nodes: SubmissionFormNode[]
}
export type SubmissionFormDefinitions = {
  schema: 'nechako-public-form-definitions-v1'
  source: string
  capturedAt: string
  forms: SubmissionFormDefinition[]
}
const rank = (value: unknown): value is string | number =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
const sourceId = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))

export function checkedSubmissionFormDefinitions(raw: unknown): SubmissionFormDefinitions {
  if (
    !reviewObject(raw) ||
    raw.schema !== 'nechako-public-form-definitions-v1' ||
    typeof raw.source !== 'string' ||
    typeof raw.capturedAt !== 'string' ||
    !Array.isArray(raw.forms)
  )
    throw new Error('The public form definitions are invalid.')
  const forms = new Set<string>()
  for (const form of raw.forms) {
    if (
      !reviewObject(form) ||
      !sourceId(form.id) ||
      forms.has(form.id) ||
      typeof form.name !== 'string' ||
      !Array.isArray(form.nodes) ||
      !Array.isArray(form.pages)
    )
      throw new Error('A public form definition omits its source identity or nodes.')
    forms.add(form.id)
    if (
      form.pages.some(
        (page) => !reviewObject(page) || !rank(page.id) || (page.label !== undefined && typeof page.label !== 'string'),
      )
    )
      throw new Error('A public form page is invalid.')
    const fieldIds = new Set<string>()
    for (const node of form.nodes) {
      if (
        !reviewObject(node) ||
        typeof node.label !== 'string' ||
        typeof node.type !== 'string' ||
        typeof node.dynamic !== 'boolean' ||
        !rank(node.page) ||
        !rank(node.nodeRank) ||
        !rank(node.fieldRank) ||
        typeof node.nodeType !== 'string' ||
        typeof node.semanticType !== 'string' ||
        (node.nodeName !== undefined && typeof node.nodeName !== 'string') ||
        (node.content !== undefined && typeof node.content !== 'string') ||
        (node.fieldId !== undefined && !sourceId(node.fieldId)) ||
        (node.dynamic && !sourceId(node.fieldId))
      )
        throw new Error('A public form node is invalid.')
      if (node.fieldId) {
        if (fieldIds.has(node.fieldId)) throw new Error('Public form field IDs must be unique.')
        fieldIds.add(node.fieldId)
      }
    }
  }
  return raw as SubmissionFormDefinitions
}
export async function loadSubmissionFormDefinitions(signal?: AbortSignal) {
  return checkedSubmissionFormDefinitions(await fetchJson(`${SUBMISSION_SNAPSHOT_BASE}forms.json.gz`, signal))
}

export type SubmissionLayoutField = { definition?: SubmissionFormNode; field: SnapshotField }
export type SubmissionLayoutSection = {
  key: string
  page: string
  pageLabel?: string
  label: string
  fields: SubmissionLayoutField[]
  resource?: string
  content?: string
  fieldId?: string
}
/** Native Submission.js consumes nodes in returned order; ranks describe, never override, that order. */
export function submissionFormLayout(
  record: SubmissionRecord,
  form?: SubmissionFormDefinition,
): SubmissionLayoutSection[] {
  const sections: SubmissionLayoutSection[] = [],
    seen = new Set<string>()
  const byId = new Map(record.fields.map((field) => [field.id, field]))
  let group: SubmissionLayoutSection | undefined
  let groupRank: string | undefined
  for (const [index, node] of (form?.nodes ?? []).entries()) {
    const page = String(node.page),
      pageLabel = form?.pages.find((item) => String(item.id) === page)?.label
    if (node.dynamic) {
      const key = `${page}:${node.nodeRank}`
      if (!group || groupRank !== key) {
        group = { key: `node-${index}`, page, pageLabel, label: 'Dynamic Content', fields: [] }
        sections.push(group)
        groupRank = key
      }
      const field = byId.get(node.fieldId!) ?? {
        id: node.fieldId!,
        label: node.label,
        type: node.type,
        value: undefined,
      }
      group.fields.push({ definition: node, field })
      seen.add(node.fieldId!)
    } else {
      group = undefined
      groupRank = undefined
      sections.push({
        key: `node-${index}`,
        page,
        pageLabel,
        label: node.label,
        fields: [],
        resource: node.semanticType,
        content: node.content,
        fieldId: node.fieldId,
      })
    }
  }
  const remaining = record.fields.filter((field) => !seen.has(field.id))
  if (remaining.length)
    sections.push({
      key: 'captured-fields',
      page: '',
      label: form ? 'Other captured fields' : 'Dynamic Content',
      fields: remaining.map((field) => ({ field })),
    })
  return sections
}

export function publicSubmissionChildren(records: SubmissionRecord[], parentId: string) {
  return records.filter(
    (record) =>
      record.parentId !== undefined &&
      record.parentId !== null &&
      String(record.parentId) === parentId &&
      record.id !== parentId,
  )
}
export function submissionRecordCsv(record: SubmissionRecord) {
  return csvExport(
    [
      'Submission ID',
      'Form ID',
      'Submission Title',
      'Submission Name',
      'Field ID',
      'Field Label',
      'Field Type',
      'Value',
      'Source',
    ],
    record.fields.map((field) => [
      record.id,
      record.formId,
      record.title,
      record.name,
      field.id,
      field.label,
      field.type,
      reviewText(field.value),
      record.sourceUrl,
    ]),
  )
}
function exportedFieldLinks(field: SnapshotField) {
  const explicit =
    typeof field.value === 'string' && field.type === 'htmleditor'
      ? [...field.value.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((match) =>
          snapshotFieldText(match[1] ?? match[2] ?? match[3], 'htmleditor'),
        )
      : []
  return [
    ...new Set(
      [...explicit, ...fieldLinks(field.label, snapshotFieldText(field.value, field.type))].flatMap(
        (candidate) => snapshotSourceUrl(candidate, true) ?? [],
      ),
    ),
  ]
}
/** A readable HTML document, with escaped source text and explicit safe media links. No raw source HTML or inline image bytes. */
export function submissionRecordHtml(record: SubmissionRecord, capturedAt: string, form?: SubmissionFormDefinition) {
  const e = escapeHtml
  const sections = submissionFormLayout(record, form)
    .map(
      (section) =>
        `<section><h2>${e(section.pageLabel ? `${section.pageLabel} · ${section.label}` : section.label)}</h2>${section.fields
          .map(
            ({ field, definition }) =>
              `<h3>${e(definition?.label ?? field.label)}</h3><p class="provenance">Field ID ${e(field.id)} · ${e(definition?.type ?? field.type)}</p><div class="value">${e(snapshotFieldText(field.value, definition?.type ?? field.type)) || '(empty string)'}</div>${exportedFieldLinks(
                { ...field, type: definition?.type ?? field.type },
              )
                .map((url) => `<p><a href="${e(url)}" rel="noreferrer">${e(url)}</a></p>`)
                .join('')}`,
          )
          .join(
            '',
          )}${section.resource ? `<p>${e(section.content ? snapshotFieldText(section.content, 'htmleditor') : `Source form section: ${section.label}. Resource inventories appear below; protected workflow values are not included.`)}</p>` : ''}</section>`,
    )
    .join('')
  const resources = (['attachments', 'layers'] as const)
    .map(
      (key) =>
        `<h2>${key === 'attachments' ? 'Attachments' : 'Spatial Data'} (${record[key].length})</h2><ul>${record[key].map((item) => `<li>${e(item.name ?? '')} · Source ID ${e(item.id ?? 'not supplied')}</li>`).join('')}</ul>`,
    )
    .join('')
  const media = record.media
    .map((item) => {
      const url = snapshotSourceUrl(item.url, true)
      return `<li>Field ID ${e(item.fieldId)} · media ${e(item.ordinal)} · ${e(item.mime)} · ${e(item.kind)} ${url ? `<a href="${e(url)}" rel="noreferrer">Open source media</a>` : '(embedded media bytes remain in the original portal)'}</li>`
    })
    .join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(record.title || `Submission ${record.id}`)}</title><style>body{font:15px/1.6 system-ui;max-width:900px;margin:24px auto;padding:0 16px}h2{border-bottom:1px solid #ddd}.value{white-space:pre-wrap;overflow-wrap:anywhere}.provenance{font-size:12px;color:#555}section{margin:24px 0}</style><body><h1>${e(record.title || `Submission ${record.id}`)}</h1><p>Submission ID ${e(record.id)} · Form ID ${e(record.formId)} · ${e(record.formName)}</p><p>Submission Name: ${record.name === '' ? '(empty string)' : e(record.name)}<br>Submission Date: ${e(record.date)}<br>Submitted By: ${e(record.submittedBy ?? 'Not supplied')}</p><p class="provenance">Captured anonymous content: ${e(capturedAt)}. Source: <a href="${e(record.sourceUrl)}">original portal</a>; use submission ID ${e(record.id)} in its Search. Attachment/spatial bodies, embedded media bytes, permissions and history are excluded.</p>${sections}${resources}<h2>Media references (${record.media.length})</h2><ul>${media}</ul></body></html>`
}
