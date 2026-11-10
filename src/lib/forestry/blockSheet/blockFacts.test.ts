import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { BC_ALBERS } from '@/lib/geo/projectedCrs'
import { blockAreaHa, blockCentroid, blockElevationRange, blockFacts, MAX_BLOCK_ELEVATION_SAMPLES } from './blockFacts'

const albers = proj4('EPSG:4326', BC_ALBERS)
const [cx, cy] = albers.forward([-121.5, 54.06])
/** A square `side` metres across in BC Albers, centred at (cx + dx, cy + dy), as lon/lat. */
const square = (side: number, dx = 0, dy = 0, clockwise = false) => {
  const h = side / 2
  const ring = [
    [cx + dx - h, cy + dy - h],
    [cx + dx + h, cy + dy - h],
    [cx + dx + h, cy + dy + h],
    [cx + dx - h, cy + dy + h],
    [cx + dx - h, cy + dy - h],
  ].map((p) => albers.inverse(p))
  return clockwise ? ring.reverse() : ring
}

describe('block facts', () => {
  it('measures area planar in BC Albers, either winding', () => {
    expect(blockAreaHa({ type: 'Polygon', coordinates: [square(1000)] })).toBeCloseTo(100, 6)
    expect(blockAreaHa({ type: 'Polygon', coordinates: [square(1000, 0, 0, true)] })).toBeCloseTo(100, 6)
  })

  it('subtracts holes and adds multipolygon parts', () => {
    expect(blockAreaHa({ type: 'Polygon', coordinates: [square(1000), square(200)] })).toBeCloseTo(96, 6)
    expect(blockAreaHa({ type: 'MultiPolygon', coordinates: [[square(1000)], [square(100, 5000, 0)]] })).toBeCloseTo(
      101,
      6,
    )
  })

  it('finds the area-weighted centroid', () => {
    const [lng, lat] = blockCentroid({ type: 'Polygon', coordinates: [square(1000)] })
    expect(lng).toBeCloseTo(-121.5, 6)
    expect(lat).toBeCloseTo(54.06, 6)
    // A hole off-centre pulls the centroid away from it.
    const holed = blockCentroid({ type: 'Polygon', coordinates: [square(1000), square(200, 300, 0)] })
    expect(albers.forward(holed)[0]).toBeLessThan(cx)
  })

  it('reads the elevation range inside the block only', () => {
    const plane = {
      elevationAt: (lng: number, lat: number) => {
        const [x] = albers.forward([lng, lat])
        return 500 + (x - cx) * 0.1
      },
    }
    const range = blockElevationRange({ type: 'Polygon', coordinates: [square(1000)] }, plane, 10)!
    expect(range.min).toBeGreaterThan(450 - 1)
    expect(range.min).toBeLessThan(452)
    expect(range.max).toBeGreaterThan(548)
    expect(range.max).toBeLessThan(551)
    expect(range.missing).toBe(0)
  })

  it('counts samples without ground and returns null when none had any', () => {
    const half = {
      elevationAt: (lng: number, lat: number) => (albers.forward([lng, lat])[0] < cx ? 700 : Number.NaN),
    }
    const range = blockElevationRange({ type: 'Polygon', coordinates: [square(1000)] }, half, 10)!
    expect(range.min).toBe(700)
    expect(range.missing).toBeGreaterThan(0)
    expect(
      blockElevationRange({ type: 'Polygon', coordinates: [square(1000)] }, { elevationAt: () => NaN }, 10),
    ).toBeNull()
  })

  it('coarsens the grid to stay within the sample budget', () => {
    let calls = 0
    const range = blockElevationRange(
      { type: 'Polygon', coordinates: [square(5000)] },
      {
        elevationAt: () => {
          calls++
          return 1
        },
      },
      1,
    )!
    expect(calls).toBeLessThanOrEqual(MAX_BLOCK_ELEVATION_SAMPLES)
    expect(range.spacingM).toBeGreaterThan(1)
  })

  it('names the mapsheet from the centroid and leaves elevation unknown without terrain', () => {
    const facts = blockFacts({ type: 'Polygon', coordinates: [square(1000)] })
    expect(facts.mapsheet).toBe('093I003')
    expect(facts.elevation).toBeNull()
  })
})
