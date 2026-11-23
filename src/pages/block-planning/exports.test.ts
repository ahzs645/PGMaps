import { describe, expect, it } from 'vitest'
import { parsePack } from '../../../packages/legal-rules/src/contract'
import pg from '../../../packages/legal-rules/packs/bc-pgtsa-planning-1.2.0.json'
import { openPlanFile } from './migrate'
import { samplePlan } from './plan'
import { analyzePlan } from './planAnalysis'
import { assessmentRecord, blocksGeoJson, buildExport } from './exports'

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
})
