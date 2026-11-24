import { describe, expect, it } from 'vitest'
import benchmark from '../observations/fpb-irc-235.json'
import regional from '../packs/bc-pgtsa-biodiversity.json'
import { parsePack } from '../src/contract'
import { assess } from '../engine/evaluate'
import { patchDistributionDistance, screenOldForestTarget } from '../src/screen.mjs'
import { analyze } from '../../../src/pages/forest-patches/analysis'
import { patchFacts } from '../../../src/pages/forest-patches/legalEvidence'
import { bins, exampleProject, movementTowardTarget, order, table } from '../../../src/pages/forest-patches/project'

const pack = parsePack(regional)
function review(facts: Record<string, boolean | null>, date = '2019-12-31') {
  return assess(
    date,
    [pack],
    [
      {
        format: 'pgmaps-legal-facts/v1',
        pack: pack.id,
        version: pack.version,
        source: 'Test of the historical instrument',
        facts: Object.entries(facts).map(([id, value]) => ({ id, value })),
      },
    ],
  )
}

describe('Prince George Forest District, Board Appendix 1, 2019', () => {
  it('reproduces the 25 published unit rows, including both old-forest deficits', () => {
    const deficits: Record<string, number> = {}
    const board = benchmark.oldForest2019.units.filter((r) => r.district === 'Prince George')
    const units = order.oldAndInteriorForest.filter((u) => u.district === 'Prince George')
    expect(board.map((r) => r.unit)).toEqual(units.map((u) => u.unit))
    for (const row of board) {
      const unit = units.find((u) => u.unit === row.unit)!
      expect([unit.oldForestMinPct, unit.interiorOfRequiredOldForestMinPct], unit.unit).toEqual([
        row.oldPercent,
        row.interiorPercent,
      ])
      const screen = screenOldForestTarget(unit, {
        cflbAreaHa: row.cflbHa,
        qualifyingOldForestHa: row.oldHa,
        qualifyingOldInteriorForestHa: row.interiorHa,
      })
      expect(screen.bindingDecision).toBe(false)
      // The report prints the inputs and minima to whole hectares.
      expect(Math.abs(screen.requiredOldHa - row.requiredOldHa), unit.unit).toBeLessThan(1)
      expect(Math.abs(screen.requiredInteriorHa - row.requiredInteriorHa), unit.unit).toBeLessThan(1)
      expect(screen.interiorForestDeficitHa, unit.unit).toBe(0)
      if (screen.status === 'below_numeric_targets') deficits[row.unit] = Math.round(screen.oldForestDeficitHa)
      else expect(screen.status).toBe('meets_numeric_targets_only')
    }
    expect(deficits).toEqual({ A4: 4465, A24: 887 })
  })
  it('holds every district’s targets equal to the Board’s 49 rows', () => {
    expect(benchmark.oldForest2019.units).toHaveLength(49)
    for (const row of benchmark.oldForest2019.units) {
      const unit = order.oldAndInteriorForest.find((u) => u.unit === row.unit && u.district === row.district)
      expect(unit, row.unit).toBeDefined()
      expect([unit!.oldForestMinPct, unit!.interiorOfRequiredOldForestMinPct], row.unit).toEqual([
        row.oldPercent,
        row.interiorPercent,
      ])
    }
  })
  it('flips the historical A15 numeric screen if 11 qualifying hectares are reclassified', () => {
    const u = order.oldAndInteriorForest.find((u) => u.unit === 'A15' && u.district === 'Prince George')!
    const row = benchmark.oldForest2019.units.find((u) => u.unit === 'A15' && u.district === 'Prince George')!
    const screen = (reclassifiedHa: number) =>
      screenOldForestTarget(u, {
        cflbAreaHa: row.cflbHa,
        qualifyingOldForestHa: row.oldHa - reclassifiedHa,
        qualifyingOldInteriorForestHa: row.interiorHa,
      }).status
    expect(screen(10)).toBe('meets_numeric_targets_only')
    expect(screen(11)).toBe('below_numeric_targets')
  })
  it('can flag an interior deficit independently of the old-forest minimum', () => {
    const unit = order.oldAndInteriorForest.find((u) => u.unit === 'A4')!
    const areas = { cflbAreaHa: 1000, qualifyingOldForestHa: 290, qualifyingOldInteriorForestHa: 25 }
    expect(screenOldForestTarget(unit, areas)).toMatchObject({
      requiredOldHa: 260,
      requiredInteriorHa: 26,
      oldForestDeficitHa: 0,
      interiorForestDeficitHa: 1,
    })
    expect(screenOldForestTarget(unit, { ...areas, qualifyingOldInteriorForestHa: 26 }).status).toBe(
      'meets_numeric_targets_only',
    )
    for (const invalid of [{ qualifyingOldForestHa: 1001 }, { qualifyingOldInteriorForestHa: 291 }, { cflbAreaHa: 0 }])
      expect(screenOldForestTarget(unit, { ...areas, ...invalid }).status).toBe('indeterminate')
    for (const pct of [null, NaN, -1, 101])
      expect(screenOldForestTarget({ ...unit, oldForestMinPct: pct }, areas).status).toBe('indeterminate')
  })
})

describe('TSA patch targets and district-specific observations, Board Appendix 4', () => {
  it('checks all nine target groups and preserves the two different kinds of missing data', () => {
    expect(benchmark.youngForest.classOrder).toEqual(bins)
    const records = benchmark.youngForest.distributions
    expect(records).toHaveLength(14)
    expect(new Set(records.filter((r) => r.target).map((r) => r.ndu))).toEqual(new Set(table.targets.map((t) => t.ndu)))
    for (const row of records) {
      const target = table.targets.find((t) => t.ndu === row.ndu)
      expect(target ? bins.map((b) => target.percent[b]) : null, row.ndu).toEqual(row.target)
      if (row.target === null || row.observed2015 === null) {
        expect(row.observed2018).toBeNull()
        expect(row.ndu).toBe(row.target === null ? 'Boreal Foothills - Mountain' : 'Northern Boreal Mountains')
      }
    }
  })
  const closerByUnit: Record<string, boolean[]> = {
    'McGregor Plateau': [false, true, true, true],
    'Moist Interior - Mountain': [false, true, false, false],
    'Moist Interior - Plateau': [false, false, false, false],
    'Wet Mountain': [true, true, true, true],
    'Wet Trench - Mountain': [true, true, true, false],
    'Wet Trench - Valley': [false, true, false, false],
  }
  it.each(benchmark.youngForest.distributions.filter((r) => r.district === 'Prince George' && r.target))(
    'replays the 2015 and 2018 class movements in $ndu without inferring D.5(b)',
    (row) => {
      const target = table.targets.find((t) => t.ndu === row.ndu)!.percent
      const record = (v: number[]) => Object.fromEntries(bins.map((b, i) => [b, v[i]]))
      for (const v of [row.observed2015!, row.observed2018!])
        expect(patchDistributionDistance(record(v), target).status).toBe('advisory_only')
      const changes = bins.map((b, i) => movementTowardTarget(row.observed2015![i], row.observed2018![i], target[b])!)
      expect(changes.map(Math.sign)).toEqual(closerByUnit[row.ndu].map((closer) => (closer ? 1 : -1)))
      const findings = review({ applicable: true, 'patch-class-away': changes.some((v) => v < 0) }).releases[0].findings
      expect(findings.find((f) => f.rule === 'trend')?.status).toBe(
        row.ndu === 'Wet Mountain' ? 'condition_not_triggered' : 'review_required',
      )
      expect(findings.find((f) => f.rule === 'rationale')?.status).toBe('missing_evidence')
    },
  )
  it('rejects impossible individual percentages even if their sum is 100', () => {
    const target = table.targets[0].percent
    expect(patchDistributionDistance({ ...target, under50ha: -1, between51and100ha: 16 }, target).status).toBe(
      'indeterminate',
    )
    expect(patchDistributionDistance(target, { ...target, over1000ha: 101 }).status).toBe('indeterminate')
  })
})

describe('Prince George order release, scope and independent alternatives', () => {
  it('exercises all 81 combinations of scope, trend, and both D.5 determinations', () => {
    const states = [true, false, null]
    for (const applicable of states)
      for (const trend of states)
        for (const old of states)
          for (const patch of states) {
            const report = review({
              applicable,
              'patch-class-away': trend,
              'old-unachievable': old,
              'patch-unachievable': patch,
            })
            expect(report.bindingDecision).toBe(false)
            for (const [id, value, actions] of [
              ['trend', trend, ['review']],
              ['recruitment', old, ['submit', 'obtain-approval', 'implement']],
              ['rationale', patch, ['submit']],
            ] as const) {
              const finding = report.releases[0].findings.find((f) => f.rule === id)!
              const status =
                applicable === false
                  ? 'outside_scope'
                  : applicable === null || value === null
                    ? 'missing_evidence'
                    : value
                      ? 'review_required'
                      : 'condition_not_triggered'
              expect(finding.status).toBe(status)
              expect(finding.actions?.map((a) => a.kind)).toEqual(status === 'review_required' ? actions : undefined)
            }
          }
  })
  it.each([
    ['2004-10-19', false],
    ['2004-10-20', true],
    ['2026-11-23', true],
    ['2026-11-24', false],
  ])('respects the source date window on %s', (date, covered) => {
    const findings = review({}, date as string).releases[0].findings
    expect(findings.every((r) => r.status === (covered ? 'missing_evidence' : 'outside_source_window'))).toBe(true)
  })
  it('keeps D.1–D.4 as reviewed evidence, including the conditional D.4 cap', () => {
    expect(order.alternativesAndInterpretations.map((a) => a.id)).toEqual([
      'D.1',
      'D.2',
      'D.3',
      'D.4',
      'D.5(a)',
      'D.5(b)',
    ])
    expect(order.alternativesAndInterpretations.every((a) => a.requiresReview)).toBe(true)
    expect(order.alternativesAndInterpretations.find((a) => a.id === 'D.4')?.maxPercentOfOldForestObjective).toBe(20)
    expect(pack.rules.map((r) => r.id)).toEqual(['trend', 'recruitment', 'rationale'])
  })
  it('preserves unknown measurements and compares matching classes in the planner', () => {
    const project = { ...exampleProject(), district: 'Prince George' }
    const result = analyze(project, 2031, 'proposed')
    const measured = () => patchFacts(project, result, 2031, 'proposed').facts[0].value
    const row = result.timeline.find((r) => r.year === 2031 && r.scenario === 'proposed')!
    const original = measured()
    expect(typeof original).toBe('boolean')
    row.classes.reverse()
    expect(measured()).toBe(original)
    row.classes[0].percent = null
    expect(measured()).toBeNull()
    expect(patchFacts(project, result, 2026, 'proposed').facts[0].value).toBeNull()
  })
})
