import { describe, expect, it, vi } from 'vitest'
import { ClimateStore, canPrefetch, reuseClimateGeometry } from './adapters/climateStore'
import { resolveLayer } from './storyScene'
import { ClimatePreparation, type ClimateFrame } from './adapters/climatePreparation'
import type { ProjectStoryLayerDef } from '@/lib/projectPackages'
import {
  decodeTile,
  type Cells,
} from '../../../vendor/bcdatamapper/datascrapers/climate/climatedata-ca/bc-climate/deckgl.mjs'

const base = 'https://example.test/release/'
const band = {
  horizon: '1971-2000',
  percentile: 'p50',
  measure: 'absolute',
  baseline: null,
  season: 'annual',
  units: 'days',
  min: 0,
  max: 10,
}
function layer(horizon = band.horizon) {
  return resolveLayer(
    {
      id: horizon,
      format: 'climate-grid',
      data: `${base}manifest.json`,
      climate: { ...band, horizon, product: 'heat', domain: [0, 10], colors: ['#000000', '#ffffff'] },
      fillOpacity: 1,
      fillColor: '#ffffff',
      lineOpacity: 0,
      lineColor: '#000000',
      lineWidth: 0,
      idProperty: 'cellId',
      labelProperty: 'value',
    } as ProjectStoryLayerDef,
    horizon,
    undefined,
    '#ffffff',
  )
}
function fixture(count = 2) {
  const tile = {
    id: 't',
    row: 0,
    col: 0,
    width: count,
    height: 1,
    count,
    geometry: 'geometry.json',
    bounds: [0, 0, count, 1],
  }
  const bytes = new Uint8Array(count * 2 * 8)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < count; i++) {
    view.setFloat64(i * 8, Math.PI, true)
    view.setFloat64((count + i) * 8, 9, true)
  }
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const assets = new Map([
    [
      `${base}manifest.json`,
      json({
        format: 'bcdatamapper-native-grid-v1',
        scenario: 'ssp585',
        products: [{ id: 'heat', path: 'product.json' }],
        grids: { grid: { path: 'grid.json' } },
      }),
    ],
    [
      `${base}product.json`,
      json({
        id: 'heat',
        grid: 'grid',
        bands: [band, { ...band, horizon: '2071-2100' }],
        tiles: [{ id: 't', path: 'values.bin' }],
      }),
    ],
    [
      `${base}grid.json`,
      json({ id: 'grid', xEdges: Array.from({ length: count + 1 }, (_, i) => i), yEdges: [0, 1], tiles: [tile] }),
    ],
    [`${base}geometry.json`, json({ indices: Array.from({ length: count }, (_, i) => i) })],
    [`${base}values.bin`, bytes],
  ])
  const fetcher = vi.fn(async (url: string, _options?: { signal?: AbortSignal }) => {
    const asset = assets.get(url)
    if (!asset) throw new Error(`Missing fixture ${url}`)
    return asset
  })
  return { assets, fetcher, bytes }
}
const extent: [number, number, number, number] = [0, 0, 1, 1]
const signal = () => new AbortController().signal

describe('bounded climate read-ahead', () => {
  it('reuses release/geometry/story-band bytes forward and back without rounding values', async () => {
    const { fetcher } = fixture()
    const store = new ClimateStore(undefined, fetcher, [layer().layer, layer('2071-2100').layer])
    const first = await store.load([layer()], extent, 8, signal())
    const calls = fetcher.mock.calls.length
    expect(first[0].data.features[0].properties.value).toBe(Math.PI)
    expect(await store.load([layer('2071-2100')], extent, 8, signal(), true)).toEqual([])
    const future = await store.load([layer('2071-2100')], extent, 8, signal())
    expect(future[0].data.features[0].properties.value).toBe(9)
    expect(future[0].data.features[0].properties.horizon).toBe('2071-2100')
    await store.load([layer()], extent, 8, signal())
    expect(fetcher).toHaveBeenCalledTimes(calls)
    expect(future[0].id).toBe(first[0].id)
    expect(reuseClimateGeometry(first[0].data, future[0].data)).toBe(first[0].data)
    store.clear()
    expect(store.retainedBytes).toBe(0)
    await store.load([layer()], extent, 8, signal())
    expect(fetcher).toHaveBeenCalledTimes(calls * 2)
  })

  it('read-ahead warms transport without allocating decoded cell scenes', async () => {
    const { fetcher } = fixture()
    const store = new ClimateStore(undefined, fetcher)
    expect(await store.load([layer()], extent, 8, signal(), true)).toEqual([])
    const calls = fetcher.mock.calls.length
    expect((await store.load([layer()], extent, 8, signal()))[0].data.features).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(calls)
  })

  it('prepares the next small scene with exact values before navigation', async () => {
    const { fetcher } = fixture()
    const store = new ClimateStore(undefined, fetcher)
    const layers = [layer('2071-2100')]
    const prepared = await store.load(layers, extent, 8, signal(), 'prepare')
    const calls = fetcher.mock.calls.length
    expect(prepared).toEqual(await store.load(layers, extent, 8, signal()))
    expect(fetcher).toHaveBeenCalledTimes(calls)
    const slot = new ClimatePreparation()
    const frame: ClimateFrame = { center: [0, 0], zoom: 8, bearing: 0, pitch: 0, width: 390, height: 400 }
    slot.set(layers, frame, prepared)
    expect(slot.take(layers, frame)).toBe(prepared)
    expect(slot.take(layers, frame)).toBeUndefined()
    for (const changed of [{ zoom: 9 }, { center: [1, 0] as [number, number] }, { width: 400 }, { height: 500 }]) {
      slot.set(layers, frame, prepared)
      expect(slot.take(layers, { ...frame, ...changed })).toBeUndefined()
    }
    slot.set(layers, frame, prepared)
    expect(slot.take([layer()], frame)).toBeUndefined()
    slot.set(layers, frame, prepared)
    slot.clear()
    expect(slot.take(layers, frame)).toBeUndefined()
  })

  it('keeps preparation of large fine-grid views byte-only', async () => {
    const { fetcher } = fixture(40_001)
    const store = new ClimateStore(undefined, fetcher)
    expect(await store.load([layer()], extent, 8, signal(), 'prepare')).toEqual([])
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('values.bin'))).toBe(true)
  })

  it('pins latest once even when transport bytes are evicted', async () => {
    const { assets, fetcher } = fixture()
    assets.set(`${base}latest.json`, new TextEncoder().encode(JSON.stringify({ manifest: 'manifest.json' })))
    const selected = layer()
    selected.layer.data = `${base}latest.json`
    const store = new ClimateStore(0, fetcher)
    await store.load([selected], extent, 8, signal())
    store.clearCache()
    assets.set(`${base}latest.json`, new TextEncoder().encode(JSON.stringify({ manifest: 'new-release.json' })))
    await store.load([selected], extent, 8, signal())
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('latest.json'))).toHaveLength(1)
    expect(store.retainedBytes).toBe(0)
  })

  it('keeps different release URLs isolated even with identical product and tile IDs', async () => {
    const { assets, fetcher } = fixture()
    const secondBase = 'https://example.test/second/'
    for (const [url, value] of [...assets]) assets.set(url.replace(base, secondBase), value.slice())
    new DataView(assets.get(`${secondBase}values.bin`)!.buffer).setFloat64(0, 42, true)
    const store = new ClimateStore(undefined, fetcher)
    const first = await store.load([layer()], extent, 8, signal())
    const other = layer()
    other.layer.data = `${secondBase}manifest.json`
    const second = await store.load([other], extent, 8, signal())
    expect(first[0].data.features[0].properties.value).toBe(Math.PI)
    expect(second[0].data.features[0].properties.value).toBe(42)
    expect(second[0].id).not.toBe(first[0].id)
  })

  it('does not fetch blocks outside the destination viewport or below the zoom gate', async () => {
    const { fetcher } = fixture()
    const store = new ClimateStore(undefined, fetcher)
    expect(await store.load([layer()], [20, 20, 21, 21], 8, signal(), true)).toEqual([])
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('values.bin'))).toBe(false)
    const snow = layer()
    snow.layer.climate!.minZoom = 7
    fetcher.mockClear()
    await expect(store.load([snow], extent, 6, signal())).rejects.toThrow('Zoom in')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('validates the combined cell budget before loading any block', async () => {
    const { fetcher } = fixture(90_001)
    const store = new ClimateStore(undefined, fetcher)
    await expect(store.load([layer(), layer('2071-2100')], extent, 8, signal())).rejects.toThrow('Zoom in')
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('values.bin'))).toBe(false)
  })

  it('bounds retained bytes and refuses speculative blocks that would evict foreground data', async () => {
    const { assets, fetcher } = fixture()
    const total = [...assets.values()].reduce((sum, value) => sum + value.byteLength, 0)
    const budget = total - assets.get(`${base}values.bin`)!.byteLength + 2 * 8 - 1
    const store = new ClimateStore(budget, fetcher)
    await expect(store.load([layer()], extent, 8, signal(), true)).rejects.toThrow()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('values.bin'))).toBe(false)
    const retained = store.retainedBytes
    const calls = fetcher.mock.calls.length
    await expect(store.load([layer()], extent, 8, signal(), true)).rejects.toThrow()
    expect(store.retainedBytes).toBe(retained)
    expect(fetcher).toHaveBeenCalledTimes(calls)
    // Foreground can evict the least recently used bytes to complete the view.
    await store.load([layer()], extent, 8, signal())
    expect(store.retainedBytes).toBeLessThanOrEqual(budget)
  })

  it('retains only story-used band copies when the archive is larger than the cache', async () => {
    const { assets, fetcher } = fixture(128)
    const product = JSON.parse(new TextDecoder().decode(assets.get(`${base}product.json`)))
    product.bands.push(...Array.from({ length: 466 }, (_, i) => ({ ...band, horizon: `unused-${i}` })))
    assets.set(`${base}product.json`, new TextEncoder().encode(JSON.stringify(product)))
    const archive = new Uint8Array(468 * 128 * 8)
    archive.set(assets.get(`${base}values.bin`)!)
    new DataView(archive.buffer).setFloat64(8, Number.NaN, true)
    assets.set(`${base}values.bin`, archive)
    const budget = 256 * 1024
    expect(archive.byteLength).toBeGreaterThan(budget)
    const store = new ClimateStore(budget, fetcher, [layer().layer, layer('2071-2100').layer])
    const first = await store.load([layer()], extent, 8, signal())
    const grid = JSON.parse(new TextDecoder().decode(assets.get(`${base}grid.json`)))
    const geometry = JSON.parse(new TextDecoder().decode(assets.get(`${base}geometry.json`)))
    expect(first[0].data).toEqual(decodeTile(grid, grid.tiles[0], geometry.indices, archive, product, 0))
    const future = await store.load([layer('2071-2100')], extent, 8, signal())
    expect(future[0].data).toEqual(decodeTile(grid, grid.tiles[0], geometry.indices, archive, product, 1))
    await store.load([layer()], extent, 8, signal())
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('values.bin'))).toHaveLength(1)
    const metadataBytes = [...assets]
      .filter(([url]) => !url.endsWith('values.bin'))
      .reduce((sum, [, v]) => sum + v.byteLength, 0)
    expect(store.retainedBytes).toBe(metadataBytes + 2 * 128 * 8)
    // A subarray would report small byteLength but still retain the full archive.
    for (const [key, bytes] of store['cache']) {
      if (key.includes('#band=')) expect(bytes.buffer.byteLength).toBe(bytes.byteLength)
    }
  })

  it('does not retain optional bands at the expense of the active band', async () => {
    const { assets, fetcher } = fixture()
    const metadata = [...assets]
      .filter(([url]) => !url.endsWith('values.bin'))
      .reduce((sum, [, v]) => sum + v.byteLength, 0)
    const store = new ClimateStore(metadata + 16, fetcher, [layer().layer, layer('2071-2100').layer])
    await store.load([layer()], extent, 8, signal())
    const calls = fetcher.mock.calls.length
    await store.load([layer()], extent, 8, signal())
    expect(fetcher).toHaveBeenCalledTimes(calls)
    expect(store.retainedBytes).toBe(metadata + 16)
  })

  it('does not cache band copies from an aborted value download', async () => {
    const { fetcher } = fixture()
    const controller = new AbortController()
    const store = new ClimateStore(
      undefined,
      async (url) => {
        const bytes = await fetcher(url)
        if (url.endsWith('values.bin')) controller.abort()
        return bytes
      },
      [layer().layer, layer('2071-2100').layer],
    )
    await expect(store.load([layer()], extent, 8, controller.signal)).rejects.toThrow()
    expect([...store['cache'].keys()].some((key) => key.includes('#band='))).toBe(false)
  })

  it('never caches a canceled response and retries failures', async () => {
    const { fetcher } = fixture()
    const controller = new AbortController()
    const slow = vi.fn(async (url: string) => {
      const value = await fetcher(url)
      controller.abort()
      return value
    })
    const canceled = new ClimateStore(undefined, slow)
    await expect(canceled.load([layer()], extent, 8, controller.signal)).rejects.toThrow()
    expect(canceled.retainedBytes).toBe(0)
    fetcher.mockRejectedValueOnce(new Error('outage'))
    const store = new ClimateStore(undefined, fetcher)
    await expect(store.load([layer()], extent, 8, signal())).rejects.toThrow('outage')
    expect((await store.load([layer()], extent, 8, signal()))[0].data.features).toHaveLength(2)
  })

  it('can retry malformed cached binary without retaining a poisoned response', async () => {
    const { assets, fetcher, bytes } = fixture()
    assets.set(`${base}values.bin`, new Uint8Array(1))
    const store = new ClimateStore(undefined, fetcher)
    await expect(store.load([layer()], extent, 8, signal())).rejects.toThrow('dimensions mismatch')
    // The UI invalidates transport bytes on a foreground decoding error.
    store.clearCache()
    assets.set(`${base}values.bin`, bytes)
    expect((await store.load([layer()], extent, 8, signal()))[0].data.features[0].properties.value).toBe(Math.PI)
  })

  it('rebuilds geometry when the missing-value mask changes', () => {
    const cells = (ids: string[]) =>
      ({ type: 'FeatureCollection', features: ids.map((cellId) => ({ properties: { cellId } })) }) as Cells
    const previous = cells(['a', 'b'])
    const next = cells(['a', 'c'])
    expect(reuseClimateGeometry(previous, next)).toBe(next)
    expect(reuseClimateGeometry(previous, cells(['a']))).not.toBe(previous)
  })

  it('backs off for hidden tabs, data saver, and constrained connections', () => {
    expect(canPrefetch(false)).toBe(true)
    expect(canPrefetch(true)).toBe(false)
    expect(canPrefetch(false, { saveData: true })).toBe(false)
    for (const effectiveType of ['slow-2g', '2g', '3g']) expect(canPrefetch(false, { effectiveType })).toBe(false)
    expect(canPrefetch(false, { effectiveType: '4g' })).toBe(true)
  })
})
