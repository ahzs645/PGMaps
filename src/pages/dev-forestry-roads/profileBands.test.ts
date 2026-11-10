import { describe, expect, it } from 'vitest'
import { analyzeRoad, curveDesignAt, horizontalCurveSummary, offsetCoordinate } from './engine'
import { bandStations, MAX_BAND_VALUES, profileValueBands } from './profileBands'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { sectionCrossfall } from './templates'
import type { Alignment, Coordinate, RoadStation } from './types'

const origin: Coordinate = [-122.8, 53.9]
const pi = offsetCoordinate(origin, 0, 300)
const road = (extra: Partial<Alignment> = {}): Alignment => ({
  id: 'curve-road',
  name: 'Curve road',
  color: '#16817a',
  points: [
    { id: 'start', coordinate: origin, radiusM: 0 },
    { id: 'pi', coordinate: pi, radiusM: 80 },
    { id: 'end', coordinate: offsetCoordinate(pi, 90, 300), radiusM: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE, crossfallPercent: 3 },
  vertical: [
    { id: 'a', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'b', chainage: 520, elevation: 810, curveLength: 0 },
  ],
  overrides: [],
  ...extra,
})
const stationsAt = (chainages: number[]) => chainages.map((chainage) => ({ chainage }) as RoadStation)

describe('band stations', () => {
  it('takes calculated stations on round multiples of the spacing', () => {
    const stations = stationsAt(Array.from({ length: 51 }, (_, i) => i * 10))
    expect(bandStations(stations, 0, 500, 15).map((s) => s.chainage)).toEqual(
      Array.from({ length: 26 }, (_, i) => i * 20),
    )
    expect(bandStations(stations, 95, 205, 40).map((s) => s.chainage)).toEqual([100, 150, 200])
  })

  it('falls back to every station far enough apart, and never invents one', () => {
    const stations = stationsAt(Array.from({ length: 30 }, (_, i) => i * 7))
    const kept = bandStations(stations, 0, 203, 15).map((s) => s.chainage)
    expect(kept.every((c) => c % 7 === 0)).toBe(true)
    expect(kept.slice(1).every((c, i) => c - kept[i] >= 20 - 1e-9)).toBe(true)
    expect(bandStations(stations, 500, 600, 10)).toEqual([])
  })

  it('caps the number of values across a window', () => {
    const stations = stationsAt(Array.from({ length: 5001 }, (_, i) => i))
    expect(bandStations(stations, 0, 5000, 0).length).toBeLessThanOrEqual(MAX_BAND_VALUES + 1)
  })
})

describe('profile value bands', () => {
  it('reads ground, design, depth and grade from the calculated stations, unknown where terrain is missing', () => {
    const alignment = road()
    const analysis = analyzeRoad(
      alignment,
      { elevationAt: (_lng, lat) => (lat > origin[1] + 0.0009 && lat < origin[1] + 0.0011 ? Number.NaN : 801) },
      DEFAULT_ROAD_SETTINGS,
    )
    const bands = profileValueBands(analysis, alignment, { start: 0, end: analysis.length, minSpacingM: 20 })
    const row = (key: string) => bands.rows.find((r) => r.key === key)!
    expect(bands.rows.map((r) => r.title)).toEqual([
      'Ground',
      'Design',
      'Cut/fill',
      'Grade %',
      'X-fall L %',
      'X-fall R %',
    ])
    bands.stations.forEach((station, i) => {
      expect(row('design').values[i].value).toBe(station.designElevation)
      expect(row('grade').values[i].value).toBe(station.gradePercent)
      if (station.groundElevation === null) {
        expect(row('ground').values[i]).toMatchObject({ value: null, text: '—', tone: 'unknown' })
        expect(row('depth').values[i]).toMatchObject({ value: null, text: '—' })
      } else expect(row('depth').values[i].value).toBeCloseTo(station.groundElevation - station.designElevation!, 9)
    })
    expect(row('ground').values.some((v) => v.value === null)).toBe(true)
    const start = row('depth').values[0]
    expect(start.text).toBe('C 1.00')
    expect(start.tone).toBe('cut')
    const fill = row('depth').values.find((v) => v.value !== null && v.value < 0)!
    expect(fill.text).toMatch(/^F \d+\.\d\d$/)
  })

  it('prints the section crossfall, superelevation included, and a signed curvature diagram', () => {
    const plain = road()
    const analysis = analyzeRoad(plain, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const flat = profileValueBands(analysis, plain, { start: 0, end: analysis.length, minSpacingM: 20 })
    expect(flat.rows.find((r) => r.key === 'crossfallLeft')!.values.every((v) => v.value === 3)).toBe(true)
    const [curve] = horizontalCurveSummary(plain)
    expect(curve.direction).toBe('right')
    expect(flat.maxCurvaturePerKm).toBeCloseTo(1000 / 80, 9)
    expect(flat.curvature).toContainEqual({ chainage: curve.start, perKm: 1000 / 80 })
    expect(flat.curvature[0]).toEqual({ chainage: 0, perKm: 0 })
    expect(flat.curvatureLabels).toEqual([expect.objectContaining({ direction: 'right', radiusM: 80, text: 'R 80 R' })])

    const superelevated = road({
      curveDesign: {
        designSpeedKmh: 40,
        maxSuperelevationPercent: 8,
        sideFrictionFactor: 0.15,
        runoffLengthM: 30,
        wideningVehicleLengthM: null,
      },
    })
    const bands = profileValueBands(analysis, superelevated, { start: 0, end: analysis.length, minSpacingM: 10 })
    const left = bands.rows.find((r) => r.key === 'crossfallLeft')!.values
    const onCurve = left.find((v) => v.chainage > curve.start + 5 && v.chainage < curve.end - 5)!
    const design = curveDesignAt(superelevated, onCurve.chainage)!
    expect(onCurve.value).toBeCloseTo(sectionCrossfall(superelevated.template, 'left', design), 9)
    expect(onCurve.tone).toBe('super')
    // A right turn: the left edge is the outside, raised against the crown.
    expect(onCurve.value!).toBeLessThan(0)
    expect(left[0].tone).toBeUndefined()
  })

  it('has ground and ground grade only on a terrain profile', () => {
    const alignment = road()
    const analysis = analyzeRoad(alignment, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const bands = profileValueBands(analysis, alignment, {
      start: 0,
      end: analysis.length,
      minSpacingM: 50,
      terrainOnly: true,
    })
    expect(bands.rows.map((r) => r.key)).toEqual(['ground', 'grade'])
    expect(bands.curvature).toEqual([])
  })
})
