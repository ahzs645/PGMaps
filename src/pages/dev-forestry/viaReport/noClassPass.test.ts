import * as kit from 'document-kit'
import { writeDocx } from 'document-kit/docx'
import * as recipe from 'document-kit/recipe'
import * as jspdf from 'jspdf'
import { describe, expect, it } from 'vitest'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import { reportHtml, reportMarkdown } from './html'
import { flatBlocks } from './model'
import type { ReportContext } from './parts'
import { reportPdf } from './pdf'
import { assembleReport, REPORT_RECIPES, withViewsLeftOut } from './recipes'
import { recipeReportDocx } from './recipeRoute'
import { reportDocx } from './word'

// A package whose views have no class pass: no viewpoint facts, no figures, no pictures. Made-up names only.
const facts: DocumentFacts = { project: 'Block X1', viewpoints: [] }
const context = (formatId: string): ReportContext => ({
  date: new Date('2026-11-14T12:00:00Z'),
  office: {},
  blocks: [{ name: 'X1', areaHa: 12.4, system: 'Clearcut', retentionPercent: null, partialCut: null }],
  landform: { name: 'Landform 1', objective: 'PR', vac: 'M', areaHa: 410, source: 'drawn in step 1' },
  inventory: null,
  inventoryRead: false,
  facts,
  document: resolveViaDocument(findDocumentFormat(formatId)!, facts),
  assessment: null,
  review: null,
  breakdown: null,
  method: { terrain: 'AWS Open Data terrain', vegetation: 'VRI', eyeHeightM: 1.6 },
  measures: [],
  figures: [],
})
const leftOut = [
  {
    name: 'Viewpoint 1',
    reason: 'its analysis sheet could not be drawn: its class pass was not taken when it was saved',
  },
  { name: 'Viewpoint 2', reason: 'not captured' },
]
const PICTURES = new Set(['figure', 'figurePage', 'figurePair', 'mapFigure', 'figureGrid'])
const CREATED = '2026-11-16T00:00:00Z'

describe('a VIA report with no class pass', () => {
  for (const r of REPORT_RECIPES)
    it(`${r.id} is written in every format, its figures printing nothing and listed to complete`, async () => {
      const report = withViewsLeftOut(assembleReport(r, context(r.format)), leftOut)
      // No picture nobody gave reaches the file: the draft alone keeps a box for one.
      const drawn = flatBlocks(report.blocks).filter((block) => PICTURES.has(block.kind))
      for (const block of drawn) expect(JSON.stringify(block), r.id).not.toMatch(/data:image/)
      for (const view of leftOut)
        expect(
          report.toComplete.some((item) => item.what.startsWith(`${view.name} is not in the report`)),
          `${r.id}: ${view.name}`,
        ).toBe(true)
      expect(reportMarkdown(report)).toContain('Views left out of this report')
      expect(reportHtml(report, null)).toContain('Viewpoint 2: not captured.')
      expect(reportPdf(report, null, jspdf).byteLength).toBeGreaterThan(0)
      const options = { created: CREATED }
      expect(
        (await reportDocx(report, null, { imageInfo: kit.imageInfo, writeDocx }, options)).byteLength,
      ).toBeGreaterThan(0)
      const routed = await recipeReportDocx(
        { recipe, imageInfo: kit.imageInfo, writeDocx },
        { recipe: r, ctx: context(r.format), leftOut, logo: null, options },
      )
      expect(routed.byteLength).toBeGreaterThan(0)
    })
})
