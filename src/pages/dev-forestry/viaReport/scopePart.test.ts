import { describe, expect, it } from 'vitest'

import { comparisonCase } from './comparisonContexts'
import { findReportPart } from './registry'
import { findReportRecipe } from './recipes'

describe('the report’s scope part', () => {
  it('prints the scope every figure is measured on, each row with its source, and lists the reviewer’s blank statement', async () => {
    const recipe = findReportRecipe('appendix-1-report')!
    const { ctx } = await comparisonCase(recipe, 'full')
    const part = findReportPart('assessment-scope')!
    const out = part.build(ctx)
    expect(out.blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Scope of the assessment' })
    const statement = JSON.stringify(out.blocks[1])
    expect(statement).toContain('Every percent alteration in this report is measured on this scope')
    expect(statement).toMatch(/Landform 1 \([\d.]+ ha; drawn\)/)
    expect(statement).toMatch(/2 blocks, [\d.]+ ha gross, [\d.]+ ha net of 1 mask/)
    expect(statement).toMatch(/1 partial cut counted by Table 6/)
    const fields = out.blocks[2]
    expect(fields.kind).toBe('fields')
    const rows = fields.kind === 'fields' ? fields.rows : []
    expect(rows.map((row) => row.label)).toEqual([
      'Landform assessed',
      'Inventory units under it',
      'Reviewed as',
      'Block X1',
      'Block X2',
      'Wildlife tree patch / retention',
      'Planimetric denominator',
      'Perspective denominator',
    ])
    expect(rows.find((row) => row.label === 'Reviewed as')).toMatchObject({ value: null, source: 'reviewer' })
    expect(rows.find((row) => row.label === 'Block X1')?.value).toMatch(/less Wildlife tree patch 1/)
    expect(rows.find((row) => row.label === 'Block X2')?.value).toMatch(/partial cut .*not cleared ground/)
    // A value nobody gave prints blank and goes to the to-complete list.
    expect(out.toComplete).toEqual(['Reviewed as'])
  })

  it('prints nothing for a context built without a scope', async () => {
    const recipe = findReportRecipe('appendix-1-report')!
    const { ctx } = await comparisonCase(recipe, 'bare')
    expect(findReportPart('assessment-scope')!.build(ctx)).toMatchObject({ blocks: [] })
  })

  it('stands in the recipes that print a report’s figures, after the methods', () => {
    for (const id of ['appendix-1-report', 'consultant-net-private', 'consultant-gross', 'board-comparison']) {
      const parts = findReportRecipe(id)!.parts
      expect(parts.indexOf('assessment-scope'), id).toBe(parts.indexOf('methodology') + 1)
    }
  })
})
