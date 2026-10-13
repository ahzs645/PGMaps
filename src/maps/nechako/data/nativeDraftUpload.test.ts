import { describe, expect, it, vi } from 'vitest'
import { buildDraftReview, parseReviewForm } from './submissionReview'
import { uploadSelectedNativeDrafts } from './nativeDraftUpload'

const form = {
  name: 'Fixture form',
  nodes: [{ field_id: 561, field_label: 'Name', field_type: 'text', nodeInfo: { node_is_dynamic: true } }],
}
const review = buildDraftReview(
  { ...parseReviewForm(form), id: '39' },
  { '561': 'Title' },
  [
    { Title: 'First', Unmapped: 0 },
    { Title: 'Second', Unmapped: false },
  ],
  'fixture.csv',
)

describe('Explicit native CSV draft contract (mocked writes only)', () => {
  it('rechecks source field IDs, allocates/saves/names sequentially, and reports only confirmed returned state', async () => {
    let nextId = 1900
    const write = vi.fn(async (path: string) =>
      path.endsWith('startSubmission.php') ? { submissionId: nextId++ } : true,
    )
    const read = vi.fn(async (path: string) => (path.endsWith('getForm.php') ? form : { submission_state: 'DRAFT' }))
    const results = await uploadSelectedNativeDrafts(review, ['row-1', 'row-2'], write, { read, nameColumn: 'Title' })
    expect(write.mock.calls.map(([path]) => path)).toEqual([
      'rest/portal/startSubmission.php',
      'rest/portal/setDynamicFields.php',
      'rest/portal/setSubmissionName.php',
      'rest/portal/startSubmission.php',
      'rest/portal/setDynamicFields.php',
      'rest/portal/setSubmissionName.php',
    ])
    expect(write).toHaveBeenNthCalledWith(
      2,
      'rest/portal/setDynamicFields.php',
      { submissionId: '1900', status: 'draft', fields: '[{"id":"561","value":"First"}]' },
      undefined,
    )
    expect(results).toMatchObject([
      { submissionId: '1900', stage: 'draft-confirmed', sourceState: 'DRAFT' },
      { submissionId: '1901', stage: 'draft-confirmed' },
    ])
    expect(write.mock.calls.some(([path]) => /Submitted|Notification|delete/i.test(path))).toBe(false)
  })

  it('keeps allocated IDs and stops immediately when content save fails, without retries or deletion', async () => {
    const write = vi.fn(async (path: string) => {
      if (path.endsWith('startSubmission.php')) return { submissionId: 1902 }
      throw new Error('Save refused')
    })
    const results = await uploadSelectedNativeDrafts(review, ['row-1', 'row-2'], write, { read: async () => form })
    expect(results).toEqual([
      { localId: 'row-1', sourceRow: 1, submissionId: '1902', stage: 'allocated', error: 'Save refused' },
    ])
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('keeps ambiguous allocation state unknown and never allocates again automatically', async () => {
    const write = vi.fn(async () => {
      throw new Error('Connection lost')
    })
    const results = await uploadSelectedNativeDrafts(review, ['row-1', 'row-2'], write, { read: async () => form })
    expect(results[0]).toMatchObject({ stage: 'creation-unconfirmed', error: 'Connection lost' })
    expect(results[0].submissionId).toBeUndefined()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('refuses outdated/non-native fields, invalid rows, batch overflow and missing names before allocation', async () => {
    const write = vi.fn(async () => true)
    await expect(
      uploadSelectedNativeDrafts(review, ['row-1'], write, {
        read: async () => ({ fields: [{ id: 999, label: 'Other' }] }),
      }),
    ).rejects.toThrow('current dynamic field')
    await expect(uploadSelectedNativeDrafts(review, ['missing'], write, { read: async () => form })).rejects.toThrow(
      'Selected rows',
    )
    await expect(
      uploadSelectedNativeDrafts(
        review,
        Array.from({ length: 51 }, (_, index) => `row-${index}`),
        write,
        { read: async () => form },
      ),
    ).rejects.toThrow('50')
    await expect(
      uploadSelectedNativeDrafts(review, ['row-1'], write, { read: async () => form, nameColumn: 'Absent' }),
    ).rejects.toThrow('No drafts were allocated')
    expect(write).not.toHaveBeenCalled()
  })
})
