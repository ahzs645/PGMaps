import { describe, expect, it } from 'vitest'
import { labelChainages, labelOffset, metresPerPixel, stationLabelInterval, tickChainages } from './planAnnotations'

describe('plan annotation density', () => {
  it('converts zoom to ground resolution', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(78271.5, 0)
    expect(metresPerPixel(15, 54)).toBeCloseTo(78271.5 / 2 ** 15 * Math.cos((54 * Math.PI) / 180), 6)
  })

  it('adds station labels as the map zooms in', () => {
    // An overview at ~5.5 m/px labels every 1 km; zoomed to ~0.7 m/px it labels every 100 m.
    expect(stationLabelInterval(5.5)).toBe(1000)
    expect(stationLabelInterval(0.7)).toBe(100)
    expect(stationLabelInterval(0.05)).toBe(10)
    expect(stationLabelInterval(100)).toBeNull()
  })

  it('always labels both ends and drops a multiple crowding the end', () => {
    expect(labelChainages(1050, 200)).toEqual([0, 200, 400, 600, 800, 1050])
    expect(labelChainages(1100, 200)).toEqual([0, 200, 400, 600, 800, 1000, 1100])
    expect(labelChainages(150, 1000)).toEqual([0, 150])
  })

  it('draws minor ticks only once they are far enough apart', () => {
    expect(tickChainages(300, 100, 1).filter((t) => t.major).map((t) => t.chainage)).toEqual([0, 100, 200, 300])
    expect(tickChainages(300, 100, 1)).toHaveLength(16)
    expect(tickChainages(300, 100, 5)).toHaveLength(4)
  })

  it('places a label clear of the road on the requested side', () => {
    // Northbound: right of travel is screen right; westbound: right of travel is screen up.
    const [eastX, eastY] = labelOffset(0, 0, 7)
    expect(eastX).toBeGreaterThan(9)
    expect(Math.abs(eastY)).toBe(0)
    const [upX, upY] = labelOffset(270, 0, 7)
    expect(Math.abs(upX)).toBe(0)
    expect(upY).toBeLessThan(-9)
    const [leftX] = labelOffset(0, 0, 7, -1)
    expect(leftX).toBeLessThan(-9)
    // A rotated map turns the screen direction with it.
    expect(labelOffset(90, 90, 7)).toEqual(labelOffset(0, 0, 7))
  })
})
