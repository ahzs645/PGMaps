import { fetchJson } from '@/lib/fetchJson'
import { NECHAKO_PORTAL, parsePortalSearch, type SearchTree } from '@/lib/nechakoPortal'
import { collectionSourceUrl } from './portalCollections'
import { reviewText } from './submissionReview'

export const SUBMISSION_SNAPSHOT_BASE = '/data/nechako-portal/'
export type SnapshotField = { id: string; label: string; type: string; value: unknown }
export type SnapshotMedia = {
  fieldId: string
  ordinal: number
  mime: string
  kind: 'embedded' | 'remote'
  sourceUrl: string
  url?: string
  sha256?: string
}
export type SubmissionRecord = {
  id: string
  title: string
  name: string
  formId: string
  formName: string
  date: string
  submittedBy?: string
  parentId?: number | null
  sourceUrl: string
  fields: SnapshotField[]
  attachments: Record<string, unknown>[]
  layers: Record<string, unknown>[]
  media: SnapshotMedia[]
  searchText: string
}
export type SubmissionSnapshotManifest = {
  schema: 'nechako-public-content-manifest-v1'
  source: string
  capturedAt: string
  scope: string
  recordCount: number
  fieldCount: number
  mediaCount: number
  attachmentCount: number
  layerCount: number
  files?: Record<string, { bytes: number; uncompressedBytes?: number; sha256?: string; uncompressedSha256?: string }>
  limitations?: string[]
  omissions?: unknown
}
export type SubmissionSnapshot = { manifest: SubmissionSnapshotManifest; records: SubmissionRecord[] }

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const literalValue = (value = '') => value.replace(/''/g, "'")
function id(value: unknown) {
  if (
    !['string', 'number'].includes(typeof value) ||
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error('The submission snapshot contains an invalid source ID.')
  return String(value)
}

/** Preserve only explicit safe links; never manufacture a source submission URL. */
export function snapshotSourceUrl(value: unknown, allowHttp = false): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value, NECHAKO_PORTAL)
    return allowHttp && url.protocol === 'http:' && !url.username && !url.password
      ? url.href
      : collectionSourceUrl(url.href)
  } catch {
    return undefined
  }
}

/** Readable text only. This output is rendered as React text, never injected HTML. */
export function snapshotFieldText(value: unknown, type = ''): string {
  if (typeof value !== 'string' || type !== 'htmleditor') return reviewText(value)
  return value
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:img|embed|input)\b[^>]*>/gi, '')
    .replace(/<\/?(?:p|div|li|h[1-6]|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|apos);/g,
      (entity) =>
        ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity,
    )
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
      const number = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number(code)
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity
    })
    .trim()
}

export function checkedSubmissionManifest(value: unknown): SubmissionSnapshotManifest {
  if (
    !object(value) ||
    value.schema !== 'nechako-public-content-manifest-v1' ||
    typeof value.source !== 'string' ||
    typeof value.capturedAt !== 'string' ||
    typeof value.scope !== 'string' ||
    ['recordCount', 'fieldCount', 'mediaCount', 'attachmentCount', 'layerCount'].some((key) => !count(value[key]))
  )
    throw new Error('The submission snapshot manifest is invalid.')
  return value as SubmissionSnapshotManifest
}

export function checkedSubmissionRecords(value: unknown): SubmissionRecord[] {
  if (
    !object(value) ||
    value.schema !== 'nechako-public-content-v1' ||
    typeof value.source !== 'string' ||
    typeof value.capturedAt !== 'string' ||
    !Array.isArray(value.records)
  )
    throw new Error('The submission snapshot did not return its declared record collection.')
  const seen = new Set<string>()
  return value.records.map((raw) => {
    if (!object(raw)) throw new Error('Invalid submission record.')
    const recordId = id(raw.id)
    if (seen.has(recordId)) throw new Error('The submission snapshot contains duplicate source IDs.')
    seen.add(recordId)
    if (
      ['title', 'name', 'formName', 'date'].some((key) => typeof raw[key] !== 'string') ||
      !Array.isArray(raw.fields) ||
      !Array.isArray(raw.media)
    )
      throw new Error('A submission record omits its metadata or fields.')
    const fieldIds = new Set<string>()
    const fields = raw.fields.map((field): SnapshotField => {
      if (
        !object(field) ||
        typeof field.label !== 'string' ||
        typeof field.type !== 'string' ||
        !Object.prototype.hasOwnProperty.call(field, 'value')
      )
        throw new Error('A source field omits its definition or returned value.')
      const fieldId = id(field.id)
      if (fieldIds.has(fieldId)) throw new Error('A submission contains duplicate field IDs.')
      fieldIds.add(fieldId)
      return { id: fieldId, label: field.label, type: field.type, value: field.value }
    })
    const references = (key: 'attachments' | 'layers') => {
      if (!Array.isArray(raw[key]) || raw[key].some((row) => !object(row)))
        throw new Error('Invalid source resource inventory.')
      return raw[key] as Record<string, unknown>[]
    }
    const media = raw.media.map((item): SnapshotMedia => {
      if (
        !object(item) ||
        !['embedded', 'remote'].includes(String(item.kind)) ||
        !count(item.ordinal) ||
        typeof item.mime !== 'string'
      )
        throw new Error('Invalid source media reference.')
      return {
        fieldId: id(item.fieldId),
        ordinal: Number(item.ordinal),
        mime: item.mime,
        kind: item.kind as SnapshotMedia['kind'],
        sourceUrl: snapshotSourceUrl(item.sourceUrl) ?? NECHAKO_PORTAL,
        ...(snapshotSourceUrl(item.url, true) ? { url: snapshotSourceUrl(item.url, true) } : {}),
        ...(typeof item.sha256 === 'string' ? { sha256: item.sha256 } : {}),
      }
    })
    let parentId: number | null | undefined
    if (raw.parentId === null) parentId = null
    else if (raw.parentId !== undefined) {
      if (
        !['string', 'number'].includes(typeof raw.parentId) ||
        (typeof raw.parentId === 'string' && !/^(?:-1|\d+)$/.test(raw.parentId)) ||
        !Number.isSafeInteger(Number(raw.parentId)) ||
        Number(raw.parentId) < -1
      )
        throw new Error('Invalid source parent relationship.')
      parentId = Number(raw.parentId)
    }
    const result = {
      id: recordId,
      title: raw.title as string,
      name: raw.name as string,
      formId: id(raw.formId),
      formName: raw.formName as string,
      date: raw.date as string,
      ...(typeof raw.submittedBy === 'string' ? { submittedBy: raw.submittedBy } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      sourceUrl: snapshotSourceUrl(raw.sourceUrl) ?? NECHAKO_PORTAL,
      fields,
      attachments: references('attachments'),
      layers: references('layers'),
      media,
      searchText: '',
    }
    // Field content is always indexed, even if the producer's convenience index
    // is absent or incomplete. Falsy values retain their actual text.
    result.searchText = [
      recordId,
      result.title,
      result.name,
      result.formName,
      result.date,
      result.submittedBy ?? '',
      typeof raw.searchText === 'string' ? raw.searchText : '',
      ...fields.flatMap((field) => [field.id, field.label, snapshotFieldText(field.value, field.type)]),
    ]
      .join('\n')
      .toLocaleLowerCase()
    return result
  })
}

export async function readSubmissionManifest(signal?: AbortSignal) {
  return checkedSubmissionManifest(await fetchJson(`${SUBMISSION_SNAPSHOT_BASE}manifest.json`, signal))
}
export async function loadSubmissionSnapshot(signal?: AbortSignal): Promise<SubmissionSnapshot> {
  const [manifest, raw] = await Promise.all([
    readSubmissionManifest(signal),
    fetchJson<unknown>(`${SUBMISSION_SNAPSHOT_BASE}submissions.json.gz`, signal),
  ])
  const records = checkedSubmissionRecords(raw)
  if (!object(raw) || raw.source !== manifest.source || raw.capturedAt !== manifest.capturedAt)
    throw new Error('Submission snapshot metadata does not match its manifest capture.')
  if (
    manifest.recordCount !== records.length ||
    manifest.fieldCount !== records.reduce((total, row) => total + row.fields.length, 0) ||
    manifest.mediaCount !== records.reduce((total, row) => total + row.media.length, 0) ||
    manifest.attachmentCount !== records.reduce((total, row) => total + row.attachments.length, 0) ||
    manifest.layerCount !== records.reduce((total, row) => total + row.layers.length, 0)
  )
    throw new Error('Submission snapshot counts do not match its manifest; reload the complete snapshot.')
  return { manifest, records }
}

export function submissionType(record: SubmissionRecord): string {
  return record.parentId === undefined
    ? '—'
    : record.parentId !== null && record.parentId > 0
      ? `A:${record.parentId}`
      : 'S'
}

function columnValues(row: SubmissionRecord, name: string): unknown[] {
  const columns: Record<string, unknown> = {
    'submission id': row.id,
    'submission title': row.title,
    'submission name': row.name,
    'submission date': row.date,
    'submission time': row.date,
    'submitted by': row.submittedBy,
    'submission submitter': row.submittedBy,
    'form id': row.formId,
    'form name': row.formName,
    type: submissionType(row),
    'parent submission id': row.parentId,
  }
  const key = name.toLocaleLowerCase()
  if (Object.prototype.hasOwnProperty.call(columns, key)) return [columns[key]]
  return row.fields
    .filter((field) => field.label.toLocaleLowerCase() === key || `field_${field.id}` === key)
    .map((field) => field.value)
}
function comparison(actual: unknown, expected: SearchTree, operation: string): boolean {
  if (actual === undefined) return false
  let left: string | number | boolean = reviewText(actual).toLocaleLowerCase()
  let right: string | number | boolean = literalValue(expected.value).toLocaleLowerCase()
  if (
    typeof actual === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.test(actual) &&
    typeof right === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.test(right)
  ) {
    if (actual.length === 10) left += ' 00:00:00.000'
    if (right.length === 10) right += ' 00:00:00.000'
  }
  if (expected.token === 'number') {
    if (actual === null || typeof actual === 'boolean' || !String(actual).trim() || !Number.isFinite(Number(actual)))
      return false
    left = Number(actual)
    right = Number(expected.value)
  } else if (expected.token === 'tru' || expected.token === 'fals') {
    if (![true, false, 'true', 'false', 't', 'f', 0, 1, '0', '1'].includes(actual as string)) return false
    left = [true, 'true', 't', 1, '1'].includes(actual as string)
    right = expected.token === 'tru'
  }
  const negate = operation.startsWith('!'),
    op = negate ? operation.slice(1) : operation
  // Local ~ means contains text; regex/SQL evaluation remains with the original portal.
  const result =
    op === '~'
      ? String(left).includes(String(right))
      : op === '='
        ? left === right
        : op === '>'
          ? left > right
          : op === '>='
            ? left >= right
            : op === '<'
              ? left < right
              : op === '<='
                ? left <= right
                : false
  return negate ? !result : result
}
export function filterSubmissionSnapshot(
  records: SubmissionRecord[],
  expression: string,
  formId = '',
  permittedIds?: Set<string>,
) {
  if (expression.length > 5000) throw new Error('Use an expression of at most 5,000 characters.')
  const tree = expression.trim() ? parsePortalSearch(expression) : undefined
  const known = new Set([
    'submission id',
    'submission title',
    'submission name',
    'submission date',
    'submission time',
    'submitted by',
    'submission submitter',
    'form id',
    'form name',
    'type',
    'parent submission id',
    ...records.flatMap((row) => row.fields.flatMap((field) => [field.label.toLocaleLowerCase(), `field_${field.id}`])),
  ])
  const validate = (node: SearchTree) => {
    if (node.token === 'column' && !known.has(literalValue(node.value).toLocaleLowerCase()))
      throw new Error(`Unknown snapshot field: ${node.value}`)
    if (node.token === 'comparator' && node.right?.token === 'column' && node.value?.includes('~'))
      throw new Error('Place the field on the left of a local contains comparison.')
    if (node.left) validate(node.left)
    if (node.right) validate(node.right)
  }
  if (tree) validate(tree)
  const matches = (row: SubmissionRecord, node: SearchTree): boolean => {
    if (node.token === 'AND') return !!node.left && !!node.right && matches(row, node.left) && matches(row, node.right)
    if (node.token === 'OR') return !!node.left && !!node.right && (matches(row, node.left) || matches(row, node.right))
    if (node.token === 'comparator' && node.left && node.right) {
      const reversed = node.right.token === 'column'
      const column = reversed ? node.right : node.left
      const expected = reversed ? node.left : node.right
      const base = node.value?.replace(/^!/, '') ?? ''
      const operation = reversed
        ? `${node.value?.startsWith('!') ? '!' : ''}${({ '>': '<', '>=': '<=', '<': '>', '<=': '>=' } as Record<string, string>)[base] ?? base}`
        : (node.value ?? '')
      const values = columnValues(row, literalValue(column.value))
      return (
        values.length > 0 &&
        (operation.startsWith('!')
          ? values.every((value) => comparison(value, expected, operation))
          : values.some((value) => comparison(value, expected, operation)))
      )
    }
    return row.searchText.includes(literalValue(node.value).toLocaleLowerCase())
  }
  return records.filter(
    (row) =>
      (!formId || row.formId === formId) &&
      (!permittedIds || permittedIds.has(row.id)) &&
      (!tree || matches(row, tree)),
  )
}
