/**
 * The standing comparison of the VIA report's two Word routes, written down: for every shipped recipe (and a made-up
 * own recipe that prints every other part) over each made-up assessment (`comparisonContexts.ts`), the recipe
 * engine's document (`recipeRoute.ts`) against the direct route's (`reportDocument`), their Word bytes with a pinned
 * creation time, each part's report blocks, each page kind's frame and each piece of JSON furniture against the code
 * that draws it. Writes `src/pages/dev-forestry/viaReport/recipeJson/comparison-result.json`
 * (`npm run via-recipes:compare`); `recipeRoute.test.ts` pins the same equalities in the normal suite.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import * as kit from 'document-kit'
import { writeDocx } from 'document-kit/docx'
import * as recipe from 'document-kit/recipe'
import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'

import { COMPARISON_VARIANTS, comparisonCase } from '../../../src/pages/dev-forestry/viaReport/comparisonContexts'
import { ORACLE } from '../../../src/pages/dev-forestry/viaReport/jsonParts.oracle'
import {
  assembleReportParts,
  partContext,
  REPORT_RECIPES,
  withViewsLeftOut,
  type ReportRecipe,
} from '../../../src/pages/dev-forestry/viaReport/recipes'
import { recipeReportDocument, type RecipeKit } from '../../../src/pages/dev-forestry/viaReport/recipeRoute'
import { findReportPart, REPORT_PARTS } from '../../../src/pages/dev-forestry/viaReport/registry'
import { copyRecipe, editRecipe } from '../../../src/pages/dev-forestry/viaReport/userRecipes'
import {
  codeFurniture,
  PAGE_KINDS,
  reportDocument,
  reportPictures,
} from '../../../src/pages/dev-forestry/viaReport/word'

const OUT = join(import.meta.dirname, '../../../src/pages/dev-forestry/viaReport/recipeJson/comparison-result.json')
const KIT: RecipeKit = { recipe, imageInfo: kit.imageInfo }
const CREATED = '2026-11-16T00:00:00Z'
const same = (a: unknown, b: unknown) => {
  try {
    expect(a).toEqual(b)
    return true
  } catch {
    return false
  }
}

it('compares the two routes and writes the result', async () => {
  const unshipped = REPORT_PARTS.map((p) => p.id).filter((id) => !REPORT_RECIPES.some((r) => r.parts.includes(id)))
  const own: ReportRecipe = editRecipe(
    copyRecipe(REPORT_RECIPES[0], new Set(), () => 0.5),
    {
      name: 'Made-up own recipe',
      parts: [...REPORT_RECIPES[0].parts.slice(2).reverse(), ...unshipped, 'figures', REPORT_RECIPES[0].parts[3]],
      layout: { paper: 'legal', cover: true, contents: true },
      options: { viewingAngleClass: true, numberedPairs: true },
    },
  )
  // Each part now defined in JSON against the code it replaced, in every shipped recipe's context and assessment.
  const jsonParts: Record<string, { cases: number; equal: number }> = {}
  for (const shipped of REPORT_RECIPES)
    for (const variant of COMPARISON_VARIANTS) {
      const ctx = partContext(shipped, (await comparisonCase(shipped, variant)).ctx)
      for (const [id, oracle] of Object.entries(ORACLE)) {
        const entry = (jsonParts[id] ??= { cases: 0, equal: 0 })
        const want = oracle.build(ctx)
        const got = findReportPart(id)!.build(ctx)
        entry.cases++
        if (same(got.blocks, want.blocks) && same(got.toComplete ?? [], want.toComplete ?? [])) entry.equal++
      }
    }
  const recipes: Record<string, unknown> = {}
  const furnitureEqual: Record<string, boolean> = {}
  let cases = 0
  let equal = 0
  for (const shipped of [...REPORT_RECIPES, own]) {
    const perCase: Record<string, unknown> = {}
    const perPart: Record<string, { equal: boolean; printedIn: number }> = {}
    for (const variant of COMPARISON_VARIANTS) {
      const c = await comparisonCase(shipped, variant)
      const assembled = assembleReportParts(shipped, c.ctx, c.edits ?? {})
      const report = withViewsLeftOut(assembled.report, c.leftOut ?? [])
      const want = await reportDocument(report, c.logo, kit, { created: CREATED })
      const got = await recipeReportDocument(KIT, {
        recipe: shipped,
        ctx: c.ctx,
        edits: c.edits,
        leftOut: c.leftOut,
        logo: c.logo,
        options: { created: CREATED },
      })
      const wantBytes = await writeDocx(want, { nullCells: 'rule', creator: 'PGMaps' })
      const gotBytes = await writeDocx(got.document, { nullCells: 'rule', creator: 'PGMaps' })
      const documentEqual = same(got.document, want)
      const bytesEqual = Buffer.from(gotBytes).equals(Buffer.from(wantBytes))
      cases++
      if (documentEqual && bytesEqual) equal++
      // Each part's report blocks, by its place in each route's report.
      const slice = (blocks: typeof report.blocks, part: (typeof assembled.parts)[number]) => {
        const from = part.first ? report.blocks.indexOf(part.first) : -1
        return from < 0 ? [] : blocks.slice(from, from + part.blocks)
      }
      for (const part of assembled.parts) {
        const entry = (perPart[part.id] ??= { equal: true, printedIn: 0 })
        entry.equal &&= same(slice(got.report.blocks, part), slice(report.blocks, part))
        if (part.blocks) entry.printedIn++
      }
      // Each page kind's frame and each piece of furniture: the engine's JSON against the direct route's code.
      const code = codeFurniture(report, c.logo, await reportPictures(kit))
      for (const kind of PAGE_KINDS) {
        const key = `page:${kind}`
        furnitureEqual[key] = (furnitureEqual[key] ?? true) && same(got.furniture.section(kind), code.section(kind))
      }
      for (const piece of ['title', 'cover', 'contents', 'closing'] as const) {
        const printed = report.layout.cover ? piece !== 'title' : piece !== 'cover'
        if (!printed) continue
        furnitureEqual[piece] = (furnitureEqual[piece] ?? true) && same(got.furniture[piece], code[piece])
      }
      perCase[variant] = {
        document: documentEqual,
        wordBytes: bytesEqual,
        report: same(got.report, report),
        sections: want.sections.length,
        reportBlocks: report.blocks.length,
        toComplete: report.toComplete.length,
        orphans: got.edits.orphans.length,
      }
    }
    recipes[shipped.own ? 'own (made-up)' : shipped.id] = { cases: perCase, parts: perPart }
  }
  const partEntries = (id: string) =>
    Object.values(recipes).flatMap((r) => {
      const entry = (r as { parts: Record<string, { equal: boolean; printedIn: number }> }).parts[id]
      return entry ? [entry] : []
    })
  let kitCommit = 'unknown'
  try {
    kitCommit = execFileSync(
      'git',
      ['-C', join(import.meta.dirname, '../../../vendor/document-kit'), 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    // Not a Git checkout: the commit is left unknown.
  }
  const result = {
    about:
      'Written by npm run via-recipes:compare (scripts/forestry/via-recipes/compare.run.ts); do not edit by hand. Each recipe over each made-up assessment, built through the recipe engine and by the direct route: document deeply equal, Word bytes equal (creation time pinned), report equal, and each part and each piece of JSON furniture equal.',
    kit: kitCommit,
    cases: COMPARISON_VARIANTS,
    summary: {
      recipeCases: cases,
      equal,
      parts: REPORT_PARTS.length,
      // Parts that printed in some case, and parts whose blocks were equal in every case they ran in.
      partsPrinted: REPORT_PARTS.filter((p) => partEntries(p.id).some((entry) => entry.printedIn > 0)).length,
      partsEqual: REPORT_PARTS.filter(
        (p) => partEntries(p.id).length && partEntries(p.id).every((entry) => entry.equal),
      ).length,
      furniture: furnitureEqual,
      jsonParts,
    },
    recipes,
  }
  writeFileSync(OUT, await format(JSON.stringify(result), { ...(await resolveConfig(OUT)), filepath: OUT }))
  expect(equal).toBe(cases)
  expect(Object.values(furnitureEqual).every(Boolean)).toBe(true)
  expect(Object.values(jsonParts).every((entry) => entry.equal === entry.cases)).toBe(true)
})
