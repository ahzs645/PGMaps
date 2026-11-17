import { describe, expect, it } from 'vitest'
import type { DrainageEvidence } from '../drainageEvidence'
import { analyzeRoad, offsetCoordinate } from '../engine'
import { parseEngineering } from '../engineeringProject'
import { createEngineeringDesign } from '../engineeringTypes'
import { withStationing } from '../roadStationing'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from '../terrain'
import type { Alignment, Coordinate, Culvert, TerrainSource } from '../types'
import {
  buildCulvertSchedule,
  CULVERT_SCHEDULE_COLUMNS,
  culvertScheduleCsv,
  culvertScheduleReportHtml,
  culvertTreatmentSummary,
} from './culvertSchedule'

const origin: Coordinate = [-122.8, 53.9]
const xy = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
/** Ground rising 5 % to the north and falling 10 % to the east. */
const hillside: TerrainSource = {
  elevationAt: (lon, lat) => {
    const north = (((lat - origin[1]) * Math.PI) / 180) * 6371008.8
    const east = (((lon - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)
    return 800 + north * 0.05 - east * 0.1
  },
}
const culvert = (patch: Partial<Culvert>): Culvert => ({
  id: 'c1',
  name: 'Culvert 1',
  kind: 'stream',
  chainage: 100,
  skewDegrees: 0,
  lengthM: 12,
  diameterM: 0.8,
  inletInvertM: 803.3,
  outletInvertM: 803.0,
  minCoverM: 0.6,
  unitCost: 400,
  fixedCost: 1500,
  ...patch,
})
/** A 400 m road north then north-east on the hillside, on a profile of 5 % then −2 %. */
function road(culverts: Culvert[]): Alignment {
  return {
    id: 'spur',
    name: 'Spur 12-A',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: xy(0, 0), radiusM: 0 },
      { id: 'b', coordinate: xy(0, 200), radiusM: 35 },
      { id: 'c', coordinate: xy(120, 360), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 200, elevation: 810, curveLength: 40 },
      { id: 'v2', chainage: 396, elevation: 806, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering: { ...createEngineeringDesign(), culverts },
  }
}
const schedule = (culverts: Culvert[], more: Partial<Parameters<typeof buildCulvertSchedule>[0]> = {}) => {
  const alignment = road(culverts)
  const analysis = analyzeRoad(alignment, hillside, DEFAULT_ROAD_SETTINGS, [])
  return { alignment, analysis, schedule: buildCulvertSchedule({ alignment, analysis, place: undefined, ...more }) }
}
const drainage = (checks: Record<string, unknown>[]): { record: DrainageEvidence; stale: boolean } => ({
  stale: false,
  record: {
    settings: { rainfallMmPerHr: 30 },
    features: {
      type: 'FeatureCollection',
      features: checks.map((properties) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: origin },
        properties: { role: 'culvert-check', slope: 0.025, slopeAssumed: false, ...properties },
      })),
    },
  } as unknown as DrainageEvidence,
})

/** One CSV line's cells, quotes honoured. */
const csvCells = (line: string) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]).slice(0, -1)

describe('the culvert schedule', () => {
  it('keeps construction cost, appraisal treatment and design evidence apart for each culvert', () => {
    const { analysis, schedule: result } = schedule([
      culvert({}),
      culvert({
        id: 'c2',
        name: 'Culvert 2',
        chainage: 250,
        diameterM: 1.2,
        inletInvertM: 806.6,
        outletInvertM: 806.3,
      }),
    ])
    expect(result.rows.map((row) => row.name)).toEqual(['Culvert 1', 'Culvert 2'])
    const [small, large] = result.rows
    const engine = analysis.engineering!.culverts
    // The construction cost is the estimate's own figure, whatever the appraisal says.
    expect(small.cost).toMatchObject({ installedCad: engine[0].installedCost, replacedByCrossingRecord: false })
    expect(small.cost.installedCad).toBeCloseTo(12.00375 * 400 + 1500, 1)
    expect(small.appraisal).toMatchObject({ kind: 'in-subgrade', allowanceCad: null })
    // Between the 12 m and 13 m entries: the manual does not interpolate, so no single figure.
    expect(large.appraisal).toMatchObject({ kind: 'table', allowanceCad: null })
    expect(large.appraisal!.between).toMatchObject({ lowCad: 6728, highCad: 7248 })
    expect(large.barrelLengthM).toBeCloseTo(Math.hypot(12, 0.3), 9)
    expect(result.appraisal!.basis).toContain('default')
    expect(result.totals).toMatchObject({
      installedCad: engine[0].installedCost + engine[1].installedCost,
      tableAllowanceCad: 0,
      treatments: { 'in-subgrade': 1, table: 1, 'engineered-estimate': 0, 'not-determined': 0 },
      major: 0,
    })
    expect(culvertTreatmentSummary(result)).toBe('1 in the subgrade allowance · 1 table allowance')
    expect(small.evidence).toEqual(['Both inverts entered', 'No drainage check'])
    expect(small.fallPercent).toBeCloseTo(2.5, 9)
  })
  it('reads the appraisal manual from the project’s cost location, and none outside BC', () => {
    const coast = schedule([culvert({})], {
      place: { country: 'CA', subdivision: 'CA-BC', region: 'bc-nr:west-coast' },
    })
    expect(coast.schedule.rows[0].appraisal).toMatchObject({ kind: 'table', packId: 'bc-coast-2026' })
    const alberta = schedule([culvert({})], { place: { country: 'CA', subdivision: 'CA-AB' } })
    expect(alberta.schedule.appraisal).toBeNull()
    expect(alberta.schedule.rows[0].appraisal).toBeNull()
    expect(culvertTreatmentSummary(alberta.schedule)).toBe('No appraisal rules for this cost location')
    // The construction cost and the checks do not depend on the appraisal.
    expect(alberta.schedule.rows[0].cost).toEqual(coast.schedule.rows[0].cost)
    expect(alberta.schedule.rows[0].checks).toEqual(coast.schedule.rows[0].checks)
  })
  it('prices every barrel, classifies the installation and takes the peak from a current drainage check', () => {
    const twin = culvert({ barrels: 2, diameterM: 1 })
    const { analysis, schedule: result } = schedule([twin], {
      drainage: drainage([{ id: 'c1', designFlowM3s: 6.5, capacityM3s: 2.1, adequate: false }]),
    })
    const barrel = analysis.engineering!.culverts[0].barrelLengthM!
    expect(analysis.engineering!.culverts[0].installedCost).toBeCloseTo(2 * barrel * 400 + 1500, 6)
    const row = result.rows[0]
    expect(row.sizeText).toBe('2 × Ø 1 m')
    expect(row.appraisal).toMatchObject({ kind: 'engineered-estimate' })
    expect(row.class.major).toBe(true)
    expect(row.class.summary).toContain('6.5 m³/s')
    expect(row.checks.find((check) => check.id === 'capacity')).toMatchObject({ state: 'not-met' })
    expect(row.evidence).toContain('Drainage check: peak 6.500 m³/s')
    expect(result.drainage).toBe('current')
    // The same record, out of date, gives no peak to judge on.
    const stale = schedule([twin], {
      drainage: { ...drainage([{ id: 'c1', designFlowM3s: 6.5, capacityM3s: 2.1, adequate: false }]), stale: true },
    }).schedule.rows[0]
    expect(stale.flow).toBeNull()
    expect(stale.class.major).toBeNull()
    expect(stale.checks.find((check) => check.id === 'capacity')).toMatchObject({ state: 'not-assessed' })
  })
  it('leaves a culvert without the new fields exactly as the engine always calculated it', () => {
    const plain = schedule([culvert({})]).analysis.engineering!.culverts[0]
    expect(plain.barrelAreaM2).toBe((Math.PI * 0.8 ** 2) / 4)
    expect(plain.installedCost).toBe(plain.barrelLengthM! * 400 + 1500)
    expect(plain.barrelInternalVolumeM3).toBe(plain.barrelAreaM2 * plain.barrelLengthM!)
    // The optional fields survive a project file and come back absent when they were absent.
    const design = {
      ...createEngineeringDesign(),
      culverts: [culvert({}), culvert({ id: 'c2', shape: 'box', spanM: 2 })],
    }
    const read = parseEngineering(JSON.parse(JSON.stringify(design)), () => ({ ...DEFAULT_TEMPLATE }))
    expect(read.culverts[0]).toEqual(culvert({}))
    expect('shape' in read.culverts[0]).toBe(false)
    expect(read.culverts[1]).toMatchObject({ shape: 'box', spanM: 2 })
  })
  it('notes the longer run of road beside each culvert against the spacing table', () => {
    const { schedule: result } = schedule([culvert({ kind: 'cross-drain', diameterM: 0.6 })])
    const spacing = result.rows[0].checks.find((check) => check.id === 'spacing')!
    expect(spacing.state).toBe('note')
    expect(spacing.result).toMatch(/^\d+ m to the road end at up to \d/)
  })
  it('writes one CSV row per culvert under the road’s own station names', () => {
    const { alignment, schedule: result } = schedule([culvert({ name: 'Creek, east fork' })])
    const csv = culvertScheduleCsv(result).trimEnd().split('\n')
    expect(csv[0]).toBe(CULVERT_SCHEDULE_COLUMNS.join(','))
    expect(csv).toHaveLength(2)
    expect(csv[1]).toContain('"Creek, east fork"')
    expect(csv[1]).toContain('In the subgrade allowance')
    expect(csv[1].startsWith('0+100.0,100,')).toBe(true)
    const named = withStationing({ startStation: 1000, equations: [] }, () => culvertScheduleCsv(result)).split('\n')[1]
    expect(named.startsWith('1+100.0,100,')).toBe(true)
    expect(alignment.engineering!.culverts).toHaveLength(1)
  })
  it('adds fall, depth to invert, headwater by each control, freeboard and a suggested size, after the original columns', () => {
    const { analysis, schedule: result } = schedule([culvert({ material: 'csp' })], {
      drainage: drainage([{ id: 'c1', designFlowM3s: 0.9, capacityM3s: 2.1, adequate: true }]),
    })
    const row = result.rows[0]
    expect(row.fallOneIn).toBeCloseTo(40, 9)
    const profile = analysis.engineering!.culverts[0].profile
    expect(row.depthToInvert.inletM).toBeCloseTo(profile[0].groundElevation! - 803.3, 9)
    expect(row.depthToInvert.outletM).toBeCloseTo(profile[profile.length - 1].groundElevation! - 803.0, 9)
    expect(row.headwater.inlet && row.headwater.outlet).toBeTruthy()
    expect(row.headwater.governing).not.toBeNull()
    // The template's surfacing lifts the lowest subgrade over the barrel to the road surface.
    expect(row.headwater.road!.surfacingM).toBe(DEFAULT_TEMPLATE.surfaceDepth)
    expect(row.headwater.freeboardM).toBeCloseTo(row.headwater.road!.lowestSurfaceM - row.headwater.elevationM!, 9)
    expect(row.checks.find((check) => check.id === 'overtopping')!.state).not.toBe('not-assessed')
    expect(row.headwater.suggested!.diameterM).toBeGreaterThan(0)
    // The original columns keep their places; the new ones follow them.
    const original = CULVERT_SCHEDULE_COLUMNS.indexOf('evidence')
    expect(original).toBe(34)
    expect(CULVERT_SCHEDULE_COLUMNS.slice(original + 1)).toEqual([
      'fall_one_in',
      'inlet_depth_to_invert_m',
      'outlet_depth_to_invert_m',
      'road_surface_over_invert_m',
      'inlet_control_hw_m',
      'outlet_control_hw_m',
      'outlet_control_method',
      'governing_control',
      'governing_hw_m',
      'governing_hw_over_d',
      'headwater_elevation_m',
      'road_surface_low_m',
      'freeboard_m',
      'suggested_diameter_m',
    ])
    const cells = csvCells(culvertScheduleCsv(result).trimEnd().split('\n')[1])
    expect(cells).toHaveLength(CULVERT_SCHEDULE_COLUMNS.length)
    expect(cells[original + 1]).toBe('40')
    expect(cells[CULVERT_SCHEDULE_COLUMNS.indexOf('governing_control')]).toBe(row.headwater.governing!.control)
    expect(cells[CULVERT_SCHEDULE_COLUMNS.indexOf('outlet_control_method')]).toBe('full flow')
    expect(culvertScheduleReportHtml(result)).toContain('Falls 1 in 40 (2.5%)')
  })
  it('leaves the headwater figures empty without a current drainage check', () => {
    const row = schedule([culvert({})]).schedule.rows[0]
    expect(row.headwater).toMatchObject({
      inlet: null,
      outlet: null,
      governing: null,
      freeboardM: null,
      suggested: null,
    })
    const cells = csvCells(
      culvertScheduleCsv(schedule([culvert({})]).schedule)
        .trimEnd()
        .split('\n')[1],
    )
    expect(cells[CULVERT_SCHEDULE_COLUMNS.indexOf('governing_control')]).toBe('not determined')
    expect(cells[CULVERT_SCHEDULE_COLUMNS.indexOf('freeboard_m')]).toBe('')
  })
  it('prints the schedule for the report, and nothing for a road with no culverts', () => {
    const html = culvertScheduleReportHtml(schedule([culvert({ name: 'A <b> pipe' })]).schedule)
    expect(html).toContain('<h2>Culvert schedule</h2>')
    expect(html).toContain('A &lt;b&gt; pipe')
    expect(html).toContain('it is not the price of building one and is not part of this estimate')
    expect(html).toContain('IAM 4.3.2.1(1)(i)')
    expect(culvertScheduleReportHtml(schedule([]).schedule)).toBe('')
  })
})
