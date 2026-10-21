import type { SearchFieldGroup, SearchFieldOption } from './searchBuilder'
import type { SubmissionRecord } from './submissionSnapshot'

export type SubmissionBrowserForm = {
  id: string
  name: string
  count: number
  years: { year: string; count: number }[]
}
export const UNKNOWN_SUBMISSION_YEAR = 'not-supplied'

export function submissionYear(record: SubmissionRecord): string {
  return /^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(record.date) ? record.date.slice(0, 4) : UNKNOWN_SUBMISSION_YEAR
}

/** Groups only supplied records. Counts never imply knowledge of protected or uncaptured source records. */
export function submissionBrowserForms(records: SubmissionRecord[]): SubmissionBrowserForm[] {
  const forms = new Map<string, { id: string; name: string; count: number; years: Map<string, number> }>()
  for (const record of records) {
    let form = forms.get(record.formId)
    if (!form) {
      form = { id: record.formId, name: record.formName || `Form ${record.formId}`, count: 0, years: new Map() }
      forms.set(record.formId, form)
    }
    form.count++
    const year = submissionYear(record)
    form.years.set(year, (form.years.get(year) ?? 0) + 1)
  }
  return [...forms.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id))
    .map((form) => ({
      ...form,
      years: [...form.years]
        .sort(([a], [b]) =>
          a === UNKNOWN_SUBMISSION_YEAR ? 1 : b === UNKNOWN_SUBMISSION_YEAR ? -1 : b.localeCompare(a),
        )
        .map(([year, count]) => ({ year, count })),
    }))
}

export function browseSubmissionSnapshot(
  records: SubmissionRecord[],
  formId: string,
  year: string,
  text: string,
): SubmissionRecord[] {
  const terms = text.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return records.filter(
    (record) =>
      (!formId || record.formId === formId) &&
      (!year || submissionYear(record) === year) &&
      terms.every((term) =>
        `${record.id}\n${record.title}\n${record.name}\n${record.formName}\n${record.searchText}`
          .toLocaleLowerCase()
          .includes(term),
      ),
  )
}

export const GENERAL_SNAPSHOT_FIELDS: SearchFieldOption[] = [
  { id: 'general:submission-id', field: 'Submission ID', label: 'Submission ID', valueType: 'number' },
  { id: 'general:submission-title', field: 'Submission Title', label: 'Submission Title', valueType: 'text' },
  { id: 'general:submission-name', field: 'Submission Name', label: 'Submission Name', valueType: 'text' },
  { id: 'general:submission-time', field: 'Submission Time', label: 'Submission Time', valueType: 'text' },
  { id: 'general:submitted-by', field: 'Submitted By', label: 'Submitted By', valueType: 'text' },
  { id: 'general:form-id', field: 'Form ID', label: 'Form ID', valueType: 'number' },
  { id: 'general:form-name', field: 'Form Name', label: 'Form Name', valueType: 'text' },
  { id: 'general:type', field: 'Type', label: 'Type (S / A:parent ID)', valueType: 'text' },
  { id: 'general:parent-id', field: 'Parent Submission ID', label: 'Parent Submission ID', valueType: 'number' },
]

function fieldValueType(type: string): SearchFieldOption['valueType'] {
  if (/^(?:checkbox|checkboxfield|boolean|bool)$/i.test(type)) return 'boolean'
  if (/^(?:numberfield|number|integer|decimal|float|double)$/i.test(type)) return 'number'
  return 'text'
}

/** IDs are the query operands; duplicate display labels must never merge unrelated fields or forms. */
export function snapshotSearchFieldGroups(records: SubmissionRecord[]): SearchFieldGroup[] {
  const forms = new Map<string, { label: string; fields: Map<string, SearchFieldOption> }>()
  for (const record of records) {
    let form = forms.get(record.formId)
    if (!form) {
      form = { label: `${record.formName || 'Unnamed form'} · Form ${record.formId}`, fields: new Map() }
      forms.set(record.formId, form)
    }
    for (const field of record.fields) {
      const valueType = fieldValueType(field.type)
      const prior = form.fields.get(field.id)
      if (prior) {
        if (prior.valueType !== valueType) prior.valueType = 'text'
        continue
      }
      form.fields.set(field.id, {
        id: `form:${record.formId}:field:${field.id}`,
        field: `field_${field.id}`,
        label: `${field.label || 'Unnamed field'} · Field ${field.id}`,
        scopeFormId: record.formId,
        valueType,
      })
    }
  }
  return [
    { id: 'general', label: 'General fields', fields: GENERAL_SNAPSHOT_FIELDS },
    ...[...forms.entries()]
      .sort(([, a], [, b]) => a.label.localeCompare(b.label))
      .map(([id, form]) => ({
        id: `form:${id}`,
        label: form.label,
        fields: [...form.fields.values()].sort((a, b) => a.label.localeCompare(b.label)),
      })),
  ]
}
