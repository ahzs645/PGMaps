import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { stationsCsv } from './project'
import { availableStationColumns, reportingRows, stationReportCsv, tableTotals } from './stationReport'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, Coordinate } from './types'

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

describe("the manual's volume table: surfacing, stripping, borrow and waste by interval", () => {
  const northing = (p: Coordinate) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8
  // Fill for the first half and cut for the second, a stripped topsoil horizon, and a pit and a
  // spoil site so the allocation borrows and wastes.
  const design = (haul: boolean): Alignment => {
    const engineering = createEngineeringDesign()
    engineering.materials = [
      {
        id: 'topsoil',
        name: 'Topsoil',
        color: '#6b4f2a',
        cutRate: 3,
        reusableFraction: 0,
        compactionFactor: 1,
        purpose: 'stripping',
      },
    ]
    engineering.strata = [{ id: 'top', materialId: 'topsoil', start: 0, end: 450, topDepthM: 0, bottomDepthM: 0.3 }]
    engineering.haul.enabled = haul
    const site = (id: string, kind: 'borrow' | 'waste', chainage: number) => ({
      id,
      name: id,
      kind,
      chainage,
      accessDistanceM: 140,
      capacityM3: null,
      unitRate: 0,
      fixedCost: 0,
    })
    engineering.sites = [site('pit', 'borrow', 85), site('spoil', 'waste', 400)]
    return {
      id: 'r',
      name: 'Road',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 0, 450), radiusM: 0 },
      ],
      vertical: [
        { id: 's', chainage: 0, elevation: 803, curveLength: 0 },
        { id: 'e', chainage: 450, elevation: 798, curveLength: 0 },
      ],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
      engineering,
    }
  }
  const hole = { elevationAt: (lng: number, lat: number) => (Math.abs(northing([lng, lat]) - 255) < 6 ? NaN : 800) }
  const road = analyzeRoad(design(true), hole, DEFAULT_ROAD_SETTINGS)
  const e = road.engineering!

  it('sums each of them into 100 m rows that add up to the road totals', () => {
    const rows = reportingRows(road, road.stations, 100)
    const totals = tableTotals(rows)
    expect(road.surfaceVolumeM3).toBeGreaterThan(100)
    expect(e.strippingCutM3).toBeGreaterThan(10)
    expect(e.haul.borrowCompactedM3).toBeGreaterThan(100)
    expect(e.haul.wasteBankM3).toBeGreaterThan(100)
    expect(totals.surfacingVolume).toBeCloseTo(road.surfaceVolumeM3, 6)
    expect(totals.strippingVolume).toBeCloseTo(e.strippingCutM3, 6)
    expect(totals.borrowVolume).toBeCloseTo(e.haul.borrowCompactedM3, 6)
    expect(totals.wasteVolume).toBeCloseTo(e.haul.wasteBankM3, 6)
    expect(totals.cutVolume).toBeCloseTo(road.cutVolumeM3, 6)
    // The row holding the gap still reports the surfacing of its known 70 m.
    const partial = rows.find((r) => r.unknownM > 0)!
    expect(partial.surfacingVolume!).toBeCloseTo(rows[1].surfacingVolume! * 0.7, 6)
    // Stripping is part of the cut, never more than it.
    for (const row of rows) expect(row.strippingVolume!).toBeLessThanOrEqual(row.cutVolume! + 1e-9)
  })

  it('offers borrow and waste only once haul is allocated, and stripping without materials reads zero', () => {
    const ids = (analysis: typeof road) => availableStationColumns(analysis).map((c) => c.id)
    expect(ids(road)).toEqual(expect.arrayContaining(['surfacing', 'stripping', 'borrow', 'waste']))
    const off = analyzeRoad(design(false), hole, DEFAULT_ROAD_SETTINGS)
    expect(ids(off)).toEqual(expect.arrayContaining(['surfacing', 'stripping']))
    expect(ids(off)).not.toContain('borrow')
    expect(tableTotals(reportingRows(off, off.stations, 100)).borrowVolume).toBeNull()
    expect(tableTotals(reportingRows(analysis, analysis.stations, 100)).strippingVolume).toBe(0)
    expect(availableStationColumns(road, true).map((c) => c.id)).toEqual([
      'ground',
      'groundGrade',
      'interval',
      'longitude',
      'latitude',
    ])
  })

  it('carries them in the CSV at the chosen interval, with the rows adding up to its total row', () => {
    const rows = reportingRows(road, road.stations, 100)
    const lines = stationReportCsv(road, rows).trimEnd().split('\r\n')
    const header = lines[0].split(',')
    expect(header).toEqual([
      'station_m',
      'ground_elevation_m',
      'design_elevation_m',
      'design_grade_pct',
      'cut_area_m2',
      'fill_area_m2',
      'cut_volume_bank_m3',
      'fill_volume_compacted_m3',
      'surfacing_volume_m3',
      'stripping_volume_bank_m3',
      'borrow_volume_compacted_m3',
      'waste_volume_bank_m3',
      'mass_balance_m3',
      'formation_width_m',
      'longitude',
      'latitude',
      'cut_volume_curvature_corrected_bank_m3',
      'fill_volume_curvature_corrected_compacted_m3',
      'unknown_earthwork_m',
      'flags',
    ])
    expect(lines).toHaveLength(rows.length + 2)
    const body = lines.slice(1, -1).map((line) => line.split(','))
    const total = lines.at(-1)!.split(',')
    expect(body.map((cells) => Number(cells[0]))).toEqual([0, 100, 200, 300, 400, 450])
    expect(total[0]).toBe('total')
    for (const column of [
      'cut_volume_bank_m3',
      'fill_volume_compacted_m3',
      'surfacing_volume_m3',
      'stripping_volume_bank_m3',
      'borrow_volume_compacted_m3',
      'waste_volume_bank_m3',
      'unknown_earthwork_m',
    ]) {
      const i = header.indexOf(column)
      expect(body.reduce((sum, cells) => sum + Number(cells[i]), 0)).toBeCloseTo(Number(total[i]), 6)
    }
    expect(Number(total[header.indexOf('borrow_volume_compacted_m3')])).toBeCloseTo(e.haul.borrowCompactedM3, 6)
    expect(Number(total[header.indexOf('unknown_earthwork_m')])).toBeCloseTo(30, 6)
    expect(body[3].at(-1)).toContain('Partial: leaves out 30 m with unknown earthwork')
    // A cumulative or per-station column has no total.
    expect(total[header.indexOf('mass_balance_m3')]).toBe('')
    expect(total[header.indexOf('ground_elevation_m')]).toBe('')
  })

  it('carries them in the Station CSV of every calculated station too', () => {
    const [head, ...lines] = stationsCsv(road, { kind: 'demo', name: 'T', resolutionM: 1, verticalReference: 'V' })
      .trimEnd()
      .split('\r\n')
    const header = head.split(',')
    const sum = (column: string) =>
      lines.reduce((total, line) => total + Number(line.split(',')[header.indexOf(column)]), 0)
    expect(sum('interval_surfacing_volume_m3')).toBeCloseTo(road.surfaceVolumeM3, 6)
    expect(sum('interval_stripping_bank_m3')).toBeCloseTo(e.strippingCutM3, 6)
    expect(sum('interval_borrow_compacted_m3')).toBeCloseTo(e.haul.borrowCompactedM3, 6)
    expect(sum('interval_waste_bank_m3')).toBeCloseTo(e.haul.wasteBankM3, 6)
    // Unknown stays blank, never zero.
    const at250 = lines.find((line) => line.startsWith('250,'))!.split(',')
    expect(at250[header.indexOf('interval_surfacing_volume_m3')]).toBe('')
    expect(at250[header.indexOf('interval_borrow_compacted_m3')]).toBe('')
  })
})
