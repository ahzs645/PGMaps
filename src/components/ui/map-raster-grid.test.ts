import { expect, it, vi } from 'vitest'
import type { PickingInfo } from '@deck.gl/core'
import { PolygonLayer } from '@deck.gl/layers'
import { encode } from 'fast-png'
import { createRasterGridLayer } from './map-raster-grid'
import type { RasterClassGrid, RasterGridCell } from '@/lib/rasterClassGrid'

it('uses the saved source pyramid at every map zoom and permits explicit level comparisons', () => {
  const options = { id: 'all-levels', tileUrl: () => '/tile.png', palette: [{ value: 1, rgb: [200, 40, 30] as const }], colorForValue: (): [number, number, number, number] => [200, 40, 30, 255] }
  const all = createRasterGridLayer({ ...options, sourceZoom: { min: 3, max: 10 } })
  expect(all.props.minZoom).toBe(3)
  expect(all.props.maxZoom).toBe(10)
  expect(all.props.visibleMinZoom).toBeUndefined()
  const fixed = createRasterGridLayer({ ...options, sourceZoom: { min: 7, max: 7 } })
  expect(fixed.props.minZoom).toBe(7)
  expect(fixed.props.maxZoom).toBe(7)
  expect(fixed.props.visibleMinZoom).toBe(7)
  expect(() => createRasterGridLayer({ ...options, sourceZoom: { min: 10, max: 3 } })).toThrow('bounds')
})

it('draws unclassified and partially transparent pixels in their original colour by default', async () => {
  const data = new Uint8Array(256 * 256 * 4)
  data.set([17, 43, 89, 1])
  const png = encode({ width: 256, height: 256, channels: 4, data })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => png.buffer })))
  try {
    const layer = createRasterGridLayer({
      id: 'original', sourceZoom: 10, tileUrl: () => '/source.png', opacity: 0.82,
      palette: [{ value: 1, rgb: [200, 40, 30] }], colorForValue: () => [148, 163, 184, 160],
    })
    const tile = { index: { x: 162, y: 329, z: 10 } }
    const grid = await layer.props.getTileData!(tile as Parameters<NonNullable<typeof layer.props.getTileData>>[0]) as RasterClassGrid
    const boxes = layer.props.renderSubLayers!({ id: 'tile', data: grid, tile } as Parameters<NonNullable<typeof layer.props.renderSubLayers>>[0])
    if (!(boxes instanceof PolygonLayer)) throw new Error('Expected individual boxes')
    const fill = boxes.props.getFillColor
    if (typeof fill !== 'function') throw new Error('Expected per-box colour')
    expect(grid.cellPixels).toBe(1)
    expect(grid.cells[0].value).toBe(-2)
    expect(fill(grid.cells[0], {} as Parameters<typeof fill>[1])).toEqual([17, 43, 89, 1])
    expect(boxes.props.stroked).toBe(false)
    expect(layer.props.opacity).toBe(0.82)
  } finally { vi.unstubAllGlobals() }
})

it('dispatches cell hover and click metadata from the outer TileLayer and clears hover on exit', () => {
  const onHover = vi.fn(), onPick = vi.fn()
  const layer = createRasterGridLayer({
    id: 'grid', sourceZoom: 10, cellPixels: 4,
    tileUrl: ({ x, y, z }) => `/tiles/${z}/${x}/${y}.png`,
    palette: [{ value: 0, rgb: [200, 40, 30] }],
    colorForValue: () => [200, 40, 30, 150], onHover, onPick,
  })
  // TileLayer adds the source tile after walking up the picking layer chain.
  const info = {
    object: { value: 0, agreement: 1, row: 3, column: 2 },
    coordinate: [-122.75, 53.915], tile: { index: { x: 162, y: 329, z: 10 } },
  } as unknown as PickingInfo<RasterGridCell>
  const expected = {
    value: 0, agreement: 1, row: 3, column: 2,
    longitude: -122.75, latitude: 53.915, tile: { x: 162, y: 329, z: 10 }, cellPixels: 4,
  }
  const event = {} as Parameters<NonNullable<typeof layer.props.onHover>>[1]
  layer.props.onHover?.(info, event)
  layer.props.onClick?.(info, event)
  expect(onHover).toHaveBeenLastCalledWith(expected)
  expect(onPick).toHaveBeenLastCalledWith(expected)
  const exit = { object: null } as PickingInfo
  layer.props.onHover?.(exit, event)
  layer.props.onClick?.(exit, event)
  expect(onHover).toHaveBeenLastCalledWith(null)
  expect(onPick).toHaveBeenCalledTimes(1)
})
