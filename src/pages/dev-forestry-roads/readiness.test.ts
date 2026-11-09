import { describe, expect, it } from 'vitest'
import { assessCostReadiness } from './costReadiness'
import { buildCrossingRegister, CROSSING_MATCH_DISTANCE_M, crossingRegisterSummary } from './crossingRegister'
import { DEFAULT_DESIGN_STANDARDS, type DesignStandards } from './designStandards'
import type { DrainageEvidence } from './drainageEvidence'
import { analyzeRoad, offsetCoordinate, positionAt } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import {
  assessReadiness,
  isStartingTemplate,
  readinessCounts,
  readinessReportHtml,
  readinessSummary,
  type ReadinessInput,
  type ReadinessRow,
} from './readiness'
import { assessmentFingerprint, RIPARIAN_RULES } from './streamClass'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate, Culvert, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const xy = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
/** Ground rising 5 % to the north and falling 10 % to the east, so a road heading north sits on a side slope. */
const hillside: TerrainSource = {
  elevationAt: (lon, lat) => {
    const north = (((lat - origin[1]) * Math.PI) / 180) * 6371008.8
    const east = (((lon - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)
    return 800 + north * 0.05 - east * 0.1
  },
}
const terrain = { kind: 'geotiff' as const, name: 'DTM-1m.tif', resolutionM: 1, verticalReference: 'CGVD2013' }

/** A 400 m road north then north-east, with one 35 m curve and a profile on the ground's 5 %. */
function road(patch: Partial<Alignment> = {}): Alignment {
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
    engineering: createEngineeringDesign(),
    ...patch,
  }
}
const stream = (id: string, north: number, patch: Partial<ContextFeature> = {}): ContextFeature => ({
  id,
  name: `Imported stream ${id}`,
  kind: 'stream',
  geometry: { type: 'LineString', coordinates: [xy(-60, north), xy(60, north)] },
  ...patch,
})
const culvert = (patch: Partial<Culvert>): Culvert => ({
  id: 'c1',
  name: 'Culvert 1',
  kind: 'stream',
  chainage: 100,
  skewDegrees: 0,
  lengthM: 12,
  diameterM: 0.8,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.6,
  unitCost: 0,
  fixedCost: 0,
  ...patch,
})
/** A saved drainage check reduced to what the register and the row read. */
function drainageRecord(
  crossings: { id: string; chainage: number; areaHa?: number; redirected?: boolean }[],
  summary: Partial<DrainageEvidence['summary']> = {},
  checks: { id: string; adequate: boolean; minimumDiameterM?: number }[] = [],
): DrainageEvidence {
  return {
    summary: {
      crossings: crossings.length,
      redirected: crossings.filter((c) => c.redirected).length,
      lowPoints: 0,
      pondingAreaM2: 0,
      undersized: checks.filter((c) => !c.adequate).length,
      culverts: checks.length,
      changedCells: 0,
      ...summary,
    },
    features: {
      type: 'FeatureCollection',
      features: [
        ...crossings.map((c) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: origin },
          properties: { role: 'crossing', areaHa: 2, redirected: false, divertedM: 0, ...c },
        })),
        ...checks.map((c) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: origin },
          properties: { role: 'culvert-check', minimumDiameterM: 0.6, ...c },
        })),
      ],
    },
  } as unknown as DrainageEvidence
}

function assess(
  options: {
    alignment?: Alignment
    settings?: Partial<RoadSettings>
    standards?: Partial<DesignStandards>
    context?: ContextFeature[]
    drainage?: ReadinessInput['drainage']
    vehicle?: ReadinessInput['vehicle']
    terrain?: ReadinessInput['terrain']
    source?: TerrainSource
  } = {},
) {
  const alignment = options.alignment ?? road()
  const settings = { ...DEFAULT_ROAD_SETTINGS, ...options.settings }
  const standards = options.standards ? { ...DEFAULT_DESIGN_STANDARDS, ...options.standards } : undefined
  const context = options.context ?? []
  const analysis = analyzeRoad(alignment, options.source ?? hillside, settings, context, { gradeStandards: standards })
  const rows = assessReadiness({
    settings,
    standards,
    terrain: options.terrain ?? terrain,
    context,
    alignment,
    analysis,
    cost: assessCostReadiness(analysis, alignment, settings),
    drainage: options.drainage,
    vehicle: options.vehicle,
  })
  const row = (id: string) => {
    const found = rows.find((item) => item.id === id)
    if (!found) throw Error(`No readiness row ${id}`)
    return found
  }
  return { rows, row, analysis, alignment }
}

describe('assessReadiness: what the walkthrough found ticked or missing', () => {
  it('raises a radius below the minimum while the corners are still fitted', () => {
    const { row } = assess({ settings: { minRadius: 60 } })
    expect(row('curves-fitted').state).toBe('met')
    expect(row('curve-radius')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: '1 of 1 curve is tighter than 60 m',
      judgedOn: 'Minimum radius 60 m',
    })
    expect(row('curve-radius').measured).toMatch(/^Tightest 35 m at 0\+/)
    expect(row('curve-radius').action).toMatchObject({ target: 'curves' })
    expect(assess({ settings: { minRadius: 30 } }).row('curve-radius').state).toBe('met')
  })

  it('does not call drainage checked while low points and modelled streams have no culvert', () => {
    const drainage = {
      stale: false,
      record: drainageRecord(
        [
          { id: 'crossing-1', chainage: 2.5, areaHa: 7.6 },
          { id: 'crossing-2', chainage: 335.6, areaHa: 2.69 },
        ],
        { lowPoints: 22, pondingAreaM2: 809 },
      ),
    }
    const { row } = assess({ drainage })
    expect(row('drainage')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: '22 low points have no culvert and 2 modelled streams have no culvert',
    })
    expect(row('drainage').measured).toContain('809 m² new ponding')
    expect(row('drainage').action).toMatchObject({ target: 'drainage' })
  })

  it('never reads an unrun or out-of-date drainage check as met', () => {
    expect(assess().row('drainage')).toMatchObject({
      state: 'not-assessed',
      result: 'The drainage check has not been run',
    })
    const stale = assess({ drainage: { stale: true, record: drainageRecord([]) } })
    expect(stale.row('drainage')).toMatchObject({ state: 'not-assessed', result: 'The drainage check is out of date' })
    const clean = assess({ drainage: { stale: false, record: drainageRecord([]) } })
    expect(clean.row('drainage').state).toBe('met')
  })

  it('does not accept a default, unsized culvert as the structure at a stream crossing', () => {
    const context = [stream('1', 100)]
    const bare = assess({ context })
    expect(bare.row('crossing-structures')).toMatchObject({ state: 'attention', result: '1 crossing has no structure' })

    const defaulted = road()
    defaulted.engineering!.culverts = [culvert({ sourceFeatureId: '1', chainage: 100 })]
    const unsized = assess({ context, alignment: defaulted })
    expect(unsized.row('crossing-structures')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: '1 culvert is not sized',
    })
    expect(unsized.row('crossing-structures').measured).toContain('no inverts, capacity not checked')
    expect(unsized.row('crossing-structures').action).toMatchObject({ target: 'culverts' })
    expect(unsized.row('crossing-structures').action?.chainage).toBeCloseTo(100, 6)

    // Inverts and a current capacity check that passes: sized.
    const sizedRoad = road()
    sizedRoad.engineering!.culverts = [
      culvert({ sourceFeatureId: '1', chainage: 100, inletInvertM: 801.5, outletInvertM: 801.1, unitCost: 400 }),
    ]
    const drainage = {
      stale: false,
      record: drainageRecord([{ id: 'crossing-1', chainage: 104 }], {}, [{ id: 'c1', adequate: true }]),
    }
    const sized = assess({ context, alignment: sizedRoad, drainage })
    expect(sized.row('crossing-structures')).toMatchObject({
      state: 'met',
      result: 'The 1 crossing has a sized culvert',
    })
    // The same culvert against a capacity check it fails.
    const failing = assess({
      context,
      alignment: sizedRoad,
      drainage: {
        stale: false,
        record: drainageRecord([{ id: 'crossing-1', chainage: 104 }], {}, [
          { id: 'c1', adequate: false, minimumDiameterM: 1.2 },
        ]),
      },
    })
    expect(failing.row('crossing-structures').measured).toContain('undersized: needs Ø 1.2 m')
  })

  it('raises a fill deficit that has no borrow source, and haul allocation left off', () => {
    // A profile lifted 1.5 m above the ground everywhere: all fill, no cut.
    const lifted = road({
      vertical: [
        { id: 'v0', chainage: 0, elevation: 801.5, curveLength: 0 },
        { id: 'v1', chainage: 200, elevation: 811.5, curveLength: 40 },
        { id: 'v2', chainage: 396, elevation: 807.5, curveLength: 0 },
      ],
    })
    const { row, analysis } = assess({ alignment: lifted })
    const short = analysis.fillVolumeM3 - analysis.cutVolumeM3 * DEFAULT_ROAD_SETTINGS.shrinkFactor
    expect(short).toBeGreaterThan(100)
    expect(row('earthwork-balance')).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(row('earthwork-balance').result).toBe(
      `Fill is short by ${Math.round(short).toLocaleString('en-CA')} m³ and no borrow source is set`,
    )
    expect(row('earthwork-balance').action).toMatchObject({ target: 'haul' })
    expect(row('haul')).toMatchObject({
      state: 'attention',
      severity: 'todo',
      result: 'Haul allocation is off: haul, borrow and waste add $0 to the estimate',
    })

    // With haul allocation on and a borrow pit that covers the deficit, the balance row clears.
    const sourced = structuredClone(lifted)
    sourced.engineering!.haul = { ...sourced.engineering!.haul, enabled: true, borrowRate: 9, wasteRate: 4 }
    sourced.engineering!.sites = [
      {
        id: 'pit',
        name: 'Pit A',
        kind: 'borrow',
        chainage: 0,
        accessDistanceM: 50,
        capacityM3: null,
        unitRate: 9,
        fixedCost: 0,
      },
      {
        id: 'dump',
        name: 'Spoil 1',
        kind: 'waste',
        chainage: 396,
        accessDistanceM: 20,
        capacityM3: null,
        unitRate: 4,
        fixedCost: 0,
      },
    ]
    const cleared = assess({ alignment: sourced })
    expect(cleared.row('earthwork-balance')).toMatchObject({
      state: 'met',
      result: 'Borrow and waste are all allocated to sites',
    })
    expect(cleared.row('earthwork-balance').measured).toContain('from Pit A')
  })

  it('raises crossed streams that have no reviewed riparian class', () => {
    const unassessed = assess({ context: [stream('1', 100), stream('2', 150)] })
    expect(unassessed.row('stream-class')).toMatchObject({
      state: 'attention',
      severity: 'todo',
      result: '2 of 2 crossed streams have no reviewed class',
    })
    const geometry = stream('1', 100).geometry
    const assessment = { channelWidthM: 2, fish: 'present' as const, communityWatershed: 'outside' as const }
    const reviewed = stream('1', 100, {
      streamAssessment: {
        ...assessment,
        reviewedClass: 'S3',
        reviewedFingerprint: assessmentFingerprint(assessment, geometry.coordinates),
        reviewedRules: `${RIPARIAN_RULES.id}@${RIPARIAN_RULES.consolidatedTo}`,
      },
    })
    expect(assess({ context: [reviewed] }).row('stream-class')).toMatchObject({
      state: 'met',
      measured: 'Imported stream 1: S3',
    })
    // Without stream data the question cannot be asked at all.
    expect(assess().row('stream-class').state).toBe('not-assessed')
    expect(assess().row('crossing-structures').state).toBe('not-assessed')
  })

  it('raises a cross-section template still at its starting values', () => {
    expect(isStartingTemplate(DEFAULT_TEMPLATE)).toBe(true)
    expect(assess().row('template')).toMatchObject({
      state: 'attention',
      severity: 'todo',
      result: 'The template is still the starting one',
    })
    const narrowed = road({ template: { ...DEFAULT_TEMPLATE, leftWidth: 2.5, rightWidth: 2.5 } })
    expect(assess({ alignment: narrowed }).row('template').state).toBe('met')
    // Against a 5 m standard, the starting 6 m top is a breach, not a reminder.
    expect(assess({ standards: { runningSurfaceWidthM: 5 } }).row('template')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: 'Running surface is 6 m; the standard is 5 m',
    })
  })
})

describe('assessReadiness: limits and states', () => {
  it('states a grade breach as a result, with where and against what', () => {
    const steep = road({
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 100, elevation: 805, curveLength: 0 },
        { id: 'v2', chainage: 150, elevation: 815, curveLength: 0 },
        { id: 'v3', chainage: 396, elevation: 820, curveLength: 0 },
      ],
    })
    const { row } = assess({ alignment: steep })
    expect(row('grade')).toMatchObject({ state: 'attention', severity: 'limit', judgedOn: '12%' })
    expect(row('grade').result).toBe('Grade exceeds the standard in 1 place')
    expect(row('grade').measured).toMatch(/^Steepest 20\.0% at 0\+1/)
    expect(row('grade').action?.target).toBe('station')
    // 12 %, 22 % for pitches up to 60 m: the 50 m pitch is allowed, and the row says a pitch was used.
    const allowed = assess({ alignment: steep, standards: { shortPitchGradePercent: 22, shortPitchMaxLengthM: 60 } })
    expect(allowed.row('grade')).toMatchObject({ state: 'met', judgedOn: '12%; 22% for pitches up to 60 m' })
    expect(allowed.row('grade').measured).toContain('1 short pitch allowed')
  })

  it('leaves checks with no limit entered as not assessed, with the measured value shown', () => {
    const { row } = assess()
    expect(row('vertical-k')).toMatchObject({ state: 'not-assessed' })
    expect(row('vertical-k').measured).toMatch(/^Smallest K /)
    expect(row('clearing-width')).toMatchObject({ state: 'not-assessed', result: 'No clearing width limit is entered' })
    expect(row('clearing-width').measured).toMatch(/^Widest \d+\.\d m at 0\+/)
    expect(row('cross-drain-spacing')).toMatchObject({ state: 'not-assessed' })
    expect(row('cross-drain-spacing').measured).toContain('Longest run without a culvert 399 m')
    expect(row('vehicle-fit').state).toBe('not-assessed')
    expect(row('constraints').state).toBe('not-assessed')
    expect(row('standards')).toMatchObject({ state: 'attention', severity: 'todo' })
  })

  it('judges clearing width, cross-drain spacing and K once their limits are entered', () => {
    const alignment = road({
      verticalStandards: {
        gradeRanges: [],
        minSagK: null,
        minCrestK: 20,
        minCurveLengthM: null,
        minTangentLengthM: null,
      },
    })
    alignment.engineering!.culverts = [
      culvert({ chainage: 120 }),
      culvert({ id: 'c2', name: 'Culvert 2', chainage: 260 }),
    ]
    const { row } = assess({
      alignment,
      standards: { maxClearingWidthM: 7.5, maxCrossDrainSpacingM: 150, confirmedOn: '2026-11-09' },
    })
    expect(row('clearing-width')).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(row('clearing-width').result).toMatch(/^Clearing is wider than 7.5 m in \d+ place/)
    expect(row('cross-drain-spacing')).toMatchObject({
      state: 'met',
      result: 'No run is longer than 150 m without a culvert',
    })
    // K = 40 m / 7.04 % is about 5.7, below the crest minimum of 20.
    expect(row('vertical-k')).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(row('standards')).toMatchObject({ state: 'met', result: 'Standards confirmed 2026-11-09' })
    expect(assess({ alignment, standards: { maxCrossDrainSpacingM: 100 } }).row('cross-drain-spacing')).toMatchObject({
      state: 'attention',
      result: '3 runs are longer than 100 m without a culvert',
    })
  })

  it('reports terrain gaps and terrain that cannot support site quantities', () => {
    const holed: TerrainSource = {
      elevationAt: (lon, lat) => {
        const north = (((lat - origin[1]) * Math.PI) / 180) * 6371008.8
        return north > 100 && north < 140 ? Number.NaN : hillside.elevationAt(lon, lat)
      },
    }
    const { row } = assess({ source: holed })
    expect(row('terrain-coverage')).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(row('terrain-coverage').measured).toMatch(/% covered · 0\+\d/)
    expect(row('terrain-coverage').action).toMatchObject({ target: 'station' })
    expect(assess().row('terrain-coverage').state).toBe('met')
    expect(assess().row('terrain-source').state).toBe('met')
    const coarse = assess({
      terrain: { kind: 'regional', name: 'CDEM', resolutionM: 20, verticalReference: 'CGVD2013' },
    })
    expect(coarse.row('terrain-source')).toMatchObject({ state: 'attention', severity: 'limit' })
  })

  it('raises an excluded area the centreline enters, and names it', () => {
    const block: ContextFeature = {
      id: 'block-a',
      name: 'Block A',
      kind: 'avoid',
      geometry: { type: 'Polygon', coordinates: [[xy(-30, 60), xy(30, 60), xy(30, 120), xy(-30, 120), xy(-30, 60)]] },
    }
    const { row } = assess({ context: [block] })
    expect(row('constraints')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: 'The road enters 1 excluded or unreviewed area',
    })
    expect(row('constraints').measured).toMatch(/^Block A \(excluded\) at 0\+060\.0 to 0\+120\.0/)
    const clear = {
      ...block,
      geometry: { type: 'Polygon' as const, coordinates: [[xy(200, 0), xy(260, 0), xy(260, 60), xy(200, 0)]] },
    }
    expect(assess({ context: [clear] }).row('constraints').state).toBe('met')
  })

  it('reports the swept path of the design vehicle when one has been run', () => {
    const fits = {
      vehicleName: 'Log truck',
      clearanceM: 0.3,
      turns: 2,
      failingTurns: 0,
      worstWideningM: 0,
      worstChainage: null,
    }
    expect(assess({ vehicle: fits }).row('vehicle-fit')).toMatchObject({
      state: 'met',
      result: 'The vehicle fits all 2 turns',
    })
    const tight = { ...fits, failingTurns: 1, worstWideningM: 1.24, worstChainage: 210 }
    expect(assess({ vehicle: tight }).row('vehicle-fit')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: 'The vehicle leaves the running surface at 1 of 2 turns',
      measured: 'Log truck · needs up to 1.24 m more width at 0+210.0',
    })
  })

  it('keeps a cost prompt it has no row for, and gives every attention row somewhere to go', () => {
    const base = assess()
    const cost = assessCostReadiness(base.analysis, base.alignment, DEFAULT_ROAD_SETTINGS)
    cost.flags.push({ id: 'unpriced-stripping', label: 'Stripping has no price', detail: '120 m³ at $0.' })
    const rows = assessReadiness({
      settings: DEFAULT_ROAD_SETTINGS,
      terrain,
      context: [],
      alignment: base.alignment,
      analysis: base.analysis,
      cost,
    })
    expect(rows.find((item) => item.id === 'cost-unpriced-stripping')).toMatchObject({
      state: 'attention',
      result: 'Stripping has no price',
    })
    const stranded = rows.filter((item: ReadinessRow) => item.state === 'attention' && !item.action)
    expect(stranded.map((item) => item.id)).toEqual([])
    expect(new Set(rows.map((item) => item.id)).size).toBe(rows.length)
  })

  it('counts and names the culverts that have no price', () => {
    const alignment = road()
    alignment.engineering!.culverts = [
      culvert({ chainage: 120 }),
      culvert({ id: 'c2', name: 'Culvert 2', chainage: 260, unitCost: 450 }),
    ]
    const priced = assess({ alignment }).row('structure-costs')
    expect(priced).toMatchObject({ state: 'attention', severity: 'todo', result: '1 culvert has no price' })
    expect(priced.measured).toMatch(/^No price: Culvert 1/)
    expect(priced.action).toMatchObject({ target: 'culverts' })
    // Nothing entered is nothing to price: not assessed, never a tick.
    expect(assess().row('structure-costs').state).toBe('not-assessed')
  })

  it('summarises the list and prints it for the report', () => {
    const { rows } = assess({ settings: { minRadius: 60 } })
    const counts = readinessCounts(rows)
    expect(counts.met + counts.attention + counts.notAssessed).toBe(rows.length)
    expect(readinessSummary(rows)).toBe(
      `${counts.attention} need attention · ${counts.notAssessed} not assessed · ${counts.met} met`,
    )
    const report = readinessReportHtml(rows)
    expect(report).toContain('<h2>Readiness checks</h2>')
    expect(report).toContain('1 of 1 curve is tighter than 60 m')
    expect(report).toContain('Not assessed means the workspace could not make the check; it is not a pass.')
  })
})

describe('assessReadiness: vertical curves the engine did not apply', () => {
  // PVIs 20 m apart, each with a 60 m curve. Neither fits, so the road keeps two unrounded breaks.
  const crowded = (patch: Partial<Alignment> = {}) =>
    road({
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 190, elevation: 815, curveLength: 60 },
        { id: 'v2', chainage: 210, elevation: 813, curveLength: 60 },
        { id: 'v3', chainage: 396, elevation: 806, curveLength: 0 },
      ],
      ...patch,
    })

  it('reads a curve that does not fit as a grade break without a curve, and names the stations', () => {
    const { row, analysis } = assess({ alignment: crowded() })
    expect(analysis.warnings.filter((w) => w.includes('tangent grades are retained'))).toHaveLength(2)
    expect(row('vertical-curves')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: '2 of 2 grade breaks have no vertical curve: 2 entered curves do not fit and are not applied',
    })
    expect(row('vertical-curves').measured).toBe(
      'Entered curve not applied at 0+190.0 (60 m, does not fit its tangents), 0+210.0 (60 m, does not fit its tangents) · largest unrounded break 17.9% at 0+190.0',
    )
    expect(row('vertical-curves').action).toMatchObject({ target: 'profile', chainage: 190 })
    // With no minimum K the K row is not assessed, and it does not quote a K the road does not have.
    expect(row('vertical-k').state).toBe('not-assessed')
    expect(row('vertical-k').measured).toBe('No vertical curve is applied')
  })

  it('does not pass the minimum K on the entered length of a curve that was not applied', () => {
    const { row, analysis } = assess({
      alignment: crowded({
        verticalStandards: {
          gradeRanges: [],
          minSagK: 3,
          minCrestK: 3,
          minCurveLengthM: null,
          minTangentLengthM: null,
        },
      }),
    })
    // On its entered 60 m the crest at 190 m would have K 3.4 and pass.
    expect(analysis.verticalChecks?.map((check) => check.kind)).toEqual(['k', 'k'])
    expect(row('vertical-k')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: '2 vertical curve checks failed',
    })
    expect(row('vertical-k').measured).toMatch(/^The 60 m vertical curve at 0\+190\.0 does not fit its tangents/)
    expect(row('vertical-k').action).toMatchObject({ target: 'profile', chainage: 190 })
  })

  it('still lists a break with no curve entered beside one whose curve was dropped', () => {
    const mixed = road({
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 100, elevation: 808, curveLength: 0 },
        { id: 'v2', chainage: 190, elevation: 815, curveLength: 60 },
        { id: 'v3', chainage: 210, elevation: 813, curveLength: 0 },
        { id: 'v4', chainage: 396, elevation: 806, curveLength: 0 },
      ],
    })
    const { row } = assess({ alignment: mixed })
    // 100 m: 8 % to 7.8 % is under the 0.5 % that needs a curve. 190 m: dropped. 210 m: none entered.
    expect(row('vertical-curves')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: '2 of 2 grade breaks have no vertical curve: 1 entered curve does not fit and is not applied',
    })
    expect(row('vertical-curves').measured).toContain('Entered curve not applied at 0+190.0')
    expect(row('vertical-curves').measured).toContain('no curve entered at 0+210.0')
    // The fitted profile of the shared fixture is unchanged.
    expect(assess().row('vertical-curves')).toMatchObject({
      state: 'met',
      result: 'The 1 grade break has a vertical curve',
    })
  })
})

describe('buildCrossingRegister', () => {
  const at = (alignment: Alignment, chainage: number) => positionAt(alignment, chainage).coordinate
  it('lists a mapped stream and a modelled flow line near it as one crossing, and the rest as unmatched', () => {
    const alignment = road()
    alignment.engineering!.culverts = [culvert({ sourceFeatureId: '1', chainage: 100 })]
    const context = [stream('1', 100), stream('2', 150)]
    const analysis = analyzeRoad(alignment, hillside, DEFAULT_ROAD_SETTINGS, context)
    expect(at(alignment, 100)).toBeDefined()
    const register = buildCrossingRegister({
      alignment,
      analysis,
      context,
      drainage: {
        stale: false,
        record: drainageRecord([
          { id: 'crossing-1', chainage: 100 + CROSSING_MATCH_DISTANCE_M - 1, areaHa: 7.6 },
          { id: 'crossing-2', chainage: 335.6, areaHa: 2.69 },
        ]),
      },
    })
    expect(register.rows.map((row) => [Math.round(row.chainage), row.source, row.structure.kind])).toEqual([
      [100, 'both', 'culvert'],
      [150, 'mapped', 'none'],
      [336, 'modelled', 'none'],
    ])
    expect(register.rows[0].separationM).toBeCloseTo(CROSSING_MATCH_DISTANCE_M - 1, 6)
    expect(register.rows[0].structure.outstanding).toEqual(['no inverts', 'capacity not checked'])
    expect(register.rows[2].classStatus).toBeNull()
    expect(crossingRegisterSummary(register)).toBe('2 mapped · 2 modelled · 1 matched')
  })

  it('pairs each mapped stream with its nearest flow line and never one flow line twice', () => {
    const alignment = road()
    const context = [stream('1', 100), stream('2', 120)]
    const analysis = analyzeRoad(alignment, hillside, DEFAULT_ROAD_SETTINGS, context)
    const register = buildCrossingRegister({
      alignment,
      analysis,
      context,
      drainage: { stale: false, record: drainageRecord([{ id: 'crossing-1', chainage: 112 }]) },
    })
    expect(register.rows.map((row) => [Math.round(row.chainage), row.source])).toEqual([
      [100, 'mapped'],
      [120, 'both'],
    ])
    expect(register.matchedCount).toBe(1)
  })

  it('lists mapped crossings only when the drainage check is out of date or was not run', () => {
    const alignment = road()
    const context = [stream('1', 100)]
    const analysis = analyzeRoad(alignment, hillside, DEFAULT_ROAD_SETTINGS, context)
    const record = drainageRecord([{ id: 'crossing-1', chainage: 300 }])
    const stale = buildCrossingRegister({ alignment, analysis, context, drainage: { stale: true, record } })
    expect(stale.rows).toHaveLength(1)
    expect(stale.modelledCount).toBeNull()
    expect(crossingRegisterSummary(stale)).toBe('1 mapped · modelled crossings out of date')
    expect(crossingRegisterSummary(buildCrossingRegister({ alignment, analysis, context }))).toBe(
      '1 mapped · modelled crossings not checked',
    )
  })
})
