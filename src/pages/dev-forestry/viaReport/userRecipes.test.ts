import { describe, expect, it } from 'vitest'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import { drawGroupOf, standIn, standInGroups, standInUrl, withStandIns } from './draftPictures'
import { reportHtml } from './html'
import type { ReportContext } from './parts'
import { recipeMakeup } from './recipeMakeup'
import { assembleReport, assembleReportParts, findReportRecipe, REPORT_RECIPES } from './recipes'
import {
  copyRecipe,
  editRecipe,
  partSources,
  readOwnRecipe,
  readRecipeFile,
  recipeFileName,
  recipeFileText,
  storedRecipe,
} from './userRecipes'

const facts: DocumentFacts = {
  project: 'Block X1',
  viewpoints: [
    {
      name: 'Viewpoint 1',
      landform: 'Landform 1',
      objective: 'PR',
      inventory: { vsu: '12', vsc: '2', vac: 'M', evc: 'R', vqo: 'PR' },
      areas: { landform: 10000, proposed: 300, nonVeg: 0, privateLand: 0, rock: 500 },
      sightlinePercent: 3.1,
      distanceKm: 2.6,
      hfovDeg: 39.6,
      lensMm: 50,
      lngLat: [-122.5, 53.9],
      blocks: [{ id: 'X1', status: 'visible', visiblePercent: 40 }],
    },
  ],
}

function context(formatId: string, over: Partial<ReportContext> = {}): ReportContext {
  return {
    date: new Date('2026-11-15T12:00:00Z'),
    office: { licence: 'A00000', cuttingPermit: '1' },
    blocks: [{ name: 'X1', areaHa: 12.4, system: 'Clearcut', retentionPercent: null, partialCut: null }],
    landform: { name: 'Landform 1', objective: 'PR', vac: 'M', areaHa: 410, source: 'drawn in step 1' },
    inventory: facts.viewpoints[0].inventory ?? null,
    inventoryRead: true,
    facts,
    document: resolveViaDocument(findDocumentFormat(formatId)!, facts),
    assessment: null,
    review: null,
    breakdown: null,
    method: { terrain: 'AWS Open Data terrain', vegetation: 'VRI', eyeHeightM: 1.6 },
    measures: [],
    figures: [],
    ...over,
  }
}

/** A fixed "random" so ids are stable. */
const fixed = () => 0.5

describe('own VIA report recipes', () => {
  const base = findReportRecipe('form-2001-sheets')!

  it('copy a built-in recipe with every choice, as your own, with sources from its parts', () => {
    const copy = copyRecipe(base, new Set(REPORT_RECIPES.map((r) => r.id)), fixed)
    expect(copy.id).toMatch(/^own-2001-via-summary-form-with-analysis-shee-[0-9a-z]{4}$/)
    expect(copy.name).toBe('2001 VIA summary form with analysis sheets (your copy)')
    expect(copy.parts).toEqual(base.parts)
    expect(copy.parts).not.toBe(base.parts)
    expect(copy.format).toBe(base.format)
    expect(copy.own).toEqual({ basedOn: 'form-2001-sheets' })
    expect(copy.sources).toEqual(partSources(base.parts))
    // A copy of a copy remembers the built-in it came from, and is named once.
    const again = copyRecipe(copy, new Set([copy.id]), () => 0.75)
    expect(again.own).toEqual({ basedOn: 'form-2001-sheets' })
    expect(again.name).toBe(copy.name)
    expect(again.id).not.toBe(copy.id)
  })

  it('assemble exactly as the built-in recipe does until changed, but name the report your own', () => {
    const copy = copyRecipe(base, new Set(), fixed)
    const ctx = context(base.format)
    const built = assembleReport(base, ctx)
    const own = assembleReport(copy, ctx)
    expect(own.blocks).toEqual(built.blocks)
    expect(own.toComplete).toEqual(built.toComplete)
    expect(built.footer).toMatch(/^PGMaps report in the structure of reference document 03/)
    expect(own.footer).toMatch(/^PGMaps report from your own recipe, 2001 VIA summary form/)
  })

  it('keep sources following the parts when edited', () => {
    const copy = copyRecipe(base, new Set(), fixed)
    const edited = editRecipe(copy, { parts: [...copy.parts, 'ea-visual-memo'] })
    expect(edited.sources).toContain('26')
    expect(edited.own).toEqual(copy.own)
    expect(edited.id).toBe(copy.id)
  })

  it('read back as stored, and through a shared file', () => {
    const copy = editRecipe(copyRecipe(base, new Set(), fixed), {
      layout: { paper: 'legal', cover: true },
      options: { numberedPairs: true, figurePanorama: 2.4 },
      obliquePitch: 75,
      overviewSheetStyle: 'end-map-portrait',
      figureStyle: 'district-greyscale',
    })
    const stored = JSON.parse(JSON.stringify(storedRecipe(copy)))
    expect(readOwnRecipe(stored)).toEqual({ recipe: copy })
    const file = recipeFileText(copy, new Date('2026-11-15T00:00:00Z'))
    expect(readRecipeFile(file, { ids: new Set(), names: new Set() })).toEqual({ recipe: copy })
    expect(recipeFileName(copy)).toBe('2001-via-summary-form-with-analysis-sheets-your-copy.via-recipe.json')
  })

  it('import under a fresh id and name when they are taken, never over a recipe', () => {
    const copy = copyRecipe(base, new Set(), fixed)
    const read = readRecipeFile(
      recipeFileText(copy, new Date()),
      {
        ids: new Set([copy.id]),
        names: new Set([copy.name]),
      },
      () => 0.25,
    )
    expect(read.recipe?.id).not.toBe(copy.id)
    expect(read.recipe?.name).toBe(`${copy.name} (imported)`)
  })

  it('refuse a recipe naming what this PGMaps does not have, saying each problem', () => {
    const stored = storedRecipe(copyRecipe(base, new Set(), fixed))
    const bad = readOwnRecipe({
      ...stored,
      parts: ['cover', 'no-such-part'],
      format: 'not-a-format',
      figureStyle: 'not-a-style',
      options: { numberedPairs: 'yes', madeUp: true },
      obliquePitch: 95,
    })
    expect(bad.recipe).toBeUndefined()
    expect(bad.error).toContain('"no-such-part"')
    expect(bad.error).toContain('document format "not-a-format"')
    expect(bad.error).toContain('figure style "not-a-style"')
    expect(bad.error).toContain('"madeUp"')
    expect(bad.error).toContain('oblique pitch')
    expect(readOwnRecipe({ ...stored, id: 'form-2001-sheets' }).error).toContain('id')
    expect(readOwnRecipe({ ...stored, parts: [] }).error).toContain('no parts')
    expect(readRecipeFile('{"kind":"other"}', { ids: new Set(), names: new Set() }).error).toContain(
      'not a PGMaps VIA recipe',
    )
    expect(readRecipeFile('nope', { ids: new Set(), names: new Set() }).error).toBe('The file is not JSON.')
  })

  it('describe what a recipe is made of from the catalogues it names', () => {
    const rows = recipeMakeup(base)
    const value = (label: string) => rows.find((row) => row.label === label)?.value
    expect(value('Follows')).toBe('Reference document 03')
    expect(value('Document format')).toContain('(03)')
    expect(value('Percent alteration')).toMatch(/dp$/)
    expect(value('Paper')).toBe('Letter')
    const own = recipeMakeup(editRecipe(copyRecipe(base, new Set(), fixed), { options: { numberedPairs: true } }))
    expect(own.find((row) => row.label === 'Recipe')?.value).toMatch(/^Your own, copied from 2001 VIA summary form/)
    expect(own.find((row) => row.label === 'Options')?.value).toContain('Number photograph / simulation pairs')
  })
})

describe('the VIA report draft', () => {
  it('tags each stand-in with its picture group, read back from the page', () => {
    const url = standInUrl('before:view-1', 'Viewpoint 1: before harvest', 'Click to draw', 1200, 800)
    expect(drawGroupOf(url)).toBe('before:view-1')
    expect(drawGroupOf('data:image/png;base64,AAAA')).toBeNull()
    expect(standInGroups(`<img src="${url}"><img src="${standInUrl('maps', 'Map', 'x', 400, 300)}">`)).toEqual([
      'before:view-1',
      'maps',
    ])
  })

  it('stands in for every picture not drawn, keeping the drawn ones and their sizes', () => {
    const drawnMap = {
      view: 'map',
      caption: 'Overview',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 400,
      height: 300,
    }
    const images = withStandIns({
      images: { overviewMap: drawnMap, before: {}, overhead: [] },
      views: [{ id: 'v1', name: 'Viewpoint 1', aspect: 16 / 9 }],
      blocks: ['X1', 'X2'],
      sheetStyle: 'topo-landscape',
      figurePageMaps: false,
      beforeBy: 'pgmaps',
    })
    expect(images.overviewMap).toBe(drawnMap)
    expect(drawGroupOf(images.overviewSheet!.dataUrl)).toBe('maps')
    expect(images.overviewSheet!.map).toEqual({ inPicture: true })
    expect(drawGroupOf(images.before!['Viewpoint 1'].dataUrl)).toBe('before:v1')
    expect(images.before!['Viewpoint 1'].width / images.before!['Viewpoint 1'].height).toBeCloseTo(16 / 9, 2)
    // One overhead and an oblique per block, as the capture takes.
    expect(images.overhead!.map((figure) => drawGroupOf(figure.dataUrl))).toEqual(['renders', 'renders', 'renders'])
    expect(images.figurePageMaps).toBeNull()
    const engine = withStandIns({
      images: {},
      views: [{ id: 'v1', name: 'Viewpoint 1', aspect: 1.5 }],
      blocks: [],
      sheetStyle: 'end-map-portrait',
      figurePageMaps: true,
      beforeBy: 'engine',
    })
    expect(drawGroupOf(engine.before!['Viewpoint 1'].dataUrl)).toBe('engine')
    expect(drawGroupOf(engine.figurePageMaps!.location['Viewpoint 1'].dataUrl)).toBe('maps')
    expect(standIn('maps', 'm', 'Map', 'how', 4 / 3).height).toBe(900)
  })

  it('marks where each part starts and tints values, without changing the file', () => {
    const recipe = findReportRecipe('appendix-1-report')!
    const ctx = context(recipe.format)
    const { report, parts } = assembleReportParts(recipe, ctx)
    expect(parts.map((part) => part.id)).toEqual(recipe.parts)
    expect(report).toEqual(assembleReport(recipe, ctx))
    const file = reportHtml(report, null)
    const draft = reportHtml(report, null, { parts })
    expect(file).not.toContain('draft-part')
    expect(file).not.toContain('data-src=')
    for (const [index, part] of parts.entries()) if (part.first) expect(draft, part.id).toContain(`id="part-${index}"`)
    expect(draft).toContain('data-src="scene"')
    expect(draft).not.toContain('Print / save as PDF')
    // Every part that printed has a mark, and a part that printed nothing has none.
    expect(parts.filter((part) => part.blocks === 0).every((part) => part.first === null)).toBe(true)
  })

  it('lays out with stand-ins where the file will put pictures', () => {
    const recipe = findReportRecipe('form-2001-photos')!
    const images = withStandIns({
      images: {},
      views: [{ id: 'v1', name: 'Viewpoint 1', aspect: 1.5 }],
      blocks: ['X1'],
      sheetStyle: 'end-map-portrait',
      figurePageMaps: false,
      beforeBy: 'pgmaps',
    })
    const report = assembleReport(recipe, context(recipe.format, { images }))
    const groups = standInGroups(reportHtml(report, null, { parts: [] }))
    expect(groups).toContain('maps')
    expect(groups).toContain('before:v1')
  })
})
