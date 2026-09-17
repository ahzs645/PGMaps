import { describe, expect, it } from 'vitest'

import {
  DEM_TILE_SIZE,
  ElevationGrid,
  decodeTerrariumElevation,
  demResolutionMeters,
  demTileCoordinates,
  demTileRange,
  demTileUrl,
  lngLatToMercator,
  mercatorToLngLat,
} from './terrain'

describe('decodeTerrariumElevation', () => {
  it('puts sea level at the 32768 m offset', () => {
    expect(decodeTerrariumElevation(128, 0, 0)).toBe(0)
  })

  it('reads metres and fractional metres from the green and blue channels', () => {
    expect(decodeTerrariumElevation(128, 100, 0)).toBe(100)
    expect(decodeTerrariumElevation(128, 100, 128)).toBe(100.5)
    expect(decodeTerrariumElevation(127, 156, 0)).toBe(-100)
  })
})

describe('mercator conversion', () => {
  it('places the origin at the north-west corner of the world', () => {
    expect(lngLatToMercator(-180, 85.05112878)[0]).toBeCloseTo(0, 6)
    expect(lngLatToMercator(-180, 85.05112878)[1]).toBeCloseTo(0, 6)
    expect(lngLatToMercator(0, 0)).toEqual([0.5, 0.5])
  })

  it('round-trips a Prince George coordinate', () => {
    const [x, y] = lngLatToMercator(-122.7645, 53.9097)
    const [lng, lat] = mercatorToLngLat(x, y)
    expect(lng).toBeCloseTo(-122.7645, 9)
    expect(lat).toBeCloseTo(53.9097, 9)
  })
})

describe('demResolutionMeters', () => {
  it('halves with every zoom level and narrows towards the poles', () => {
    expect(demResolutionMeters(0, 0)).toBeCloseTo(156543.03, 1)
    expect(demResolutionMeters(0, 13) * 2).toBeCloseTo(demResolutionMeters(0, 12), 6)
    // Roughly 11 m per pixel across British Columbia at the default zoom.
    expect(demResolutionMeters(54, 13)).toBeGreaterThan(10)
    expect(demResolutionMeters(54, 13)).toBeLessThan(12)
  })
})

describe('demTileRange', () => {
  it('covers an area with the tiles its width and height need', () => {
    const range = demTileRange([-122.8, 53.85, -122.6, 53.95], 13)
    expect(range.zoom).toBe(13)
    // A zoom 13 tile spans 360/8192 degrees of longitude, and less latitude the
    // further north it sits: about six tiles across and five down here.
    expect(range.maxX - range.minX + 1).toBe(6)
    expect(range.maxY - range.minY + 1).toBe(5)
    expect(range.tileCount).toBe(demTileCoordinates(range).length)
  })

  it('grows the range when padding pushes past a tile edge', () => {
    const tight = demTileRange([-122.7, 53.9, -122.7, 53.9], 13)
    const padded = demTileRange([-122.7, 53.9, -122.7, 53.9], 13, 5000)
    expect(tight.tileCount).toBe(1)
    expect(padded.tileCount).toBeGreaterThan(tight.tileCount)
  })

  it('builds tile URLs from the template', () => {
    expect(demTileUrl(12, 34, 13, 'https://example.test/{z}/{x}/{y}.png')).toBe('https://example.test/13/12/34.png')
  })
})

/** A tile whose elevation equals its column index, for checking interpolation. */
function rampTile(): Float32Array {
  const values = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE)
  for (let y = 0; y < DEM_TILE_SIZE; y += 1) {
    for (let x = 0; x < DEM_TILE_SIZE; x += 1) values[y * DEM_TILE_SIZE + x] = x
  }
  return values
}

/** A single-tile range at the north-west corner of the world. */
const ORIGIN_TILE_RANGE = { zoom: 0, minX: 0, minY: 0, maxX: 0, maxY: 0, tileCount: 1 }

describe('ElevationGrid', () => {
  it('samples pixel centres exactly and interpolates between them', () => {
    const grid = new ElevationGrid(ORIGIN_TILE_RANGE)
    grid.setTile(0, 0, rampTile())

    expect(grid.elevationAtWorldPixel(0.5, 0.5)).toBe(0)
    expect(grid.elevationAtWorldPixel(1.5, 0.5)).toBe(1)
    expect(grid.elevationAtWorldPixel(1, 0.5)).toBeCloseTo(0.5, 10)
    expect(grid.elevationAtWorldPixel(10.25, 0.5)).toBeCloseTo(9.75, 10)
  })

  it('reports NaN outside the loaded mosaic', () => {
    const grid = new ElevationGrid({ zoom: 2, minX: 0, minY: 0, maxX: 1, maxY: 1, tileCount: 4 })
    grid.setTile(0, 0, rampTile())
    expect(grid.hasTile(0, 0)).toBe(true)
    expect(grid.hasTile(1, 1)).toBe(false)
    expect(grid.hasTile(3, 3)).toBe(false)
    expect(grid.tileCount).toBe(1)
    // Inside the range but never filled, and outside the range entirely.
    expect(Number.isNaN(grid.elevationAtWorldPixel(400, 400))).toBe(true)
    expect(Number.isNaN(grid.elevationAtWorldPixel(900, 900))).toBe(true)
  })

  it('places every tile at its own offset in the mosaic', () => {
    const range = { zoom: 2, minX: 1, minY: 1, maxX: 2, maxY: 2, tileCount: 4 }
    const grid = new ElevationGrid(range)
    const flat = (value: number) => new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).fill(value)
    grid.setTile(1, 1, flat(100))
    grid.setTile(2, 2, flat(900))
    // A tile outside the range is ignored rather than corrupting a neighbour.
    grid.setTile(9, 9, flat(-1))

    expect(grid.elevationAtWorldPixel(300, 300)).toBe(100)
    expect(grid.elevationAtWorldPixel(600, 600)).toBe(900)
    expect(grid.tileCount).toBe(2)
  })

  it('reaches the same sample through lng/lat and through Mercator', () => {
    const range = demTileRange([-122.8, 53.85, -122.6, 53.95], 6)
    const grid = new ElevationGrid(range)
    for (const tile of demTileCoordinates(range)) grid.setTile(tile.x, tile.y, rampTile())

    const [mx, my] = lngLatToMercator(-122.7645, 53.9097)
    expect(grid.elevationAtMercator(mx, my)).toBe(grid.elevationAt(-122.7645, 53.9097))
    expect(Number.isNaN(grid.elevationAt(-122.7645, 53.9097))).toBe(false)
  })
})
