import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  GENERIC_SCHEDULE_ITEMS,
  occurrenceYears,
  parseCostSchedule,
  resolveSchedule,
  scheduleRowProblem,
  summarizeBudget,
  withEntry,
  withoutEntry,
  type CostScheduleState,
} from './costSchedule'
import { BC_PACK } from './costPlaces/packs'
import { projectBudget } from './projectBudget'
import { analyzeRoad } from './engine'
import { parseProject, projectReportHtml, serializeProject } from './project'
import { describeProjectChange } from './projectChangeLabel'
import { createDemoProject, demoTerrain } from './terrain'
import { idleDrivers, parseCostScenarios, scenarioCase } from './costScenarios'
import { createEngineeringDesign } from './engineeringTypes'
import { buildUpSnapshot, calculateBuildUp, parseRateBuildUps, truckCycleMinutes } from './costEvidence/rateBuildUps'

const context = { constructionTotal: 400000, lengthKm: 2.5, mobilizationInEstimate: 0 }

describe('the project budget', () => {
  it('lists every generic item, then the pack’s, and starts each one not assessed', () => {
    const rows = resolveSchedule(undefined, BC_PACK.scheduleItems!, context)
    expect(rows).toHaveLength(GENERIC_SCHEDULE_ITEMS.length + 3)
    expect(rows.every((row) => row.status === 'not-assessed')).toBe(true)
    // Grouped in schedule order, the BC items inside their own groups.
    expect(rows.map((row) => row.group)).toEqual(
      [...rows.map((row) => row.group)].sort(
        (a, b) =>
          ['investigation', 'support', 'environmental', 'contractor', 'owner', 'future'].indexOf(a) -
          ['investigation', 'support', 'environmental', 'contractor', 'owner', 'future'].indexOf(b),
      ),
    )
    expect(rows.find((row) => row.id === 'bc-gst')?.group).toBe('owner')
    const summary = summarizeBudget(rows, context)
    expect(summary).toMatchObject({ construction: 400000, projectItems: 0, projectBudget: 400000 })
    expect(summary.counts['not-assessed']).toBe(rows.length)
  })

  it('reads mobilization as carried by the estimate when the estimate has a mobilization line', () => {
    const rows = resolveSchedule(undefined, [], { ...context, mobilizationInEstimate: 25000 })
    const mobilization = rows.find((row) => row.id === 'mobilization')!
    expect(mobilization).toMatchObject({ status: 'included', derived: 'The construction estimate’s Mobilization line' })
    expect(scheduleRowProblem(mobilization)).toBeNull()
  })

  it('prices lump sums, percentages of construction and per-km amounts, and counts allowances apart', () => {
    let state: CostScheduleState | undefined
    state = withEntry(state, { id: 'survey-layout', status: 'priced', basis: 'per-km', amount: 4000 })
    state = withEntry(state, { id: 'insurance-bonding', status: 'priced', basis: 'percent', percent: 3 })
    state = withEntry(state, { id: 'water-management', status: 'allowance', basis: 'lump-sum', amount: 50000 })
    state = withEntry(state, { id: 'traffic-control', status: 'excluded', reason: 'Road closed during the work' })
    state = withEntry(state, { id: 'overhead-profit', status: 'included', includedIn: 'Contractor unit rates' })
    const rows = resolveSchedule(state, [], context)
    const amount = (id: string) => rows.find((row) => row.id === id)!.amount
    expect(amount('survey-layout')).toBe(10000)
    expect(amount('insurance-bonding')).toBe(12000)
    expect(amount('water-management')).toBe(50000)
    expect(amount('traffic-control')).toBeNull()
    const summary = summarizeBudget(rows, context)
    expect(summary).toMatchObject({ projectItems: 72000, allowances: 50000, projectBudget: 472000 })
    expect(summary.counts).toMatchObject({ priced: 2, allowance: 1, excluded: 1, included: 1 })
    expect(summary.problems).toEqual([])
  })

  it('names what an item still needs before it can be read', () => {
    const state = withEntry(
      withEntry(withEntry(undefined, { id: 'geotechnical', status: 'priced' }), {
        id: 'traffic-control',
        status: 'excluded',
      }),
      { id: 'land-access', status: 'included' },
    )
    const problems = summarizeBudget(resolveSchedule(state, [], context), context).problems
    expect(problems.map(({ row, problem }) => [row.id, problem])).toEqual([
      ['geotechnical', 'Enter its amount, or mark it not assessed.'],
      ['traffic-control', 'Say why it is excluded.'],
      ['land-access', 'Name the line that carries it.'],
    ])
  })

  it('costs future work over the horizon, undiscounted and as a present value, outside the construction budget', () => {
    expect(occurrenceYears({ firstYear: 1, everyYears: 1 }, 5)).toEqual([1, 2, 3, 4, 5])
    expect(occurrenceYears({ firstYear: 4, everyYears: 4 }, 20)).toEqual([4, 8, 12, 16, 20])
    expect(occurrenceYears({ firstYear: 15, everyYears: 0 }, 20)).toEqual([15])
    expect(occurrenceYears({ firstYear: 25, everyYears: 0 }, 20)).toEqual([])
    let state = withEntry(undefined, {
      id: 'maintenance',
      status: 'priced',
      basis: 'per-km',
      amount: 1000,
      recurrence: { firstYear: 1, everyYears: 1 },
    })
    state = withEntry(state, {
      id: 'deactivation',
      status: 'allowance',
      basis: 'lump-sum',
      amount: 30000,
      recurrence: { firstYear: 10, everyYears: 0 },
    })
    state = { ...state, lifecycle: { horizonYears: 10, discountRatePercent: 4 } }
    const rows = resolveSchedule(state, [], context)
    const summary = summarizeBudget(rows, context, state.lifecycle)
    expect(summary.projectBudget).toBe(400000)
    expect(summary.lifecycle.undiscounted).toBe(2500 * 10 + 30000)
    const annuity = (1 - 1.04 ** -10) / 0.04
    expect(summary.lifecycle.presentValue).toBeCloseTo(2500 * annuity + 30000 / 1.04 ** 10, 6)
    // A future item priced without timing is a problem, not a year-0 cost.
    const untimed = withEntry(undefined, { id: 'inspections', status: 'priced', amount: 500 })
    expect(summarizeBudget(resolveSchedule(untimed, [], context), context).problems[0].problem).toMatch(
      /first falls due/,
    )
  })

  it('keeps custom items, resets template items, and drops an empty schedule from the file', () => {
    let state = withEntry(undefined, {
      id: 'custom-a',
      group: 'support',
      label: 'Helicopter crew moves',
      status: 'priced',
      amount: 12000,
    })
    state = withEntry(state, { id: 'design', status: 'priced', amount: 20000 })
    const rows = resolveSchedule(state, [], context)
    expect(rows.find((row) => row.id === 'custom-a')).toMatchObject({ custom: true, group: 'support', amount: 12000 })
    expect(withoutEntry(state, 'design')!.entries.map((e) => e.id)).toEqual(['custom-a'])
    expect(withoutEntry(withoutEntry(state, 'design'), 'custom-a')).toBeUndefined()
    expect(parseCostSchedule(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(() => parseCostSchedule({ entries: [{ id: 'x', status: 'maybe' }] })).toThrow(/status/)
    expect(() => parseCostSchedule({ entries: [{ id: 'x', status: 'priced', label: 'Orphan' }] })).toThrow(
      /group and a name/,
    )
    expect(() => parseCostSchedule({ entries: [], lifecycle: { horizonYears: 0, discountRatePercent: 3 } })).toThrow(
      /horizon/,
    )
  })
})

describe('the budget in the project and the report', () => {
  it('stays out of a project that never set one, and the report says what is not assessed', () => {
    const project = createDemoProject()
    const restored = parseProject(JSON.parse(serializeProject(project)))
    for (const key of ['costLocation', 'costSchedule', 'rateBuildUps', 'costScenarios'])
      expect(key in restored).toBe(false)
    const active = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    const report = projectReportHtml(project, analyzeRoad(active, demoTerrain, project.settings))
    expect(report).toContain('<dt>Cost location</dt><dd data-cost-location>Not set.')
    expect(report).toContain('data-project-budget')
    expect(report).toMatch(/\d+ items are not assessed: the budget leaves them out/)
  })

  it('round-trips location, budget, build-ups and scenarios, names the edit, and prints them', () => {
    const base = createDemoProject()
    const project = {
      ...base,
      costLocation: {
        place: { country: 'CA', subdivision: 'CA-BC', region: 'bc-nr:omineca' },
        basis: 'road-location' as const,
        setOn: '2026-11-14',
      },
      costSchedule: withEntry(undefined, { id: 'bc-gst', status: 'priced', basis: 'percent', percent: 5 }),
      rateBuildUps: [
        {
          id: 'b1',
          name: 'Excavator crew',
          kind: 'equipment' as const,
          equipment: { allInCrewCadPerHour: 240, netBankM3PerHour: 60 },
          quote: 'Rate card 2026',
          savedOn: '2026-11-14',
        },
      ],
      costScenarios: { drivers: { 'excavation-rate': { low: 0.9, high: 1.25 } }, note: 'Two test pits' },
    }
    expect(describeProjectChange(base, { ...base, costLocation: project.costLocation })).toMatch(/Cost location/)
    expect(describeProjectChange(base, { ...base, costSchedule: project.costSchedule })).toMatch(/Project budget/)
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.costLocation).toEqual(project.costLocation)
    expect(restored.costSchedule).toEqual(project.costSchedule)
    expect(restored.rateBuildUps).toEqual(project.rateBuildUps)
    expect(restored.costScenarios).toEqual(project.costScenarios)
    const active = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    const analysis = analyzeRoad(active, demoTerrain, project.settings)
    const report = projectReportHtml(project, analysis)
    expect(report).toContain(
      'Omineca, British Columbia, Canada · amounts in CAD · accepted from the road’s location 2026-11-14',
    )
    expect(report).toContain(
      'Excavator crew (Equipment and crew): 240/h ÷ 60 bank m³ an hour = 4 per bank m³; inputs from Rate card 2026',
    )
    expect(report).toContain('Excavation productivity × 0.9 low, × 1.25 high')
    expect(report).toContain('data-budget-row="bc-gst"')
    const gst = projectBudget(project, analysis).rows.find((row) => row.id === 'bc-gst')!
    expect(gst.amount).toBeCloseTo(analysis.estimatedCost * 0.05, 6)
  })
})

describe('low and high cases', () => {
  const base = createDemoProject()
  const active = base.alignments.find((a) => a.id === base.activeAlignmentId)!
  const road = {
    ...active,
    engineering: {
      ...createEngineeringDesign(),
      materials: [
        { id: 'till', name: 'Till', color: '#000', cutRate: 10, reusableFraction: 0.8, compactionFactor: 0.9 },
        {
          id: 'rock',
          name: 'Rock',
          color: '#111',
          cutRate: 40,
          reusableFraction: 1,
          compactionFactor: 1.3,
          rock: true,
        },
      ],
      strata: [{ id: 's', start: 0, end: 2000, materialId: 'rock', topDepthM: 2, bottomDepthM: null }],
      haul: { ...createEngineeringDesign().haul, overhaulRate: 2 },
    },
  }

  it('scales only what each driver names, on a copy, and lists what changed', () => {
    const scenario = {
      drivers: {
        'excavation-rate': { low: 0.9, high: 1.2 },
        'rock-depth': { low: 1.5, high: 0.5 },
        'reusable-cut': { low: 1.5, high: 0.5 },
        'clearing-rate': { low: 1, high: 1 },
      },
    }
    const high = scenarioCase(base.settings, road, scenario, 'high')
    expect(high.settings.cutRate).toBeCloseTo(base.settings.cutRate * 1.2, 10)
    expect(high.settings.clearingRate).toBe(base.settings.clearingRate)
    const e = high.alignment.engineering!
    expect(e.materials.map((m) => m.cutRate)).toEqual([12, 40])
    expect(e.strata[0].topDepthM).toBe(1)
    expect(e.materials[0].reusableFraction).toBeCloseTo(0.4, 10)
    expect(high.applied).toEqual([
      'Excavation productivity × 1.2',
      'Depth to rock × 0.5',
      'Suitable share of cut × 0.5',
    ])
    const low = scenarioCase(base.settings, road, scenario, 'low')
    // A reusable share is capped at the whole of the cut.
    expect(low.alignment.engineering!.materials.map((m) => m.reusableFraction)).toEqual([1, 1])
    expect(road.engineering.materials[0].cutRate).toBe(10)
    // The haul driver needs haul turned on, and structures need a culvert.
    expect(
      idleDrivers(road, { drivers: { 'haul-rate': { low: 1, high: 2 }, structures: { low: 1, high: 2 } } }),
    ).toEqual(['haul-rate', 'structures'])
  })

  it('moves the analysed estimate the way the bounds say', () => {
    const scenario = { drivers: { 'excavation-rate': { low: 0.5, high: 2 }, 'clearing-rate': { low: 0.5, high: 2 } } }
    const run = (which: 'low' | 'high') => {
      const c = scenarioCase(base.settings, active, scenario, which)
      return analyzeRoad(c.alignment, demoTerrain, c.settings).estimatedCost
    }
    const middle = analyzeRoad(active, demoTerrain, base.settings).estimatedCost
    expect(run('low')).toBeLessThan(middle)
    expect(run('high')).toBeGreaterThan(middle)
  })

  it('is stored as bounds only, and refuses a bound outside its range', () => {
    expect(parseCostScenarios({ drivers: { 'haul-rate': { low: 0.9, high: 1.3 } } })).toEqual({
      drivers: { 'haul-rate': { low: 0.9, high: 1.3 } },
    })
    expect(() => parseCostScenarios({ drivers: { 'haul-rate': { low: 0, high: 1.3 } } })).toThrow(/0\.1 to 5/)
    expect(() => parseCostScenarios({ drivers: { luck: { low: 1, high: 1 } } })).toThrow(/not one PGMaps runs/)
  })
})

describe('saved build-ups', () => {
  it('works a truck cycle out from its parts and shows the arithmetic', () => {
    const parts = { loadMinutes: 6, haulKm: 12, loadedKmh: 40, unloadMinutes: 4, emptyKmh: 60, queueMinutes: 2 }
    expect(truckCycleMinutes(parts)).toBe(42)
    expect(truckCycleMinutes({ ...parts, emptyKmh: null })).toBeNull()
    const result = calculateBuildUp({
      kind: 'truck-cycle',
      truck: {
        allInRateCadPerHour: 165,
        cycleMinutes: null,
        compactedPayloadM3: 10,
        parts: { ...parts, queueMinutes: null },
      },
    })
    expect(result.result.valid).toBe(false)
    expect(result.result.errors[0]).toBe('Enter every part of the cycle.')
    const material = calculateBuildUp({
      kind: 'material',
      material: { quoteUnit: 'tonne', priceCad: 18, tonnesPerCompactedM3: 2.1, looseM3PerCompactedM3: null },
    })
    expect(material.formula).toBe('18/t × 2.1 t per compacted m³ = 37.8 per compacted m³')
  })

  it('round-trips, and refuses a broken one', () => {
    const buildUp = {
      id: 'b',
      name: 'Crew',
      kind: 'equipment' as const,
      equipment: { allInCrewCadPerHour: 240, netBankM3PerHour: null },
      savedOn: '2026-11-14',
    }
    expect(parseRateBuildUps([buildUp])).toEqual([buildUp])
    expect(buildUpSnapshot(buildUp)).toBeNull()
    expect(parseRateBuildUps([])).toBeUndefined()
    expect(() => parseRateBuildUps([{ ...buildUp, kind: 'guess' }])).toThrow(/kind/)
    expect(() => parseRateBuildUps([buildUp, buildUp])).toThrow(/distinct/)
  })
})

describe('the evidence catalogue build', () => {
  it('rebuilds byte for byte from the inputs kept in the repository', () => {
    // Throws, failing the test, when a generated file differs from a rebuild or an input fails its checksum.
    const out = execFileSync('node', ['scripts/forestry/cost-evidence/build-catalogue.mjs', '--check'], {
      encoding: 'utf8',
    })
    expect(out).toContain('The generated catalogue matches its inputs.')
  }, 30000)
})
