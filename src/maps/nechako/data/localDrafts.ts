import { normalizeGeojson } from './workspace'
import { fieldIssue, parseReviewForm } from './submissionReview'
import { parseImportJson } from './importValues'
import { checkedLocalWorkbenchRecord, type LocalWorkbenchRecord } from './localWorkbench'

export type LocalDraftData = {
  schema: 'nechako-local-submission-v1'
  status: 'draft' | 'reviewed' | 'archived'
  values: Record<string, unknown>
  original?: unknown
  geometry?: GeoJSON.Geometry | null
  sourceFeature?: GeoJSON.Feature
  formOriginal?: unknown
  formRaw?: string | null
  attachmentIds?: string[]
  relationships?: { kind: string; id: string; role?: string }[]
  issues?: string[]
  localValidation?: string[]
  history?: {
    editedAt: string
    name: string
    status: string
    values: Record<string, unknown>
    geometry?: GeoJSON.Geometry | null
    attachmentIds?: string[]
  }[]
  [key: string]: unknown
}
export type DraftValueEditor = { type: 'text' | 'number' | 'boolean' | 'null' | 'json'; text: string }
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function localDraftData(value: unknown): LocalDraftData {
  if (
    !object(value) ||
    value.schema !== 'nechako-local-submission-v1' ||
    !object(value.values) ||
    !['draft', 'reviewed', 'archived'].includes(String(value.status))
  )
    throw new Error('This cached item is not an editable local submission draft.')
  return value as LocalDraftData
}
export function localDraftGeometry(data: LocalDraftData): GeoJSON.Geometry | null {
  return data.geometry === undefined ? (data.sourceFeature?.geometry ?? null) : data.geometry
}
/** Start with explicit missing values; source defaults are retained in the definition, never invented. */
export function blankLocalDraft(schemaRecord: LocalWorkbenchRecord): LocalWorkbenchRecord<LocalDraftData> {
  if (schemaRecord.kind !== 'schema') throw new Error('Choose a cached schema to start a local draft.')
  const form = parseReviewForm(schemaRecord.data)
  if (!form.fields.length) throw new Error('This cached schema has no editable fields.')
  const now = new Date().toISOString()
  return checkedLocalWorkbenchRecord({
    id: `draft:${crypto.randomUUID()}`,
    kind: 'submission',
    name: `New ${schemaRecord.name}`.slice(0, 200),
    createdAt: now,
    updatedAt: now,
    bytes: 0,
    data: {
      schema: 'nechako-local-submission-v1',
      status: 'draft',
      sourceType: 'local',
      formId: form.id,
      formTitle: form.title,
      formOriginal: form.original,
      schemaId: schemaRecord.id,
      values: Object.fromEntries(form.fields.map((field) => [field.id, null])),
      original: {},
      geometry: null,
      attachmentIds: [],
      issues: [],
      localValidation: form.fields.flatMap((field) => {
        const issue = fieldIssue(field, null)
        return issue ? [`${field.label}: ${issue}`] : []
      }),
      relationships: [{ kind: 'schema', id: schemaRecord.id, role: 'draft-schema' }],
    },
  }) as LocalWorkbenchRecord<LocalDraftData>
}
export function draftValueEditor(value: unknown): DraftValueEditor {
  if (value === null) return { type: 'null', text: '' }
  if (typeof value === 'number') return { type: 'number', text: String(value) }
  if (typeof value === 'boolean') return { type: 'boolean', text: String(value) }
  if (typeof value === 'string') return { type: 'text', text: value }
  return { type: 'json', text: JSON.stringify(value, null, 2) ?? 'null' }
}
export function parseDraftValue(editor: DraftValueEditor): unknown {
  if (editor.type === 'text') return editor.text
  if (editor.type === 'null') return null
  if (editor.type === 'boolean') {
    if (editor.text !== 'true' && editor.text !== 'false') throw new Error('Choose true or false for a Boolean value.')
    return editor.text === 'true'
  }
  if (editor.type === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(editor.text.trim()))
      throw new Error('Enter a finite decimal number.')
    const value = Number(editor.text)
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new Error('This number is outside JavaScript’s exact range. Choose Text to retain its exact digits.')
    return value
  }
  return parseImportJson(editor.text)
}
export function editedLocalDraft(
  record: LocalWorkbenchRecord,
  input: {
    name: string
    status: LocalDraftData['status']
    editors: Record<string, DraftValueEditor>
    geometryText: string
    attachmentIds: string[]
  },
): LocalWorkbenchRecord<LocalDraftData> {
  const previous = localDraftData(record.data)
  if (!input.name.trim() || input.name.length > 200)
    throw new Error('A local draft title must contain 1–200 characters.')
  if (!['draft', 'reviewed', 'archived'].includes(input.status))
    throw new Error('Choose a supported local review status.')
  if (Object.keys(input.editors).length > 5000) throw new Error('Edit at most 5,000 field values in a draft.')
  const values = Object.fromEntries(
    Object.entries(input.editors).map(([key, editor]) => {
      try {
        return [key, parseDraftValue(editor)]
      } catch (reason) {
        throw new Error(`${key}: ${reason instanceof Error ? reason.message : String(reason)}`)
      }
    }),
  )
  const geometryValue = input.geometryText.trim() ? parseImportJson(input.geometryText) : null
  const feature = normalizeGeojson({ type: 'Feature', properties: {}, geometry: geometryValue }).features[0]
  const geometry = feature.geometry
  const validation: string[] = []
  if (previous.formOriginal) {
    try {
      const form = parseReviewForm(previous.formOriginal)
      for (const field of form.fields) {
        const issue = fieldIssue(field, values[field.id])
        if (issue) validation.push(`${field.label}: ${issue}`)
      }
    } catch {
      validation.push('The original field rules could not be interpreted; source definition remains available.')
    }
  }
  const attachmentIds = [...new Set(input.attachmentIds)]
  const sourceRelationships = (previous.relationships ?? []).filter(
    (item) => item.kind !== 'attachment' || item.role === 'original-source',
  )
  const now = new Date().toISOString()
  return checkedLocalWorkbenchRecord({
    ...record,
    name: input.name.trim(),
    updatedAt: now,
    data: {
      ...previous,
      status: input.status,
      values,
      geometry,
      attachmentIds,
      localValidation: validation,
      relationships: [
        ...sourceRelationships,
        ...attachmentIds.map((id) => ({ kind: 'attachment', id, role: 'draft-attachment' })),
      ],
      history: [
        ...(previous.history ?? []),
        {
          editedAt: record.updatedAt,
          name: record.name,
          status: previous.status,
          values: previous.values,
          geometry: previous.geometry,
          attachmentIds: previous.attachmentIds,
        },
      ].slice(-20),
    },
  }) as LocalWorkbenchRecord<LocalDraftData>
}
