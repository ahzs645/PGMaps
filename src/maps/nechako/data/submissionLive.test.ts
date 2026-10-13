import { describe, expect, it, vi } from 'vitest'
import {
  SubmissionLiveLoader,
  checkedSubmissionLive,
  childSubmissionId,
  nativeBoolean,
  submissionLiveRequest,
  type SubmissionLiveState,
} from './submissionLive'

function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Original submission live resources', () => {
  it('uses exact native read parameters and rejects invalid source IDs before reading', async () => {
    expect(submissionLiveRequest('permissions', '1477')).toEqual({
      path: 'rest/portal/getSubmissionPermissions.php',
      params: { submissionId: '1477' },
    })
    expect(submissionLiveRequest('history', '1477')).toEqual({
      path: 'rest/portal/getHistory.php',
      params: { sub_id: '1477' },
    })
    expect(submissionLiveRequest('children', '1477')).toEqual({
      path: 'rest/portal/getChildren.php',
      params: { parentId: '1477' },
    })
    const read = vi.fn(),
      updates: SubmissionLiveState[] = []
    await new SubmissionLiveLoader(read, (state) => updates.push(state)).load('history', '-1')
    expect(read).not.toHaveBeenCalled()
    expect(updates.at(-1)?.status).toBe('error')
    for (const id of ['0', '2147483648', '1 OR 1', '1.2']) expect(() => submissionLiveRequest('children', id)).toThrow()
  })

  it('preserves real grouped permissions without treating string or missing flags as grants', () => {
    const groups = [
      {
        text: 'Fixture group',
        gid: 2,
        checked: false,
        attributes: [
          { uid: 7, text: 'Fixture selected user*', checked: true, editChecked: false },
          { uid: 8, text: 'Fixture unknown user', checked: 'true', editEnabled: null },
        ],
      },
    ]
    const parsed = checkedSubmissionLive('permissions', groups)
    expect(parsed.kind).toBe('permissions')
    if (parsed.kind !== 'permissions') throw new Error('Unexpected kind')
    expect(parsed.entries[0].group).toBe(groups[0])
    expect(parsed.entries[0].source.text).toBe('Fixture selected user*')
    expect(parsed.entries.filter((entry) => nativeBoolean(entry.source.checked) === true)).toHaveLength(1)
    expect(nativeBoolean('true')).toBeUndefined()
    expect(nativeBoolean(1)).toBeUndefined()
    expect(nativeBoolean(false)).toBe(false)
    expect(() => checkedSubmissionLive('permissions', [{ attributes: null }])).toThrow()
  })

  it('retains native history values and only opens verified native child ID fields', () => {
    const history = [
      {
        history_timestamp: 'source timestamp',
        changed_field_old_value: false,
        changed_field_new_value: 0,
        reason: null,
        unknown_source_key: [],
      },
    ]
    expect(checkedSubmissionLive('history', history)).toEqual({ kind: 'history', rows: history })
    expect(childSubmissionId({ form_submission_id: 12, submission_title: 'Fixture child' })).toBe('12')
    expect(childSubmissionId({ submission_id: 12 })).toBeUndefined()
    expect(childSubmissionId({ form_submission_id: -1 })).toBeUndefined()
    expect(checkedSubmissionLive('children', [])).toEqual({ kind: 'children', rows: [] })
    for (const value of [null, { error: 'Permission denied' }, '[]', [null]])
      expect(() => checkedSubmissionLive('history', value)).toThrow()
  })

  it('clears loaded identity data and ignores delayed results even when transport ignores abort', async () => {
    const request = pending<unknown>(),
      states: SubmissionLiveState[] = []
    let signal: AbortSignal | undefined
    const loader = new SubmissionLiveLoader(
      (_path, _params, currentSignal) => {
        signal = currentSignal
        return request.promise
      },
      (state) => states.push(state),
    )
    const loading = loader.load('permissions', '1477')
    loader.cancel('Connection changed')
    expect(signal?.aborted).toBe(true)
    request.resolve([{ text: 'OLD PRIVATE GROUP', attributes: [{ text: 'OLD PRIVATE USER', checked: true }] }])
    await loading
    expect(states.at(-1)).toEqual({ status: 'idle', message: 'Connection changed' })
    expect(states.some((state) => state.status === 'loaded')).toBe(false)

    const loadedStates: SubmissionLiveState[] = []
    const loaded = new SubmissionLiveLoader(
      async () => [{ history_timestamp: 'Private fixture history' }],
      (state) => loadedStates.push(state),
    )
    await loaded.load('history', '1477')
    expect(loadedStates.at(-1)?.status).toBe('loaded')
    loaded.cancel('Disconnected')
    expect(loadedStates.at(-1)).toEqual({ status: 'idle', message: 'Disconnected' })
  })

  it('keeps the latest retry and propagates access denial instead of inventing an empty list', async () => {
    const old = pending<unknown>(),
      current = pending<unknown>(),
      states: SubmissionLiveState[] = []
    const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const loader = new SubmissionLiveLoader(read, (state) => states.push(state))
    const first = loader.load('children', '1477'),
      next = loader.load('children', '1477')
    current.resolve([{ form_submission_id: 12 }])
    await next
    old.resolve([{ form_submission_id: 13 }])
    await first
    expect(states.filter((state) => state.status === 'loaded')).toEqual([
      { status: 'loaded', data: { kind: 'children', rows: [{ form_submission_id: 12 }] } },
    ])
    const denied: SubmissionLiveState[] = []
    await new SubmissionLiveLoader(
      async () => {
        throw new Error('Source permission denied')
      },
      (state) => denied.push(state),
    ).load('history', '1477')
    expect(denied.at(-1)).toEqual({ status: 'error', message: 'Source permission denied' })
    expect(denied.some((state) => state.status === 'loaded')).toBe(false)
  })
})
