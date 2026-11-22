import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import { loadPreviousSite, savePreviousSite } from './toolsStorage'

describe('the previous site kept in this browser', () => {
  it('keeps one project file in its slot, the latest switch replacing the last', async () => {
    expect(await loadPreviousSite()).toBeNull()
    await savePreviousSite({
      name: 'Site A',
      savedAt: '2026-11-22T10:00:00.000Z',
      blob: new Blob(['site a'], { type: 'application/zip' }),
    })
    const first = await loadPreviousSite()
    expect(first).toMatchObject({ id: 'previous', name: 'Site A', savedAt: '2026-11-22T10:00:00.000Z' })
    expect(await new Response(first!.blob).text()).toBe('site a')
    await savePreviousSite({ name: 'Site B', savedAt: '2026-11-22T11:00:00.000Z', blob: new Blob(['site b']) })
    const second = await loadPreviousSite()
    expect(second?.name).toBe('Site B')
    expect(await new Response(second!.blob).text()).toBe('site b')
  })
})
