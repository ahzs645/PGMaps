import { describe, expect, it } from 'vitest'
import { designInputsOf, safeAnalyzeRoad } from './analysisResult'
import { assessCostReadiness, unpricedQuantities } from './costReadiness'
import { buildCrossingRegister, CROSSING_MATCH_DISTANCE_M, crossingRegisterSummary } from './crossingRegister'
import { DEFAULT_DESIGN_STANDARDS, type DesignStandards } from './designStandards'
import type { DrainageEvidence } from './drainageEvidence'
import { analyzeRoad, offsetCoordinate, positionAt } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import {
  assessReadiness,
  isStartingTemplate,
  projectReadiness,
  readinessCounts,
  readinessParts,
  readinessReportHtml,
  readinessSummary,
  readinessVerdict,
  type ReadinessInput,
  type ReadinessRow,
} from './readiness'
import { assessmentFingerprint, RIPARIAN_RULES } from './streamClass'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate, Culvert, RoadAnalysis, RoadSettings, TerrainSource } from './types'

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
  cellM = 1,
): DrainageEvidence {
  return {
    grid: { cellM, width: 100, height: 100, origin: [0, 0] },
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

  it('does not call drainage checked while cross-drain sites and modelled streams have no culvert', () => {
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
      result: '22 cross-drain sites have no culvert and 2 modelled streams have no culvert',
    })
    expect(row('drainage').measured).toContain('809 m² new ponding')
    expect(row('drainage').action).toMatchObject({ target: 'drainage' })
  })

  it('reads cross-drain candidates on coarse terrain as a screen, never a finding or a pass', () => {
    const coarse = (summary: Partial<DrainageEvidence['summary']>) =>
      assess({ drainage: { stale: false, record: drainageRecord([], summary, [], 22.4) } }).row('drainage')
    // 211 candidates on 22 m cells are not 211 missing culverts.
    expect(coarse({ lowPoints: 211 })).toMatchObject({
      state: 'not-assessed',
      result: 'Cross-drain sites need terrain of 2 m cells or finer',
    })
    expect(coarse({ lowPoints: 211 }).measured).toContain('211 cross-drain candidates (screening on 22 m cells)')
    // Nor does a coarse run with none read as drained.
    expect(coarse({}).state).toBe('not-assessed')
    // A stream finding still stands on coarse terrain.
    expect(coarse({ lowPoints: 5, undersized: 1, culverts: 1 })).toMatchObject({
      state: 'attention',
      result: '1 culvert is undersized',
    })
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

  it('measures how each crossing meets its stream: square, with 15 m straight each side', () => {
    // The road heads north; a stream running east–west crosses it square, 100 m from the start.
    const square = assess({ context: [stream('1', 100)] }).row('crossing-approach')
    expect(square).toMatchObject({
      state: 'met',
      result: 'The 1 crossing is within the screen with straight approaches',
    })
    expect(square.measured).toMatch(/^0\+100\.0 Imported stream 1: 0° off square, 100 m \/ 8\d\.\d m straight$/)
    // A stream running 60° off the road's perpendicular is past the 45° screen.
    const skewed = assess({
      context: [stream('1', 100, { geometry: { type: 'LineString', coordinates: [xy(-30, 48), xy(30, 152)] } })],
    }).row('crossing-approach')
    expect(skewed).toMatchObject({ state: 'attention', severity: 'todo' })
    expect(skewed.measured).toMatch(/60° off square/)
    // On the curve at point 2 there is no straight approach at all.
    const onCurve = assess({ context: [stream('1', 195)] }).row('crossing-approach')
    expect(onCurve).toMatchObject({ state: 'attention', result: '1 crossing is skewed or short of straight approach' })
    expect(onCurve.measured).toMatch(/on a curve/)
  })

  it('raises a road running inside a riparian area away from a crossing (FPPR s. 50)', () => {
    // A crossing passes through the area as part of the crossing.
    expect(assess({ context: [stream('1', 100)] }).row('riparian-areas')).toMatchObject({
      state: 'met',
      result: 'The road enters riparian areas only at its 1 crossing',
    })
    // A stream 40 m east of the road, running beside it: inside its unresolved 100 m screen.
    const beside = (patch: Partial<ContextFeature> = {}) =>
      stream('2', 0, { geometry: { type: 'LineString', coordinates: [xy(40, 20), xy(40, 150)] }, ...patch })
    const unresolved = assess({ context: [beside()] }).row('riparian-areas')
    expect(unresolved).toMatchObject({
      state: 'attention',
      severity: 'todo',
      result: 'The road runs inside 1 riparian area away from a crossing',
    })
    expect(unresolved.measured).toMatch(/Imported stream 2 \(unresolved, 100 m screen\) at 0\+000\.0 to/)
    // Reviewed as S4 with a 2 m channel, its area is 1 + 0 + 30 m wide: clear of a road 40 m away.
    const geometry = beside().geometry
    const reviewedBeside = (riparianClass: 'S4' | 'S2') => {
      const assessment = { channelWidthM: 2, fish: 'present' as const, communityWatershed: 'outside' as const }
      return beside({
        streamAssessment: {
          ...assessment,
          reviewedClass: riparianClass,
          reviewedFingerprint: assessmentFingerprint(assessment, geometry.coordinates),
          reviewedRules: `${RIPARIAN_RULES.id}@${RIPARIAN_RULES.consolidatedTo}`,
        },
      })
    }
    expect(assess({ context: [reviewedBeside('S4')] }).row('riparian-areas')).toMatchObject({
      state: 'met',
      result: 'The road stays outside every riparian screening area',
    })
    // An S2 reach's 50 m area does reach it, and on a reviewed class the rule is a limit.
    expect(assess({ context: [reviewedBeside('S2')] }).row('riparian-areas')).toMatchObject({
      state: 'attention',
      severity: 'limit',
    })
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
    // Wheels that fit do not make a turn the truck cannot steer.
    const locked = { ...fits, beyondLockTurns: 1, steeringLockDeg: 28.31 }
    expect(assess({ vehicle: locked }).row('vehicle-fit')).toMatchObject({
      state: 'attention',
      result: 'The vehicle cannot steer 1 of 2 turns',
      measured: 'Log truck · beyond its 28.31° steering lock',
    })
    expect(assess({ vehicle: { ...locked, beyondLockTurns: 0 } }).row('vehicle-fit').state).toBe('met')
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

  it('counts unpriced culverts by record, whatever their names contain', () => {
    const alignment = road()
    alignment.engineering!.culverts = [
      culvert({ name: 'CMP 600 mm, km 0.2', chainage: 120 }),
      culvert({ id: 'c2', name: 'Creek No. 4 crossing', chainage: 260 }),
      culvert({ id: 'c3', name: 'Culvert 3', chainage: 300, unitCost: 450 }),
    ]
    const { row, analysis } = assess({ alignment })
    expect(row('structure-costs')).toMatchObject({
      state: 'attention',
      severity: 'todo',
      result: '2 culverts have no price',
    })
    expect(row('structure-costs').measured).toMatch(/^No price: CMP 600 mm, km 0\.2; Creek No\. 4 crossing/)
    // The button goes to the first culvert that has no price, not the first culvert entered.
    expect(row('structure-costs').action).toMatchObject({ target: 'culverts', chainage: 120 })
    // The cost dialog lists the same culverts, with or without inverts.
    const unpriced = unpricedQuantities(analysis, alignment, DEFAULT_ROAD_SETTINGS).filter(
      (item) => item.rowId === 'structures',
    )
    expect(unpriced.map((item) => item.text)).toEqual([
      '12 m of culvert (CMP 600 mm, km 0.2) has no installed cost',
      '12 m of culvert (Creek No. 4 crossing) has no installed cost',
    ])
  })

  it('sends an unpriced rate to where that rate is edited', () => {
    const rates = { cutRate: 9, fillRate: 7, surfacingRate: 31, clearingRate: 1.4 }
    // Every base rate is entered; one ground material has no excavation rate.
    const alignment = road()
    alignment.engineering!.materials = [
      { id: 'till', name: 'Till', color: '#987654', cutRate: 0, reusableFraction: 1, compactionFactor: 0.9 },
    ]
    alignment.engineering!.strata = [
      { id: 'all', materialId: 'till', start: 0, end: 400, topDepthM: 0, bottomDepthM: null },
    ]
    const material = assess({ alignment, settings: rates }).row('rates')
    expect(material).toMatchObject({
      state: 'attention',
      result: 'Positive work quantities have zero amounts',
      action: { label: 'Materials', target: 'materials' },
    })
    expect(material.measured).toContain('excavation (Till) has no rate')
    // A base rate at zero is edited under Unit rates, and so is a rate still at its starting value.
    expect(assess({ settings: { ...rates, fillRate: 0 } }).row('rates').action).toEqual({
      label: 'Enter rates',
      target: 'rates',
    })
    expect(assess().row('rates').action).toEqual({ label: 'Enter rates', target: 'rates' })
    // An aggregate source with no evidence is completed under Engineering → Haul.
    const sourced = road()
    sourced.engineering!.surfacingSupply = {
      enabled: true,
      name: 'Pit 7',
      acquisitionRate: 5,
      processingRate: 4,
      loadingRate: 2,
      haulDistanceKm: 3,
      haulRate: 1,
      placementRate: 3,
      capacityM3: null,
      sourceNotes: '',
    }
    const aggregate = assess({ alignment: sourced, settings: rates }).row('rates')
    expect(aggregate).toMatchObject({
      result: 'Aggregate source assumptions need evidence',
      action: { label: 'Aggregate source', target: 'haul' },
    })
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

  it('leads with what needs attention and never reads clear over a check that was not made', () => {
    const { rows } = assess({ settings: { minRadius: 60 } })
    const parts = readinessParts(rows)
    // Every row is in exactly one part.
    expect([...parts.attention, ...parts.notAssessed, ...parts.met].map((row) => row.id).sort()).toEqual(
      rows.map((row) => row.id).sort(),
    )
    // A broken limit comes before an input still to do.
    const severities = parts.attention.map((row) => row.severity)
    expect(severities.lastIndexOf('limit')).toBeLessThan(severities.indexOf('todo'))
    expect(parts.attention[0].id).toBe('curve-radius')
    const counts = readinessCounts(rows)
    expect(readinessVerdict(rows)).toEqual({
      tone: 'danger',
      text: `Not ready: ${counts.limits} outside a limit, ${counts.attention - counts.limits} to do`,
    })
    const row = (state: ReadinessRow['state'], severity?: ReadinessRow['severity']): ReadinessRow => ({
      id: `${state}-${severity}`,
      group: 'cost',
      check: 'A check',
      state,
      severity,
      result: 'A result',
    })
    expect(readinessVerdict([row('met'), row('attention', 'todo')])).toEqual({
      tone: 'warning',
      text: 'Not ready: 1 to do',
    })
    expect(readinessVerdict([row('met'), row('not-assessed')])).toEqual({
      tone: 'neutral',
      text: 'Nothing needs attention, but 1 check was not made',
    })
    expect(readinessVerdict([row('met'), row('met')]).text).toBe('All 2 checks are met')
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

describe('assessReadiness: a check that was not made never reads as met', () => {
  // Everything a rule could read is present: streams, an excluded area the road enters, a culvert,
  // a vehicle result and every limit. What is missing is the calculation.
  const block: ContextFeature = {
    id: 'block-a',
    name: 'Block A',
    kind: 'avoid',
    geometry: { type: 'Polygon', coordinates: [[xy(-30, 60), xy(30, 60), xy(30, 120), xy(-30, 120), xy(-30, 60)]] },
  }
  const context = [stream('1', 100), block]
  const standards: DesignStandards = {
    ...DEFAULT_DESIGN_STANDARDS,
    maxClearingWidthM: 30,
    maxCrossDrainSpacingM: 150,
    runningSurfaceWidthM: 6,
    confirmedOn: '2026-11-09',
  }
  const entered = (patch: Partial<Alignment> = {}) => {
    const alignment = road({
      verticalStandards: { gradeRanges: [], minSagK: 2, minCrestK: 2, minCurveLengthM: null, minTangentLengthM: null },
      ...patch,
    })
    alignment.engineering!.culverts = [culvert({ unitCost: 400 })]
    alignment.engineering!.haul = { ...alignment.engineering!.haul, enabled: true, mobilizationCost: 5000 }
    return alignment
  }
  const rowsFor = (alignment: Alignment, analysis: RoadAnalysis) =>
    assessReadiness({
      settings: DEFAULT_ROAD_SETTINGS,
      standards,
      terrain,
      context,
      alignment,
      analysis,
      cost: assessCostReadiness(analysis, alignment, DEFAULT_ROAD_SETTINGS),
      drainage: undefined,
      vehicle: null,
    })

  // The analysis fails on the template and there is no earlier valid result to fall back on.
  const failed = entered({ template: { ...DEFAULT_TEMPLATE, cutSlope: 0 } })
  const nothing = safeAnalyzeRoad(failed, hillside, DEFAULT_ROAD_SETTINGS, context, { gradeStandards: standards })
  const uncalculated = rowsFor(failed, nothing)
  const calculated = rowsFor(
    entered(),
    analyzeRoad(entered(), hillside, DEFAULT_ROAD_SETTINGS, context, { gradeStandards: standards }),
  )

  it('has nothing calculated to judge', () => {
    expect(nothing.stations).toEqual([])
    expect(uncalculated[0]).toMatchObject({ id: 'invalid-input', state: 'attention', severity: 'limit' })
  })

  // Every rule that reads the calculation, with what the same road gives once it is calculated.
  it.each([
    ['terrain-coverage', 'No sections were calculated', 'met'],
    ['grade', 'No grades were calculated', 'met'],
    ['curves-fitted', 'No sections were calculated, so the corners were not checked', 'met'],
    ['materials', 'No earthwork was calculated', 'attention'],
    ['earthwork-balance', 'No earthwork was calculated', 'attention'],
    ['clearing-width', 'No sections to measure', 'met'],
    ['crossing-structures', 'No sections were calculated, so crossings were not found', 'attention'],
    ['stream-class', 'No sections were calculated, so crossed streams were not found', 'attention'],
    ['crossing-approach', 'No sections were calculated, so crossings were not found', 'met'],
    ['riparian-areas', 'No sections were calculated, so the areas were not tested', 'met'],
    ['cross-drain-spacing', 'No road to measure', 'attention'],
    ['constraints', 'No sections were calculated, so the areas were not tested', 'attention'],
    ['rates', 'No quantities were calculated, so no rate is in use', 'attention'],
    ['haul', 'No earthwork was calculated', 'attention'],
    ['structure-costs', 'No structure cost was calculated', 'attention'],
  ])('%s is not assessed when nothing was calculated', (id, result, onceCalculated) => {
    expect(uncalculated.find((row) => row.id === id)).toMatchObject({ state: 'not-assessed', result })
    expect(calculated.find((row) => row.id === id)?.state).toBe(onceCalculated)
  })

  // Rules judged on an input alone hold whether or not the road calculated; each has its own
  // not-assessed case for when that input is missing.
  it.each([
    [
      'terrain-source',
      'met',
      { terrain: { ...terrain, resolutionM: Number.NaN } },
      'The terrain’s cell size is not recorded',
    ],
    [
      'profile',
      'met',
      { alignment: road({ vertical: [], mappedRoad: {} as never }) },
      'Mapped road: read as built, with the formation on the ground',
    ],
    ['curve-radius', 'met', { settings: { minRadius: 0 } }, 'No minimum radius is entered'],
    ['vertical-curves', 'met', { alignment: road({ vertical: [] }) }, 'No designed profile to check'],
    ['vertical-k', 'met', { alignment: road() }, 'No minimum K is entered, so curve length is not checked'],
    ['template', 'met', { alignment: road({ mappedRoad: {} as never }) }, 'Mapped road: no section is designed'],
  ] as const)('%s reads its input, and is not assessed without it', (id, withInput, missing, result) => {
    expect(uncalculated.find((row) => row.id === id)?.state).toBe(withInput)
    expect(assess(missing as Parameters<typeof assess>[0]).row(id)).toMatchObject({ state: 'not-assessed', result })
  })

  it('never reads met for a rule whose own input is empty, on a road that did calculate', () => {
    // No streams, areas, culverts, limits, vehicle or drainage check: the starting project.
    const { rows } = assess()
    const states = Object.fromEntries(rows.map((row) => [row.id, row.state]))
    expect(states).toMatchObject({
      'vehicle-fit': 'not-assessed',
      'vertical-k': 'not-assessed',
      'clearing-width': 'not-assessed',
      'crossing-structures': 'not-assessed',
      'stream-class': 'not-assessed',
      'crossing-approach': 'not-assessed',
      'riparian-areas': 'not-assessed',
      drainage: 'not-assessed',
      'cross-drain-spacing': 'not-assessed',
      constraints: 'not-assessed',
      'structure-costs': 'not-assessed',
    })
    // A road whose corners carry no curve has no radius to judge, and its corners are raised.
    const sharp = road()
    sharp.points[1].radiusM = 0
    const unfitted = assess({ alignment: sharp })
    expect(unfitted.row('curves-fitted')).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(unfitted.row('curve-radius')).toMatchObject({
      state: 'not-assessed',
      result: 'No curve is fitted, so there is no radius to judge',
    })
    // A road with no complete section has no cut to call classified.
    const noGround: TerrainSource = { elevationAt: () => Number.NaN }
    const blind = assess({ source: noGround })
    expect(blind.analysis.stations.length).toBeGreaterThan(0)
    expect(blind.row('materials')).toMatchObject({ state: 'not-assessed', result: 'No earthwork was calculated' })
    expect(blind.row('rates').state).toBe('not-assessed')
  })

  it('does not fail on a line or profile the engine cannot read', () => {
    const broken = entered()
    broken.points[1] = { ...broken.points[1], coordinate: [Number.NaN, 53.9] }
    const analysis = safeAnalyzeRoad(broken, hillside, DEFAULT_ROAD_SETTINGS, context)
    const rows = rowsFor(broken, analysis)
    expect(rows.find((row) => row.id === 'curve-radius')).toMatchObject({
      state: 'not-assessed',
      result: 'The line could not be calculated',
    })
    expect(rows.filter((row) => row.state === 'met').map((row) => row.id)).toEqual([
      'terrain-source',
      'standards',
      'profile',
      'vertical-curves',
      'vertical-k',
      'template',
      'allowances',
    ])
  })
})

describe('assessReadiness: a material plan that was not solved', () => {
  /** Thirteen priced sites: one over what the economic model opens, so the allocation stops. */
  const unsolved = () => {
    const alignment = road()
    Object.assign(alignment.engineering!.haul, { enabled: true, allocation: 'economic', borrowRate: 12, wasteRate: 7 })
    alignment.engineering!.sites = Array.from({ length: 13 }, (_, i) => ({
      id: `site${i}`,
      name: `Site ${i + 1}`,
      kind: i % 2 ? ('borrow' as const) : ('waste' as const),
      chainage: 10 + i * 30,
      accessDistanceM: 30,
      capacityM3: null,
      unitRate: 3,
      fixedCost: 100,
    }))
    return alignment
  }

  it('says the plan was not solved instead of stating a deficit no allocation found', () => {
    const { row, rows, analysis, alignment } = assess({ alignment: unsolved() })
    expect(analysis.engineering!.haul.optimizationStatus).toBe('unsolved')
    expect(analysis.fillVolumeM3).toBeGreaterThan(100)
    expect(row('earthwork-balance')).toMatchObject({
      state: 'not-assessed',
      result: 'The material plan was not solved, so borrow and waste have no source or site yet',
      action: { label: 'Haul', target: 'haul' },
    })
    expect(row('earthwork-balance').measured).toMatch(/m³ usable cut − .* m³ fill = /)
    expect(row('earthwork-balance').measured).not.toMatch(/borrow|waste/)
    expect(row('haul')).toMatchObject({
      state: 'not-assessed',
      result: 'The material plan was not solved, so haul, borrow and waste are not priced',
      action: { label: 'Haul', target: 'haul' },
    })
    expect(row('haul').measured).toMatch(/^Material plan not solved: /)
    // One state, said once: no third row, and no prompt about unallocated or unpriced borrow.
    expect(rows.filter((item) => item.id.startsWith('cost-'))).toEqual([])
    const flags = assessCostReadiness(analysis, alignment, DEFAULT_ROAD_SETTINGS).flags.map((flag) => flag.id)
    expect(flags).toContain('unsolved-material-plan')
    expect(flags).not.toContain('unallocated-haul')
    expect(flags).not.toContain('zero-supply-rates')
    expect(unpricedQuantities(analysis, alignment, DEFAULT_ROAD_SETTINGS).map((item) => item.rowId)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(borrow|waste)-/)]),
    )
  })

  it('still states a real deficit when the plan is solved and a site is missing', () => {
    const alignment = unsolved()
    // One borrow pit and nowhere for the surplus cut to go, allocated nearest-first.
    alignment.engineering!.haul.allocation = 'nearest'
    alignment.engineering!.sites = alignment.engineering!.sites.slice(1, 2)
    const { row, analysis } = assess({ alignment })
    expect(analysis.engineering!.haul.optimizationStatus).toBeUndefined()
    expect(row('earthwork-balance')).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(row('earthwork-balance').result).toMatch(/m³ of waste has no site$/)
  })

  it('reads an infeasible plan as a broken limit, without a volume the model never placed', () => {
    const alignment = unsolved()
    // The economic model must place every cubic metre: with no waste site it has no answer.
    alignment.engineering!.sites = alignment.engineering!.sites.slice(1, 2)
    const { row, analysis } = assess({ alignment })
    expect(analysis.engineering!.haul).toMatchObject({
      optimizationStatus: 'infeasible',
      unallocatedBorrowM3: 0,
      unallocatedWasteM3: 0,
    })
    expect(row('earthwork-balance')).toMatchObject({
      state: 'attention',
      severity: 'limit',
      result: 'The material plan is infeasible: the sites, capacities and rules entered cannot meet every demand',
    })
    expect(row('haul')).toMatchObject({
      state: 'attention',
      result: 'Material supply and construction rules are infeasible',
    })
  })
})

describe('projectReadiness: results that leave out an invalid input', () => {
  const project = (alignment: Alignment) => ({
    settings: DEFAULT_ROAD_SETTINGS,
    standards: undefined,
    terrain: { ...terrain, source: 'imported' } as never,
    context: [] as ContextFeature[],
    drainage: undefined,
    alignments: [alignment],
  })

  it('says so first, cannot read as clear, and judges the inputs the results used', () => {
    const valid = road({ template: { ...DEFAULT_TEMPLATE, leftWidth: 2.5, rightWidth: 2.5 } })
    const edited: Alignment = { ...valid, template: { ...valid.template, leftWidth: 60 } }
    const analysis = safeAnalyzeRoad(edited, hillside, DEFAULT_ROAD_SETTINGS, [], {}, designInputsOf(valid))
    const { rows } = projectReadiness(project(edited), edited, analysis, { drainageStale: false })
    expect(rows[0]).toMatchObject({
      id: 'invalid-input',
      group: 'inputs',
      state: 'attention',
      severity: 'limit',
      result: 'The results leave out 1 invalid input',
      measured: 'Road section: left half-width (m) must be 0.1 to 50. The checks below use its last valid value.',
      action: { label: 'Correct the input', target: 'template' },
    })
    expect(readinessCounts(rows).limits).toBeGreaterThan(0)
    // The template row quotes the 5 m top the sections were calculated with, not the 62.5 m entered.
    const template = rows.find((row) => row.id === 'template')!
    expect(template.measured).toMatch(/^5 m top/)
    // The printed list leads with the same row, under its own heading.
    const report = readinessReportHtml(rows)
    expect(report.indexOf('>Inputs<')).toBeGreaterThan(0)
    expect(report.indexOf('>Inputs<')).toBeLessThan(report.indexOf('>Terrain<'))
    // A road with nothing invalid has no such row.
    const clean = safeAnalyzeRoad(valid, hillside, DEFAULT_ROAD_SETTINGS)
    expect(
      projectReadiness(project(valid), valid, clean, { drainageStale: false }).rows.some(
        (row) => row.group === 'inputs',
      ),
    ).toBe(false)
  })

  it('leads to where each kind of input is corrected', () => {
    const valid = road()
    const edited = structuredClone(valid)
    edited.engineering!.culverts = [culvert({ diameterM: -1 })]
    const analysis = safeAnalyzeRoad(edited, hillside, DEFAULT_ROAD_SETTINGS, [], {}, designInputsOf(valid))
    const { rows } = projectReadiness(project(edited), edited, analysis, { drainageStale: false })
    expect(rows[0]).toMatchObject({ id: 'invalid-input', action: { target: 'culverts' } })
    // The invalid culvert is left out, so no row counts or prices it.
    expect(rows.find((row) => row.id === 'structure-costs')?.state).toBe('not-assessed')
  })

  it('says nothing is calculated when no valid inputs are known', () => {
    const bad = road({ template: { ...DEFAULT_TEMPLATE, cutSlope: 0 } })
    const analysis = safeAnalyzeRoad(bad, hillside, DEFAULT_ROAD_SETTINGS)
    const { rows } = projectReadiness(project(bad), bad, analysis, { drainageStale: false })
    expect(rows[0]).toMatchObject({
      id: 'invalid-input',
      state: 'attention',
      severity: 'limit',
      result: 'Nothing is calculated: an input is invalid',
      measured: 'Road section: cut batter (H:V) must be 0.1 to 10.',
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
