import { describe, expect, it } from 'vitest'
import {
  computeViewshed,
  MAX_SIGHTLINE_STEPS,
  sightlineSampling,
  dateTimeInZone,
  destination,
  solarPosition,
  sunVisibility,
  viewshedBounds,
  type ViewshedSettings,
} from './model'
import { haversineMeters } from '@/pages/dev-forestry/visibility'
import { localRasterResolution, parseRasters, rasterProjection, rasterSampler } from '@/pages/dev-forestry/localRaster'
import { lngLatToMercator, mercatorToLngLat } from '@/pages/dev-forestry/terrain'

const SETTINGS: ViewshedSettings = { observer: { lng: 0, lat: 0 }, radiusMeters: 500, heightA: 1.2, heightB: 1.7 }
const FLAT = { elevationAt: () => 100 }

describe('terrain viewshed', () => {
  it('sees flat nearby terrain from both heights and clips to the radius', () => {
    const result = computeViewshed(FLAT, SETTINGS, 20, 24)
    expect(result.counts.total).toBeGreaterThan(400)
    expect(result.counts.total).toBeLessThan(24 * 24)
    expect(result.counts.visibleA).toBe(result.counts.total)
    expect(result.counts.visibleB).toBe(result.counts.total)
    expect(result.counts.unknown).toBe(0)
    expect(result.cells[0]).toBe(0)
  })

  it('a ridge blocks seated sightlines while a taller observer sees over it', () => {
    const source = { elevationAt: (lng: number) => (lng > 0.0008 && lng < 0.0016 ? 110 : 100) }
    const result = computeViewshed(source, { ...SETTINGS, heightB: 30 }, 10, 32)
    expect(result.counts.visibleB).toBeGreaterThan(result.counts.visibleA)
    expect(Array.from(result.cells)).toContain(3)
    expect(sunVisibility(result, { azimuth: 90, altitude: 2 }, 'A').status).toBe('blocked')
    expect(sunVisibility(result, { azimuth: 90, altitude: 2 }, 'B').status).toBe('clear')
  })

  it('missing ground never produces a clear viewshed or a clear sun', () => {
    const result = computeViewshed({ elevationAt: () => NaN }, SETTINGS, 30, 16)
    expect(result.counts.unknown).toBe(result.counts.total)
    expect(result.counts.visibleA).toBe(0)
    expect(sunVisibility(result, { azimuth: 90, altitude: 10 }, 'B').status).toBe('unknown')
  })

  it('clips a north-facing sector and accepts equivalent wrapped bearings', () => {
    const sector = computeViewshed(FLAT, { ...SETTINGS, fieldOfView: { bearing: 0, width: 90 } }, 20, 24, false)
    const all = computeViewshed(FLAT, SETTINGS, 20, 24, false)
    expect(sector.counts.total).toBeGreaterThan(all.counts.total / 5)
    expect(sector.counts.total).toBeLessThan(all.counts.total / 3)
    expect(Array.from(sector.cells.slice(12 * 24))).toEqual(Array(12 * 24).fill(0))
    expect(
      computeViewshed(FLAT, { ...SETTINGS, fieldOfView: { bearing: -1080, width: 90 } }, 20, 24, false).cells,
    ).toEqual(sector.cells)
  })

  it('uses target height to see over a ridge without treating no-data as visible', () => {
    const source = { elevationAt: (lng: number) => (lng > 0.0008 && lng < 0.0016 ? 110 : 100) }
    const ground = computeViewshed(source, SETTINGS, 10, 32, false)
    const raised = computeViewshed(source, { ...SETTINGS, targetOffsetMeters: 50 }, 10, 32, false)
    expect(raised.counts.visibleA).toBeGreaterThan(ground.counts.visibleA)
    const unknown = computeViewshed({ elevationAt: () => NaN }, { ...SETTINGS, targetOffsetMeters: 50 }, 20, 16, false)
    expect(unknown.counts.unknown).toBe(unknown.counts.total)
  })

  it('rejects invalid target heights and field-of-view settings', () => {
    for (const targetOffsetMeters of [-1, 1001, Infinity])
      expect(() => computeViewshed(FLAT, { ...SETTINGS, targetOffsetMeters }, 20, 16, false)).toThrow('Target height')
    for (const width of [0, -1, 361, NaN])
      expect(() => computeViewshed(FLAT, { ...SETTINGS, fieldOfView: { bearing: 0, width } }, 20, 16, false)).toThrow(
        'Field of view',
      )
  })

  it('unknown terrain beyond a known ridge cannot erase that obstruction', () => {
    const result = computeViewshed(
      { elevationAt: (lng: number) => (lng > 0.002 ? NaN : lng > 0.0008 ? 140 : 100) },
      SETTINGS,
      20,
      16,
    )
    expect(sunVisibility(result, { azimuth: 90, altitude: 2 }, 'A').status).toBe('blocked')
    expect(sunVisibility(result, { azimuth: 90, altitude: 85 }, 'A').status).toBe('unknown')
  })

  it('uses metre distances at northern latitudes and rejects unsupported footprints', () => {
    const origin = { lng: -122, lat: 54 }
    expect(haversineMeters(origin, destination(origin, 90, 5000))).toBeCloseTo(5000, 5)
    const box = viewshedBounds({ ...SETTINGS, observer: origin })
    expect(box[0]).toBeLessThan(origin.lng)
    expect(box[3]).toBeGreaterThan(origin.lat)
    expect(() => viewshedBounds({ ...SETTINGS, observer: { lng: 180, lat: 0 } })).toThrow('date line')
    expect(() => viewshedBounds({ ...SETTINGS, radiusMeters: Infinity })).toThrow('radius')
  })
})

describe('sun planning', () => {
  it('places the solstice noon sun south of Greenwich with the expected altitude', () => {
    const sun = solarPosition(new Date('2026-06-21T12:00:00Z'), { lng: 0, lat: 51.5 })
    expect(sun.altitude).toBeCloseTo(61.94, 0)
    expect(sun.azimuth).toBeGreaterThan(178)
    expect(sun.azimuth).toBeLessThan(182)
    expect(solarPosition(new Date('2026-06-21T00:00:00Z'), { lng: 0, lat: 51.5 }).altitude).toBeLessThan(0)
  })

  it('applies the selected date’s Vancouver DST offset', () => {
    expect(dateTimeInZone('2026-06-21', 240, 'America/Vancouver')?.toISOString()).toBe('2026-06-21T11:00:00.000Z')
    expect(dateTimeInZone('2025-12-21', 240, 'America/Vancouver')?.toISOString()).toBe('2025-12-21T12:00:00.000Z')
    expect(dateTimeInZone('2026-03-08', 150, 'America/Vancouver')).toBeNull()
    expect(dateTimeInZone('', 0, 'UTC')).toBeNull()
  })
})

describe('imported fine DEMs', () => {
  it('never reports a ray visible beyond the range it can sample at half the cell size', () => {
    const fine = { ...SETTINGS, radiusMeters: 2000 }
    const { stepMeters, sampledRangeMeters } = sightlineSampling(0.25, fine.radiusMeters)
    expect(stepMeters).toBe(0.125)
    expect(sampledRangeMeters).toBe(0.125 * MAX_SIGHTLINE_STEPS)
    const result = computeViewshed(FLAT, fine, 0.25, 24)
    expect(result.sampledRangeMeters).toBe(sampledRangeMeters)
    expect(result.counts.visibleA).toBeGreaterThan(0)
    expect(result.counts.unknown).toBeGreaterThan(0)
    expect(result.counts.visibleA + result.counts.unknown).toBe(result.counts.total)
    expect(sunVisibility(result, { azimuth: 90, altitude: 10 }, 'A').status).toBe('unknown')
    const coarse = computeViewshed(FLAT, fine, 1, 24)
    expect(coarse.sampledRangeMeters).toBe(2000)
    expect(coarse.counts.unknown).toBe(0)
    expect(sunVisibility(coarse, { azimuth: 90, altitude: 10 }, 'A').status).toBe('clear')
    expect(() => computeViewshed(FLAT, fine, 0, 24)).toThrow('resolution')
  })

  // A north-up UTM 10N grid centred on a cell centre at the observer, as an imported GeoTIFF would be.
  const projection = rasterProjection(32610)
  const observer = { lng: -122.75, lat: 53.92 }
  const [ox, oy] = projection.forward([observer.lng, observer.lat]).map(Math.round)
  const dem = (pixel: number, cells: number, elevation: (north: number) => number) => {
    const half = Math.floor(cells / 2),
      values: number[] = []
    for (let row = 0; row < cells; row++)
      for (let col = 0; col < cells; col++) values.push(elevation((half - row) * pixel))
    const [raster] = parseRasters([
      {
        id: 'dem',
        name: 'dem',
        kind: 'terrain',
        epsg: 32610,
        origin: [ox - half * pixel, oy + half * pixel],
        pixelSize: [pixel, -pixel],
        width: cells,
        height: cells,
        values,
        acquired: '',
        verticalReference: 'CGVD2013',
        sha256: 'a'.repeat(64),
      },
    ])
    return { source: rasterSampler(raster), resolution: localRasterResolution(raster, observer.lat) }
  }
  /** UTM offset from the observer of a result cell centre. */
  const offset = (result: ReturnType<typeof computeViewshed>, row: number, col: number) => {
    const [west, south, east, north] = result.bounds
    const [x0, y0] = lngLatToMercator(west, north),
      [x1, y1] = lngLatToMercator(east, south)
    const [x, y] = projection.forward(
      mercatorToLngLat(x0 + ((col + 0.5) / result.size) * (x1 - x0), y0 + ((row + 0.5) / result.size) * (y1 - y0)),
    )
    return { east: x - ox, north: y - oy }
  }

  it('a one-cell wall on a 1 m DEM hides everything behind it', () => {
    const { source, resolution } = dem(1, 401, (north) => (north === 37 ? 30 : 0))
    expect(resolution).toBe(1)
    const result = computeViewshed(source, { ...SETTINGS, observer, radiusMeters: 190 }, resolution, 64, false)
    let behind = 0,
      visibleBehind = 0
    for (let row = 0; row < 64; row++)
      for (let col = 0; col < 64; col++) {
        const cell = result.cells[row * 64 + col]
        if (!cell || offset(result, row, col).north < 40) continue
        behind++
        if (cell !== 1) visibleBehind++
      }
    expect(behind).toBeGreaterThan(500)
    expect(visibleBehind).toBe(0)
  })

  it('a one-cell 20 m ridge on a 10 m DEM hides a 50 m target as computed by hand', () => {
    const { source, resolution } = dem(10, 81, (north) => (north === 100 ? 20 : 0))
    const settings = { ...SETTINGS, observer, radiusMeters: 400, heightA: 1.6, heightB: 1.6, targetOffsetMeters: 50 }
    const result = computeViewshed(source, settings, resolution, 96, false)
    // Over 0 m ground the sightline clears the crest iff 1.6 + 48.4 × 100 / D > 20, i.e. D < 263 m. The interpolated
    // ridge rises 2 m per metre, so it blocks a ray for 20 − (1.6 + 4840 / D) metres; from D = 361 m that is at least
    // the 5 m sample spacing (half a cell), and no sample can step over it as the former 15 m spacing could.
    const states = { near: new Set<number>(), far: new Set<number>() }
    for (let row = 0; row < 96; row++)
      for (let col = 0; col < 96; col++) {
        const cell = result.cells[row * 96 + col],
          { east, north } = offset(result, row, col)
        // Targets almost due north, whose sightlines cross the ridge at close to a right angle.
        if (!cell || Math.abs(east) > 15) continue
        if (north > 130 && north < 255) states.near.add(cell)
        if (north > 362 && north < 398) states.far.add(cell)
      }
    expect([...states.near]).toEqual([4])
    expect([...states.far]).toEqual([1])
  })
})
