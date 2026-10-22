import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalWorkbench,
  deleteLocalWorkbench,
  getLocalWorkbench,
  importLocalWorkbench,
  listLocalWorkbench,
  LOCAL_WORKBENCH_DATABASE,
  saveLocalWorkbench,
  subscribeLocalWorkbench,
  type LocalWorkbenchRecord,
} from './localWorkbench'

beforeEach(async () => {
  vi.restoreAllMocks()
  await clearLocalWorkbench()
})
describe('explicit browser-local workbench', () => {
  it('persists source IDs, falsy values and original bytes across independent database connections', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 254, 255])], { type: 'application/octet-stream' })
    const saved = await saveLocalWorkbench({
      id: 'utf0-field',
      kind: 'attachment',
      name: 'Useful field 0',
      data: { id: 0, enabled: false, empty: null },
      blob,
      filename: 'field.bin',
      source: { access: 'private', recordId: 'source-0' },
    })
    const reopened = new Dexie(LOCAL_WORKBENCH_DATABASE)
    reopened.version(1).stores({ records: 'id,kind,updatedAt,[kind+updatedAt]' })
    try {
      const reloaded = (await reopened.table('records').get(saved.id)) as LocalWorkbenchRecord
      expect(reloaded.data).toEqual({ id: 0, enabled: false, empty: null })
      expect(reloaded.source).toEqual({ access: 'private', recordId: 'source-0' })
      expect(new Uint8Array(await reloaded.blob!.arrayBuffer())).toEqual(new Uint8Array([0, 1, 254, 255]))
      expect(reloaded.bytes).toBe(new TextEncoder().encode(JSON.stringify(reloaded.data)).byteLength + 4)
    } finally {
      reopened.close()
    }
  })
  it('updates records without losing original binary and supports explicit binary removal', async () => {
    const saved = await saveLocalWorkbench({
      kind: 'style',
      name: 'Original',
      data: { name: 'Original' },
      blob: new Blob(['original']),
    })
    const updated = await saveLocalWorkbench({ id: saved.id, kind: 'style', name: 'Edited', data: { name: 'Edited' } })
    expect(updated.createdAt).toBe(saved.createdAt)
    expect(await updated.blob!.text()).toBe('original')
    expect((await listLocalWorkbench('style')).map((record) => record.name)).toEqual(['Edited'])
    const cleared = await saveLocalWorkbench({ id: saved.id, kind: 'style', name: 'Edited', data: {}, blob: null })
    expect(cleared.blob).toBeUndefined()
    await expect(
      saveLocalWorkbench({ id: saved.id, kind: 'layer', name: 'Wrong kind', data: {} }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
  it('restores related records atomically and requires explicit ID replacement', async () => {
    const existing = await saveLocalWorkbench({
      id: 'existing',
      kind: 'schema',
      name: 'Existing schema',
      data: { fields: [] },
    })
    const linked: LocalWorkbenchRecord = {
      ...existing,
      id: 'attachment',
      kind: 'attachment',
      name: 'Linked photo',
      data: { relationships: [{ kind: 'schema', id: 'existing' }] },
      blob: new Blob(['photo']),
    }
    await expect(importLocalWorkbench([linked, { ...existing, name: 'Replacement' }])).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(await getLocalWorkbench(linked.id)).toBeUndefined()
    expect((await getLocalWorkbench(existing.id))?.name).toBe('Existing schema')
    expect(await importLocalWorkbench([linked, { ...existing, name: 'Replacement' }], { overwrite: true })).toBe(2)
    expect((await getLocalWorkbench(existing.id))?.name).toBe('Replacement')
    expect((await getLocalWorkbench(linked.id))?.data).toEqual(linked.data)
  })
  it('filters and clears only the requested kind, while delete removes only one ID', async () => {
    const a = await saveLocalWorkbench({ kind: 'layer', name: 'A', data: {} })
    await saveLocalWorkbench({ kind: 'layer', name: 'B', data: {} })
    await saveLocalWorkbench({ kind: 'style-defaults', name: 'Defaults', data: {} })
    await deleteLocalWorkbench(a.id)
    expect((await listLocalWorkbench('layer')).map((record) => record.name)).toEqual(['B'])
    await clearLocalWorkbench('layer')
    expect((await listLocalWorkbench()).map((record) => record.kind)).toEqual(['style-defaults'])
  })
  it('rejects invalid payloads before persistence but preserves legitimate domain field names', async () => {
    const cycle: { child?: unknown } = {}
    cycle.child = cycle
    await expect(saveLocalWorkbench({ kind: 'schema', name: 'Cycle', data: cycle })).rejects.toMatchObject({
      code: 'invalid',
    })
    await expect(saveLocalWorkbench({ kind: 'schema', name: 'NaN', data: { value: NaN } })).rejects.toMatchObject({
      code: 'invalid',
    })
    await expect(
      saveLocalWorkbench({ id: 'bad\nname', kind: 'schema', name: 'Control', data: {} }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      saveLocalWorkbench({
        kind: 'schema',
        name: 'Token source',
        data: {},
        source: { url: 'https://example.com/?token=secret' },
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    await expect(
      saveLocalWorkbench({
        kind: 'schema',
        name: 'Login source',
        data: {},
        source: { url: 'https://admin:password@example.com/' },
      }),
    ).rejects.toMatchObject({ code: 'invalid' })
    expect(await listLocalWorkbench()).toEqual([])
    const saved = await saveLocalWorkbench({
      kind: 'schema',
      name: 'Field named password',
      data: { fields: [{ id: 'password', label: 'Password quality' }] },
    })
    expect(saved.data.fields[0].id).toBe('password')
  })
  it('reports quota errors without replacing an existing successful save', async () => {
    const previous = await saveLocalWorkbench({ id: 'same', kind: 'project', name: 'Saved', data: {} })
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await expect(
      saveLocalWorkbench({ id: previous.id, kind: 'project', name: 'Failed replacement', data: {} }),
    ).rejects.toMatchObject({ code: 'quota' })
    put.mockRestore()
    expect((await getLocalWorkbench(previous.id))?.name).toBe('Saved')
  })
  it('notifies subscribed views after a committed local mutation', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocalWorkbench(listener)
    try {
      await vi.waitFor(() => expect(listener).toHaveBeenCalled())
      listener.mockClear()
      await saveLocalWorkbench({ kind: 'layer', name: 'Visible after save', data: {} })
      await vi.waitFor(() => expect(listener).toHaveBeenCalled())
    } finally {
      unsubscribe()
    }
  })
})
