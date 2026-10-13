import { errorText, portalRead } from '@/lib/nechakoPortal'
import { parseReviewForm, reviewObject, unwrapReview, type DraftReview } from './submissionReview'

export type DraftWrite = (path: string, params: Record<string, string>, signal?: AbortSignal) => Promise<unknown>
type Read = typeof portalRead
export type NativeDraftResult = {
  localId: string
  sourceRow: number
  submissionId?: string
  stage: 'allocated' | 'content-saved' | 'draft-confirmed' | 'failed' | 'creation-unconfirmed'
  sourceState?: string
  error?: string
}
function checkedWrite(value: unknown): unknown {
  if (value === false || (reviewObject(value) && (value.success === false || value.error)))
    throw new Error(reviewObject(value) ? String(value.error || 'Source write rejected') : 'Source write rejected')
  return unwrapReview(value)
}

/** Exact BulkLoader.js sequence. No automatic retries, inferred IDs or publication. */
export async function uploadSelectedNativeDrafts(
  review: DraftReview,
  selected: string[],
  write: DraftWrite,
  options: {
    read?: Read
    nameColumn?: string
    signal?: AbortSignal
    onProgress?: (results: NativeDraftResult[]) => void
  } = {},
) {
  if (!/^[1-9]\d*$/.test(review.formId)) throw new Error('Native draft upload requires an existing source form ID.')
  if (!selected.length || selected.length > 50 || new Set(selected).size !== selected.length)
    throw new Error('Select between 1 and 50 distinct reviewed rows for a native draft batch.')
  const rows = selected.map((id) => review.drafts.find((draft) => draft.localId === id))
  if (rows.some((row) => !row || row.issues.length))
    throw new Error('Selected rows must exist and have no review issues.')
  if (
    options.nameColumn &&
    rows.some(
      (row) => typeof row!.source[options.nameColumn!] !== 'string' || !String(row!.source[options.nameColumn!]).trim(),
    )
  )
    throw new Error(
      'Every selected row needs a nonempty string in the chosen native name column. No drafts were allocated.',
    )
  const read = options.read ?? portalRead
  const form = parseReviewForm(await read('rest/portal/getForm.php', { id: review.formId }, options.signal))
  for (const row of rows)
    for (const id of Object.keys(row!.values))
      if (!/^[1-9]\d*$/.test(id) || !form.fields.some((field) => field.id === id))
        throw new Error(
          'A mapped field is not a current dynamic field of the selected source form. No drafts were allocated.',
        )
  const results: NativeDraftResult[] = []
  for (const row of rows) {
    if (options.signal?.aborted) break
    const result: NativeDraftResult = {
      localId: row!.localId,
      sourceRow: row!.sourceRow,
      stage: 'creation-unconfirmed',
    }
    results.push(result)
    try {
      const allocated = checkedWrite(
        await write('rest/portal/startSubmission.php', { formId: review.formId }, options.signal),
      )
      const id = reviewObject(allocated) ? String(allocated.submissionId ?? '') : ''
      if (!/^[1-9]\d*$/.test(id))
        throw new Error(
          'Source creation returned no usable ID. Inspect the original portal before another allocation attempt.',
        )
      result.submissionId = id
      result.stage = 'allocated'
      options.onProgress?.(results.map((item) => ({ ...item })))
      checkedWrite(
        await write(
          'rest/portal/setDynamicFields.php',
          {
            fields: JSON.stringify(Object.entries(row!.values).map(([fieldId, value]) => ({ id: fieldId, value }))),
            status: 'draft',
            submissionId: id,
          },
          options.signal,
        ),
      )
      result.stage = 'content-saved'
      if (options.nameColumn) {
        const name = row!.source[options.nameColumn]
        if (typeof name !== 'string' || !name.trim())
          throw new Error('The selected native name column has no nonempty string value.')
        checkedWrite(await write('rest/portal/setSubmissionName.php', { name, submissionId: id }, options.signal))
      }
      const metadata = await read('rest/portal/getSubmissionMetadata.php', { submissionId: id }, options.signal)
      if (reviewObject(metadata)) {
        result.sourceState = String(metadata.submission_state ?? '')
        if (result.sourceState === 'DRAFT') result.stage = 'draft-confirmed'
      }
    } catch (reason) {
      result.error = errorText(reason)
      // An interrupted/ambiguous creation must never be retried as an apparently failed allocation.
      options.onProgress?.(results.map((item) => ({ ...item })))
      break
    }
    options.onProgress?.(results.map((item) => ({ ...item })))
  }
  return results
}
