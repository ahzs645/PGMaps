import { describe, expect, it } from 'vitest'
import reference from '../../../scripts/forestry-castor/reference/sql-reference.json'
import { runCastor } from './engine'
import { applyYield, growthYears, interpolateYield } from './growth'
import { canApplyEcaChange, evaluateConstraints, matchesPredicate, rankConstraintIndices } from './constraints'
import {
  DEFAULT_CASTOR_CONFIG,
  type CastorConfig,
  type CastorConstraint,
  type CastorPixel,
  type CastorPredicate,
  type CastorProject,
  type CastorYieldCurve,
} from './types'
import { validateCastorProject } from './validation'

const pixel = (id: number, values: Partial<CastorPixel> = {}): CastorPixel => ({
  id,
  blockId: String(id),
  compartment: 'A',
  areaHa: 1,
  thlbHa: 1,
  owned: true,
  age: 100,
  volume: 100,
  height: 20,
  eca: 0.1,
  distance: 1000,
  salvageVolume: 0,
  zones: { zone1: '1' },
  ...values,
})
const project = (pixels: CastorPixel[], values: Partial<CastorProject> = {}): CastorProject => ({
  schema: 'pgmaps-castor-project-v1',
  name: 'Numerical fixture',
  description: 'Synthetic unit/reference case.',
  provenance: { source: 'Unit fixture', notes: [], synthetic: true },
  pixels,
  yieldCurves: [],
  constraints: [],
  harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 100, type: 'live' }],
  adjacency: [],
  landings: [],
  ...values,
})
const config = (values: Partial<CastorConfig> = {}): CastorConfig => ({
  ...DEFAULT_CASTOR_CONFIG,
  periods: 1,
  initializeFromYield: false,
  ...values,
})
const constantCurve = (id: string, volume: number, height = 20): CastorYieldCurve => ({
  id,
  points: [
    { age: 0, volume, height, eca: 0.1 },
    { age: 200, volume, height, eca: 0.1 },
  ],
})

describe('independent pinned SQL references', () => {
  const constraintPixels = reference.constraintPixels.map((row) =>
    pixel(row.pixelid, {
      owned: row.own === 1,
      age: row.age,
      thlbHa: row.thlb,
      distance: row.dist,
      eca: row.eca,
      crownClosure: row.crownclosure,
      zones: { zone1: String(row.zone1) },
    }),
  )
  for (const entry of reference.constraints)
    it(`reproduces source candidate ordering: ${entry.id}`, () => {
      const condition: CastorPredicate | undefined =
        entry.id === 'ge-multi'
          ? {
              all: [
                { field: 'age', op: 'ge', value: 120 },
                { field: 'crownClosure', op: 'ge', value: 60 },
              ],
            }
          : entry.id === 'le-multi'
            ? {
                any: [
                  { field: 'age', op: 'le', value: 50 },
                  { field: 'crownClosure', op: 'lt', value: 40 },
                ],
              }
            : undefined
      const constraint: CastorConstraint = {
        id: entry.id,
        zone: 'zone1',
        zoneId: '1',
        type: entry.type as 'ge' | 'le',
        variable: entry.variable === 'dist' ? 'distance' : entry.variable,
        threshold: entry.threshold,
        percentage: entry.percentage,
        condition,
      }
      const mask = new Uint8Array(constraintPixels.length)
      if ('initialProtected' in entry) for (const id of entry.initialProtected ?? []) mask[id - 1] = 1
      const candidates = constraintPixels
        .map((_, i) => i)
        .filter(
          (i) =>
            constraintPixels[i].owned &&
            constraintPixels[i].zones.zone1 === '1' &&
            (!('denominator' in entry) || constraintPixels[i].thlbHa > 0),
        )
      const selected = rankConstraintIndices(constraintPixels, candidates, constraint, mask)
        .slice(0, entry.limitCells)
        .map((i) => constraintPixels[i].id)
      expect(selected).toEqual(entry.selectedPixelIds)
    })
  for (const row of reference.rMidpointRounding)
    it(`uses R ties-to-even first growth step for ${row.periodLength} years`, () => {
      expect(growthYears(config({ stepYears: row.periodLength }), 1)).toBe(row.initialIncrement)
      expect(growthYears(config({ stepYears: row.periodLength }), 2)).toBe(row.periodLength)
    })
  const curve: CastorYieldCurve = {
    id: '1',
    points: reference.growth.yieldRows.map((row) => ({
      age: row.age,
      volume: row.tvol,
      height: row.height,
      eca: row.eca,
      basalArea: row.basalarea,
      qmd: row.qmd,
      crownClosure: row.crownclosure,
    })),
  }
  for (const row of reference.growth.expected.filter((row) => row.vol !== null))
    it(`matches actual growth SQL at fixture pixel ${row.pixelid}`, () => {
      const age = reference.growth.pixels.find((input) => input.pixelid === row.pixelid)!.age
      const state = pixel(row.pixelid, { age, deciduousPercent: 0 })
      applyYield(state, curve)
      for (const [field, expected] of Object.entries({
        volume: row.vol,
        height: row.ht,
        eca: row.eca,
        deciduousPercent: row.dec_pcnt,
        crownClosure: row.crownclosure,
        basalArea: row.basalarea,
        qmd: row.qmd,
      }))
        expect(state[field as keyof CastorPixel]).toBeCloseTo(expected!, 10)
    })
  it('explicitly corrects the missing upper-knot / NULL-volume endpoint', () => {
    const last = curve.points[curve.points.length - 1]
    expect(reference.growth.expected.find((row) => row.pixelid === 11)?.vol).toBeNull()
    expect(interpolateYield(curve, last.age).volume).toBe(last.volume)
    expect(interpolateYield(curve, last.age + 100).volume).toBe(last.volume)
  })
  for (const row of reference.queue.cases)
    it(`matches cumulative prefix selection for ${row.targetM3} m³`, () => {
      const input = project(
        reference.queue.rows.map((value) => pixel(value.pixelid, { volume: value.vol_h })),
        { harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: row.targetM3, type: 'live' }] },
      )
      expect(
        runCastor(input, config({ blockPriority: [{ field: 'id', direction: 'asc' }] })).harvestPixelList.map(
          (value) => value.pixelId,
        ),
      ).toEqual(row.pixelIds)
    })
})

describe('harvest accounting and management safeguards', () => {
  it('uses THLB hectares and true annual rates without mutating input', () => {
    const input = project([pixel(1, { areaHa: 0.5, thlbHa: 0.25 }), pixel(2, { areaHa: 2, thlbHa: 1.5, age: 50 })], {
      harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 175, type: 'live' }],
    })
    const original = JSON.stringify(input)
    const result = runCastor(input, config())
    expect(JSON.stringify(input)).toBe(original)
    expect(result.harvestReport[0]).toMatchObject({
      volumeM3: 175,
      areaHa: 1.75,
      annualVolumeM3: 35,
      annualAreaHa: 0.35,
      meanBlockAreaHa: 0.875,
    })
    expect(result.harvestReport[0].meanAge).toBeCloseTo((102 * 0.25 + 52 * 1.5) / 1.75)
    expect(result.summary.finalStockM3).toBe(0)
    expect(result.harvestBlockList.reduce((sum, row) => sum + row.volumeM3, 0)).toBe(175)
    expect(result.snapshots[1].harvestedVolumeM3).toEqual([25, 150])
  })
  it('removes the arbitrary upstream target/50 candidate cap', () => {
    const input = project([pixel(1, { volume: 20 })], {
      harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 20, type: 'live' }],
    })
    expect(runCastor(input, config()).summary.harvestedM3).toBe(20)
  })
  it('deduplicates overlapping partitions and keeps an unmet flow visible', () => {
    const input = project([pixel(1, { volume: 40 }), pixel(2, { volume: 60 })], {
      harvestFlows: [1, 2].map((i) => ({ id: `flow${i}`, compartment: 'A', period: 1, targetM3: 100, type: 'live' })),
    })
    const result = runCastor(input, config())
    expect(result.harvestPixelList).toHaveLength(2)
    expect(result.harvestReport.map((row) => row.volumeM3)).toEqual([100, 0])
    expect(result.summary).toMatchObject({ harvestedM3: 100, targetM3: 200, shortfallM3: 100 })
  })
  it('scopes the current growing-stock floor to each compartment', () => {
    const input = project(
      [1, 2, 3, 4].map((id) => pixel(id, { volume: 40 })).concat(pixel(5, { compartment: 'B', volume: 1000 })),
      { harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 200, type: 'live' }] },
    )
    const result = runCastor(input, config({ growingStockRetention: 0.5 }))
    expect(result.harvestReport[0]).toMatchObject({ effectiveTargetM3: 80, volumeM3: 80, shortfallM3: 120 })
    expect(
      result.growingStockReport.find((row) => row.phase === 'after-harvest' && row.compartment === 'A')?.stockM3,
    ).toBe(80)
    expect(result.finalPixels[4].volume).toBe(1000)
  })
  it('never harvests unowned pixels', () => {
    const result = runCastor(project([pixel(1, { owned: false, age: 200 }), pixel(2)]), config())
    expect(result.harvestPixelList.map((row) => row.pixelId)).toEqual([2])
  })
  it('supports whole-block target limits without silently splitting a block', () => {
    const input = project(
      [
        pixel(1, { blockId: 'A', volume: 30 }),
        pixel(2, { blockId: 'A', volume: 30 }),
        pixel(3, { blockId: 'B', volume: 40 }),
      ],
      { harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 50, type: 'live' }] },
    )
    expect(runCastor(input, config({ harvestUnit: 'block' })).summary.harvestedM3).toBe(0)
    expect(runCastor(input, config({ harvestUnit: 'pixel' })).summary.harvestedM3).toBe(30)
    input.harvestFlows[0].targetM3 = 60
    expect(runCastor(input, config({ harvestUnit: 'block' })).harvestPixelList.map((row) => row.pixelId)).toEqual([
      1, 2,
    ])
  })
  it('prevents new same-period adjacent clearcuts', () => {
    const input = project([pixel(1, { age: 200 }), pixel(2), pixel(3, { age: 50 })], {
      adjacency: [['1', '2']],
      harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 200, type: 'live' }],
    })
    const result = runCastor(input, config({ adjacencyHeight: 3 }))
    expect(result.harvestPixelList.map((row) => row.pixelId)).toEqual([1, 3])
    expect(result.snapshots[1].constrained[1]).toBe(1)
    expect(result.snapshots[1].constrainedYears[1]).toBe(5)
  })
  it('protects existing low-height blocks and their neighbours', () => {
    const input = project([pixel(1, { height: 2, volume: 0 }), pixel(2), pixel(3)], { adjacency: [['1', '2']] })
    const result = runCastor(input, config({ adjacencyHeight: 3 }))
    expect(result.harvestPixelList.map((row) => row.pixelId)).toEqual([3])
    expect(result.snapshots[1].constrained.slice(0, 2)).toEqual([1, 1])
  })
  it('reports blocked scheduled work as a shortfall instead of bypassing protection', () => {
    const input = project([pixel(1)], {
      constraints: [{ id: 'reserve', type: 'nh', zone: 'zone1', zoneId: '1' }],
      schedule: [{ period: 1, pixelIds: [1] }],
    })
    const result = runCastor(input, config({ mode: 'schedule' }))
    expect(result.summary).toMatchObject({ targetM3: 100, harvestedM3: 0, shortfallM3: 100 })
    expect(result.finalPixels[0].volume).toBe(100)
  })
  it('uses elapsed years consistently for constraint windows', () => {
    const input = project([pixel(1)], {
      constraints: [{ id: 'reserve', type: 'nh', zone: 'zone1', zoneId: '1', startYear: 5, stopYear: 10 }],
      harvestFlows: [1, 2, 3].map((period) => ({
        id: `flow${period}`,
        compartment: 'A',
        period,
        targetM3: 100,
        type: 'live',
      })),
    })
    const result = runCastor(input, config({ periods: 3 }))
    expect(result.harvestPixelList.map((row) => row.elapsedYears)).toEqual([15])
    expect(result.snapshots[3].constrainedPeriods).toEqual([2])
    expect(result.snapshots[3].constrainedYears).toEqual([10])
  })
  it('does not make an existing old stand younger at the maximum yield age', () => {
    const result = runCastor(project([pixel(1, { age: 400 })], { harvestFlows: [] }), config({ maxYieldAge: 350 }))
    expect(result.finalPixels[0].age).toBe(400)
  })
})

describe('partial cutting, salvage, and spatial state', () => {
  it('regrows a clearcut on its managed curve and keeps legacy attributes current', () => {
    const input = project(
      [
        pixel(1, {
          age: 50,
          curveId: '1',
          managedCurveId: '2',
          attributes: { yieldid: 1, yieldid_trans: 2, vol: 100 },
        }),
      ],
      {
        yieldCurves: [
          {
            id: '1',
            points: [
              { age: 0, volume: 0, height: 0, eca: 1 },
              { age: 100, volume: 200, height: 20, eca: 0.1 },
            ],
          },
          {
            id: '2',
            points: [
              { age: 0, volume: 0, height: 0, eca: 1 },
              { age: 100, volume: 500, height: 30, eca: 0.1 },
            ],
          },
        ],
        harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 104, type: 'live' }],
      },
    )
    const result = runCastor(input, config({ periods: 2 }))
    expect(result.harvestReport[0].volumeM3).toBe(104)
    expect(result.finalPixels[0]).toMatchObject({
      age: 5,
      volume: 25,
      curveId: '2',
      attributes: { yieldid: 2, vol: 25 },
    })
    expect(result.snapshots[2].harvestedYear).toEqual([2030])
    expect(result.snapshots[2].harvestedVolumeM3).toEqual([104])
    expect(result.summary.finalStockM3).toBe(25)
  })
  it('accounts for partial cutting with a post-treatment yield transition and one landing', () => {
    const input = project(
      [
        pixel(1, {
          areaHa: 2,
          thlbHa: 2,
          age: 50,
          volume: 200,
          curveId: 'before',
          managedCurveId: 'after',
          treatmentId: 'thin',
          attributes: { silvsystem: 2, yieldid: 1, yieldid_trans: 2 },
        }),
      ],
      {
        yieldCurves: [constantCurve('before', 200), constantCurve('after', 100), constantCurve('future', 120)],
        treatments: [
          {
            id: 'thin',
            method: 'curve-transition',
            condition: { field: 'age', op: 'ge', value: 50 },
            nextCurveId: 'after',
            nextManagedCurveId: 'future',
            nextSilviculturalSystem: 1,
          },
        ],
        harvestFlows: [{ id: 'flow', compartment: 'A', period: 1, targetM3: 300, type: 'live' }],
      },
    )
    const result = runCastor(input, config({ periods: 2 }))
    expect(result.harvestPixelList).toHaveLength(1)
    expect(result.harvestPixelList[0]).toMatchObject({ type: 'partial', volumeM3: 200, removeFraction: 0.5, areaHa: 2 })
    expect(result.harvestReport[0]).toMatchObject({
      volumeM3: 200,
      transitionVolumeM3: 200,
      transitionAreaHa: 2,
      shortfallM3: 100,
    })
    expect(result.finalPixels[0]).toMatchObject({
      age: 57,
      volume: 100,
      curveId: 'after',
      managedCurveId: 'future',
      attributes: { silvsystem: 1, yieldid: 'after', yieldid_trans: 'future' },
    })
    expect(result.landings).toHaveLength(1)
    expect(result.landings[0].source).toBe('harvest-pixel')
  })
  it('keeps a user-specified retained-volume fraction through subsequent growth', () => {
    const input = project([pixel(1, { volume: 200, curveId: 'constant', treatmentId: 'thin' })], {
      yieldCurves: [constantCurve('constant', 200)],
      treatments: [
        { id: 'thin', method: 'fraction', condition: { field: 'age', op: 'ge', value: 10 }, removeFraction: 0.3 },
      ],
    })
    const result = runCastor(input, config({ periods: 2 }))
    expect(result.summary.harvestedM3).toBe(60)
    expect(result.finalPixels[0].volume).toBe(140)
    expect(result.assumptions.some((note) => note.includes('user-supplied sensitivity'))).toBe(true)
  })
  it('refuses a yield transition that would produce negative harvested volume', () => {
    const input = project([pixel(1, { treatmentId: 'invalid' })], {
      yieldCurves: [constantCurve('higher', 150)],
      treatments: [{ id: 'invalid', nextCurveId: 'higher', condition: { field: 'age', op: 'ge', value: 1 } }],
    })
    const result = runCastor(input, config())
    expect(result.summary.harvestedM3).toBe(0)
    expect(result.warnings.some((note) => note.includes('negative removed volume'))).toBe(true)
  })
  it('charges live stock removed during full salvage to the retention floor', () => {
    const input = project([pixel(1, { volume: 20, salvageVolume: 100 })], {
      harvestFlows: [{ id: 'dead', compartment: 'A', period: 1, targetM3: 100, type: 'salvage' }],
    })
    expect(runCastor(input, config({ growingStockRetention: 1 })).summary.harvestedM3).toBe(0)
    const result = runCastor(input, config())
    expect(result.salvageReport[0]).toMatchObject({ availableM3: 100, harvestedM3: 100, remainingM3: 0, areaHa: 1 })
    expect(result.summary.finalStockM3).toBe(0)
    expect(result.warnings.some((note) => note.includes('Live-stock loss'))).toBe(true)
  })
  it('keeps live trees during a fractional salvage entry', () => {
    const input = project([pixel(1, { volume: 20, salvageVolume: 100 })], {
      schedule: [{ period: 1, pixelIds: [1], type: 'salvage', removeFraction: 0.5 }],
    })
    const result = runCastor(input, config({ mode: 'schedule', growingStockRetention: 1 }))
    expect(result.finalPixels[0]).toMatchObject({ volume: 20, salvageVolume: 50, height: 20 })
    expect(result.salvageReport[0]).toMatchObject({ availableM3: 100, harvestedM3: 50, remainingM3: 50 })
  })
  it('updates new-harvest proximity in projected metres while retaining imported historical distance', () => {
    const input = project(
      [pixel(1, { x: 0, y: 0, age: 200 }), pixel(2, { x: 3, y: 4 }), pixel(3, { x: 6, y: 8, distance: 2 })],
      { crs: 'EPSG:3005' },
    )
    const result = runCastor(input, config({ updateDistance: true }))
    expect(result.finalPixels.map((value) => value.distance)).toEqual([0, 5, 2])
    expect(result.assumptions.some((note) => note.includes('does not implement disturbanceCastor'))).toBe(true)
  })
})

describe('constraints, reproducibility, and input integrity', () => {
  it('protects whole areas conservatively for nonuniform pixel sizes', () => {
    const pixels = [pixel(1, { areaHa: 3, thlbHa: 3, age: 200 }), pixel(2, { areaHa: 1, thlbHa: 1, age: 50 })]
    const evaluated = evaluateConstraints(
      pixels,
      [{ id: 'old', zone: 'zone1', zoneId: '1', type: 'ge', variable: 'age', threshold: 100, percentage: 50 }],
      5,
    )
    expect([...evaluated.protectedMask]).toEqual([1, 0])
  })
  it('reports old-growth compliance before and after harvest', () => {
    const input = project(
      [pixel(1, { age: 200 }), pixel(2, { age: 180 }), pixel(3, { age: 50 }), pixel(4, { age: 40 })],
      {
        constraints: [
          { id: 'old', zone: 'zone1', zoneId: '1', type: 'ge', variable: 'age', threshold: 120, percentage: 50 },
        ],
      },
    )
    const result = runCastor(input, config())
    expect(result.harvestPixelList[0].pixelId).toBe(3)
    expect(result.zoneManagement.map((row) => [row.phase, row.actualPercent, row.met])).toEqual([
      ['before-harvest', 50, true],
      ['after-harvest', 50, true],
    ])
  })
  it('guards the actual ECA budget and clamps overdrawn reservation limits', () => {
    const pixels = [pixel(1), pixel(2)]
    const constraints: CastorConstraint[] = [
      { id: 'watershed', zone: 'zone1', zoneId: '1', type: 'le', variable: 'eca', threshold: 50, percentage: 100 },
    ]
    expect(canApplyEcaChange(pixels, [{ index: 0, eca: 1 }], constraints, 5)).toBe(false)
    constraints[0].threshold = 60
    expect(canApplyEcaChange(pixels, [{ index: 0, eca: 1 }], constraints, 5)).toBe(true)
    pixels[0].eca = 1
    pixels[1].eca = 1
    constraints[0].threshold = 10
    expect([...evaluateConstraints(pixels, constraints, 5).protectedMask]).toEqual([1, 1])
  })
  it('evaluates only explicit structured predicates without numeric/string coercion', () => {
    expect(
      matchesPredicate(pixel(1), {
        all: [{ field: 'age', op: 'ge', value: 80 }, { not: { field: 'compartment', op: 'eq', value: 'B' } }],
      }),
    ).toBe(true)
    expect(matchesPredicate(pixel(1), { field: 'age', op: 'eq', value: '100' })).toBe(false)
    expect(matchesPredicate(pixel(1), { not: { field: 'basalArea', op: 'ge', value: 20 } })).toBe(false)
    expect(
      matchesPredicate(pixel(1), {
        any: [
          { field: 'basalArea', op: 'ge', value: 20 },
          { field: 'age', op: 'ge', value: 20 },
        ],
      }),
    ).toBe(true)
  })
  it('provides deterministic seeded sensitivity, with an exact zero-CV case', () => {
    const input = project([pixel(1)])
    const settings = config({ uncertainty: { enabled: true, replicates: 200, coefficientOfVariation: 0.3, seed: 123 } })
    const result = runCastor(input, settings)
    expect(runCastor(input, settings).uncertainty).toEqual(result.uncertainty)
    expect(result.uncertainty[0].p05M3).toBeLessThan(result.uncertainty[0].medianM3)
    expect(result.uncertainty[0].medianM3).toBeLessThan(result.uncertainty[0].p95M3)
    expect(runCastor(input, config({ uncertainty: { ...settings.uncertainty, seed: 124 } })).uncertainty).not.toEqual(
      result.uncertainty,
    )
    expect(
      runCastor(input, config({ uncertainty: { ...settings.uncertainty, coefficientOfVariation: 0 } })).uncertainty[0],
    ).toMatchObject({ p05M3: 100, medianM3: 100, p95M3: 100, probabilityTarget: 1 })
  })
  it('supports cooperative cancellation without returning a partial result', () => {
    expect(() => runCastor(project([pixel(1)]), config(), { shouldCancel: () => true })).toThrow('cancelled')
  })
  it.each([
    null,
    {},
    { pixels: null },
    { ...project([pixel(1)]), constraints: [null] },
    { ...project([pixel(1)]), treatments: [{ id: 'bad', condition: null }] },
  ])('rejects malformed nested data without an unhandled TypeError', (value) => {
    expect(validateCastorProject(value, config()).errors.length).toBeGreaterThan(0)
  })
  it('rejects duplicate ids, missing curves, malformed expressions, and non-metre distance contexts', () => {
    expect(
      validateCastorProject(project([pixel(1), pixel(1)]), config()).errors.some((error) =>
        error.message.includes('Duplicate pixel'),
      ),
    ).toBe(true)
    expect(
      validateCastorProject(project([pixel(1, { curveId: 'missing' })]), config()).errors.some((error) =>
        error.path.endsWith('curveId'),
      ),
    ).toBe(true)
    const input = project([pixel(1, { x: 0, y: 0 })], {
      crs: 'EPSG:4326',
      harvestFlows: [
        {
          id: 'flow',
          compartment: 'A',
          period: 1,
          targetM3: 100,
          type: 'live',
          condition: { field: 'constructor', op: 'eq', value: 1 },
        },
      ],
    })
    expect(validateCastorProject(input, config({ updateDistance: true })).errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(['crs', 'harvestFlows[0].condition.field']),
    )
  })
  it('rejects invalid WGS84 coordinates and open polygon rings', () => {
    const input = project([pixel(1, { geometry: { type: 'Point', coordinates: [181, 53] } })])
    expect(validateCastorProject(input, config()).errors.some((error) => error.path.includes('geometry'))).toBe(true)
    input.pixels[0].geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    }
    expect(validateCastorProject(input, config()).errors.some((error) => error.message.includes('close'))).toBe(true)
    input.pixels[0].geometry = { type: 'Point', coordinates: [-122.75, 53.91] }
    expect(validateCastorProject(input, config()).errors).toEqual([])
  })
  it('rejects malformed display metadata and executable provenance links', () => {
    const input = project([pixel(1)])
    const result = validateCastorProject(
      {
        ...input,
        provenance: { source: 'Source', notes: [], revision: {}, synthetic: 'false', url: 'javascript:alert(1)' },
      },
      config(),
    )
    expect(result.errors.map((error) => error.path)).toEqual(
      expect.arrayContaining(['provenance.revision', 'provenance.synthetic', 'provenance.url']),
    )
  })
  it('rejects unsafe volume magnitudes and overflowing priority aggregates', () => {
    const unsafe = project([pixel(1, { volume: 1e308, areaHa: 1e6, thlbHa: 1e6 })])
    expect(() => runCastor(unsafe, config())).toThrow(/volume/)
    const priority = project([pixel(1, { areaHa: 1e6, thlbHa: 1, attributes: { customPriority: 1e308 } })])
    expect(() =>
      runCastor(priority, config({ blockPriority: [{ field: 'customPriority', direction: 'desc' }] })),
    ).toThrow(/overflows area-weighted averaging/)
  })
})
