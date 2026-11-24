import { describe, expect, it } from 'vitest'
import { parsePack } from '../../../packages/legal-rules/src/contract'
import pg from '../../../packages/legal-rules/packs/bc-pgtsa-planning-1.2.0.json'
import { openPlanFile } from './migrate'
import { parsePlan, samplePlan } from './plan'
import { analyzePlan } from './planAnalysis'
import { assessmentRecord, blocksGeoJson, buildExport } from './exports'
import { setCheck, setOldForest } from './edits'
import { boardCheckKey, oldForestKey } from './records'

const plan = {
  ...samplePlan(),
  landscape: {
    review: {
      selected: ['bc.pgtsa.biodiversity@1.2.0'],
      date: '2026-11-17',
      sets: {
        'bc.pgtsa.biodiversity@1.2.0': {
          format: 'pgmaps-legal-facts/v1' as const,
          pack: 'bc.pgtsa.biodiversity',
          version: '1.2.0',
          source: 'test',
          facts: [{ id: 'applicable', value: true }],
        },
      },
    },
  },
}
const result = analyzePlan(plan, { schedule: 'proposed', year: 2026 })
const library = [parsePack(pg)]

describe('block planning exports', () => {
  it('writes a plan file that opens again unchanged', () => {
    const reopened = openPlanFile(JSON.parse(buildExport('plan', plan, undefined, library, '2026-11-23')))
    expect(reopened.plan).toEqual(JSON.parse(JSON.stringify(plan)))
  })

  it('records every schedule, the review’s findings, the pathways and a labelled index', () => {
    const record = assessmentRecord(plan, result, library, '2026-11-23')
    expect(record.bindingDecision).toBe(false)
    expect(record.schedules.map((s) => s.schedule)).toEqual(['none', 'proposed', 'deferred'])
    expect(record.landscapeReview.assessment && 'releases' in record.landscapeReview.assessment).toBe(true)
    expect(record.pathways.map((p) => p.id)).toEqual(['D.5(b)', 'D.5(a)'])
    expect(record.planningIndex.notALegalTest).toBe(true)
    expect(record.published?.observations.length).toBe(2)
  })

  it('gives each block shape the year each schedule cuts it', () => {
    const block = blocksGeoJson(plan).features.find((f) => f.properties?.layer === 'block')!
    expect(block.properties).toMatchObject({
      'cut_No further harvest': null,
      cut_Proposed: 2026,
      'cut_Deferred 10 years': 2036,
    })
  })

  it('escapes what the planner typed in the summary, and refuses to summarise without a run', () => {
    const html = buildExport(
      'summary',
      { ...plan, landscape: { ...plan.landscape, rationale: '<script>x</script>' } },
      result,
      library,
      'today',
    )
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Not a legal test')
    expect(() => buildExport('record', plan, undefined, library, 'today')).toThrow(/patch calculation/)
  })

  it('carries the Board check and old forest, and marks them out of date once their inputs change', () => {
    let kept = setCheck(plan, 'board', {
      ranOn: '2026-11-24',
      key: boardCheckKey(plan),
      years: [
        { year: 2015, shares: [10, 20, 30, 40], totalHa: 500 },
        { year: 2018, shares: [11, 19, 30, 40], totalHa: 520 },
      ],
    })
    kept = setOldForest(kept, { district: 'Prince George', unit: 'A10' })
    const year = {
      cflbHa: 1000,
      requiredOldHa: 170,
      oldHa: 120,
      countedNotOldHa: 0,
      requiredNonPineHa: 140,
      nonPineOldHa: 100,
      unknownAgeHa: 0,
      requiredInteriorHa: 42.5,
      interiorHa: 30,
    }
    kept = setCheck(kept, 'oldForest', {
      ranOn: '2026-11-24',
      readOn: '2026-11-24',
      key: oldForestKey(kept),
      district: 'Prince George',
      unit: 'A10',
      source: 'Order Map 2, Prince George · A10',
      cflbProxyHa: 1000,
      gisFraction: 0.12,
      projectedYear: 2025,
      counts: { stands: 10, ogmas: 1, parks: 0, retention: 0, corridors: 2 },
      excluded: [
        { kind: 'non-crown', records: 3, grossHa: 120, cflbHa: 80 },
        { kind: 'tfl', records: 1, grossHa: 500, cflbHa: 400 },
      ],
      corridorKinds: { fsr: 1, pipeline: 1 },
      schedules: kept.schedules.map((s) => ({ schedule: s.id, years: [{ year: 2026, ...year }] })),
      calibration2019: null,
    })
    const record = assessmentRecord(kept, result, library, '2026-11-24')
    expect(record.boardCheck?.current).toBe(true)
    expect(record.oldForest?.current).toBe(true)
    expect(record.oldForest?.shortfalls[0].first).toEqual({ year: 2026, what: ['old', 'old non-pine', 'old interior'] })
    const html = buildExport('summary', kept, result, library, 'today')
    expect(html).toContain('Check of the method against these figures')
    expect(html).toContain('Old and old interior forest · A10')
    expect(html).toContain('the order’s table says 17%')
    expect(html).toContain('Tree farm licences 500 ha (400 ha of it on the proxy CFLB)')
    expect(html).toContain('480 ha left the CFLB in all')
    expect(html).toContain('pipelines 1')
    const reopened = openPlanFile(JSON.parse(buildExport('plan', kept, undefined, library, '2026-11-24')))
    expect(reopened.plan.checks?.oldForest?.excluded).toEqual(kept.checks?.oldForest?.excluded)
    expect(reopened.plan.checks?.oldForest?.corridorKinds).toEqual({ fsr: 1, pipeline: 1 })
    expect(html).not.toContain('The plan changed after this was calculated')
    // No D.3 summary in this record: the summary prints none.
    expect(html).not.toContain('Representative stands (D.3)')
    const row = (key: string, cflbHa: number, oldHa: number, nonPineOldHa: number) => ({
      key,
      cflbHa,
      oldHa,
      nonPineOldHa,
    })
    const d3 = setCheck(kept, 'oldForest', {
      ...kept.checks!.oldForest!,
      representation: {
        schedule: kept.reviewSchedule,
        years: [
          {
            year: 2026,
            interiorHa: 30,
            interiorNonPineHa: 24,
            by: {
              species: [row('pine', 400, 20, 0), row('spruce', 600, 100, 100)],
              bec: [row('SBS wk1', 1000, 120, 100)],
              age: [row('8', 120, 120, 100), row('3', 880, 0, 0)],
              site: [row('15-20', 1000, 120, 100)],
            },
          },
        ],
      },
    })
    const printed = buildExport('summary', d3, result, library, 'today')
    expect(printed).toContain('Representative stands (D.3)')
    expect(printed).toContain('(i.e. non-pine forest)')
    expect(printed).toContain('non-pine-leading 60.0% of the CFLB, old non-pine 83.3% of old forest')
    expect(printed).toContain('<td>Spruce (S)</td><td>600 (60.0%)</td><td>100 (83.3%)</td><td>100 (100.0%)</td>')
    expect(printed).toContain('15 to under 20 m')
    const changed = setOldForest(kept, { countParks: true })
    expect(buildExport('summary', changed, result, library, 'today')).toContain(
      'The plan changed after this was calculated',
    )
  })

  it('prints D.4’s statement and figures and every pooled unit, with the Board per unit', () => {
    let kept = setOldForest(plan, {
      district: 'Prince George',
      unit: 'A5',
      younger: { fromAge: 100, benefit: 'Keeps the <b>riparian</b> link.' },
      pooledWith: [{ district: 'Prince George', unit: 'A6' }],
    })
    const year = {
      year: 2026,
      cflbHa: 1000,
      requiredOldHa: 290,
      oldHa: 260,
      countedNotOldHa: 0,
      requiredNonPineHa: null,
      nonPineOldHa: 200,
      unknownAgeHa: 0,
      requiredInteriorHa: 116,
      interiorHa: 150,
      d4OldSupplyHa: 400,
      d4OldHa: 58,
      d4InteriorSupplyHa: 20,
      d4InteriorHa: 20,
    }
    const unitRow = (unit: string) => ({
      district: 'Prince George',
      unit,
      source: `Order Map 2, Prince George · ${unit}`,
      cflbProxyHa: 500,
      gisFraction: null,
      projectedYear: 2025,
      counts: { stands: 10, ogmas: 1, parks: 0, retention: 0, corridors: 2 },
      schedules: kept.schedules.map((s) => ({ schedule: s.id, years: [year] })),
      calibration2019: { ...year, year: 2019 },
    })
    kept = setCheck(kept, 'oldForest', {
      ...unitRow('A5'),
      ranOn: '2026-11-24',
      readOn: '2026-11-24',
      key: oldForestKey(kept),
      younger: { fromAge: 100, benefit: 'Keeps the <b>riparian</b> link.' },
      pool: [unitRow('A5'), unitRow('A6')],
    })
    // The kept record reads back from the plan file whole.
    expect(parsePlan(JSON.parse(JSON.stringify(kept))).checks?.oldForest).toEqual(kept.checks?.oldForest)
    const record = assessmentRecord(kept, result, library, '2026-11-24')
    expect(record.oldForest?.shortfalls[0].text).toBe(
      'no shortfall over the projection; old met only with D.4 from 2026',
    )
    expect(record.oldForest?.younger?.benefit).toMatch(/riparian/)
    expect(record.oldForest?.pool?.map((u) => u.unit)).toEqual(['A5', 'A6'])
    const html = buildExport('summary', kept, result, library, 'today')
    expect(html).toContain('Old and old interior forest · A5 + A6')
    expect(html).toContain('Pooled under D.2 by the reviewer')
    expect(html).toContain('Conservation benefit: Keeps the &lt;b&gt;riparian&lt;/b&gt; link.')
    expect(html).toContain('58 (400)')
    expect(html).toContain('A5: 2019, baseline only, against the Board')
    expect(html).toContain('A6: 2019, baseline only, against the Board')
  })
})
