import { describe, expect, it } from 'vitest'
import { cableCoordinateAtDistance, resolvedCableLine } from './cableGeometry'
import { analyzeCable, distance, offsetCoordinate } from './engine'
import type { CableLine, Coordinate } from './types'

const start: Coordinate = [-122.72, 53.89]
const base: CableLine = {
  id: 'example',
  name: 'Example D-line',
  start,
  end: offsetCoordinate(start, 90, 100),
  startHeight: 25,
  endHeight: 7,
  deflectionPercent: 5,
}

describe('D-line support geometry', () => {
  it('preserves legacy endpoint coordinates and heights without mutating the original line', () => {
    const before = structuredClone(base)
    const result = resolvedCableLine(base)
    expect(result.start).toEqual(base.start)
    expect(result.end).toEqual(base.end)
    expect(result.startHeight).toBe(25)
    expect(result.endHeight).toBe(7)
    expect(base).toEqual(before)
  })

  it('insets both endpoints along the original line and resolves only once', () => {
    const line = { ...base, startOffsetM: 20, endOffsetM: 30 }
    const result = resolvedCableLine(line)
    expect(distance(base.start, result.start)).toBeCloseTo(20, 5)
    expect(distance(base.end, result.end)).toBeCloseTo(30, 5)
    expect(distance(result.start, result.end)).toBeCloseTo(50, 5)
    expect(result.startOffsetM).toBeUndefined()
    expect(result.endOffsetM).toBeUndefined()
    expect(resolvedCableLine(result)).toEqual(result)
    expect(line.start).toEqual(base.start)
  })

  it('supports outward offsets and places yarder/tailhold heights on the chosen physical ends', () => {
    const result = resolvedCableLine({ ...base, startOffsetM: -20, endOffsetM: -30, yarderAt: 'end' })
    expect(distance(result.start, result.end)).toBeCloseTo(150, 5)
    expect(distance(result.start, base.start)).toBeCloseTo(20, 5)
    expect(distance(result.end, base.end)).toBeCloseTo(30, 5)
    expect(result.startHeight).toBe(7)
    expect(result.endHeight).toBe(25)
    expect(result.yarderAt).toBeUndefined()
    const analyzed = analyzeCable(result, { elevationAt: () => 100 })
    expect(analyzed.samples[0].cable).toBe(107)
    expect(analyzed.samples[analyzed.samples.length - 1].cable).toBe(125)
  })

  it('rejects collapsed, reversed and invalid offsets rather than drawing a plausible cable', () => {
    expect(() => resolvedCableLine({ ...base, startOffsetM: 60, endOffsetM: 40 })).toThrow(/collapse|reverse/)
    expect(() => resolvedCableLine({ ...base, startOffsetM: 80, endOffsetM: 30 })).toThrow(/collapse|reverse/)
    expect(() => resolvedCableLine({ ...base, startOffsetM: 201 })).toThrow(/offset/)
    expect(() => resolvedCableLine({ ...base, endOffsetM: NaN })).toThrow(/offset/)
    expect(() => resolvedCableLine({ ...base, startHeight: Infinity })).toThrow(/height/)
    expect(() => resolvedCableLine({ ...base, end: [0, 85] })).toThrow(/WGS84/)
    expect(() => resolvedCableLine({ ...base, end: base.start, startOffsetM: 2 })).toThrow(/distinct/)
  })

  it('puts the span cursor on the resolved line and clamps its endpoints', () => {
    const line: CableLine = { ...base, startOffsetM: 20, endOffsetM: 30, yarderAt: 'end' }
    const effective = resolvedCableLine(line)
    const cursor = cableCoordinateAtDistance(line, 15)
    expect(distance(effective.start, cursor)).toBeCloseTo(15, 5)
    expect(distance(base.start, cursor)).toBeCloseTo(35, 5)
    expect(cableCoordinateAtDistance(line, -1)).toEqual(effective.start)
    expect(cableCoordinateAtDistance(line, 1000)).toEqual(effective.end)
  })
})
