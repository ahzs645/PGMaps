import { describe, expect, it } from 'vitest'

import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts, type DocumentViewpoint } from '../viaDocument/resolve'
import { PERCENT_SCALES } from '../viaDocument/scales'
import type { ViaAssessment } from '../via'
import { reportHtml, reportMarkdown } from './html'
import type { ReportBlock } from './model'
import type { ReportContext } from './parts'
import { andList, DISTRICT_PARTS, operationArea, rangeFor, withinRange } from './partsDistrict'
import { findReportPart } from './registry'
import { assembleReport, REPORT_RECIPES } from './recipes'

const lakeshore: DocumentViewpoint = {
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
}

const ridge: DocumentViewpoint = {
  ...lakeshore,
  name: 'Ridge Road',
  n: '2',
  areas: { landform: 5000, proposed: 300, nonVeg: 100, privateLand: 0, rock: 0 },
  sightlinePercent: 6.4,
  distanceKm: 0.6,
  blocks: [
    { id: 'X1', status: 'visible', visiblePercent: 70 },
    { id: 'X2', status: 'possible glimpses', visiblePercent: 4 },
  ],
}

function context(formatId: string, viewpoints: DocumentViewpoint[] = [lakeshore], over: Partial<ReportContext> = {}) {
  const facts: DocumentFacts = { project: 'Blocks X1, X2', viewpoints }
  const ctx: ReportContext = {
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
    inventory: lakeshore.inventory ?? null,
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
  return ctx
}

const build = (id: string, ctx: ReportContext) => findReportPart(id)!.build(ctx)
const all = (blocks: ReportBlock[]) => JSON.stringify(blocks)
const tables = (blocks: ReportBlock[]) => blocks.filter((b) => b.kind === 'table')
const fieldRows = (blocks: ReportBlock[]) => blocks.flatMap((b) => (b.kind === 'fields' ? b.rows : []))
const choices = (blocks: ReportBlock[]) => blocks.filter((b) => b.kind === 'choices')

describe('the district summary table (02)', () => {
  it('prints rows 1-12 in the form’s order, filled from the district format', () => {
    const out = build('district-summary-form', context('district-summary'))
    const [inventory, lake, figures] = tables(out.blocks)
    expect(inventory).toMatchObject({
      title: '1. Visual Landscape Inventory/Analysis Data',
      columns: ['Landform', 'VLU #', 'VSR', 'VAC', 'EVC', 'VQO'],
      rows: [['Landform 1', '12', '2', 'M', 'R', 'Partial Retention']],
    })
    expect(lake).toMatchObject({ title: '2. Lake (if applicable)', rows: [['', '', '', '', '', '', '']] })
    // Gross landform, cm² rule, one decimal: 300 / 10000 = 3.0%, under PR<7% on the strict bounds.
    expect(figures).toMatchObject({
      columns: ['4. Viewpoints for assessment (name and/or #)', 'Lakeshore'],
      rows: [
        ['5. Percent of VLU in existing alteration (not visually greened up) (perspective view)', '0.0%'],
        ['6. Percent of VLU in proposed alteration (perspective view)', '3.0%'],
        ['7. Total percent alteration visible (perspective view)', '3.0%'],
        ['8. Does total % alteration fall within VQO guidelines? (P=0%; R<1.5%; PR<7%; M<18%; MM<30%)', 'Yes'],
      ],
    })
    expect(figures.kind === 'table' && figures.note).toContain(
      'The run’s sightline figures, the assessment’s: Lakeshore 3.10%',
    )
    const rows = fieldRows(out.blocks)
    expect(rows.map((row) => row.label.split(' ')[0])).toEqual([
      'Licensee',
      'Sale',
      'Block',
      'Completed',
      'Date',
      'Date',
      '3.',
      '9.',
      '10.',
      '11.',
      '12.',
    ])
    expect(rows.find((row) => row.label === 'Sale or licence #')?.value).toBe('A00000, CP 1')
    expect(rows.find((row) => row.label === 'Block #')?.value).toBe('X1, X2')
    expect(rows.find((row) => row.label.startsWith('3.'))?.value).toBe('20.4 ha (X1 12.4 ha, X2 8.0 ha)')
    // Notes 1-4 and the footer box.
    const notes = out.blocks.find((b) => b.kind === 'list')
    expect(notes).toMatchObject({ ordered: true })
    expect(notes?.kind === 'list' && notes.items).toHaveLength(4)
    expect(all(out.blocks)).toContain('Visual Impact Assessment Guidelines · Kamloops Forest Region')
  })

  it('leaves the reviewer’s answers, the lake and the inventory date blank, and lists them', () => {
    const out = build('district-summary-form', context('district-summary'))
    for (const label of ['9.', '10.', '11.', '12.'])
      expect(fieldRows(out.blocks).find((row) => row.label.startsWith(label))?.value).toBeNull()
    expect(out.toComplete).toEqual(
      expect.arrayContaining([
        'Licensee name',
        'Completed by',
        '1. Date of inventory',
        '2. Lake name, number and class, and the LMZ area and alteration (if a lake applies)',
        expect.stringMatching(/^9\. Describe design principles/),
        '10. Will the proposed operation meet the definition and intent of the VQO?',
        expect.stringMatching(/^11\. Has the VIA included all proposed operations/),
        '12. Additional considerations',
      ]),
    )
  })

  it('takes a column per viewpoint and reads row 8 on the strict bounds, a figure past them being over', () => {
    const atBound = {
      ...ridge,
      name: 'Bound',
      areas: { landform: 10000, proposed: 700, nonVeg: 0, privateLand: 0, rock: 0 },
    }
    const past = {
      ...ridge,
      name: 'Past',
      areas: { landform: 1000, proposed: 400, nonVeg: 0, privateLand: 0, rock: 0 },
    }
    const out = build('district-summary-form', context('district-summary', [lakeshore, ridge, atBound, past]))
    const figures = tables(out.blocks)[2]
    if (figures.kind !== 'table') throw new Error('table expected')
    expect(figures.columns.slice(1)).toEqual(['Lakeshore', 'Ridge Road', 'Bound', 'Past'])
    // Ridge Road: existing 100 + proposed 300 over 5000 = 2.0 + 6.0 = 8.0%.
    expect(figures.rows.map((row) => row[2])).toEqual(['2.0%', '6.0%', '8.0%', 'No'])
    // 7.0% is not under PR<7%, and 40% is past MM<30%: both No.
    expect(figures.rows[3].slice(3)).toEqual(['No', 'No'])
    expect(withinRange(PERCENT_SCALES.handbookTable2, 7, 'PR')).toBe(true)
    expect(withinRange(PERCENT_SCALES.guidebookStrict, 7, 'PR')).toBe(false)
    expect(withinRange(PERCENT_SCALES.guidebookStrict, 3, null)).toBeNull()
  })

  it('reads another format’s arithmetic when the report is in one, and lists a view with no class pass', () => {
    const blind = { ...ridge, name: 'Blind', areas: null }
    const out = build('district-summary-form', context('form-2001-analysis-sheets', [lakeshore, blind]))
    const figures = tables(out.blocks)[2]
    if (figures.kind !== 'table') throw new Error('table expected')
    // Gross pixels, two decimals.
    expect(figures.rows.map((row) => row[1])).toEqual(['0.00%', '3.00%', '3.00%', 'Yes'])
    expect(figures.rows.map((row) => row[2])).toEqual(['', '', '', ''])
    expect(out.toComplete).toContain('5-8. Percent alteration (no class pass): Blind')
  })

  it('fills rows 9 and 10 only from what the reviewer signed', () => {
    const assessment = { rating: { definitionAchieved: true } } as unknown as ViaAssessment
    const out = build(
      'district-summary-form',
      context('district-summary', [lakeshore], {
        measures: ['Feather the upper edge', 'Keep the draw reserve'],
        assessment,
      }),
    )
    const rows = fieldRows(out.blocks)
    expect(rows.find((row) => row.label.startsWith('9.'))).toMatchObject({
      value: 'Feather the upper edge; Keep the draw reserve',
      source: 'reviewer',
    })
    expect(rows.find((row) => row.label.startsWith('10.'))?.value).toBe('Yes')
  })

  it('states the operation area for one block or many, with recorded retention', () => {
    expect(
      operationArea([{ name: 'A', areaHa: 10, system: 'Clearcut', retentionPercent: null, partialCut: null }]),
    ).toBe('10.0 ha (Block A)')
    expect(
      operationArea([
        { name: 'A', areaHa: 10, system: 'Dispersed retention', retentionPercent: 20, partialCut: null },
        { name: 'B', areaHa: 5, system: 'Clearcut', retentionPercent: null, partialCut: null },
      ]),
    ).toBe('15.0 ha (A 10.0 ha, B 5.0 ha; includes about 2.0 ha of recorded retention)')
    expect(operationArea([])).toBeNull()
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C')
    expect(rangeFor(PERCENT_SCALES.guidebookStrict, 'R')).toBe('R<1.5%')
    expect(rangeFor(PERCENT_SCALES.handbookTable2, 'M')).toBe('M 7.1-18%')
  })
})

describe('the 2001 form parts (01, 03, 05)', () => {
  it('prints the header with the scene’s systems, adding year and operation type on the summary form', () => {
    const ctx = context('form-2001-analysis-sheets')
    const plain = build('form-header-2001', ctx)
    expect(fieldRows(plain.blocks).map((row) => row.label)).toEqual([
      'Licensee name',
      'Licensee no.',
      'Cutting permit',
      'Blocks',
      'General location',
      'Proposed silvicultural system',
      'Date',
    ])
    expect(fieldRows(plain.blocks).find((row) => row.label === 'Proposed silvicultural system')?.value).toBe(
      'Clearcut (X1); Partial cut (X2)',
    )
    expect(plain.toComplete).toEqual(['Licensee name', 'General location'])
    const summary = build('form-header-2001', { ...ctx, recipeParts: ['form-header-2001', 'notes-2001'] })
    expect(summary.toComplete).toEqual(
      expect.arrayContaining(['Proposed year of harvest', 'Type of proposed operation']),
    )
  })

  it('tables gross, leave and net with a total, leaving unrecorded leave blank', () => {
    const ctx = context('form-2001-analysis-sheets', [lakeshore], {
      blocks: [
        { name: 'X1', areaHa: 12.4, system: 'Dispersed retention', retentionPercent: 25, partialCut: null },
        { name: 'X2', areaHa: 8, system: 'Clearcut', retentionPercent: null, partialCut: null },
      ],
    })
    const out = build('block-areas-2001', ctx)
    expect(tables(out.blocks)[0]).toMatchObject({
      columns: ['Block', 'Gross (ha)', 'Leave (ha)', 'Net (ha)'],
      rows: [
        ['X1', '12.4', '3.1', '9.3'],
        ['X2', '8.0', '', ''],
        ['Total', '20.4', '', ''],
      ],
    })
    expect(out.toComplete).toEqual(['Leave and net area (no retention recorded): X2'])
  })

  it('rates the FPPR criteria per viewpoint, filling the run’s rows and listing the reviewer’s', () => {
    const out = build('criteria-rating-2001', context('form-2001-analysis-sheets', [lakeshore, ridge]))
    const table = tables(out.blocks)[0]
    if (table.kind !== 'table') throw new Error('table expected')
    expect(table.columns).toEqual(['FPPR criteria', 'VP 1: Lakeshore', 'VP 2: Ridge Road'])
    expect(table.rows.map((row) => row[0].split(':')[0])).toEqual([
      'Blocks & roads visible',
      'Ease of seeing or visibility',
      'Scale of alteration',
      'Existing human-made alterations present?',
      'Proposal design',
      'Viewpoint importance and duration',
      'Distance from viewpoint',
      'Category of visually altered landform',
    ])
    expect(table.rows[0].slice(1)).toEqual(['Block X1', 'Blocks X1 and X2 (glimpses)'])
    expect(table.rows[1][0]).toContain('Not visible, Not easily distinguishable, Difficult to see')
    // 3.00% and 8.00% of the gross landform on Table 2.
    expect(table.rows[2].slice(1)).toEqual(['Medium (3.00%)', 'Large (8.00%)'])
    expect(table.rows[6].slice(1)).toEqual(['Moderate', 'Poor'])
    expect(table.rows[7].slice(1)).toEqual(['', ''])
    expect(out.toComplete).toEqual(
      expect.arrayContaining([
        'Section 2, ease of seeing or visibility: Lakeshore and Ridge Road',
        'Section 2, category of visually altered landform: Lakeshore and Ridge Road',
        'Section 2: the basic VQO definition met from all viewpoints (class by eye)',
      ]),
    )
    expect(choices(out.blocks)[0]).toMatchObject({ options: ['P', 'R', 'PR', 'M', 'MM'], chosen: null })
    expect(all(out.blocks)).toContain('(5) Community, tourism enterprise, or other static long-term view')
  })

  it('takes the reviewer’s ocular terms and viewpoint type at the assessment station only', () => {
    const assessed = { ...lakeshore, review: {} }
    const ctx = context('form-2001-analysis-sheets', [assessed, ridge], {
      review: { ocular: { visibleness: 'easy', scale: 'small', shape: 'natural' }, viewpointType: 4 },
      assessment: { ocular: { classId: 'partial-retention' } } as unknown as ViaAssessment,
    })
    const table = tables(build('criteria-rating-2001', ctx).blocks)[0]
    if (table.kind !== 'table') throw new Error('table expected')
    expect(table.rows.map((row) => row[1])).toEqual([
      'Block X1',
      'Easy to see',
      'Small',
      '',
      'Natural in appearance',
      '4',
      'Moderate',
      'Partial Retention',
    ])
    expect(table.rows[1][2]).toBe('')
    expect(choices(build('criteria-rating-2001', ctx).blocks)[0]).toMatchObject({ chosen: 'PR' })
  })

  it('asks the five summary questions, answering only the numerical one from the run', () => {
    const out = build('summary-2001-five', context('form-2001-analysis-sheets'))
    const asked = choices(out.blocks)
    expect(asked).toHaveLength(5)
    expect(asked.map((c) => (c.kind === 'choices' ? c.chosen : 'x'))).toEqual([null, null, 'Yes', null, null])
    expect(asked[2]).toMatchObject({ source: 'run' })
    expect(asked[4].kind === 'choices' && asked[4].label).toMatch(/next 5 years/)
    expect(all(out.blocks)).toContain(
      'From Lakeshore, the alteration is 3.00% of the gross landform, within the Partial Retention range (PR 1.6-7%).',
    )
    expect(out.toComplete).toHaveLength(4)
    expect(out.toComplete).toEqual(expect.arrayContaining([expect.stringMatching(/next 5 years/)]))
  })

  it('answers the numerical question No when any viewpoint is over, and asks the reasons for those', () => {
    const over = { ...ridge, areas: { landform: 1000, proposed: 300, nonVeg: 0, privateLand: 0, rock: 0 } }
    const out = build('summary-2001-five', context('form-2001-analysis-sheets', [lakeshore, over]))
    expect(choices(out.blocks)[2]).toMatchObject({ chosen: 'No' })
    expect(fieldRows(out.blocks).map((row) => row.label)).toEqual([
      'Reasons the alteration exceeds the range from Ridge Road',
    ])
    expect(out.toComplete).toContain('Reasons the alteration exceeds the numerical range')
  })

  it('certifies, and lists what is attached and what is not', () => {
    const figure = { view: 'Lakeshore', caption: 'Lakeshore', dataUrl: 'data:,', width: 1, height: 1 }
    const out = build(
      'certification-2001',
      context('form-2001-analysis-sheets', [lakeshore], { figures: [figure], office: { evaluator: 'Evaluator' } }),
    )
    expect(out.blocks.find((b) => b.kind === 'list')).toMatchObject({ items: ['Harvest simulations by viewpoint'] })
    expect(choices(out.blocks)[0]).toMatchObject({ chosen: null, source: 'reviewer' })
    expect(out.toComplete).toEqual([
      'Certification statement and signature',
      'Attachment: VIA overview map',
      'Attachment: Overhead model renders',
      'Attachment: Site photography by viewpoint',
    ])
  })

  it('prints notes 1-4 with note 2 read for the proposal, and the five-year question once', () => {
    const ctx = context('form-2001-analysis-sheets', [lakeshore, ridge])
    const out = build('notes-2001', ctx)
    const notes = out.blocks.find((b) => b.kind === 'list')
    expect(notes?.kind === 'list' && notes.items).toHaveLength(4)
    expect(all(out.blocks)).toContain(
      'Here the definition and intent are those of Partial Retention (PR); the scale of alteration, as a share of the gross landform, is 3.00% from Lakeshore and 8.00% from Ridge Road, against the PR 1.6-7% range.',
    )
    expect(choices(out.blocks)).toHaveLength(1)
    expect(out.toComplete).toContain('Additional considerations: all known alterations for the next 5 years')
    const withFive = build('notes-2001', { ...ctx, recipeParts: ['summary-2001-five', 'notes-2001'] })
    expect(choices(withFive.blocks)).toHaveLength(0)
    expect(withFive.toComplete).not.toContain('Additional considerations: all known alterations for the next 5 years')
  })

  it('writes the design techniques from the scene and the class pass, leaving the reviewer’s own', () => {
    const out = build('design-techniques-2001', context('form-2001-analysis-sheets', [lakeshore, ridge]))
    const prose = all(out.blocks)
    expect(prose).toContain('The proposal is clearcut harvest of Block X1 and partial cutting of Block X2.')
    expect(prose).toContain('Block X2 removes 40% of the volume and leaves a residual stand about 25 m tall.')
    expect(prose).toContain('The scene records no retention in Block X1;')
    expect(prose).toContain(
      'From Ridge Road, existing openings not yet visually greened up make up 2.00% of the gross landform.',
    )
    expect(prose).toContain(
      'The class pass shows no existing opening short of visually effective green-up from Lakeshore.',
    )
    expect(fieldRows(out.blocks)[0]).toMatchObject({ value: null, source: 'reviewer' })
    expect(out.toComplete).toEqual(['Design techniques used, or reasons a technique could not be employed'])

    const retained = context('form-2001-analysis-sheets', [lakeshore], {
      blocks: [
        { name: 'A', areaHa: 10, system: 'Dispersed retention', retentionPercent: 20, partialCut: null },
        { name: 'B', areaHa: 30, system: 'Dispersed retention', retentionPercent: 30, partialCut: null },
      ],
    })
    const kept = all(build('design-techniques-2001', retained).blocks)
    expect(kept).toContain('The proposal is dispersed-retention harvest of Blocks A and B.')
    expect(kept).toContain('Block A keeps 20% of its area, about 2.0 ha, standing as retention.')
    expect(kept).toContain('In all, about 11.0 ha of the 40.0 ha proposed stays standing (28%).')
  })
})

describe('the district and 2001 parts in a report', () => {
  it('register once each and render without slots, undefined or NaN in the recipes they serve', () => {
    const ids = DISTRICT_PARTS.map((part) => part.id)
    for (const id of ids) expect(findReportPart(id)?.id).toBe(id)
    const recipes = {
      'partial-cut-form': [
        'form-header-2001',
        'block-areas-2001',
        'criteria-rating-2001',
        'design-techniques-2001',
        'summary-2001-five',
        'certification-2001',
      ],
      'design-rationale': ['district-summary-form'],
      'form-2001-sheets': ['form-header-2001', 'design-techniques-2001', 'notes-2001'],
      'form-2001-photos': ['design-techniques-2001', 'notes-2001', 'certification-2001'],
    }
    for (const [id, parts] of Object.entries(recipes)) {
      const recipe = { ...REPORT_RECIPES.find((entry) => entry.id === id)!, parts }
      for (const viewpoints of [[lakeshore], [lakeshore, ridge], []]) {
        const report = assembleReport(recipe, context(recipe.format, viewpoints))
        expect(reportHtml(report, null), id).not.toMatch(/\{\w+\}|undefined|NaN/)
        expect(reportMarkdown(report), id).not.toMatch(/\{\w+\}|undefined|NaN/)
        expect(report.toComplete.length, id).toBeGreaterThan(0)
      }
    }
  })
})

describe('the boxed VIA summary (05 p5)', () => {
  const ctx = context('form-2001-analysed-photos', [lakeshore, ridge])
  const out = build('summary-boxed', ctx)

  it('titles it by permit and blocks and boxes each question, the run answering the numerical one', () => {
    expect(out.blocks[0]).toMatchObject({ kind: 'heading', text: 'VIA Summary - CP 1 blks X1, X2' })
    const boxes = out.blocks.filter((b): b is Extract<ReportBlock, { kind: 'choices' }> => b.kind === 'choices')
    expect(boxes).toHaveLength(4)
    expect(boxes.every((b) => b.boxed)).toBe(true)
    // Ridge Road reads 8% (over PR): No, and the line says from where.
    const numerical = boxes[2]
    expect(numerical.source).toBe('run')
    expect(numerical.chosen).toBe('No')
    expect(numerical.answer).toMatch(/% alteration from Ridge Road, over the Partial Retention range\.$/)
    const within = build('summary-boxed', context('form-2001-analysed-photos', [lakeshore])).blocks.filter(
      (b): b is Extract<ReportBlock, { kind: 'choices' }> => b.kind === 'choices',
    )[2]
    expect(within.chosen).toBe('Yes')
    expect(within.answer).toMatch(/^Less than 7\.0 percent alteration \(at most [\d.]+%, from Lakeshore\)\.$/)
    // Judgements the reviewer has not given stay blank and are listed.
    expect(boxes[0].answer).toBeNull()
    expect(out.toComplete).toContain('Signature and certification')
    const html = reportHtml(assembleReport(REPORT_RECIPES.find((r) => r.id === 'form-2001-photos')!, ctx), null)
    expect(html).toContain('<table class="answer-box">')
    expect(html).toContain('<b class="answer">')
  })
})

describe('the 2001 summary form’s design questions and attachments (03, 05)', () => {
  const assessment = (ratings: Record<string, -1 | 0 | 1>) =>
    ({
      design: Object.fromEntries(Object.entries(ratings).map(([id, rating]) => [id, { rating }])),
    }) as unknown as ViaAssessment

  it('asks the five yes / no design questions, answering only from step 4 ratings and the scene’s patches', () => {
    const blank = build('design-questions-2001', context('form-2001-analysis-sheets'))
    expect(choices(blank.blocks)).toHaveLength(5)
    expect(choices(blank.blocks).every((c) => c.kind === 'choices' && c.chosen === null)).toBe(true)
    expect(blank.toComplete).toEqual([
      'major lines of force',
      'borrowing from the natural character',
      'edge treatments',
      'islands or patches of trees',
      'existing alterations of poor design in the unit',
    ])
    expect(fieldRows(blank.blocks).map((row) => row.label)).toEqual(['If Yes, describe the design deficiencies'])
    // Good is Yes, poor is No, moderate stays the reviewer's; a mapped patch answers the islands question.
    const ctx = context('form-2001-analysis-sheets', [lakeshore], {
      assessment: assessment({ 'force-lines': -1, 'natural-character': 1, 'edge-treatment': 0 }),
      blocks: [{ name: 'X1', areaHa: 12, system: 'Clearcut', retentionPercent: null, partialCut: null, islands: 2 }],
    })
    const answered = choices(build('design-questions-2001', ctx).blocks).map((c) =>
      c.kind === 'choices' ? c.chosen : null,
    )
    expect(answered).toEqual(['Yes', 'No', null, 'Yes', null])
  })

  it('lists as attachments only what the recipe prints', () => {
    const ctx = context('district-summary', [lakeshore], {
      recipeParts: ['design-rationale', 'certification-2001', 'simulation-pages'],
      images: { overviewMap: { view: 'o', caption: 'o', dataUrl: 'data:,', width: 1, height: 1 } },
    })
    const out = build('certification-2001', ctx)
    expect(all(out.blocks)).not.toContain('VIA overview map')
    expect(out.toComplete).toContain('Attachment: Oblique model renders')
    expect(out.toComplete).not.toContain('Attachment: Site photography by viewpoint')
  })

  it('does not restate the figures in note 2 when the summary already states them per viewpoint', () => {
    const ctx = context('form-2001-analysis-sheets', [lakeshore], { recipeParts: ['summary-2001', 'notes-2001'] })
    const out = build('notes-2001', ctx)
    expect(all(out.blocks)).not.toContain('Here the definition and intent')
    expect((out.toComplete ?? []).some((item) => item.startsWith('Note 2'))).toBe(false)
  })
})
