import { afterEach, describe, expect, it, vi } from 'vitest'
import { sentinelViewBounds } from './viewport'
import { createSentinelSearch } from './searchCache'
import { createReadQueue } from './readQueue'
import fixture from './stacSearch.fixture.json'

afterEach(() => vi.useRealTimers())

describe('Sentinel viewport and request limits', () => {
  it('does no work below z12, rejects wrapped views and reuses outward-snapped small pans', () => {
    expect(sentinelViewBounds([-122.729, 53.891, -122.711, 53.899], 11.99)).toBeNull()
    expect(sentinelViewBounds([170, 50, -170, 51], 14)).toBeNull()
    expect(sentinelViewBounds([-122.728, 53.892, -122.712, 53.898], 14)).toEqual(
      sentinelViewBounds([-122.729, 53.891, -122.711, 53.899], 14),
    )
  })

  it('caches catalogue results and paces new searches including retries', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => Response.json(fixture))
    const search = createSentinelSearch(fetch)
    const options = {
      window: [-122.73, 53.88, -122.69, 53.91] as [number, number, number, number],
      range: { from: '2024-01-01', to: '2026-01-01' },
    }
    await search(options)
    await search(options)
    expect(fetch).toHaveBeenCalledTimes(1)
    const pending = search({ ...options, window: [-122.9, 53.9, -122.8, 54] })
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await pending
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After and cancels a queued search without another network call', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
    const search = createSentinelSearch(fetch)
    const options = {
      window: [-122.73, 53.88, -122.69, 53.91] as [number, number, number, number],
      range: { from: '2024-01-01', to: '2026-01-01' },
    }
    await expect(search(options)).rejects.toThrow('429')
    const controller = new AbortController()
    const pending = search({ ...options, signal: controller.signal }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    controller.abort()
    expect((await pending).name).toBe('AbortError')
  })

  it('never starts more than two band reads and skips cancelled queued reads', async () => {
    const queue = createReadQueue(2)
    const finish: Array<() => void> = []
    const read = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)))
    const a = queue(read),
      b = queue(read)
    const controller = new AbortController()
    const c = queue(read, controller.signal).catch((e) => e)
    expect(read).toHaveBeenCalledTimes(2)
    controller.abort()
    finish[0]()
    await a
    expect((await c).name).toBe('AbortError')
    finish[1]()
    await b
    expect(read).toHaveBeenCalledTimes(2)
  })
})
