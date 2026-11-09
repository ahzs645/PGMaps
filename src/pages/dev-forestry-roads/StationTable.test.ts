import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { reportingRows, tableTotals } from './StationTable'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const analysis = analyzeRoad(
  {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 450), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 799, curveLength: 0 },
      { id: 'e', chainage: 450, elevation: 799, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  },
  { elevationAt: () => 800 },
  DEFAULT_ROAD_SETTINGS,
)

describe('station table reporting interval', () => {
  it('reports every calculated station by default', () => {
    expect(reportingRows(analysis, analysis.stations, 0)).toHaveLength(analysis.stations.length)
  })

  it('reports every 200 m plus the end, summing volumes since the previous row', () => {
    const rows = reportingRows(analysis, analysis.stations, 200)
    expect(rows.map((r) => r.station.chainage)).toEqual([0, 200, 400, 450])
    const total = rows.reduce((sum, r) => sum + r.cutVolume!, 0)
    expect(total).toBeCloseTo(analysis.cutVolumeM3, 6)
    expect(rows[1].span).toBe(200)
  })
})

describe('station table on a road with unknown earthwork', () => {
  const northing = (p: Coordinate) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8
  // No ground under stations 250 and 260: the intervals 240–270 are unknown.
  const holed = analyzeRoad(
    {
      id: 'r',
      name: 'Road',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 0, 450), radiusM: 0 },
      ],
      vertical: [
        { id: 's', chainage: 0, elevation: 799, curveLength: 0 },
        { id: 'e', chainage: 450, elevation: 799, curveLength: 0 },
      ],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    },
    { elevationAt: (lng, lat) => (Math.abs(northing([lng, lat]) - 255) < 6 ? NaN : 800) },
    DEFAULT_ROAD_SETTINGS,
  )
  const sum = (rows: ReturnType<typeof reportingRows>, key: 'cutVolume' | 'fillVolume') =>
    rows.reduce((total, row) => total + (row[key] ?? 0), 0)

  it('shows the known part of a 100 m row that holds a gap, so the rows add up to the total', () => {
    expect(holed.coveragePercent).toBeLessThan(100)
    const rows = reportingRows(holed, holed.stations, 100)
    expect(rows.map((r) => r.station.chainage)).toEqual([0, 100, 200, 300, 400, 450])
    const partial = rows[3]
    // 70 of its 100 m are known: it reports those, and says what it leaves out.
    expect(partial.cutVolume).toBeGreaterThan(0)
    expect(partial.cutVolume!).toBeCloseTo(rows[2].cutVolume! * 0.7, 6)
    expect(partial.unknownM).toBeCloseTo(30, 6)
    expect(rows.filter((r) => r.unknownM > 0)).toEqual([partial])
    expect(sum(rows, 'cutVolume')).toBeCloseTo(holed.cutVolumeM3, 6)
    expect(sum(rows, 'fillVolume')).toBeCloseTo(holed.fillVolumeM3, 6)
    expect(tableTotals(rows)).toMatchObject({ unknownM: 30 })
    expect(tableTotals(rows).cutVolume).toBeCloseTo(holed.cutVolumeM3, 6)
  })

  it('adds up at every reporting interval and at every station', () => {
    for (const every of [0, 20, 50, 100, 200, 500]) {
      const rows = reportingRows(holed, holed.stations, every)
      expect(sum(rows, 'cutVolume')).toBeCloseTo(holed.cutVolumeM3, 6)
      expect(rows.reduce((total, row) => total + row.unknownM, 0)).toBeCloseTo(holed.length - holed.completeLength, 6)
    }
  })

  it('leaves a row blank only when none of its road is known', () => {
    const rows = reportingRows(holed, holed.stations, 0)
    const at = (chainage: number) => rows.find((r) => r.station.chainage === chainage)!
    expect([at(250).cutVolume, at(260).cutVolume, at(270).cutVolume]).toEqual([null, null, null])
    expect(at(270).unknownM).toBeCloseTo(10, 6)
    expect(at(280).cutVolume).toBeGreaterThan(0)
  })

  it('starts a narrowed range at zero, so its rows add up to the range total', () => {
    const inRange = holed.stations.filter((s) => s.chainage >= 100 && s.chainage <= 300)
    const rows = reportingRows(holed, inRange, 100)
    expect(rows.map((r) => r.station.chainage)).toEqual([100, 200, 300])
    expect(rows[0].cutVolume).toBe(0)
    const expected = inRange.slice(1).reduce((total, s) => total + (s.cutVolumeM3 ?? 0), 0)
    expect(sum(rows, 'cutVolume')).toBeCloseTo(expected, 6)
  })
})
