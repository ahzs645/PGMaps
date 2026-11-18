import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDecodePool, decodePoolSize, type PoolWorker } from './heicDecodePool'

type Fake = PoolWorker<string, string> & { got: string[]; ended: boolean; answer(text?: string): void }

function fakes() {
  const made: Fake[] = []
  const make = () => {
    const worker: Fake = {
      got: [],
      ended: false,
      onmessage: null,
      onerror: null,
      postMessage(message) {
        worker.got.push(message)
      },
      terminate() {
        worker.ended = true
      },
      answer(text = `done ${worker.got[worker.got.length - 1]}`) {
        worker.onmessage?.({ data: text })
      },
    }
    made.push(worker)
    return worker
  }
  return { made, make }
}
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => vi.useRealTimers())

describe('the HEIC decode pool', () => {
  it('runs up to its size side by side and gives a waiting photo the first worker to finish', async () => {
    const { made, make } = fakes()
    const pool = createDecodePool({ make, size: 2 })
    const results = [pool.run('a'), pool.run('b'), pool.run('c')]
    await turn()
    expect(made.map((worker) => worker.got)).toEqual([['a'], ['b']])
    made[1].answer()
    await turn()
    // The same worker takes the next photo: nothing is compiled again.
    expect(made).toHaveLength(2)
    expect(made[1].got).toEqual(['b', 'c'])
    made[0].answer()
    made[1].answer()
    expect(await Promise.all(results)).toEqual(['done a', 'done b', 'done c'])
  })

  it('ends a worker left idle, and starts a new one for the next photo', async () => {
    vi.useFakeTimers()
    const { made, make } = fakes()
    const pool = createDecodePool({ make, size: 2, idleMs: 5000 })
    const first = pool.run('a')
    await vi.advanceTimersByTimeAsync(0)
    made[0].answer()
    await first
    vi.advanceTimersByTime(4999)
    expect(made[0].ended).toBe(false)
    vi.advanceTimersByTime(1)
    expect(made[0].ended).toBe(true)
    expect(pool.workers()).toBe(0)
    void pool.run('b')
    await vi.advanceTimersByTimeAsync(0)
    expect(made).toHaveLength(2)
  })

  it('keeps an idle worker for a photo that comes before it ends', async () => {
    vi.useFakeTimers()
    const { made, make } = fakes()
    const pool = createDecodePool({ make, size: 1, idleMs: 5000 })
    const first = pool.run('a')
    await vi.advanceTimersByTimeAsync(0)
    made[0].answer()
    await first
    vi.advanceTimersByTime(3000)
    void pool.run('b')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(made).toHaveLength(1)
    expect(made[0].ended).toBe(false)
    expect(made[0].got).toEqual(['a', 'b'])
  })

  it('ends the worker of an aborted photo and lets the next one start on a new worker', async () => {
    const { made, make } = fakes()
    const pool = createDecodePool({ make, size: 1 })
    const controller = new AbortController()
    const stopped = pool.run('a', [], controller.signal)
    const waiting = pool.run('b')
    await turn()
    controller.abort()
    await expect(stopped).rejects.toThrow()
    await turn()
    expect(made[0].ended).toBe(true)
    expect(made).toHaveLength(2)
    made[1].answer()
    expect(await waiting).toBe('done b')
  })

  it('drops a photo aborted while it waits without touching the running one', async () => {
    const { made, make } = fakes()
    const pool = createDecodePool({ make, size: 1 })
    const running = pool.run('a')
    const controller = new AbortController()
    const waiting = pool.run('b', [], controller.signal)
    await turn()
    controller.abort()
    await expect(waiting).rejects.toThrow()
    made[0].answer()
    expect(await running).toBe('done a')
    expect(made[0].got).toEqual(['a'])
  })

  it('rejects when a worker fails to start, and carries on', async () => {
    const { made, make } = fakes()
    const pool = createDecodePool({ make, size: 1 })
    const failed = pool.run('a')
    await turn()
    made[0].onerror?.({ message: 'no script' })
    await expect(failed).rejects.toThrow('no script')
    const next = pool.run('b')
    await turn()
    made[1].answer()
    expect(await next).toBe('done b')
  })

  it('sizes the pool to the cores and the memory the browser reports', () => {
    expect(decodePoolSize(10, 8)).toBe(4)
    expect(decodePoolSize(4, 8)).toBe(3)
    expect(decodePoolSize(10, 4)).toBe(2)
    expect(decodePoolSize(10, undefined)).toBe(2)
    expect(decodePoolSize(1, 8)).toBe(1)
    expect(decodePoolSize(undefined, undefined)).toBe(1)
  })
})
