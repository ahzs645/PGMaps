import { describe, expect, it } from 'vitest'
import { SENTINEL_CLEARING_NDVI_DROP } from './limits'
import {
  crossesSnowSeason,
  firstSeenLabel,
  ndviChange,
  ndviChangeRgba,
  ndviRgba,
  ndviValues,
  rampColour,
  NDVI_STOPS,
  trueColourRgba,
} from './render'
import { defaultPair, defaultScene, type RatedScene } from './sceneChoice'
import { SENTINEL_ANCHOR_LAYER_ID, SENTINEL_LAYER_ID, sentinelBeforeId } from './planOrder'

const BASELINE_04 = { red: { scale: 0.0001, offset: -0.1 }, nir: { scale: 0.0001, offset: -0.1 } }

describe('true colour', () => {
  it('draws the TCI as it is and leaves no-data clear', () => {
    const rgba = trueColourRgba(
      [
        [10, 0],
        [20, 0],
        [30, 0],
      ],
      2,
      1,
    )
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255, 0, 0, 0, 0])
  })
})

describe('NDVI', () => {
  it('computes NDVI on reflectance, with the baseline 04.00 offset', () => {
    // Reflectance red 0.05, NIR 0.35: NDVI 0.75. Raw digital numbers would read 0.6.
    const ndvi = ndviValues({ red: [1500], nir: [4500], scl: [4] }, BASELINE_04)
    expect(ndvi[0]).toBeCloseTo(0.75, 5)
    const raw = ndviValues(
      { red: [1500], nir: [4500], scl: [4] },
      { red: { scale: 1, offset: 0 }, nir: { scale: 1, offset: 0 } },
    )
    expect(raw[0]).toBeCloseTo(0.5, 5)
  })

  it('floors reflectance at zero so NDVI stays within ±1', () => {
    // Red DN 950 with the −0.1 offset is −0.005 reflectance, which would put NDVI past 1.
    const ndvi = ndviValues({ red: [950, 1000, 900], nir: [1300, 1300, 950], scl: [4, 4, 4] }, BASELINE_04)
    expect(ndvi[0]).toBe(1)
    expect(ndvi[1]).toBe(1)
    expect(Number.isNaN(ndvi[2])).toBe(true)
  })

  it('masks no data, cloud, shadow and snow', () => {
    const ndvi = ndviValues(
      { red: [0, 1500, 1500, 1500, 1500], nir: [4500, 4500, 4500, 4500, 4500], scl: [4, 9, 3, 11, 5] },
      BASELINE_04,
    )
    expect(Array.from(ndvi).map((v) => Number.isNaN(v))).toEqual([true, true, true, true, false])
  })

  it('colours along the ramp and leaves masked pixels clear', () => {
    expect(rampColour(NDVI_STOPS, -1)).toEqual([...NDVI_STOPS[0][1]])
    expect(rampColour(NDVI_STOPS, 2)).toEqual([...NDVI_STOPS[NDVI_STOPS.length - 1][1]])
    const rgba = ndviRgba(new Float32Array([NaN, 0.7]))
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(rgba.slice(4))).toEqual([...NDVI_STOPS[3][1], 255])
  })
})

describe('NDVI change', () => {
  it('counts pixels compared and cleared, later minus earlier', () => {
    const earlier = new Float32Array([0.8, 0.8, 0.8, NaN])
    const later = new Float32Array([0.3, 0.7, 0.85, 0.2])
    const change = ndviChange(earlier, later)
    expect(change.compared).toBe(3)
    expect(change.cleared).toBe(1)
    expect(change.delta[0]).toBeCloseTo(-0.5, 5)
    expect(Number.isNaN(change.delta[3])).toBe(true)
  })

  it('draws a clearing strongly and small changes faintly', () => {
    const rgba = ndviChangeRgba(new Float32Array([-0.5, -SENTINEL_CLEARING_NDVI_DROP / 4, NaN]))
    expect(rgba[3]).toBe(235)
    expect(rgba[7]).toBeLessThan(120)
    expect(rgba[11]).toBe(0)
    expect(rgba[0]).toBeGreaterThan(rgba[1])
  })

  it('labels a clearing as an interval, never a single date', () => {
    expect(firstSeenLabel('2023-07-18', '2023-08-30')).toBe('first seen between 2023-07-18 and 2023-08-30')
    // The order the scenes were picked in does not matter.
    expect(firstSeenLabel('2023-08-30', '2023-07-18')).toBe('first seen between 2023-07-18 and 2023-08-30')
  })

  it('marks a bracket over November–April as a snow gap', () => {
    expect(crossesSnowSeason('2023-09-20', '2023-10-31')).toBe(false)
    expect(crossesSnowSeason('2023-10-20', '2023-11-02')).toBe(true)
    expect(crossesSnowSeason('2023-04-30', '2023-05-20')).toBe(false)
    expect(crossesSnowSeason('2021-08-01', '2023-08-01')).toBe(true)
    expect(firstSeenLabel('2023-09-30', '2024-06-12')).toBe('first seen between 2023-09-30 and 2024-06-12 (snow gap)')
  })
})

describe('default scenes', () => {
  const scene = (date: string, clear: number | null, coverage = 1): RatedScene =>
    ({
      id: date,
      date,
      datetime: `${date}T19:00:00Z`,
      rating: clear === null ? null : { clear, coverage },
    }) as RatedScene
  // Newest first, as the search lists them.
  const listed = [
    scene('2025-09-01', 0.3),
    scene('2025-08-20', 0.95, 0.6),
    scene('2025-08-10', 0.9),
    scene('2024-07-01', 0.99),
  ]

  it('picks the newest scene that is clear and complete over the window', () => {
    expect(defaultScene(listed)?.date).toBe('2025-08-10')
  })

  it('falls back to the scene with the most clear ground', () => {
    expect(defaultScene([scene('2025-09-01', 0.3), scene('2025-08-01', 0.6), scene('2025-07-01', null)])?.date).toBe(
      '2025-08-01',
    )
    expect(defaultScene([scene('2025-07-01', null)])).toBeUndefined()
  })

  it('pairs the oldest and newest usable scenes for a change view', () => {
    expect(defaultPair(listed)?.map((s) => s.date)).toEqual(['2024-07-01', '2025-08-10'])
    expect(defaultPair([scene('2025-07-01', 0.1)])).toBeNull()
  })
})

describe('imagery layer order', () => {
  const layer = (id: string, type = 'line') => ({ id, type })
  it('leaves the imagery above other rasters and under the engineering layers', () => {
    const ok = [
      layer('basemap', 'background'),
      layer('road-terrain', 'raster'),
      layer(SENTINEL_LAYER_ID, 'raster'),
      layer('stream'),
      layer(SENTINEL_ANCHOR_LAYER_ID),
    ]
    expect(sentinelBeforeId(ok)).toBeNull()
  })

  it('moves the imagery when a hillshade lands above it or it ends up over the engineering layers', () => {
    expect(
      sentinelBeforeId([
        layer(SENTINEL_LAYER_ID, 'raster'),
        layer('road-terrain', 'raster'),
        layer(SENTINEL_ANCHOR_LAYER_ID),
      ]),
    ).toBe(SENTINEL_ANCHOR_LAYER_ID)
    expect(sentinelBeforeId([layer(SENTINEL_ANCHOR_LAYER_ID), layer(SENTINEL_LAYER_ID, 'raster')])).toBe(
      SENTINEL_ANCHOR_LAYER_ID,
    )
    expect(sentinelBeforeId([layer(SENTINEL_LAYER_ID, 'raster')])).toBeNull()
  })
})
