import { afterEach, describe, expect, it, vi } from 'vitest'
import { createForestHistoryLoader, type ForestHistoryData } from './bcForestHistory'
import { createPreviewTerrainLoader } from './previewTerrainCache'
import { ElevationGrid, type Bounds, type DemTileRange } from './terrain'

const bounds: Bounds = [-122.65, 53.85, -122.55, 53.95]
const signal = () => new AbortController().signal
const empty = () => Response.json({ features: [] })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('preview source reuse', () => {
  it('keeps successful sources after a partial failure, backs off the failure, and retries only that source', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('/20/') ? new Response('', { status: 503 }) : empty()))
    vi.stubGlobal('fetch', fetcher)
    const load = createForestHistoryLoader()
    const first = await load(bounds, signal())
    expect(first.issues).toHaveLength(1)
    expect(first.issues[0]).toContain('planting unavailable')
    expect(first.issues[0]).not.toContain('AbortError')
    await load(bounds, signal())
    expect(fetcher).toHaveBeenCalledTimes(3)
    fetcher.mockImplementation(async () => empty())
    const recovered = await load(bounds, signal(), { retryFailed: true })
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher.mock.calls[3][0]).toContain('/20/')
    expect(recovered.issues).toEqual([])
    expect(recovered.pendingSources).toEqual([])
    await load([-123, 54, -122.9, 54.1], signal())
    expect(fetcher).toHaveBeenCalledTimes(7)
  })

  it('publishes available responses while planting is still pending', async () => {
    let release!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/20/')
          ? new Promise<Response>((resolve) => {
              release = resolve
            })
          : Promise.resolve(empty()),
      ),
    )
    const updates: ForestHistoryData[] = []
    const loading = createForestHistoryLoader()(bounds, signal(), { onUpdate: (data) => updates.push(data) })
    await vi.waitFor(() => expect(updates.at(-1)?.pendingSources).toEqual(['planting']))
    expect(updates.at(-1)?.issues).toEqual([])
    release(empty())
    expect((await loading).pendingSources).toEqual([])
  })

  it('tries a timed-out source once more, then reports it, and never caches cancelled work as a failure', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    vi.stubGlobal('fetch', fetcher)
    const load = createForestHistoryLoader()
    const timed = load(bounds, signal())
    await vi.advanceTimersByTimeAsync(20000)
    // Each source's first attempt timed out and its second is in flight.
    expect(fetcher).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(20000)
    expect((await timed).issues.every((issue) => issue.includes('took too long'))).toBe(true)
    const abort = new AbortController()
    const cancelled = load(bounds, abort.signal, { retryFailed: true })
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await rejected
    fetcher.mockImplementation(async () => empty())
    await load(bounds, signal(), { retryFailed: true })
    expect(fetcher).toHaveBeenCalledTimes(12)
  })

  it('recovers when the second attempt answers, with no issue left behind', async () => {
    vi.useFakeTimers()
    const calls = new Map<string, number>()
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options: RequestInit) => {
        const n = (calls.get(url) ?? 0) + 1
        calls.set(url, n)
        if (n > 1) return Promise.resolve(empty())
        return new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )
    const loading = createForestHistoryLoader()(bounds, signal())
    await vi.advanceTimersByTimeAsync(20000)
    const data = await loading
    expect(data.issues).toEqual([])
    expect([...calls.values()]).toEqual([2, 2, 2])
  })

  it('does not retry a refusal, which a second try would not change', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const data = await createForestHistoryLoader()(bounds, signal())
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(data.issues.every((issue) => issue.includes('could not be loaded'))).toBe(true)
  })

  it('reads each cell once per source, merges a polygon on a cell edge once, and names a partial failure', async () => {
    const cells: Bounds[] = [
      [-122.7, 53.88, -122.6, 53.94],
      [-122.6, 53.88, -122.5, 53.94],
    ]
    const shared = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.61, 53.9],
            [-122.59, 53.9],
            [-122.59, 53.91],
            [-122.61, 53.9],
          ],
        ],
      },
      properties: { OBJECTID: 7, REFERENCE_YEAR: 2010, I_SPECIES_HEIGHT_1: 4 },
    }
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/20/') && url.includes('-122.6%2C53.88%2C-122.5')) return new Response('', { status: 503 })
      return Response.json({ features: url.includes('/27/') ? [shared] : [] })
    })
    vi.stubGlobal('fetch', fetcher)
    const data = await createForestHistoryLoader()(cells, signal())
    expect(fetcher).toHaveBeenCalledTimes(6)
    expect(data.records.filter((r) => r.kind === 'height')).toHaveLength(1)
    expect(data.issues).toEqual([expect.stringContaining('planting partly unavailable')])
    expect(data.issues[0]).toContain('for 1 of 2 areas')
    expect(data.bounds).toEqual([-122.7, 53.88, -122.5, 53.94])
  })
})

const range: DemTileRange = { zoom: 14, minX: 2600, maxX: 2600, minY: 5200, maxY: 5200, tileCount: 1 }
describe('decoded preview terrain reuse', () => {
  it('reuses the exact ground source and evicts the least recently used mosaic', async () => {
    const loader = vi.fn(async (options: { range: DemTileRange }) => ({
      grid: new ElevationGrid(options.range),
      missingTileCount: 0,
    }))
    const load = createPreviewTerrainLoader(loader)
    const options = { range, signal: signal() }
    const first = await load(options)
    expect((await load(options)).source).toBe(first.source)
    expect(loader).toHaveBeenCalledTimes(1)
    const second = { range: { ...range, minX: 2601, maxX: 2601 } }
    await load(second)
    await load(options) // the first mosaic is most recently used
    await load({ range: { ...range, minX: 2602, maxX: 2602 } })
    expect((await load(options)).source).toBe(first.source)
    await load(second)
    expect(loader).toHaveBeenCalledTimes(4)
    await load(options, true)
    expect(loader).toHaveBeenCalledTimes(5)
  })

  it('keeps missing terrain unknown and allows an explicit retry', async () => {
    const loader = vi.fn(async () => ({ grid: new ElevationGrid(range), missingTileCount: 1 }))
    const load = createPreviewTerrainLoader(loader)
    expect((await load({ range })).source).toBeNull()
    await load({ range })
    expect(loader).toHaveBeenCalledTimes(1)
    await load({ range }, true)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not retain terrain from a cancelled load', async () => {
    const abort = new AbortController()
    const loader = vi.fn(async () => {
      abort.abort()
      return { grid: new ElevationGrid(range), missingTileCount: 0 }
    })
    const load = createPreviewTerrainLoader(loader)
    await expect(load({ range, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await load({ range, signal: signal() })
    expect(loader).toHaveBeenCalledTimes(2)
    await expect(load({ range, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
