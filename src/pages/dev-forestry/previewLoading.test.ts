import { afterEach, describe, expect, it, vi } from 'vitest'
import { createForestHistoryLoader, type ForestHistoryData } from './bcForestHistory'
import { createPreviewTerrainLoader } from './previewTerrainCache'
import { ElevationGrid, type Bounds, type DemTileRange } from './terrain'

const bounds: Bounds = [-122.65, 53.85, -122.55, 53.95]
const signal = () => new AbortController().signal
const empty = () => Response.json({ features: [] })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('preview source reuse', () => {
  it('keeps successful sources after a partial failure, backs off the failure, and retries only that source', async () => {
    const fetcher = vi.fn(async (url: string) => url.includes('/20/') ? new Response('', { status: 503 }) : empty())
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
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/20/') ? new Promise<Response>(resolve => { release = resolve }) : Promise.resolve(empty())))
    const updates: ForestHistoryData[] = []
    const loading = createForestHistoryLoader()(bounds, signal(), { onUpdate: data => updates.push(data) })
    await vi.waitFor(() => expect(updates.at(-1)?.pendingSources).toEqual(['planting']))
    expect(updates.at(-1)?.issues).toEqual([])
    release(empty())
    expect((await loading).pendingSources).toEqual([])
  })

  it('times out a source with a readable message and never caches cancelled work as a failure', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetcher)
    const load = createForestHistoryLoader()
    const timed = load(bounds, signal())
    await vi.advanceTimersByTimeAsync(20000)
    expect((await timed).issues.every(issue => issue.includes('took too long'))).toBe(true)
    const abort = new AbortController()
    const cancelled = load(bounds, abort.signal, { retryFailed: true })
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await rejected
    fetcher.mockImplementation(async () => empty())
    await load(bounds, signal(), { retryFailed: true })
    expect(fetcher).toHaveBeenCalledTimes(9)
  })
})

const range: DemTileRange = { zoom: 14, minX: 2600, maxX: 2600, minY: 5200, maxY: 5200, tileCount: 1 }
describe('decoded preview terrain reuse', () => {
  it('reuses the exact ground source and evicts the least recently used mosaic', async () => {
    const loader = vi.fn(async (options: { range: DemTileRange }) => ({ grid: new ElevationGrid(options.range), missingTileCount: 0 }))
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
