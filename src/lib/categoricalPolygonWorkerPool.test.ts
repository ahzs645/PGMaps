import { describe, expect, it } from 'vitest'
import { CategoricalPolygonWorkerPool } from './categoricalPolygonWorkerPool'
import type { PreparedPolygons } from './categoricalPolygonGeometry'

function fixture() {
  const workers: Array<{
    onmessage: ((event: MessageEvent) => void) | null
    onerror: ((event: ErrorEvent) => void) | null
    sent: unknown[]
    terminated: boolean
    postMessage: (value: unknown) => void
    terminate: () => void
  }> = []
  const pool = new CategoricalPolygonWorkerPool(() => {
    const worker = {
      onmessage: null,
      onerror: null,
      sent: [] as unknown[],
      terminated: false,
      postMessage(value: unknown) {
        this.sent.push(value)
      },
      terminate() {
        this.terminated = true
      },
    }
    workers.push(worker)
    return worker
  })
  const data = { values: new Float64Array([20]) } as PreparedPolygons
  const reply = (i: number) => workers[i].onmessage?.({ data: { data } } as MessageEvent)
  return { pool, workers, reply, data }
}

describe('polygon worker pool', () => {
  it('limits CPU jobs to two and reuses workers for queued blocks', async () => {
    const { pool, workers, reply, data } = fixture()
    const signal = new AbortController().signal
    const first = pool.load('a', signal),
      second = pool.load('b', signal),
      third = pool.load('c', signal)
    expect(workers).toHaveLength(2)
    reply(0)
    expect(workers[0].sent).toEqual([{ url: 'a' }, { url: 'c' }])
    reply(0)
    reply(1)
    expect(await Promise.all([first, second, third])).toEqual([data, data, data])
    pool.dispose()
  })
  it('terminates cancelled CPU work and rejects queued/disposed work', async () => {
    const { pool, workers, reply } = fixture()
    const controller = new AbortController()
    const first = pool.load('a', controller.signal)
    const second = pool.load('b', new AbortController().signal)
    const third = pool.load('c', new AbortController().signal)
    const checks = Promise.all([first, second, third].map((p) => p.catch((e: Error) => e.name)))
    controller.abort()
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(3)
    reply(0) // obsolete completion must not finish the replacement job
    pool.dispose()
    expect(await checks).toEqual(['AbortError', 'AbortError', 'AbortError'])
    await expect(pool.load('d', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects worker failures and creates a fresh worker on the next job', async () => {
    const { pool, workers, reply } = fixture()
    const first = pool.load('a', new AbortController().signal)
    workers[0].onerror?.({ message: 'failed' } as ErrorEvent)
    await expect(first).rejects.toThrow('failed')
    const second = pool.load('b', new AbortController().signal)
    expect(workers[0].terminated).toBe(true)
    reply(1)
    await expect(second).resolves.toBeDefined()
    pool.dispose()
  })
})
