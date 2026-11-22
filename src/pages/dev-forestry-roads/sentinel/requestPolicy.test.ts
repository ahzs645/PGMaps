import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeViewWindow, viewWindowRule, windowServes, type LonLatBounds } from '@/components/ui/map-view-window'
import { createSentinelSearch } from './searchCache'
import { createReadQueue } from '@/lib/sentinel2/readQueue'
import { catalogueServes, sceneReaches, type SceneCatalogue } from './catalogue'
import {
  SENTINEL_MAX_READ_PX,
  SENTINEL_MAX_WINDOW_PX,
  SENTINEL_VIEW_EDGE_SHARE,
  SENTINEL_VIEW_GRID_DEG,
  SENTINEL_VIEW_OVERSCAN,
} from '@/lib/sentinel2/limits'
import { parseSentinelScenes } from '@/lib/sentinel2/stac'
import { sceneWindow, viewPixelM } from '@/lib/sentinel2/window'
import fixture from '@/lib/sentinel2/stacSearch.fixture.json'

afterEach(() => vi.useRealTimers())

const RULE = viewWindowRule({
  overscan: SENTINEL_VIEW_OVERSCAN,
  edgeShare: SENTINEL_VIEW_EDGE_SHARE,
  gridDeg: SENTINEL_VIEW_GRID_DEG,
})
/** About a z13 view of the plan near Prince George. */
const VIEW: LonLatBounds = [-122.78, 53.86, -122.64, 53.93]
const pan = ([w, s, e, n]: LonLatBounds, dx: number, dy = 0): LonLatBounds => [w + dx, s + dy, e + dx, n + dy]

describe('Sentinel view window', () => {
  it('reads 1.5 × the view, so a small pan reads nothing', () => {
    const level = viewPixelM(VIEW)!
    const window = makeViewWindow(VIEW, level, RULE)
    expect(windowServes(window, pan(VIEW, 0.01), viewPixelM(pan(VIEW, 0.01))!, RULE)).toBe(true)
    expect(windowServes(window, pan(VIEW, 0.06), viewPixelM(pan(VIEW, 0.06))!, RULE)).toBe(false)
    const read = sceneWindow(window.bounds, 32610, { view: VIEW })
    const plain = sceneWindow(VIEW, 32610)
    expect(read.width / plain.width).toBeGreaterThan(1.4)
    expect(read.height / plain.height).toBeGreaterThan(1.4)
  })

  it('chooses the pixel from the view, so the picture is no coarser than it was without overscan', () => {
    // A z12 view about 30 km wide reads 20 m today; with overscan it still reads 20 m.
    const wide: LonLatBounds = [-122.95, 53.8, -122.5, 54.0]
    expect(sceneWindow(wide, 32610).pixelM).toBe(20)
    const window = makeViewWindow(wide, viewPixelM(wide)!, RULE)
    const read = sceneWindow(window.bounds, 32610, { view: wide })
    expect(read.pixelM).toBe(20)
    expect(Math.max(read.width, read.height)).toBeGreaterThan(SENTINEL_MAX_WINDOW_PX)
    expect(Math.max(read.width, read.height)).toBeLessThanOrEqual(SENTINEL_MAX_READ_PX)
    // Zooming in from 13 to 14 keeps 10 m: the level, and so the window, stay.
    const inner: LonLatBounds = [-122.745, 53.878, -122.675, 53.912]
    expect(viewPixelM(VIEW)).toBe(10)
    expect(viewPixelM(inner)).toBe(10)
    expect(windowServes(makeViewWindow(VIEW, 10, RULE), inner, 10, RULE)).toBe(true)
  })

  it('crops an overscanned window to the km limit and read budget about the view, refusing only a view too wide', () => {
    const view: LonLatBounds = [-123.0, 53.75, -122.4, 54.05]
    const window = makeViewWindow(view, viewPixelM(view)!, RULE)
    const read = sceneWindow(window.bounds, 32610, { view, maxKm: 50 })
    expect((read.bbox[2] - read.bbox[0]) / 1000).toBeLessThanOrEqual(50 + read.pixelM / 1000)
    const own = sceneWindow(view, 32610)
    expect(read.bbox[0]).toBeLessThanOrEqual(own.bbox[0])
    expect(read.bbox[2]).toBeGreaterThanOrEqual(own.bbox[2])
    expect(() => sceneWindow(window.bounds, 32610, { view, maxKm: 30 })).toThrow('at most 30 km')
  })
})

describe('Sentinel catalogue reuse', () => {
  const scenes = parseSentinelScenes(fixture, VIEW, { preferEpsg: 32610 })
  const catalogue: SceneCatalogue = { searched: VIEW, epsg: 32610, range: 'recent', scenes }

  it('keeps the listed scenes for a pan inside their tiles', () => {
    expect(scenes.length).toBeGreaterThan(2)
    expect(catalogueServes(catalogue, pan(VIEW, 0.2, 0.05), 32610, 'recent')).toBe(true)
    for (const scene of scenes) expect(sceneReaches(scene, pan(VIEW, 0.2))).toBe(true)
  })

  it('searches again past a listed tile, in another zone or for another date range', () => {
    const tile = scenes.find((scene) => scene.bbox)!.bbox!
    const past: LonLatBounds = [tile[2] - 0.05, VIEW[1], tile[2] + 0.1, VIEW[3]]
    expect(catalogueServes(catalogue, past, 32610, 'recent')).toBe(false)
    expect(catalogueServes(catalogue, VIEW, 32611, 'recent')).toBe(false)
    expect(catalogueServes(catalogue, VIEW, 32610, '2019')).toBe(false)
    expect(catalogueServes(null, VIEW, 32610, 'recent')).toBe(false)
    expect(catalogueServes({ ...catalogue, scenes: [] }, VIEW, 32610, 'recent')).toBe(false)
  })

  it('a pan journey inside the tiles makes one search, where the settled-view rule made eleven', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => Response.json(fixture))
    const search = createSentinelSearch(fetch)
    const range = { from: '2024-01-01', to: '2026-01-01' }
    let listed: SceneCatalogue | null = null
    let window = makeViewWindow(VIEW, viewPixelM(VIEW)!, RULE)
    const views = Array.from({ length: 11 }, (_, step) => pan(VIEW, step * 0.03, step * 0.005))
    // The settled-view rule searched each new 0.01° area: every one of these stops.
    const snapped = (view: LonLatBounds) =>
      view.map((v, i) => (i < 2 ? Math.floor(v / 0.01) : Math.ceil(v / 0.01))).join()
    expect(new Set(views.map(snapped)).size).toBe(11)
    for (const view of views) {
      if (!windowServes(window, view, viewPixelM(view)!, RULE)) window = makeViewWindow(view, viewPixelM(view)!, RULE)
      if (catalogueServes(listed, window.bounds, 32610, 'recent')) continue
      const pending = search({ window: window.bounds, range, preferEpsg: 32610 })
      await vi.advanceTimersByTimeAsync(5_000)
      listed = { searched: window.bounds, epsg: 32610, range: 'recent', scenes: await pending }
    }
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('Sentinel viewport and request limits', () => {
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
