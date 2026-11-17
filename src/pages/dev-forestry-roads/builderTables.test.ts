import { describe, expect, it } from 'vitest'
import { analyzeRoad, horizontalCurveSummary, offsetCoordinate } from './engine'
import { clearingCsv, clearingSchedule, slopeStakeBook, slopeStakeCsv, stakeText } from './builderSchedules'
import { curveElements } from './curveElements'
import { createEngineeringDesign } from './engineeringTypes'
import { grubbingAreaM2, parseAssumedEquipment, quantitySchedule, taskQuantity } from './quantitySchedule'
import { earthworkBins, gradeDistribution } from './reviewCharts'
import { availableStationColumns, columnTotal, reportingRows, stationReportCsv, tableTotals } from './stationReport'
import { stationExtras, STAKE_DEEP_M } from './stationExtras'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const R = 6371008.8,
  RAD = Math.PI / 180
const east = (p: Coordinate) => (p[0] - origin[0]) * RAD * R * Math.cos(origin[1] * RAD)
// Ground falls 30% to the east, so every section is on sidehill and cuts on the uphill side.
const terrain = { elevationAt: (lng: number, lat: number) => 800 - 0.3 * east([lng, lat]) }

const road = (): Alignment => {
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
    {
      id: 'till',
      name: 'Till',
      color: '#a07845',
      cutRate: 5,
      reusableFraction: 1,
      compactionFactor: 0.9,
      purpose: 'earthwork',
    },
  ]
  engineering.strata = [
    { id: 'top', materialId: 'topsoil', start: 0, end: 600, topDepthM: 0, bottomDepthM: 0.3 },
    { id: 'till', materialId: 'till', start: 0, end: 600, topDepthM: 0.3, bottomDepthM: null },
  ]
  engineering.culverts = []
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 250), radiusM: 60 },
      { id: 'c', coordinate: offsetCoordinate(offsetCoordinate(origin, 0, 250), 60, 300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 250, elevation: 806, curveLength: 60 },
      { id: 'e', chainage: 500, elevation: 800, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering,
  }
}
const alignment = road()
const analysis = analyzeRoad(alignment, terrain, DEFAULT_ROAD_SETTINGS)
const toGrid = (c: Coordinate): [number, number] => [east(c), (c[1] - origin[1]) * RAD * R]
const extras = stationExtras(alignment, analysis, toGrid)

describe('station extras', () => {
  it('reads the centreline cut or fill and the grade either side from the stations', () => {
    expect(extras).toHaveLength(analysis.stations.length)
    const i = 5,
      s = analysis.stations
    expect(extras[i].centreDepthM).toBeCloseTo(s[i].groundElevation! - s[i].designElevation!, 9)
    expect(extras[i].gradeLastPercent).toBeCloseTo(
      (100 * (s[i].designElevation! - s[i - 1].designElevation!)) / (s[i].chainage - s[i - 1].chainage),
      9,
    )
    expect(extras[0].gradeLastPercent).toBeNull()
    expect(extras.at(-1)!.gradeNextPercent).toBeNull()
    expect(extras[i].easting).toBeCloseTo(toGrid(s[i].coordinate)[0], 6)
  })

  it('puts the uphill catch in cut from the ditch and the downhill one in fill from the edge', () => {
    const e = extras[3]
    expect(e.uphill).toBe('left')
    expect(e.sidehillPercent!).toBeGreaterThan(20)
    expect(e.catch.left!.cutFillM!).toBeGreaterThan(0)
    expect(e.catch.left!.hinge).toBe('ditch')
    expect(e.catch.right!.cutFillM!).toBeLessThan(0)
    expect(e.catch.right!.hinge).toBe('edge')
    expect(e.catch.left!.offsetM).toBeCloseTo(Math.abs(analysis.stations[3].leftDaylightM!), 6)
    expect(stakeText(e.catch.left)).toMatch(/^C \d+\.\d \/ \d+\.\d$/)
    expect(stakeText(e.catch.right)).toMatch(/^F /)
    expect(e.ditchDepthM.left!).toBeGreaterThan(0)
    expect(e.ditchDepthM.right).toBeNull()
  })

  it("adds each material's interval cut up to the material totals", () => {
    for (const m of analysis.engineering!.materials) {
      const sum = extras.reduce((total, e) => total + (e.materialCutM3?.[m.materialId] ?? 0), 0)
      expect(sum).toBeCloseTo(m.bankCutM3, 6)
    }
  })
})

describe('station table builder columns', () => {
  it('offers them only with extras, and the material columns total to the materials', () => {
    expect(availableStationColumns(analysis).some((c) => c.extra)).toBe(false)
    const columns = availableStationColumns(analysis, false, true)
    expect(columns.map((c) => c.id)).toEqual(
      expect.arrayContaining(['centreDepth', 'gradeLast', 'gradeNext', 'catchL', 'catchR', 'clearingWidth', 'easting']),
    )
    const rows = reportingRows(analysis, analysis.stations, 50, extras)
    const totals = tableTotals(rows)
    for (const m of analysis.engineering!.materials) {
      const column = columns.find((c) => c.materialId === m.materialId)!
      expect(columnTotal(column, totals)).toBeCloseTo(m.bankCutM3, 6)
    }
    const header = stationReportCsv(analysis, rows).split('\r\n')[0]
    expect(header).toContain('slope_stake_offset_m_left')
    expect(header).toContain('cut_bank_m3_topsoil')
    // Without extras the CSV is as before.
    expect(stationReportCsv(analysis, reportingRows(analysis, analysis.stations, 50)).split('\r\n')[0]).not.toContain(
      'slope_stake',
    )
  })
})

describe('slope-stake book', () => {
  const book = slopeStakeBook(alignment, analysis, extras, 20)
  it('stakes every 20 m, both ends and the curve points (Table 5-10)', () => {
    const at = book.map((r) => Math.round(r.station.chainage))
    for (let c = 0; c <= analysis.length; c += 20) expect(at).toContain(Math.round(c))
    const curve = horizontalCurveSummary(alignment)[0]
    expect(book.find((r) => r.reasons.includes('BC'))!.station.chainage).toBeCloseTo(curve.fullStart, 0)
    expect(book.find((r) => r.reasons.includes('EC'))!.station.chainage).toBeCloseTo(curve.fullEnd, 0)
    expect(book.some((r) => r.reasons.includes('BVC'))).toBe(true)
  })
  it(`marks stations cut or filled deeper than ${STAKE_DEEP_M} m`, () => {
    for (const r of book.filter((r) => r.reasons.includes('deep')))
      expect(
        [r.extra.centreDepthM, r.extra.catch.left?.cutFillM, r.extra.catch.right?.cutFillM].some(
          (v) => v != null && Math.abs(v) > STAKE_DEEP_M,
        ),
      ).toBe(true)
  })
  it('writes a CSV row per stake station', () => {
    const lines = slopeStakeCsv(analysis, book, null, 26910).trimEnd().split('\r\n')
    expect(lines).toHaveLength(book.length + 1)
    expect(lines[0]).toMatch(/^station_m,station,reasons,/)
  })
})

describe('clearing schedule', () => {
  it('adds up to the analysis clearing area at any interval', () => {
    for (const every of [0, 20, 50]) {
      const rows = clearingSchedule(analysis, extras, every)
      expect(rows.reduce((sum, r) => sum + (r.areaM2 ?? 0), 0)).toBeCloseTo(analysis.clearingAreaM2, 6)
    }
  })
  it('marks widths over the limit and writes a total row', () => {
    const rows = clearingSchedule(analysis, extras, 20, 5)
    expect(rows.some((r) => r.over)).toBe(true)
    expect(clearingCsv(analysis, rows).trimEnd().split('\r\n').at(-1)).toMatch(/^total,/)
  })
})

describe('curve elements', () => {
  it('gives the simple curve formulas without spirals', () => {
    const r = 100,
      delta = 40
    const e = curveElements({
      radius: r,
      deflectionDegrees: delta,
      circularDeflectionDegrees: delta,
      spiralInLengthM: 0,
      spiralOutLengthM: 0,
      fullStart: 1000,
      fullLength: (r * delta * Math.PI) / 180,
    })!
    const half = (delta * Math.PI) / 360
    expect(e.tangentInM).toBeCloseTo(r * Math.tan(half), 9)
    expect(e.tangentOutM).toBeCloseTo(e.tangentInM, 9)
    expect(e.piChainage).toBeCloseTo(1000 + e.tangentInM, 9)
    expect(e.chordM).toBeCloseTo(2 * r * Math.sin(half), 9)
    expect(e.externalM).toBeCloseTo(r / Math.cos(half) - r, 9)
    expect(e.middleOrdinateM).toBeCloseTo(r * (1 - Math.cos(half)), 9)
  })
  it('lengthens the tangents by the spiral offsets and stays symmetric for equal spirals', () => {
    const base = {
      radius: 100,
      deflectionDegrees: 50,
      circularDeflectionDegrees: 50 - 2 * 8.594,
      fullStart: 0,
      fullLength: 100,
    }
    const plain = curveElements({ ...base, spiralInLengthM: 0, spiralOutLengthM: 0 })!
    const spiral = curveElements({ ...base, spiralInLengthM: 30, spiralOutLengthM: 30 })!
    expect(spiral.tangentInM).toBeGreaterThan(plain.tangentInM)
    expect(spiral.tangentInM).toBeCloseTo(spiral.tangentOutM, 9)
  })
})

describe('quantity schedule', () => {
  const lines = quantitySchedule(analysis, DEFAULT_ROAD_SETTINGS)
  it('reads the analysis figures and states grubbing as the catch-to-catch footprint', () => {
    const line = (id: string) => lines.find((l) => l.id === id)!
    expect(line('clearing').quantity).toBeCloseTo(analysis.clearingAreaM2 / 10000, 9)
    expect(line('grubbing').quantity).toBeCloseTo(grubbingAreaM2(analysis.stations) / 10000, 9)
    expect(line('grubbing').quantity!).toBeLessThanOrEqual(line('clearing').quantity! + 1e-9)
    expect(line('embankment').quantity).toBeCloseTo(analysis.fillVolumeM3, 9)
    expect(line('stripping').quantity).toBeCloseTo(analysis.engineering!.strippingCutM3, 9)
    expect(taskQuantity('Clearing', lines)!.quantity).toBe(line('clearing').quantity)
  })
  it('reads saved equipment and refuses what it cannot read', () => {
    const saved = [{ id: 'x', task: 'Common excavation', equipment: 'Excavator, 30 t class' }]
    expect(parseAssumedEquipment(saved)).toEqual(saved)
    expect(() => parseAssumedEquipment([{ id: 'x', task: 'Flying', equipment: 'Drone' }])).toThrow(/Unknown/)
  })
})

describe('review charts', () => {
  it('splits the road length into grade classes that add up to the designed length', () => {
    const { bins, knownLengthM } = gradeDistribution(analysis)
    expect(bins.reduce((sum, b) => sum + b.share, 0)).toBeCloseTo(1, 9)
    expect(knownLengthM).toBeCloseTo(analysis.length, 6)
  })
  it('sums cut and fill by stretch to the road totals', () => {
    const bins = earthworkBins(analysis)
    expect(bins.reduce((sum, b) => sum + b.cutM3, 0)).toBeCloseTo(analysis.cutVolumeM3, 6)
    expect(bins.reduce((sum, b) => sum + b.fillM3, 0)).toBeCloseTo(analysis.fillVolumeM3, 6)
  })
})
