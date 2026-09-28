import { describe, expect, it } from 'vitest'
import { ViewportBlockLoader } from './viewportBlockLoader'

function fixture(concurrency = 2, idle = 1) {
  const calls: Array<{
    id: string
    signal: AbortSignal
    resolve: (data: object) => void
    reject: (error: Error) => void
  }> = []
  let changes = 0
  const loader = new ViewportBlockLoader<object>(
    (id, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ id, signal, resolve, reject })
      }),
    () => {
      changes++
    },
    concurrency,
    idle,
  )
  return { loader, calls, changes: () => changes }
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('viewport block loading', () => {
  it('uses cached blocks during a gesture without starting requests for transient extents', async () => {
    const { loader, calls } = fixture()
    loader.update(['a', 'b'])
    calls[0].resolve({ cached: true })
    await flush()
    loader.update(['a', 'b', 'transient'], [], false, false)
    calls[1].resolve({ cached: true })
    await flush()
    expect(calls).toHaveLength(2)
    expect(loader.snapshot().visibleBlocks.map((b) => b.id)).toEqual(['a', 'b'])
    loader.update(['a', 'b', 'settled'], [], true)
    expect(calls.map((c) => c.id)).toEqual(['a', 'b', 'settled'])
    loader.dispose()
  })

  it('draws fast blocks while another is slow, prioritizes visible blocks, and reuses in-flight work', async () => {
    const { loader, calls } = fixture()
    loader.update(['center', 'edge', 'far'], ['margin'])
    expect(calls.map((c) => c.id)).toEqual(['center', 'edge'])
    loader.update(['edge', 'center', 'far'], ['margin'])
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => !c.signal.aborted)).toBe(true)
    calls[1].resolve({ value: 20 })
    await flush()
    expect(loader.snapshot()).toMatchObject({ loaded: 1, total: 3, blocks: [{ id: 'edge' }] })
    expect(calls.map((c) => c.id)).toEqual(['center', 'edge', 'far'])
    calls[2].resolve({ value: 30 })
    await flush()
    expect(calls[3].id).toBe('margin')
    loader.dispose()
  })

  it('pins every visible block beyond the idle cache budget and reuses prefetched blocks when panning', async () => {
    const { loader, calls } = fixture(6, 1)
    loader.update(['a', 'b', 'c'], ['d'])
    for (const call of calls) call.resolve({ id: call.id })
    await flush()
    const original = loader.snapshot().blocks.find((b) => b.id === 'd')!.data
    loader.update(['a', 'b', 'c', 'd'])
    expect(calls).toHaveLength(4)
    expect(loader.snapshot()).toMatchObject({ loaded: 4, total: 4 })
    loader.update(['d'])
    expect(loader.snapshot().blocks[0].data).toBe(original)
    loader.update(['c', 'd']) // most recently used idle block survives
    expect(calls).toHaveLength(4)
    loader.update(['a', 'c', 'd']) // evicted idle block is fetched again
    expect(calls).toHaveLength(5)
    loader.dispose()
  })

  it('cancels obsolete blocks and ignores their late completions', async () => {
    const { loader, calls } = fixture()
    loader.update(['old', 'shared'])
    loader.update(['shared', 'new'])
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].signal.aborted).toBe(false)
    calls[0].resolve({ stale: true })
    calls[2].resolve({ fresh: true })
    await flush()
    expect(loader.snapshot().blocks.map((b) => b.id)).toEqual(['new'])
    loader.dispose()
    expect(calls[1].signal.aborted).toBe(true)
  })

  it('retains good blocks, reports incomplete coverage and retries failures only when requested', async () => {
    const { loader, calls, changes } = fixture()
    loader.update(['good', 'missing'])
    calls[0].resolve({ value: 10 })
    calls[1].reject(new Error('missing tile'))
    await flush()
    expect(loader.snapshot()).toMatchObject({ loaded: 1, total: 2, errors: ['missing tile'] })
    loader.update(['good', 'missing'])
    expect(calls).toHaveLength(2)
    loader.update(['good', 'missing'], [], true)
    expect(calls).toHaveLength(3)
    calls[2].resolve({ value: 20 })
    await flush()
    expect(loader.snapshot()).toMatchObject({ loaded: 2, total: 2, errors: [] })
    loader.update(['pending'])
    loader.dispose()
    const before = changes()
    calls[3].resolve({ disposed: true })
    await flush()
    expect(changes()).toBe(before)
  })
})
