import { describe, expect, it } from 'vitest'
import {
  chainageAtStation,
  chainagesAtStation,
  checkRoadStationing,
  describeStationEquation,
  equationChainage,
  formatStationLabel,
  formatStationValue,
  hasStationing,
  keptStationing,
  parseRoadStationing,
  parseStationText,
  scaleStationing,
  stationAtChainage,
  stationExtent,
  type RoadStationing,
} from './roadStationing'

/** The label every station formatter printed before stationing existed. */
const before = (value: number) => {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}

describe('road stationing', () => {
  it('labels a road without stationing exactly as before', () => {
    for (const c of [0, 0.04, 0.05, 12.34, 999.95, 1000, 1234.56, 20_000.04, -3]) {
      expect(formatStationLabel(c, undefined)).toBe(before(c))
      expect(formatStationLabel(c, { startStation: 0, equations: [] })).toBe(before(c))
    }
    expect(hasStationing({ startStation: 0, equations: [] })).toBe(false)
    expect(keptStationing({ startStation: 0, equations: [] })).toBeUndefined()
    expect(stationAtChainage(42, undefined)).toBe(42)
    expect(chainagesAtStation(42, undefined, 100)).toEqual([42])
    expect(chainagesAtStation(142, undefined, 100)).toEqual([])
  })

  it('names stations from a start station and a forward equation (a gap in the names)', () => {
    const s: RoadStationing = { startStation: 1000, equations: [{ back: 1500, ahead: 2000 }] }
    expect(stationAtChainage(0, s)).toBe(1000)
    expect(stationAtChainage(499.9, s)).toBeCloseTo(1499.9, 9)
    // At the equation the ahead name wins.
    expect(stationAtChainage(500, s)).toBe(2000)
    expect(stationAtChainage(600, s)).toBe(2100)
    expect(formatStationLabel(600, s)).toBe('2+100.0')
    expect(chainagesAtStation(2100, s, 800)).toEqual([600])
    expect(chainagesAtStation(1700, s, 800)).toEqual([]) // skipped by the equation
    expect(chainageAtStation(1200, s, 800)).toBe(200)
    expect(stationExtent(s, 800)).toEqual({ min: 1000, max: 2300 })
    expect(describeStationEquation(s.equations[0], s)).toBe('1+500.0 back = 2+000.0 ahead')
  })

  it('names a station twice after a back equation, and labels the region', () => {
    const s: RoadStationing = { startStation: 0, equations: [{ back: 500, ahead: 400 }] }
    expect(chainagesAtStation(450, s, 800)).toEqual([450, 550])
    expect(formatStationLabel(450, s)).toBe('0+450.0 (1)')
    expect(formatStationLabel(550, s)).toBe('0+450.0 (2)')
    expect(formatStationLabel(100, s)).toBe('0+100.0')
    expect(chainageAtStation(450, s, 800, { near: 700 })).toBe(550)
    expect(chainageAtStation(450, s, 800, { near: 0 })).toBe(450)
    expect(chainageAtStation(450, s, 800, { region: 2 })).toBe(550)
  })

  it('runs stations down after a decreasing equation (LandXML staIncrement)', () => {
    const s: RoadStationing = { startStation: 0, equations: [{ back: 100, ahead: 5000, decreasing: true }] }
    expect(stationAtChainage(150, s)).toBe(4950)
    expect(chainagesAtStation(4950, s, 300)).toEqual([150])
  })

  it('formats and reads typed stations', () => {
    expect(formatStationValue(-12)).toBe('−0+012.0')
    expect(formatStationValue(1999.96)).toBe('2+000.0')
    expect(formatStationValue(1234.5, 0)).toBe('1+235')
    expect(parseStationText('1+234.5')).toEqual({ station: 1234.5 })
    expect(parseStationText(' 1234.5 ')).toEqual({ station: 1234.5 })
    expect(parseStationText('−0+012')).toEqual({ station: -12 })
    expect(parseStationText('0+550 (2)')).toEqual({ station: 550, region: 2 })
    expect(parseStationText('abc')).toBeNull()
    expect(parseStationText('')).toBeNull()
  })

  it('refuses stationing that does not run along the road', () => {
    expect(() => checkRoadStationing({ startStation: 0, equations: [{ back: 0, ahead: 5 }] })).toThrow(
      /after the start/,
    )
    expect(() =>
      checkRoadStationing({
        startStation: 0,
        equations: [
          { back: 50, ahead: 5 },
          { back: 40, ahead: 9 },
        ],
      }),
    ).toThrow(/along the road/)
    expect(() => checkRoadStationing({ startStation: 0, equations: [{ back: 500, ahead: 5 }] }, 300)).toThrow(/past/)
    expect(() => parseRoadStationing({ startStation: 'x', equations: [] })).toThrow()
    expect(
      parseRoadStationing({ startStation: 10, equations: [{ back: 20, ahead: 30, description: 'Bridge' }] }),
    ).toEqual({ startStation: 10, equations: [{ back: 20, ahead: 30, description: 'Bridge' }] })
  })

  it('keeps a file’s station names exactly when its stations are scaled to the road', () => {
    const s: RoadStationing = { startStation: 100, equations: [{ back: 300, ahead: 1000 }] }
    // Each file station metre is half a metre of road.
    const scaled = scaleStationing(s, 0.5)
    expect(scaled.equations[0].back).toBe(300)
    expect(equationChainage(scaled.equations[0], scaled)).toBe(100)
    expect(stationAtChainage(50, scaled)).toBe(200)
    expect(stationAtChainage(100, scaled)).toBe(1000)
    expect(chainagesAtStation(1010, scaled, 200)).toEqual([105])
    expect(describeStationEquation(scaled.equations[0], scaled)).toBe('0+300.0 back = 1+000.0 ahead')
    expect(parseRoadStationing(JSON.parse(JSON.stringify(scaled)))).toEqual(scaled)
    expect(() => checkRoadStationing({ ...scaled, chainageScale: 5 })).toThrow(/between 0.5 and 2/)
  })
})
