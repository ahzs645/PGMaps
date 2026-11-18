import { describe, expect, it } from 'vitest'
import { analyzeRoad, curveDesignAt, horizontalCurveSummary, offsetCoordinate } from './engine'
import {
  bandStations,
  bandTextWidth,
  bandValueAnchor,
  MAX_BAND_VALUES,
  profileValueBands,
  stakeRows,
} from './profileBands'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { roadSidehill } from './sectionSideSlope'
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
  it('adds a Sidehill row and its colour spans only when given the road sidehill', () => {
    const alignment = road()
    // Ground rising 70 % eastward: the road starts north, so the right side is uphill.
    const analysis = analyzeRoad(
      alignment,
      { elevationAt: (lng) => 800 + 0.7 * (lng - origin[0]) * 111_320 * Math.cos((origin[1] * Math.PI) / 180) },
      DEFAULT_ROAD_SETTINGS,
    )
    const plain = profileValueBands(analysis, alignment, { start: 0, end: analysis.length, minSpacingM: 20 })
    expect(plain.rows.map((r) => r.key)).not.toContain('sidehill')
    expect(plain.sidehillSpans).toEqual([])
    const bands = profileValueBands(analysis, alignment, {
      start: 0,
      end: analysis.length,
      minSpacingM: 20,
      sidehill: roadSidehill(analysis.stations),
    })
    const row = bands.rows.at(-1)!
    expect(row.key).toBe('sidehill')
    expect(row.values[0].text).toBe('70 R')
    expect(row.values[0].tone).toBe('bench')
    // The road turns east through its curve and then runs along the contour: full bench, then gentle.
    const spans = bands.sidehillSpans
    expect(spans[0]).toMatchObject({ start: 0, sidehillClass: 'full-bench' })
    expect(spans.at(-1)).toMatchObject({ end: analysis.stations.at(-1)!.chainage, sidehillClass: 'gentle' })
    spans.slice(1).forEach((span, i) => expect(span.start).toBeCloseTo(spans[i].end, 9))
  })

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

describe('placing a band value inside the plot', () => {
  it('starts a value at the left edge after the row title, ends one at the right edge, centres the rest', () => {
    const width = bandTextWidth('749.92', 10)
    // At the plot's left edge a centred value ran back over its row title ("Ground749.92").
    expect(bandValueAnchor(90, width, 90, 600)).toEqual({ x: 92, anchor: 'start' })
    expect(bandValueAnchor(600, width, 90, 600)).toEqual({ x: 598, anchor: 'end' })
    expect(bandValueAnchor(300, width, 90, 600)).toEqual({ x: 300, anchor: 'middle' })
    // Near but not at an edge, the text starts where centring would have started it, if that is inside.
    expect(bandValueAnchor(100, width, 90, 600)).toEqual({ x: 92, anchor: 'start' })
  })
})

describe('slope-stake and clearing rows', () => {
  const station = (chainage: number, over: Partial<RoadStation> = {}) =>
    ({ chainage, leftDaylightM: 6.24, rightDaylightM: 4.5, ...over }) as RoadStation

  it('signs the left stake negative and reads an incomplete side as unknown', () => {
    const rows = stakeRows([station(0), station(20, { rightDaylightM: null })], false)
    expect(rows.map((r) => r.key)).toEqual(['stakeLeft', 'stakeRight'])
    expect(rows[0].values.map((v) => v.text)).toEqual(['-6.2', '-6.2'])
    expect(rows[1].values.map((v) => v.text)).toEqual(['4.5', '—'])
  })

  it('adds a clearing row only when asked, with unknown where a station has none', () => {
    const rows = stakeRows([station(0, { clearingWidthM: 14.25 }), station(20)], true)
    expect(rows.at(-1)?.key).toBe('clearing')
    expect(rows.at(-1)?.values.map((v) => v.text)).toEqual(['14.3', '—'])
  })

  it('leaves the plot book’s bands as they were and adds the stakes on screen', () => {
    const analysis = analyzeRoad(road(), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const plain = profileValueBands(analysis, road(), { start: 0, end: analysis.length, minSpacingM: 50 })
    const screen = profileValueBands(analysis, road(), {
      start: 0,
      end: analysis.length,
      minSpacingM: 50,
      stakes: true,
    })
    expect(plain.rows.some((r) => r.key === 'stakeLeft')).toBe(false)
    expect(screen.rows.map((r) => r.key)).toEqual([...plain.rows.map((r) => r.key), 'stakeLeft', 'stakeRight'])
  })
})
