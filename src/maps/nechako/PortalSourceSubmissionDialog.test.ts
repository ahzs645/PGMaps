import { describe, expect, it, vi } from 'vitest'
import {
  SourceSubmissionLoader,
  checkedSourceSubmissionMetadata,
  sourceSubmissionFields,
  type SourceSubmissionState,
} from './PortalSourceSubmissionDialog'
const metadata = {
  submission_id: 742,
  form_id: 4,
  submission_title: 'Source-only fixture',
  submission_name: '',
  parent_id: 69,
}
const form = {
  name: 'Fixture form',
  nodes: [
    { field_id: 46, field_label: 'Text', field_type: 'text', nodeInfo: { node_is_dynamic: true } },
    { field_id: 47, field_label: 'Checkbox', field_type: 'checkbox', nodeInfo: { node_is_dynamic: true } },
    {
      field_id: 100,
      field_label: 'Attachments',
      field_type: '5',
      nodeInfo: { node_is_dynamic: false, node_name: 'attachmentsNode.form' },
    },
    { field_id: 48, field_label: 'Number', field_type: 'number', nodeInfo: { node_is_dynamic: true } },
    { field_id: 49, field_label: 'Empty', field_type: 'text', nodeInfo: { node_is_dynamic: true } },
    { field_id: 50, field_label: 'Null', field_type: 'text', nodeInfo: { node_is_dynamic: true } },
  ],
}
function pending<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('source-only submission authorization and lifecycle', () => {
  it('denies a source failure and never reads forms or resources before matching metadata authorization', async () => {
    const states: SourceSubmissionState[] = [],
      read = vi.fn().mockRejectedValue(new Error('Source permission denied'))
    const loader = new SourceSubmissionLoader(read, (state) => states.push(state))
    await loader.open('742')
    await loader.loadResource('preview')
    await loader.loadResource('attachments')
    await expect(loader.authorizedRead('rest/portal/getHistory.php', { sub_id: '742' })).rejects.toThrow(
      'Check submission access',
    )
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0].slice(0, 2)).toEqual(['rest/portal/getSubmissionMetadata.php', { submissionId: '742' }])
    expect(states.at(-1)).toEqual({ status: 'error', message: 'Source permission denied' })
    for (const value of [
      { ...metadata, submission_id: 741 },
      { ...metadata, sourceDenied: true },
      { ...metadata, status: 'failure' },
      { ...metadata, error: 'Denied' },
      { ...metadata, form_id: 0 },
      null,
    ])
      expect(() => checkedSourceSubmissionMetadata(value, '742')).toThrow()
  })
  it('preserves group-local native indices and false/zero/empty values without promoting source records to a capture', async () => {
    expect(sourceSubmissionFields(form).fields.map((field) => field.index)).toEqual([0, 1, 0, 1, 2])
    const states: SourceSubmissionState[] = []
    const values: Record<string, unknown> = { '46': 'Live fixture', '47': false, '48': 0, '49': [], '50': null }
    const read = vi
      .fn()
      .mockImplementation(async (path, params) =>
        path.endsWith('getSubmissionMetadata.php')
          ? metadata
          : path.endsWith('getSubmissionForm.php')
            ? 4
            : path.endsWith('getForm.php')
              ? form
              : values[params.fieldId],
      )
    const loader = new SourceSubmissionLoader(read, (state) => states.push(state))
    await loader.open('742')
    await loader.loadResource('preview')
    const current = states.at(-1)
    expect(current?.status).toBe('ready')
    if (current?.status !== 'ready' || current.resources.preview?.status !== 'loaded')
      throw new Error('Expected source preview')
    expect(current.resources.preview.value).toMatchObject({
      submissionId: '742',
      values: { '47': { value: false }, '48': { value: 0 }, '49': { value: [] }, '50': { value: null } },
    })
    expect(
      read.mock.calls.filter(([path]) => path.endsWith('getFieldValue.php')).map(([, params]) => params.fieldIndex),
    ).toEqual(['0', '1', '0', '1', '2'])
    expect(JSON.stringify(current)).not.toContain('nechako-public-content')
    loader.cancel('Disconnected')
    expect(states.at(-1)).toEqual({ status: 'idle', message: 'Disconnected' })
  })
  it('rejects a mismatching form before field values and retains individual source field errors', async () => {
    const states: SourceSubmissionState[] = []
    const read = vi.fn().mockImplementation(async (path) => (path.endsWith('getSubmissionMetadata.php') ? metadata : 5))
    const loader = new SourceSubmissionLoader(read, (state) => states.push(state))
    await loader.open('742')
    await loader.loadResource('preview')
    const current = states.at(-1)
    expect(current?.status === 'ready' && current.resources.preview).toEqual({
      status: 'error',
      message: 'The source form does not match the permitted submission.',
    })
    expect(read).toHaveBeenCalledTimes(2)
    read.mockImplementation(async (path, params) => {
      if (path.endsWith('getSubmissionMetadata.php')) return metadata
      if (path.endsWith('getSubmissionForm.php')) return 4
      if (path.endsWith('getForm.php')) return form
      if (params.fieldId === '47') throw new Error('Field permission denied')
      return ''
    })
    await loader.loadResource('preview')
    const updated = states.at(-1)
    expect(
      updated?.status === 'ready' && updated.resources.preview?.status === 'loaded' && updated.resources.preview.value,
    ).toMatchObject({ values: { '47': { error: 'Field permission denied' }, '46': { value: '' } } })
  })
  it('caps field concurrency at four and clears pending and already-loaded identity data synchronously', async () => {
    const states: SourceSubmissionState[] = [],
      waits: ReturnType<typeof pending<unknown>>[] = []
    let active = 0,
      peak = 0
    const read = vi.fn().mockImplementation(async (path) => {
      if (path.endsWith('getSubmissionMetadata.php')) return metadata
      if (path.endsWith('getSubmissionForm.php')) return 4
      if (path.endsWith('getForm.php')) return form
      const wait = pending<unknown>()
      waits.push(wait)
      peak = Math.max(peak, ++active)
      const value = await wait.promise
      active--
      return value
    })
    const loader = new SourceSubmissionLoader(read, (state) => states.push(state))
    await loader.open('742')
    const loading = loader.loadResource('preview')
    await tick()
    await tick()
    expect(waits).toHaveLength(4)
    expect(peak).toBe(4)
    loader.cancel('Account changed')
    expect(states.at(-1)).toEqual({ status: 'idle', message: 'Account changed' })
    waits.forEach((wait) => wait.resolve('OLD PRIVATE FIXTURE'))
    await loading
    expect(waits).toHaveLength(4)
    expect(states.at(-1)).toEqual({ status: 'idle', message: 'Account changed' })
    expect(JSON.stringify(states)).not.toContain('OLD PRIVATE FIXTURE')
  })
  it('aborts guarded live reads on identity change and rejects ignored-signal late completion or another source ID', async () => {
    const wait = pending<unknown>(),
      states: SourceSubmissionState[] = []
    let signal: AbortSignal | undefined
    const read = vi.fn().mockImplementation(async (path, _params, requestSignal) => {
      if (path.endsWith('getSubmissionMetadata.php')) return metadata
      signal = requestSignal
      return wait.promise
    })
    const loader = new SourceSubmissionLoader(read, (state) => states.push(state))
    await loader.open('742')
    await expect(loader.authorizedRead('rest/portal/getChildren.php', { parentId: '741' })).rejects.toThrow(
      'does not belong',
    )
    const guarded = loader.authorizedRead('rest/portal/getHistory.php', { sub_id: '742' }),
      rejected = expect(guarded).rejects.toMatchObject({ name: 'AbortError' })
    loader.cancel('Connection changed')
    expect(signal?.aborted).toBe(true)
    wait.resolve([{ uname: 'OLDER PRIVATE FIXTURE' }])
    await rejected
    expect(states.at(-1)).toEqual({ status: 'idle', message: 'Connection changed' })
  })
  it('does not publish delayed metadata after close or superseding source IDs', async () => {
    const previous = pending<unknown>(),
      states: SourceSubmissionState[] = []
    const read = vi
      .fn()
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce({ ...metadata, submission_id: 743 })
    const loader = new SourceSubmissionLoader(read, (state) => states.push(state))
    const old = loader.open('742')
    await loader.open('743')
    previous.resolve(metadata)
    await old
    expect(states.at(-1)).toMatchObject({ status: 'ready', metadata: { submission_id: 743 } })
    loader.cancel()
    expect(states.at(-1)).toEqual({ status: 'idle', message: undefined })
  })
})
