import { describe, expect, it } from 'vitest'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import { imageLabel, reportHtml, reportMarkdown } from './html'
import { designElementsMatrix, partialCutMatrix, table2Bar } from './matrices'
import { flatBlocks, type ReportBlock } from './model'
import {
  blockVisibilitySentences,
  preparerText,
  rangeStanding,
  runConclusion,
  SUMMARY_QUESTIONS_2001,
  viewDirection,
  visibilityPhrase,
  type ReportContext,
} from './parts'
import { CONSULTANT_RECIPE_PARTS } from './partsConsultant'
import { findReportPart, REPORT_PARTS } from './registry'
import { assembleReport, recipeFormat, REPORT_RECIPES, withViewsLeftOut } from './recipes'
import { viewsLeftOutMarkdown } from '../viaDocument/markdown'

const facts: DocumentFacts = {
  project: 'Block X1',
  viewpoints: [
    {
      name: 'Lakeshore',
      landform: 'Landform 1',
      objective: 'PR',
      inventory: { vsu: '12', vsc: '2', vac: 'M', evc: 'R', vqo: 'PR' },
      areas: { landform: 10000, proposed: 300, nonVeg: 0, privateLand: 0, rock: 500 },
      sightlinePercent: 3.1,
      distanceKm: 2.6,
      hfovDeg: 39.6,
      lensMm: 50,
      lngLat: [-122.5, 53.9],
      blocks: [
        { id: 'X1', status: 'visible', visiblePercent: 40 },
        { id: 'X2', status: 'not visible', visiblePercent: 0 },
      ],
    },
  ],
}

function context(recipeFormatId: string, over: Partial<ReportContext> = {}): ReportContext {
  return {
    date: new Date('2026-11-14T12:00:00Z'),
    office: { licence: 'A00000', cuttingPermit: '1' },
    blocks: [
      { name: 'X1', areaHa: 12.4, system: 'Clearcut', retentionPercent: null, partialCut: null },
      {
        name: 'X2',
        areaHa: 8,
        system: 'Partial cut',
        retentionPercent: null,
        partialCut: { removedPercent: 40, residualHeightM: 25 },
      },
    ],
    landform: { name: 'Landform 1', objective: 'PR', vac: 'M', areaHa: 410, source: 'drawn in step 1' },
    inventory: facts.viewpoints[0].inventory ?? null,
    inventoryRead: true,
    facts,
    document: resolveViaDocument(findDocumentFormat(recipeFormatId)!, facts),
    assessment: null,
    review: null,
    breakdown: null,
    method: { terrain: 'AWS Open Data terrain', vegetation: 'VRI', eyeHeightM: 1.6 },
    measures: [],
    figures: [],
    ...over,
  }
}

const all = (blocks: ReportBlock[]) => JSON.stringify(blocks)

describe('VIA report recipes', () => {
  it('name only parts and formats that exist, and cover every report asked for', () => {
    for (const recipe of REPORT_RECIPES) {
      expect(() => recipeFormat(recipe), recipe.id).not.toThrow()
      for (const id of recipe.parts) expect(findReportPart(id), `${recipe.id}: ${id}`).not.toBeNull()
    }
    const covered = new Set(REPORT_RECIPES.flatMap((recipe) => recipe.sources))
    for (const doc of ['01', '02', '03', '05', '06', '21', '22', '23', '26']) expect(covered.has(doc), doc).toBe(true)
  })

  it('register each part id once across the modules', () => {
    const ids = REPORT_PARTS.map((part) => part.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('share their parts: every part serves at least one recipe, most serve several', () => {
    const uses = new Map(REPORT_PARTS.map((part) => [part.id, 0]))
    // The consultant reports' part lists, from `partsConsultant.ts`, which `recipes.ts` reads.
    const lists = [...REPORT_RECIPES.map((recipe) => recipe.parts), ...Object.values(CONSULTANT_RECIPE_PARTS)]
    for (const parts of lists) for (const id of new Set(parts)) uses.set(id, (uses.get(id) ?? 0) + 1)
    expect([...uses].filter(([, n]) => n === 0)).toEqual([])
    expect([...uses.values()].filter((n) => n > 1).length).toBeGreaterThan(REPORT_PARTS.length / 2)
  })

  it('assemble every recipe, printing blanks rather than placeholders, and list what is left', () => {
    for (const recipe of REPORT_RECIPES) {
      const report = assembleReport(recipe, context(recipe.format))
      const html = reportHtml(report, null)
      expect(html, recipe.id).not.toMatch(/\{\w+\}|undefined|NaN/)
      expect(reportMarkdown(report), recipe.id).not.toMatch(/\{\w+\}|undefined|NaN/)
      expect(report.toComplete.length, recipe.id).toBeGreaterThan(0)
      // No logo given: the slot keeps its place and draws nothing.
      expect(html).toContain('<div class="logo"></div>')
      expect(html).not.toContain('Logo (your own)')
    }
  })

  it('puts the logo in the title block when there is one', () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'consultant-net-private')!
    const html = reportHtml(assembleReport(recipe, context(recipe.format)), {
      name: 'mine.png',
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(html).toContain('<div class="logo"><img src="data:image/png;base64,AAAA" alt="mine.png">')
    expect(html).not.toContain('Logo (your own)')
  })
})

describe('report parts', () => {
  it('read the 2001 worksheet on the format’s rule and answer the numerical question from the run', () => {
    const ctx = context('form-2001-analysed-photos')
    const numerical = findReportPart('numerical-data')!.build(ctx).blocks
    // Net of rock and private land: 300 / (10000 - 500) = 3.2% (one decimal), Partial Retention.
    // One worksheet, a column per viewpoint, as the 2001 forms print it.
    const worksheet = numerical.find((b) => b.kind === 'table' && b.title === 'Percent alteration worksheet')
    expect(worksheet?.kind === 'table' && worksheet.rows.find((row) => row[0].startsWith('4.'))).toEqual([
      '4. Percent alteration ((2 + 3) / 1)',
      '3.2%',
    ])
    // Each viewpoint's class on the format's scale, and the class met from them all, ticked from the run.
    expect(worksheet?.kind === 'table' && worksheet.rows.at(-1)).toEqual([
      'VQO achieved on percent alteration (Handbook Table 2 (perspective view))',
      'PR',
    ])
    // The summary forms (03, 05) ask which class the figures alone meet, ticked from the run, under the form's
    // instructions; 01's partial-cut form does not ask it.
    expect(numerical.find((b) => b.kind === 'choices')).toBeUndefined()
    const form = findReportPart('numerical-data')!.build({ ...ctx, recipeParts: ['numerical-data', 'notes-2001'] })
    expect(form.blocks.find((b) => b.kind === 'choices')).toMatchObject({
      label: expect.stringContaining('based on percent alteration only'),
      chosen: 'PR',
      source: 'run',
    })
    expect(all(form.blocks)).toContain('Complete either the clearcut or partial-cutting section below')
    expect(all(numerical)).not.toContain('Complete either the clearcut')
    // A clearcut block brings the poster's clearcut guide, read at the run's 3.2%; the partial cut its table.
    expect(all(numerical)).toContain('Clearcut harvesting')
    expect(all(numerical)).toContain('Partial cutting')
    const withoutClearcut = findReportPart('numerical-data')!.build({ ...ctx, blocks: ctx.blocks.slice(1) }).blocks
    expect(all(withoutClearcut)).not.toContain('Clearcut harvesting')
    const summary = findReportPart('summary-2001')!.build(ctx)
    // The form's own long questions (03), the numerical one answered from every viewpoint's figure.
    const within = summary.blocks.find((b) => b.kind === 'choices' && b.label === SUMMARY_QUESTIONS_2001.numerical)
    expect(within).toMatchObject({ chosen: 'Yes', source: 'run' })
    // The judgements are blank and listed, never filled from the run.
    expect(summary.toComplete).toEqual(expect.arrayContaining([SUMMARY_QUESTIONS_2001.met]))
    expect(all(summary.blocks)).not.toContain('Is the VQO met?')
  })

  it('print Appendix 1 blank when no viewpoint sees the proposal and step 4 is not recorded, and say so', () => {
    const unseen: DocumentFacts = {
      ...facts,
      viewpoints: [
        {
          ...facts.viewpoints[0],
          areas: { ...facts.viewpoints[0].areas!, proposed: 0 },
          blocks: [{ id: 'X1', status: 'not visible', visiblePercent: 0 }],
        },
      ],
    }
    const format = findDocumentFormat('appendix-1-net-private-rock')!
    const out = findReportPart('appendix-1')!.build(
      context(format.id, { facts: unseen, document: resolveViaDocument(format, unseen) }),
    )
    expect(all(out.blocks)).toContain('not filled')
    // The form itself still prints, its judgements and the viewpoint's lines blank, never filled from another view.
    expect(all(out.blocks)).toContain('3.4.2 Numerical assessment')
    expect(all(out.blocks)).toContain('"label":"Viewpoint description","value":null')
    expect(flatBlocks(out.blocks).some((b) => b.kind === 'signature')).toBe(true)
    expect(out.toComplete?.[0]).toBe('Step 4 at the assessment station')
  })

  it('write the EA memo’s existing conditions from the inventory read, and visibility from the run', () => {
    const noVqo = context('referral-panoramas', { landform: null, inventory: null })
    const memo = all(findReportPart('ea-visual-memo')!.build(noVqo).blocks)
    expect(memo).toContain('not in an area with an established visual quality objective')
    expect(memo).toContain('Lakeshore: the development is expected to be partly visible: 1 of 2 blocks in view')
    // A few pixels of the landform, or glimpses only, are never called visible.
    expect(visibilityPhrase([{ status: 'visible', visiblePercent: 8 }], '0.04')).toMatch(
      /^may be seen only in glimpses/,
    )
    expect(visibilityPhrase([{ status: 'possible glimpses', visiblePercent: 2 }], '1.20')).toMatch(/glimpses/)
    expect(visibilityPhrase([{ status: 'unknown', visiblePercent: 0 }], '1.20')).toBeNull()
    const unread = all(findReportPart('ea-visual-memo')!.build({ ...noVqo, inventoryRead: false }).blocks)
    expect(unread).toContain('was not read')
  })
})

describe('the templates the reference comparison found missing', () => {
  it('state each viewpoint’s answer to the numerical question, and ask for reasons only when it is over', () => {
    const out = all(findReportPart('summary-2001')!.build(context('form-2001-analysed-photos')).blocks)
    expect(out).toContain(
      'From Lakeshore, the alteration is 3.2% of the landform net of rock and private land, within the Partial Retention range (PR 1.6-7%).',
    )
    expect(out).not.toContain('Reasons the alteration exceeds')
  })

  it('write a viewpoint page’s rationale and each block’s visibility from the run', () => {
    const ctx = context('appendix-1-net-private-rock')
    const page = all(findReportPart('viewpoint-pages')!.build(ctx).blocks)
    expect(page).toContain(
      'Lakeshore looks toward Landform 1, 2.6 km from the nearest block it sees; Block X1 is in view (3.2% of the landform in the picture).',
    )
    expect(blockVisibilitySentences(ctx).map((s) => s.text)).toEqual([
      'From Lakeshore, Block X1 is visible, with 40% of its ground in view.',
      'From Lakeshore, Block X2 is not expected to be visible.',
    ])
  })

  it('adopt the inventory unit in a sentence, offer the certification, and state the purpose', () => {
    const ctx = context('perspective-report-net-private')
    expect(all(findReportPart('inventory')!.build(ctx).blocks)).toContain(
      'Landform 1 takes visual sensitivity unit 12 from the visual landscape inventory: sensitivity class 2, absorption capability M, existing visual condition R and an established objective of PR.',
    )
    const signOff = findReportPart('sign-off')!
      .build(ctx)
      .blocks.find((b) => b.kind === 'choices')
    expect(signOff).toMatchObject({ chosen: null, source: 'reviewer' })
    expect(all(findReportPart('purpose')!.build(ctx).blocks)).toContain(
      'This assessment tests whether Blocks X1 and X2 meet the Partial Retention (PR) objective established for Landform 1, as seen from 1 viewpoint.',
    )
  })
})

describe('the preparer', () => {
  it('prints the evaluator with their designation and own organisation, and leaves the seal to complete', () => {
    const ctx = context('perspective-report-net-private', {
      office: {
        licensee: 'Client Ltd.',
        evaluator: 'J. Smith',
        evaluatorDesignation: 'RPF #4521',
        evaluatorOrganisation: 'Northwood Forestry',
      },
    })
    expect(preparerText(ctx.office, true)).toBe('J. Smith, RPF #4521, Northwood Forestry')
    expect(preparerText({ evaluatorDesignation: 'RPF' })).toBeNull()
    expect(all(findReportPart('sign-off')!.build(ctx).blocks)).toContain('J. Smith, RPF #4521, Northwood Forestry')
    const certified = findReportPart('sign-off-certified')!.build(ctx)
    expect(certified.toComplete).toEqual(['Prepared by: seal, signature and date'])
    expect(all(certified.blocks)).toContain('RPF #4521')
    const peer = findReportPart('sign-off-peer')!.build(context('perspective-report-net-private'))
    expect(peer.toComplete).toContain('Prepared by: designation, seal, signature and date')
  })
})

describe('report layout', () => {
  it('prints on its own paper, with a cover, contents, page numbers, landscape tables and 11 x 17 sheets', () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'appendix-1-report')!
    const sheet = {
      view: 'Lakeshore',
      caption: 'Lakeshore: analysis',
      dataUrl: 'data:image/png;base64,AA',
      width: 1224,
      height: 792,
    }
    const html = reportHtml(assembleReport(recipe, context(recipe.format, { figures: [sheet] })), null)
    expect(html).toContain('@page{size:legal portrait')
    expect(html).toContain('counter(page) " of " counter(pages)')
    expect(html).toContain('<section class="cover">')
    expect(html).toMatch(/<figure class="sheet"( id="f\d+")?>/)
    const consultant = REPORT_RECIPES.find((entry) => entry.id === 'consultant-net-private')!
    const report = reportHtml(assembleReport(consultant, context(consultant.format)), null)
    expect(report).toContain('<nav class="contents"><h2>Contents</h2>')
    // Table 5 has thirteen columns: a landscape page.
    expect(report).toMatch(/<div class="wide"><h4>Table 5: Detailed assessment of visual impact from the key viewpoint/)
    const form = REPORT_RECIPES.find((entry) => entry.id === 'form-2001-sheets')!
    const formHtml = reportHtml(assembleReport(form, context(form.format)), null)
    expect(formHtml).not.toContain('<section class="cover">')
    expect(formHtml).toContain('<th>VP 1</th>')
  })

  it('lists the figure pages under Images in the contents, each linked to an anchor inside its own page', () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'form-2001-photos')!
    const sheet = { view: 'Lakeshore', caption: 'Lakeshore: analysis', dataUrl: 'data:,', width: 1224, height: 792 }
    const photo = { ...sheet, caption: 'Lakeshore: photograph', source: 'photo' as const }
    const html = reportHtml(
      assembleReport(recipe, context(recipe.format, { figures: [sheet], images: { before: { Lakeshore: photo } } })),
      null,
    )
    const contents = html.match(/<nav class="contents">.*?<\/nav>/s)?.[0] ?? ''
    expect(contents).toContain('<h4>Images</h4>')
    expect(contents).toMatch(/<a href="#f\d+">Lakeshore: analysis<\/a>/)
    const pair = contents.match(/<a href="#(f\d+)">Lakeshore: [^<]+ \/ [^<]+<\/a>/)
    expect(pair).not.toBeNull()
    // The anchor sits just inside the figure's own opening tag, so the page rules that read the tag still apply.
    expect(html).toContain(` id="${pair![1]}">`)
    expect(html).toMatch(/<figure class="sheet" id="f\d+">/)
    expect(
      imageLabel({ kind: 'figurePage', number: 'Figure 2', title: 'Visualization', facts: [], side: [], main: [] }),
    ).toBe('Figure 2: Visualization')
    expect(imageLabel({ kind: 'pageBreak' })).toBeNull()
  })
})

describe('fixes from the second reading', () => {
  it('names a viewpoint that brings its own article once, and lists the reasons line for an over-range viewpoint', () => {
    const over = {
      ...facts.viewpoints[0],
      name: 'The Shores',
      areas: { landform: 1000, proposed: 300, nonVeg: 0, privateLand: 0, rock: 0 },
    }
    const ctx = context('form-2001-analysis-sheets', {
      facts: { ...facts, viewpoints: [over] },
      document: resolveViaDocument(findDocumentFormat('form-2001-analysis-sheets')!, { ...facts, viewpoints: [over] }),
    })
    const out = findReportPart('summary-2001')!.build(ctx)
    expect(all(out.blocks)).toContain('From The Shores, the alteration is 30.00%')
    // The reasons line names the viewpoint it is for.
    expect(all(out.blocks)).toContain('Reasons the alteration exceeds the range from The Shores')
    expect(out.toComplete).toContain('Reasons the alteration exceeds the numerical range from The Shores')
  })

  it('keeps a heading on the landscape or 11 x 17 page it introduces', () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'form-2001-sheets')!
    const sheet = {
      view: 'Lakeshore',
      caption: 'Lakeshore: analysis',
      dataUrl: 'data:image/png;base64,AA',
      width: 1224,
      height: 792,
    }
    const html = reportHtml(assembleReport(recipe, context(recipe.format, { figures: [sheet] })), null)
    // The section heading before it ("Calculations") moves with the viewpoint's heading onto the sheet's page.
    expect(html).toMatch(
      /<div class="sheet-page"><h3 id="s\d+">[^<]+<\/h3><h4>Lakeshore<\/h4><figure class="sheet"( id="f\d+")?>/,
    )
    expect(html).not.toMatch(/<li>\d+\. /)
    // The consultant reports number the sheet in their appendix, its heading on the sheet's page.
    const consultant = REPORT_RECIPES.find((entry) => entry.id === 'consultant-net-private')!
    expect(reportHtml(assembleReport(consultant, context(consultant.format, { figures: [sheet] })), null)).toMatch(
      /<div class="sheet-page"><h4>Appendix A\d+: Perspective Viewpoint Analysis – Lakeshore[^<]*<\/h4><figure class="sheet"( id="f\d+")?>/,
    )
  })

  it('prints a short paragraph closing a landscape table’s section on the table’s page, never a long one (22, Table 2)', () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'consultant-net-private')!
    const columns = ['Landform', 'Blocks', 'VSU', 'VSC', 'VAC', 'EVC', 'VQO', 'Description']
    const table: ReportBlock = { kind: 'table', title: 'Table 2', columns, rows: [columns], source: 'run' }
    const said = (text: string): ReportBlock => ({
      kind: 'paragraph',
      sentences: [{ id: 'split', text, source: 'scene', missing: [], template: text }],
    })
    const html = (closing: ReportBlock) =>
      reportHtml(
        {
          ...assembleReport(recipe, context(recipe.format)),
          blocks: [
            { kind: 'heading', level: 1, text: 'Visual Impact Assessment' },
            { kind: 'heading', level: 2, text: 'Landforms' },
            table,
            closing,
            { kind: 'heading', level: 2, text: 'Viewpoints' },
          ],
        },
        null,
      )
    expect(html(said('Landform 1b is assessed as a sub-landform of Landform 1.'))).toMatch(
      /<div class="wide-page"><h3 id="s\d+">Landforms<\/h3><div class="wide">.*<\/div><p>Landform 1b is assessed as a sub-landform of Landform 1\.<\/p><\/div>/s,
    )
    // A discussion stays on portrait pages.
    expect(html(said('x'.repeat(2000)))).toMatch(/<\/div><\/div>\n<p>x{2000}<\/p>/)
  })
})

describe('matrices and scales', () => {
  it('places a partial cut’s X in the clearcut-equivalent table', () => {
    const matrix = partialCutMatrix({ removedPercent: 40, residualHeightM: 25 })
    if (matrix.kind !== 'matrix') throw new Error('matrix expected')
    expect(matrix.point).toEqual({ row: 3, column: 4 })
    expect(matrix.cells[3][4]).toBe('3.4')
    expect(partialCutMatrix(null).kind === 'matrix' && (partialCutMatrix(null) as { marks: unknown[] }).marks).toEqual(
      [],
    )
  })

  it('marks each rated design element on its own row and leaves unrated rows bare', () => {
    const matrix = designElementsMatrix({ 'force-lines': -1, 'edge-treatment': 1 }, 'reviewer')
    if (matrix.kind !== 'matrix') throw new Error('matrix expected')
    expect(matrix.marks).toEqual([
      { row: 0, column: 0 },
      { row: 2, column: 2 },
    ])
  })

  it('places X on the Appendix 1 bar and draws it', () => {
    const bar = table2Bar('Initial percent alteration (X)', 7.8, 'run')
    expect(bar).toMatchObject({ kind: 'scale', mark: 7.8, markLabel: '7.8%' })
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'appendix-1-report')!
    const html = reportHtml({ ...assembleReport(recipe, context(recipe.format)), blocks: [bar] }, null)
    expect(html).toContain('<svg class="scale"')
    expect(html).toContain('30+')
  })
})

describe('26: why each viewpoint, timber screening, regrowth', () => {
  const screenedFacts: DocumentFacts = {
    ...facts,
    viewpoints: [
      {
        ...facts.viewpoints[0],
        blocks: [
          { id: 'X1', status: 'visible', visiblePercent: 40, screenedPercent: 30 },
          { id: 'X2', status: 'not visible', visiblePercent: 0, screenedPercent: 60 },
        ],
      },
      {
        ...facts.viewpoints[0],
        name: 'Ridge road',
        areas: { ...facts.viewpoints[0].areas!, proposed: 0 },
        blocks: [{ id: 'X1', status: 'not visible', visiblePercent: 0 }],
      },
    ],
  }
  const ctx = context('referral-panoramas', {
    facts: screenedFacts,
    document: resolveViaDocument(findDocumentFormat('referral-panoramas')!, screenedFacts),
    recipeParts: ['ea-visual-memo', 'overview-map'],
  })
  const memo = JSON.stringify(findReportPart('ea-visual-memo')!.build(ctx).blocks)

  it('says which viewpoints were simulated and why, from the run', () => {
    expect(memo).toContain(
      'Lakeshore is simulated because the run finds a line of sight from it to the proposed blocks; Ridge road has none and is shown with the blocks’ position marked.',
    )
  })

  it('gives the timber screening by area, and the proposal, the map and regrowth', () => {
    // X1 12.4 ha at 30%, X2 8 ha at 60%: 41.8% screened; 40% and 0% in sight: 24.3%.
    expect(memo).toContain(
      'From Lakeshore, standing timber between the viewer and the blocks hides 42% of their ground; 24% is in line of sight.',
    )
    expect(memo).toContain('Figure 1 shows the 2 observer viewpoints and the proposed blocks.')
    expect(memo).toContain('which the simulations do not model')
    expect(memo).not.toContain('From Ridge road, standing timber')
    expect(memo).not.toContain('read bare ground')
  })

  it('prints the with-timber pixel figure beside the visibility, or why it was not measured', () => {
    const withTimber = (timber: DocumentFacts['viewpoints'][number]['withTimber']): DocumentFacts => ({
      ...screenedFacts,
      viewpoints: screenedFacts.viewpoints.map((vp) => ({ ...vp, ...(timber ? { withTimber: timber } : {}) })),
    })
    const build = (part: string, facts: DocumentFacts, format = 'referral-panoramas') =>
      JSON.stringify(
        findReportPart(part)!.build({
          ...ctx,
          facts,
          document: resolveViaDocument(findDocumentFormat(format)!, facts),
        }).blocks,
      )
    const areas = { ...screenedFacts.viewpoints[0].areas!, proposed: 0 }
    const measured = build('ea-visual-memo', withTimber({ areas, source: 'pgmaps' }))
    expect(measured).toMatch(
      /Lakeshore: the development [^"]*; with the drawn timber in front, [\d.]+% of the landform/,
    )
    const absent = build('ea-visual-memo', withTimber({ absent: 'no before-harvest render of this view' }))
    expect(absent).toContain(
      'the figure with the drawn timber in front was not measured (no before-harvest render of this view)',
    )
    // The calculation strip: a field of its own, beside the pixel and sightline figures, never instead of them.
    const calc = build(
      'calculations',
      withTimber({ absent: 'no before-harvest render of this view' }),
      'appendix-1-net-private-rock',
    )
    expect(calc).toContain(
      '"label":"Pixel figure, with drawn timber","value":"Not measured: no before-harvest render of this view"',
    )
    expect(calc).toContain('Sightline figure (the assessment’s)')
    expect(build('calculations', withTimber(undefined), 'appendix-1-net-private-rock')).not.toContain(
      'with drawn timber',
    )
  })

  it('says when the run read bare ground only', () => {
    const bare = { ...screenedFacts, screeningModelled: false }
    const out = JSON.stringify(
      findReportPart('ea-visual-memo')!.build({
        ...ctx,
        facts: bare,
        document: resolveViaDocument(findDocumentFormat('referral-panoramas')!, bare),
      }).blocks,
    )
    expect(out).toContain('standing timber was not counted as screening')
  })
})

describe('report layout and the 2001 forms, third reading', () => {
  const sheet = { view: 'Lakeshore', caption: 'Lakeshore: analysis', dataUrl: 'data:,', width: 2448, height: 1584 }

  it('prints the viewpoint’s elevation, direction of view and viewing angle where the run knows them', () => {
    const at = { ...facts.viewpoints[0], elevationM: 883.6, bearingDeg: 10, hfovDeg: 60 }
    const known = { ...facts, viewpoints: [at] }
    const out = findReportPart('viewpoints-columns')!.build(context('form-2001-analysis-sheets', { facts: known }))
    const table = out.blocks.find((b) => b.kind === 'table')
    const row = (label: string) => (table?.kind === 'table' ? table.rows.find((r) => r[0] === label) : undefined)
    expect(row('Viewpoint elevation')).toEqual(['Viewpoint elevation', '884 m'])
    // The field's left and right edges, three digits, across north as 03 prints "315-030".
    expect(row('Direction of view')).toEqual(['Direction of view', '340°–040°'])
    expect(row('Viewing angle (horizontal field)')).toEqual(['Viewing angle (horizontal field)', '60°'])
    // Unknown stays blank, never 0 m.
    const blank = findReportPart('viewpoints-columns')!.build(context('form-2001-analysis-sheets'))
    const empty = blank.blocks.find((b) => b.kind === 'table')
    expect(empty?.kind === 'table' && empty.rows.find((r) => r[0] === 'Viewpoint elevation')).toEqual([
      'Viewpoint elevation',
      '',
    ])
    expect(viewDirection({ bearingDeg: 200 })).toBe('200°')
    expect(viewDirection({ bearingDeg: null, hfovDeg: 60 })).toBe('')
    // 06's viewpoint pages and Appendix 1 carry them too.
    const pages = all(
      findReportPart('viewpoint-pages')!.build(context('appendix-1-net-private-rock', { facts: known })).blocks,
    )
    expect(pages).toContain('"label":"Elevation","value":"884 m"')
    expect(pages).toContain('"label":"Viewing direction","value":"340°–040°"')
  })

  it('asks section 1 by viewpoint columns and one class, as 03 and 05 print it', () => {
    const out = findReportPart('basic-definition')!.build(context('form-2001-analysis-sheets'))
    const table = out.blocks.find((b) => b.kind === 'table')
    expect(table?.kind === 'table' && table.columns).toEqual([
      'Describe the level of impact from each viewpoint',
      'VP 1',
    ])
    expect(out.blocks.filter((b) => b.kind === 'choices')).toHaveLength(1)
    expect(out.toComplete).toContain('Basic VQO definition met from all viewpoints (class by eye, step 4)')
  })

  it('prints the partial-cut evaluation, not the whole table, when no block is cut so', () => {
    const ctx = context('form-2001-analysis-sheets', { blocks: [context('form-2001-analysis-sheets').blocks[0]] })
    const out = all(findReportPart('numerical-data')!.build(ctx).blocks)
    expect(out).toContain('Not applicable: no block is recorded as a partial cut')
    expect(out).not.toContain('printed for reference')
  })

  it('concludes on the run’s facts when the format writes no conclusion of its own', () => {
    const sentences = runConclusion(context('appendix-1-net-private-rock'))
    const text = sentences.map((s) => s.text).join(' ')
    expect(text).toContain('Lakeshore sees part of Blocks X1 and X2.')
    // 300 / (10000 - 500) = 3.2%, read on the format's own scale.
    expect(text).toContain('the percent alteration of the landform is 3.2% from Lakeshore (Partial Retention)')
    expect(text).toContain('The figure is within the Partial Retention range')
    const out = all(findReportPart('conclusion')!.build(context('appendix-1-net-private-rock')).blocks)
    expect(out).not.toContain('The conclusion is written once')
  })

  it('prints an analysis sheet on the full 11 x 17 page with its calculation as one strip under it', () => {
    const blocks: ReportBlock[] = [
      { kind: 'heading', level: 1, text: 'Report' },
      { kind: 'text', text: 'Body.', source: 'fixed' },
      { kind: 'heading', level: 2, text: 'Calculations' },
      { kind: 'figure', figure: sheet, caption: sheet.caption },
      { kind: 'fields', rows: [{ label: 'Landform', value: '100 px', source: 'run' }] },
    ]
    const html = reportHtml(
      {
        id: 'x',
        title: 'Report',
        subtitle: 's',
        sources: [],
        blocks,
        footer: 'f',
        layout: { paper: 'letter', cover: false, contents: false },
        toComplete: [
          { part: 'Header', what: 'Licence' },
          { part: 'Header', what: 'Permit' },
        ],
      },
      null,
    )
    expect(html).toContain('<table class="sheet-calc"><tr><th>Landform</th></tr><tr><td>100 px</td></tr></table>')
    expect(html).not.toContain('height:7.4in')
    expect(html).toMatch(/\.sheet-page\{page:sheet;display:flex;flex-direction:column;height:10\.2in/)
    // The list goes before the trailing sheet, one line per part, so it never takes a last page of its own.
    expect(html.indexOf('id="complete"')).toBeLessThan(html.indexOf('class="sheet-page"'))
    expect(html).toContain('<li><b>Header:</b> Licence; Permit</li>')
    // A full-size map sheet keeps its own rules.
    expect(html).toContain('figure.sheet.full{page:sheetfull')
  })

  it('lists a document sentence once when a part already lists the same judgement', () => {
    const recipe = REPORT_RECIPES.find((entry) => entry.id === 'form-2001-sheets')!
    const report = assembleReport(recipe, context(recipe.format))
    expect(report.toComplete.some((item) => item.part === 'Wording' && /ocular/.test(item.what))).toBe(false)
  })

  it('gives 03 the yes / no design questions and 02 the full certification and landscape simulations', () => {
    const form = REPORT_RECIPES.find((entry) => entry.id === 'form-2001-sheets')!
    expect(form.parts).toContain('design-questions-2001')
    expect(form.parts).not.toContain('visual-design')
    const rationale = REPORT_RECIPES.find((entry) => entry.id === 'design-rationale')!
    expect(rationale.parts).toEqual(expect.arrayContaining(['certification-2001', 'simulation-pages']))
    expect(rationale.parts).not.toContain('sign-off')
    const handbook = REPORT_RECIPES.find((entry) => entry.id === 'appendix-1-report')!
    expect(handbook.parts.indexOf('sign-off')).toBeGreaterThan(handbook.parts.indexOf('conclusion'))
    const report = assembleReport(rationale, context(rationale.format, { figures: [sheet] }))
    const html = reportHtml(report, null)
    expect(html).toContain('I certify that I have reviewed this document')
    expect(html).toContain('vf-pair vf-landscape')
    expect(html).toContain('not a field-verified photograph')
    // 02 prints no overview map, so its attachments never claim one.
    expect(JSON.stringify(report.blocks)).not.toContain('VIA overview map')
  })
})

describe('rangeStanding', () => {
  it('says below, within or over the objective’s range, never "within" a range the figure is under', () => {
    expect(rangeStanding('R', 'PR', 'PR 1.6-7%')).toBe(
      'below the Partial Retention range (PR 1.6-7%), within what Partial Retention allows',
    )
    expect(rangeStanding('PR', 'PR', 'PR 1.6-7%')).toBe('within the Partial Retention range (PR 1.6-7%)')
    expect(rangeStanding('M', 'PR', 'PR 1.6-7%')).toBe('over the Partial Retention range (PR 1.6-7%)')
  })
})

describe('views of the package a report or document does not print', () => {
  it('names each at the end of the report and lists it to complete, never dropping it silently', () => {
    const recipe = REPORT_RECIPES[0]
    const report = assembleReport(recipe, context(recipe.format))
    expect(withViewsLeftOut(report, [])).toBe(report)
    const named = withViewsLeftOut(report, [
      { name: 'VLI 145', reason: 'its analysis sheet could not be drawn: no frame.' },
    ])
    expect(named.blocks.slice(-2)).toEqual([
      { kind: 'heading', level: 2, text: 'Views left out of this report' },
      { kind: 'list', items: ['VLI 145: its analysis sheet could not be drawn: no frame.'], source: 'run' },
    ])
    expect(named.toComplete.at(-1)).toEqual({
      part: 'Figures',
      what: 'VLI 145 is not in the report (its analysis sheet could not be drawn: no frame): capture it again or leave it out of the package',
    })
    expect(reportMarkdown(named)).toContain('VLI 145: its analysis sheet could not be drawn: no frame.')
  })

  it('closes a VIA document with the views it does not hold', () => {
    expect(viewsLeftOutMarkdown([])).toBe('')
    expect(viewsLeftOutMarkdown([{ name: 'Viewpoint 4', reason: 'not captured' }])).toBe(
      '\n## Views left out of this document\n\n- Viewpoint 4: not captured.\n',
    )
  })
})

describe('the objective’s authority', () => {
  const sentences = (ctx: ReportContext, id: string) => all(findReportPart(id)!.build(ctx).blocks)
  const gaps = (ctx: ReportContext, id: string) => findReportPart(id)!.build(ctx).toComplete ?? []
  const noObjective: Partial<ReportContext> = {
    landform: { name: 'Landform 1', objective: null, vac: 'M', areaHa: 410, source: 'drawn' },
    inventory: null,
  }

  it('names the order or plan only when the objective is recorded too', () => {
    const both = context('perspective-report-net-private', { office: { sourceDocument: 'a made-up land use order' } })
    expect(sentences(both, 'regulatory-frame')).toContain(
      'is Partial Retention (PR), established by a made-up land use order.',
    )
    expect(sentences(both, 'design-rationale')).toContain('The objective is established by a made-up land use order.')
    expect(gaps(both, 'regulatory-frame')).toEqual([])

    const authorityOnly = context('perspective-report-net-private', {
      ...noObjective,
      office: { sourceDocument: 'a made-up land use order' },
    })
    for (const id of ['regulatory-frame', 'design-rationale']) {
      expect(sentences(authorityOnly, id), id).not.toContain('established by')
      expect(sentences(authorityOnly, id), id).not.toContain('a made-up land use order')
      expect(gaps(authorityOnly, id), id).toContain('Established visual quality objective')
    }
    expect(sentences(authorityOnly, 'regulatory-frame')).toContain('for the landform is not recorded.')

    const neither = context('perspective-report-net-private', { ...noObjective, office: {} })
    expect(gaps(neither, 'regulatory-frame')).toEqual([
      'Established visual quality objective',
      'Objective source document',
    ])
  })

  it('prints a historical reference only among the references, never as the objective’s authority', () => {
    const ctx = context('perspective-report-net-private', {
      office: { referenceDocument: 'a made-up earlier assessment' },
    })
    for (const id of ['regulatory-frame', 'design-rationale', 'inventory'])
      expect(sentences(ctx, id), id).not.toContain('a made-up earlier assessment')
    expect(sentences(ctx, 'regulatory-frame')).not.toContain('established by')
    expect(gaps(ctx, 'regulatory-frame')).toEqual(['Objective source document'])
    expect(sentences(ctx, 'references')).toContain(
      "Historical reference, not the objective's authority: a made-up earlier assessment.",
    )
    expect(sentences(context('perspective-report-net-private'), 'references')).not.toContain('Historical reference')
  })
})
