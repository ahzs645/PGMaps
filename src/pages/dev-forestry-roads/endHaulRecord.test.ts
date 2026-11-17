import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { endHaulCsv, endHaulSections, equipmentHoursCsv, EQUIPMENT_HOURS_HEADER } from './endHaul'
import { recordChanges, RECORD_LEVEL_TOLERANCE_M } from './recordChanges'
import {
  clearingReportHtml,
  endHaulReportHtml,
  recordChangesReportHtml,
  slopeStakeReportHtml,
} from './builderReportHtml'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const flat = { elevationAt: () => 800 }
// Formation 3 m below the ground for the whole road: all cut, sent to a spoil site past the end.
const road = (id = 'r', lower = 3): Alignment => {
  const engineering = createEngineeringDesign()
  engineering.haul.enabled = true
  engineering.sites = [
    {
      id: 'spoil',
      name: 'Spoil A',
      kind: 'waste',
      chainage: 300,
      accessDistanceM: 150,
      capacityM3: null,
      unitRate: 0,
      fixedCost: 0,
    },
  ]
  engineering.culverts = []
  return {
    id,
    name: id === 'r' ? 'Road' : 'Issued',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800 - lower, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 800 - lower, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering,
  }
}
const alignment = road()
const analysis = analyzeRoad(alignment, flat, DEFAULT_ROAD_SETTINGS)

describe('end haul', () => {
  const sections = endHaulSections(analysis, alignment)
  it('sets out the trucked cut as sections that add up to the wasted bank volume', () => {
    expect(sections.length).toBeGreaterThan(0)
    const wasted = analysis
      .engineering!.movements.filter((m) => m.kind === 'waste' && m.disposalMethod !== 'sidecast')
      .reduce((sum, m) => sum + (m.bankVolumeM3 ?? m.transportedVolumeM3), 0)
    expect(sections.reduce((sum, s) => sum + s.bankM3, 0)).toBeCloseTo(wasted, 6)
    expect(sections[0].destinations).toContain('Spoil A')
    expect(sections[0].meanHaulM).toBeGreaterThan(150)
    expect(endHaulCsv(sections, String).split('\r\n')[0]).toMatch(/^start_station,end_station,/)
  })
  it('prints nothing without a haul allocation', () => {
    const off = road()
    off.engineering!.haul.enabled = false
    expect(endHaulSections(analyzeRoad(off, flat, DEFAULT_ROAD_SETTINGS), off)).toEqual([])
  })
  it('lays out the equipment-hours sheet with the form header and six machines', () => {
    const csv = equipmentHoursCsv({
      roadName: 'Road',
      analysis,
      station: (c) => c.toFixed(0),
      equipment: [{ id: 'x', task: 'Common excavation', equipment: 'Excavator 30 t' }],
      days: 3,
    })
    const lines = csv.trimEnd().split('\r\n')
    for (const field of EQUIPMENT_HOURS_HEADER) expect(csv).toContain(field)
    expect(csv).toContain('Equipment 1: Excavator 30 t')
    expect(
      lines
        .find((l) => l.startsWith('Date'))!
        .split(',')
        .filter((c) => c === 'Operating Hours'),
    ).toHaveLength(6)
    expect(lines.at(-1)).toMatch(/^Page Total/)
  })
})

describe('record of changes', () => {
  const issued = road('i', 3)
  const issuedAnalysis = analyzeRoad(issued, flat, DEFAULT_ROAD_SETTINGS)
  it('finds no change between a road and its copy', () => {
    const r = recordChanges({ alignment: issued, analysis: issuedAnalysis }, { alignment, analysis })
    expect(r.planShifts).toEqual([])
    expect(r.levelChanges).toEqual([])
    expect(r.culverts).toEqual([])
    expect(r.rows.find((row) => row.item === 'Length')!.change).toBe('No change')
  })
  it('lists a raised formation and an added culvert', () => {
    const built = road('r', 2.5)
    built.engineering!.culverts = [
      {
        id: 'c1',
        name: 'CMP 1',
        chainage: 150,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: null,
        outletInvertM: null,
        minCoverM: 0.3,
        unitCost: 0,
        fixedCost: 0,
      },
    ]
    const builtAnalysis = analyzeRoad(built, flat, DEFAULT_ROAD_SETTINGS)
    const r = recordChanges(
      { alignment: issued, analysis: issuedAnalysis },
      { alignment: built, analysis: builtAnalysis },
    )
    expect(r.levelChanges).toHaveLength(1)
    expect(r.levelChanges[0].maxM).toBeCloseTo(0.5, 6)
    expect(r.levelChanges[0].maxM).toBeGreaterThan(RECORD_LEVEL_TOLERANCE_M)
    expect(r.culverts).toEqual([{ name: 'CMP 1', change: expect.stringMatching(/^Added at 150\.0 m, 600 mm/) }])
    const html = recordChangesReportHtml(
      { alignment: issued, analysis: issuedAnalysis },
      { alignment: built, analysis: builtAnalysis },
      String,
    )
    expect(html).toContain('<h2>Record of changes from the issued design</h2>')
    expect(html).toContain('CMP 1')
  })
})

describe('builder report sections', () => {
  const ctx = {
    project: { settings: DEFAULT_ROAD_SETTINGS, standards: undefined },
    alignment,
    analysis,
    station: (c: number) => c.toFixed(1),
  }
  it('print the stake book, clearing schedule and end haul under their headings', () => {
    expect(slopeStakeReportHtml(ctx)).toMatch(/^<h2>Slope-stake book<\/h2>/)
    expect(clearingReportHtml(ctx)).toMatch(/^<h2>Clearing schedule<\/h2>/)
    const endHaul = endHaulReportHtml(ctx)
    expect(endHaul).toMatch(/^<h2>End haul summary<\/h2>/)
    expect(endHaul).toContain('Spoil A')
    expect(endHaul).toContain('Terrain stability assessment')
  })
})
