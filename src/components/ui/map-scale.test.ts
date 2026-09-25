import { describe, expect, it } from 'vitest'

import { greatCircleMeters, scaleBarFor } from './map-scale'

describe('scale bar length', () => {
  it('picks the longest 1, 2 or 5 × 10ⁿ that fits', () => {
    expect(scaleBarFor(10, 100)).toEqual({ meters: 1000, pixels: 100, label: '1 km' })
    expect(scaleBarFor(4, 100)).toMatchObject({ meters: 200, label: '200 m' })
    expect(scaleBarFor(4, 100)!.pixels).toBeCloseTo(50, 10)
    expect(scaleBarFor(60, 100)).toMatchObject({ meters: 5000, label: '5 km' })
    expect(scaleBarFor(0.004, 100)).toMatchObject({ meters: 0.2, label: '20 cm' })
  })

  it('never draws a bar longer than it may', () => {
    for (const mpp of [0.37, 1.9, 7.3, 22, 180, 950]) expect(scaleBarFor(mpp, 120)!.pixels).toBeLessThanOrEqual(120)
  })

  it('draws nothing for a meaningless scale', () => {
    expect(scaleBarFor(0)).toBeNull()
    expect(scaleBarFor(Number.NaN)).toBeNull()
  })
})

describe('great-circle distance', () => {
  it('shrinks a degree of longitude with latitude, as the ground does', () => {
    const equator = greatCircleMeters({ lng: 0, lat: 0 }, { lng: 1, lat: 0 })
    const princeGeorge = greatCircleMeters({ lng: -122.75, lat: 53.9 }, { lng: -121.75, lat: 53.9 })
    expect(equator).toBeCloseTo(111195, -1)
    expect(princeGeorge / equator).toBeCloseTo(Math.cos((53.9 * Math.PI) / 180), 3)
  })
})
