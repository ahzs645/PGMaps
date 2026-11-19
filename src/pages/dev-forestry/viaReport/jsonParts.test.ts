import { describe, expect, it } from 'vitest'

import { COMPARISON_VARIANTS, comparisonCase } from './comparisonContexts'
import { editPartBlocks } from './edits'
import { ORACLE } from './jsonParts.oracle'
import { assembleReport, partContext, REPORT_RECIPES } from './recipes'
import { ReportEngineNotLoaded, reportEngine, setReportEngine } from './reportEngine'
import { findReportPart } from './registry'

describe('the parts defined in JSON', () => {
  it('give every format the very blocks and to-complete their code gave, in every recipe and assessment', async () => {
    let compared = 0
    for (const recipe of REPORT_RECIPES)
      for (const variant of COMPARISON_VARIANTS) {
        const c = await comparisonCase(recipe, variant)
        // Every recipe's context, and the summary form's, whether the recipe prints the part or not.
        for (const ctx of [partContext(recipe, c.ctx), { ...partContext(recipe, c.ctx), recipeParts: ['notes-2001'] }])
          for (const [id, oracle] of Object.entries(ORACLE)) {
            const json = findReportPart(id)!
            const want = oracle.build(ctx)
            const got = json.build(ctx)
            expect(got.blocks, `${recipe.id} / ${variant} / ${id}`).toEqual(want.blocks)
            expect(got.toComplete ?? [], `${recipe.id} / ${variant} / ${id}`).toEqual(want.toComplete ?? [])
            expect(JSON.stringify(got.blocks)).toBe(JSON.stringify(want.blocks))
            // A hand edit lands on the same place, and a part with none returns the very blocks it built.
            const edits = { [`${id}|x|field|y`]: 'kept' }
            const edited = editPartBlocks(json, got.blocks, edits)
            expect(edited.targets).toEqual(editPartBlocks(oracle, want.blocks, edits).targets)
            expect(editPartBlocks(json, got.blocks, {}).blocks.every((block, i) => block === got.blocks[i])).toBe(true)
            compared++
          }
      }
    expect(compared).toBe(REPORT_RECIPES.length * COMPARISON_VARIANTS.length * 2 * Object.keys(ORACLE).length)
  })

  it('keep their ids, titles and sources', () => {
    for (const [id, oracle] of Object.entries(ORACLE)) {
      const json = findReportPart(id)!
      expect({ id: json.id, title: json.title, sources: json.sources }).toEqual({
        id: oracle.id,
        title: oracle.title,
        sources: oracle.sources,
      })
    }
  })

  it('refuse to print before the engine is loaded, naming the part, and never assemble a report without it', async () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.parts.includes('cover'))!
    const c = await comparisonCase(recipe, 'full')
    const engine = reportEngine('test')
    setReportEngine(null)
    try {
      expect(() => assembleReport(recipe, c.ctx)).toThrow(ReportEngineNotLoaded)
      expect(() => findReportPart('cover')!.build(c.ctx)).toThrow(/“cover”.*not loaded/)
    } finally {
      setReportEngine(engine)
    }
    expect(assembleReport(recipe, c.ctx).blocks.length).toBeGreaterThan(1)
  })
})
