import * as kit from 'document-kit'
import { writeDocx } from 'document-kit/docx'
import * as recipe from 'document-kit/recipe'
import { describe, expect, it } from 'vitest'

import { COMPARISON_VARIANTS, comparisonCase, type ComparisonCase } from './comparisonContexts'
import { flatBlocks, type ReportBlock } from './model'
import { assembleReport, assembleReportParts, REPORT_RECIPES, withViewsLeftOut, type ReportRecipe } from './recipes'
import {
  compileViaRecipe,
  ownRecipeJson,
  recipeReportDocument,
  recipeReportDocx,
  reportRecipeOf,
  type RecipeKit,
} from './recipeRoute'
import { REPORT_PARTS } from './registry'
import { copyRecipe, editRecipe } from './userRecipes'
import { reportDocument, reportDocx } from './word'

// Made-up cases only (`comparisonContexts.ts`): no real VIA's case, block, licensee, place or figure.

const KIT: RecipeKit = { recipe, imageInfo: kit.imageInfo }
const CREATED = '2026-11-16T00:00:00Z'

/** The direct route: the report as the page assembles it, written by `word.ts` alone. */
async function direct(recipeIn: ReportRecipe, c: ComparisonCase) {
  const report = withViewsLeftOut(assembleReportParts(recipeIn, c.ctx, c.edits ?? {}).report, c.leftOut ?? [])
  return { report, document: await reportDocument(report, c.logo, kit, { created: CREATED }) }
}
const routed = (recipeIn: ReportRecipe, c: ComparisonCase) =>
  recipeReportDocument(KIT, {
    recipe: recipeIn,
    ctx: c.ctx,
    edits: c.edits,
    leftOut: c.leftOut,
    logo: c.logo,
    options: { created: CREATED },
  })

/** Every kind of report block (`model.ts`). */
const BLOCK_KINDS: readonly ReportBlock['kind'][] = [
  'heading',
  'paragraph',
  'text',
  'list',
  'fields',
  'table',
  'matrix',
  'scale',
  'choices',
  'figure',
  'signature',
  'form',
  'pageBreak',
  'figurePage',
  'figurePair',
  'mapFigure',
  'figureGrid',
]

/** The parts no shipped recipe prints, in an own recipe of their own, so the comparison reaches every part. */
const unshipped = REPORT_PARTS.map((part) => part.id).filter((id) => !REPORT_RECIPES.some((r) => r.parts.includes(id)))
const OWN: ReportRecipe = editRecipe(
  copyRecipe(REPORT_RECIPES[0], new Set(), () => 0.5),
  {
    name: 'Made-up own recipe',
    // A shipped recipe's parts with two left out, the rest reordered, the unshipped parts, the figures appendix (every
    // shipped recipe that has it also has calculations, so it prints nothing there) and one part printed twice.
    parts: [...REPORT_RECIPES[0].parts.slice(2).reverse(), ...unshipped, 'figures', REPORT_RECIPES[0].parts[3]],
    layout: { paper: 'legal', cover: true, contents: true },
    options: { viewingAngleClass: true, numberedPairs: true },
  },
)

describe('the recipe route', () => {
  it('reads every shipped recipe back from its JSON unchanged', () => {
    for (const shipped of REPORT_RECIPES) expect(reportRecipeOf(compileViaRecipe(KIT, shipped.id))).toEqual(shipped)
  })

  it('builds the very document and Word bytes the direct route builds, for every recipe and assessment', async () => {
    const kinds = new Set<string>()
    const printed = new Set<string>()
    const pages = new Set<string>()
    for (const shipped of [...REPORT_RECIPES, OWN])
      for (const variant of COMPARISON_VARIANTS) {
        const c = await comparisonCase(shipped, variant)
        const want = await direct(shipped, c)
        const got = await routed(shipped, c)
        expect(got.report, `${shipped.id} / ${variant}: report`).toEqual(want.report)
        expect(got.document, `${shipped.id} / ${variant}: document`).toEqual(want.document)
        for (const block of [...want.report.blocks, ...flatBlocks(want.report.blocks)]) kinds.add(block.kind)
        for (const part of got.parts) if (part.blocks) printed.add(part.id)
        for (const section of got.document.sections)
          pages.add(`${section.page?.orientation} ${JSON.stringify(section.page?.paper)}`)
      }
    // Between them the cases print every block kind and every part, on portrait, landscape and 11 × 17 pages.
    expect([...kinds].sort()).toEqual([...BLOCK_KINDS].sort())
    expect(REPORT_PARTS.map((part) => part.id).filter((id) => !printed.has(id))).toEqual([])
    expect(pages.size).toBeGreaterThanOrEqual(5)
  })

  it('writes the same Word bytes', async () => {
    for (const shipped of [...REPORT_RECIPES, OWN]) {
      const c = await comparisonCase(shipped, 'edited')
      const { report } = await direct(shipped, c)
      const word = { imageInfo: kit.imageInfo, writeDocx }
      const want = await reportDocx(report, c.logo, word, { created: CREATED })
      const got = await recipeReportDocx(
        { ...KIT, writeDocx },
        {
          recipe: shipped,
          ctx: c.ctx,
          edits: c.edits,
          leftOut: c.leftOut,
          logo: c.logo,
          options: { created: CREATED },
        },
      )
      expect(Buffer.from(got).equals(Buffer.from(want)), shipped.id).toBe(true)
    }
  })

  it('keeps the hand edits, the orphans and the to-complete list as the page keeps them', async () => {
    for (const shipped of REPORT_RECIPES) {
      const c = await comparisonCase(shipped, 'edited')
      const page = assembleReportParts(shipped, c.ctx, c.edits)
      const got = await routed(shipped, c)
      expect(got.edits.targets).toEqual(page.edits.targets)
      expect(got.edits.orphans).toEqual(page.edits.orphans)
      expect(got.edits.orphans.length).toBe(1)
      expect(got.report.footer).toMatch(/values? changed by hand by the reviewer/)
      // Each part's own to-complete travels with it into the engine's list as `pending`, in order: a code part's on
      // its blocks, a JSON part's as its component declares it.
      const kitItems = got.rendered.toComplete.filter((item) => item.kind === 'pending' && item.partId !== null)
      const partItems = got.report.toComplete.slice(
        0,
        got.parts.reduce((n, part) => n + part.toComplete, 0),
      )
      expect(kitItems.map((item) => item.what)).toEqual(partItems.map((item) => item.what))
    }
  })

  it('builds an own recipe as a kit recipe extending the shipped one it was copied from', () => {
    const json = ownRecipeJson(KIT, OWN)
    expect(json.extends).toBe(REPORT_RECIPES[0].id)
    expect(json.own).toEqual({ basedOn: REPORT_RECIPES[0].id })
    const back = reportRecipeOf(compileViaRecipe(KIT, json))
    expect(back.parts).toEqual(OWN.parts)
    expect(back.options).toEqual(OWN.options)
    expect(back.layout).toEqual(OWN.layout)
  })

  it('assembles an own recipe through the engine as the page assembles it', async () => {
    const c = await comparisonCase(OWN, 'full')
    const back = reportRecipeOf(compileViaRecipe(KIT, ownRecipeJson(KIT, OWN)))
    expect(assembleReport(back, c.ctx)).toEqual(assembleReport(OWN, c.ctx))
  })
})
