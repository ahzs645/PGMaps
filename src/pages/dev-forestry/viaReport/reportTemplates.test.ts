/**
 * The handbook (06), Board comparison (21) and environmental assessment memo (26) templates the reference comparison
 * found missing: viewpoint order and list, one Appendix 1 form per viewpoint that sees the proposal, visibility wording
 * that agrees with the picture's figure, the to-complete list in plain words, 21's numbered pair and references, and
 * 26's pointer to its figure pages.
 */
import { describe, expect, it } from 'vitest'

import type { ViaAssessment } from '../via'
import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts, type DocumentViewpoint } from '../viaDocument/resolve'
import { toCompleteLine } from '../viaDocument/wording'
import { reportMarkdown } from './html'
import type { ReportBlock } from './model'
import {
  hiddenCause,
  inViewpointOrder,
  runConclusion,
  simulationFiguresSentence,
  viewpointNumber,
  viewpointPlaceName,
  visibilityPhrase,
  type ReportContext,
} from './parts'
import { findReportPart } from './registry'
import { assembleReport, REPORT_RECIPES } from './recipes'

const viewpoint = (over: Partial<DocumentViewpoint> & { name: string }): DocumentViewpoint => ({
  landform: 'Landform 1',
  objective: 'PR',
  inventory: null,
  areas: { landform: 10000, proposed: 300, nonVeg: 100, privateLand: 0, rock: 0 },
  sightlinePercent: 3.1,
  distanceKm: 2.6,
  hfovDeg: 39.6,
  lensMm: 50,
  lngLat: [-122.5, 53.9],
  elevationM: 640,
  bearingDeg: 270,
  blocks: [{ id: 'X1', status: 'visible', visiblePercent: 40, screenedPercent: 0 }],
  ...over,
})

function context(formatId: string, viewpoints: DocumentViewpoint[], over: Partial<ReportContext> = {}): ReportContext {
  const facts: DocumentFacts = { project: 'Block X1', viewpoints }
  return {
    date: new Date('2026-11-15T12:00:00Z'),
    office: { licence: 'A00000', cuttingPermit: '1' },
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
    ...over,
  }
}

const recipe = (id: string) => REPORT_RECIPES.find((entry) => entry.id === id)!
const all = (blocks: readonly ReportBlock[]) => JSON.stringify(blocks)
const fieldValue = (blocks: readonly ReportBlock[], title: string, label: string) => {
  const group = blocks.find((b) => b.kind === 'fields' && b.title === title)
  return group?.kind === 'fields' ? group.rows.find((row) => row.label === label)?.value : undefined
}

describe('viewpoint order and the numbered list (06)', () => {
  it('reads the number a name carries, in any of the references’ spellings', () => {
    expect(viewpointNumber('Duncan Dam (VP2)')).toBe(2)
    expect(viewpointNumber('VPT3 Lakeview')).toBe(3)
    expect(viewpointNumber('Ridge (VP03)')).toBe(3)
    expect(viewpointNumber('Scenic Viewpoint (VP4)')).toBe(4)
    expect(viewpointNumber('Lakeshore')).toBeNull()
    expect(viewpointPlaceName('Duncan Dam Scenic Viewpoint (VP2)')).toBe('Duncan Dam Scenic Viewpoint')
    expect(viewpointPlaceName('VP3 - Hwy 31')).toBe('Hwy 31')
  })

  it('orders the facts and the resolved document together by that number, unnumbered views last', () => {
    const ctx = context('appendix-1-net-private-rock', [
      viewpoint({ name: 'Flats (VP7)', n: '1' }),
      viewpoint({ name: 'Lakeshore', n: '2' }),
      viewpoint({ name: 'Dam (VP2)', n: '3', distanceKm: 1.2 }),
    ])
    const ordered = inViewpointOrder(ctx)
    expect(ordered.facts.viewpoints.map((vp) => [vp.name, vp.n])).toEqual([
      ['Dam (VP2)', '2'],
      ['Flats (VP7)', '7'],
      ['Lakeshore', '2'],
    ])
    expect(ordered.document.viewpoints.map((vp) => vp.name)).toEqual(['Dam (VP2)', 'Flats (VP7)', 'Lakeshore'])
    // Unchanged when no name carries a number.
    const plain = context('appendix-1-net-private-rock', [viewpoint({ name: 'B' }), viewpoint({ name: 'A' })])
    expect(inViewpointOrder(plain)).toBe(plain)
  })

  it('prints sections, pairs and forms in number order, with the list in the methods', () => {
    const ctx = context('appendix-1-net-private-rock', [
      viewpoint({ name: 'Flats (VP7)' }),
      viewpoint({ name: 'Highway (VP1)' }),
    ])
    const md = reportMarkdown(assembleReport(recipe('appendix-1-report'), ctx))
    expect(md).toContain('- Viewpoint 1: Highway\n- Viewpoint 7: Flats')
    expect(md.indexOf('### Highway (VP1)')).toBeLessThan(md.indexOf('### Flats (VP7)'))
    expect(md.indexOf('summary form, Highway (VP1)')).toBeLessThan(md.indexOf('summary form, Flats (VP7)'))
  })
})

describe('Appendix 1, one form per viewpoint that sees the proposal (06)', () => {
  const vps = [
    viewpoint({ name: 'Dam (VP2)', atAssessment: true, review: { importance: 'High (5)' } }),
    viewpoint({ name: 'Beach (VP4)', atAssessment: false }),
    viewpoint({
      name: 'Ridge (VP5)',
      atAssessment: false,
      areas: { landform: 10000, proposed: 0, nonVeg: 0, privateLand: 0, rock: 0 },
      blocks: [{ id: 'X1', status: 'not visible', visiblePercent: 0, screenedPercent: 0 }],
    }),
  ]

  it('fills the run’s lines on each form and leaves the judgements blank and listed without step 4', () => {
    const out = findReportPart('appendix-1')!.build(context('appendix-1-net-private-rock', vps))
    const text = all(out.blocks)
    expect(text).toContain('summary form, Dam (VP2)')
    expect(text).toContain('summary form, Beach (VP4)')
    // A viewpoint that sees none of the proposal takes no form.
    expect(text).not.toContain('summary form, Ridge (VP5)')
    const beach = out.blocks.slice(out.blocks.findIndex((b) => b.kind === 'heading' && b.text.endsWith('Beach (VP4)')))
    expect(fieldValue(beach, '3.2.1 Viewpoint', 'Viewing direction')).toBe('West (250°–290°)')
    expect(fieldValue(beach, '3.2.1 Viewpoint', 'Elevation')).toBe('640 m')
    expect(fieldValue(beach, '3.2.2 Photography (simulation camera)', 'Lens focal length')).toMatch(/^50 mm/)
    // a and c from the picture on the format's rule (300 and 100 of 10,000 px), X the picture's figure; b is blank.
    const numerical = beach.find((b) => b.kind === 'fields' && b.rows[0]?.label.startsWith('a)'))
    expect(numerical?.kind === 'fields' && numerical.rows.map((row) => row.value)).toEqual([
      '3.0%',
      null,
      '1.0%',
      '4.0% (Partial Retention)',
    ])
    expect(out.toComplete).toEqual(
      expect.arrayContaining([
        'Step 4 at the assessment station',
        expect.stringMatching(/^Beach \(VP4\): class by eye \(3\.4\.1\), line b/),
      ]),
    )
  })

  it('prints step 4 judgements only on the assessment station’s form', () => {
    const assessment = {
      ocular: { classId: 'partial-retention' },
      design: {},
      roads: null,
      retentionMeasured: null,
      rating: { id: 'met', label: 'Met' },
      missing: [],
      y: null,
      adjusted: null,
      initialPercent: 4,
    } as unknown as ViaAssessment
    const out = findReportPart('appendix-1')!.build(context('appendix-1-net-private-rock', vps, { assessment }))
    const marks = out.blocks.filter((b) => b.kind === 'scale' && b.title === 'Class by eye')
    expect(marks.map((b) => b.kind === 'scale' && b.mark !== null)).toEqual([true, false])
    expect(all(out.blocks)).toContain('The judgements on the form for Dam (VP2) are the reviewer’s step 4 record')
  })
})

describe('visibility agrees with the picture’s figure', () => {
  const beach = viewpoint({
    name: 'Beach (VP4)',
    distanceKm: null,
    areas: { landform: 14794, proposed: 1011, nonVeg: 0, privateLand: 0, rock: 0 },
    blocks: [
      { id: 'X1', status: 'not visible', visiblePercent: 0, screenedPercent: 0 },
      { id: 'X2', status: 'not visible', visiblePercent: 0, screenedPercent: 0 },
    ],
  })

  it('says a block is seen when the pixel figure is above zero, whatever the callouts’ samples say', () => {
    const ctx = context('appendix-1-net-private-rock', [beach], {
      blocks: [
        { name: 'X1', areaHa: 12.4, system: 'Clearcut', retentionPercent: null, partialCut: null },
        { name: 'X2', areaHa: 8, system: 'Clearcut', retentionPercent: null, partialCut: null },
      ],
    })
    const page = all(findReportPart('viewpoint-pages')!.build(ctx).blocks)
    expect(page).toContain('part of the proposed blocks is in view (6.8% of the landform in the picture)')
    expect(page).not.toContain('no proposed block is expected to be visible')
    const conclusion = runConclusion(ctx).map((s) => s.text)
    expect(conclusion[0]).toBe('Beach (VP4) sees part of Blocks X1 and X2.')
    expect(conclusion.join(' ')).not.toContain('not expected to be visible')
    expect(visibilityPhrase(beach.blocks, '6.8', true)).toBe(
      'is expected to be partly visible (6.8% of the landform in this picture)',
    )
  })

  it('names why the rest is out of sight from the run’s codes, and says nothing when it cannot', () => {
    expect(hiddenCause([{ visiblePercent: 0, screenedPercent: 0 }])).toBe('hidden by the terrain')
    expect(hiddenCause([{ visiblePercent: 20, screenedPercent: 80 }])).toBe('screened by standing timber')
    expect(hiddenCause([{ visiblePercent: 10, screenedPercent: 40 }])).toBe('hidden by the terrain and standing timber')
    expect(hiddenCause([{ visiblePercent: 0 }])).toBeNull()
    expect(visibilityPhrase([{ status: 'not visible', visiblePercent: 0, screenedPercent: 0 }], '0.00')).toBe(
      'is not expected to be visible, hidden by the terrain',
    )
    expect(visibilityPhrase([{ status: 'not visible', visiblePercent: 0 }], '0.00')).toBe(
      'is not expected to be visible',
    )
    expect(visibilityPhrase([{ status: 'possible glimpses', visiblePercent: 2, screenedPercent: 50 }], '0.04')).toBe(
      'may be seen only in glimpses (0.04% of the landform in this picture); the rest of the blocks’ ground is hidden by the terrain and standing timber',
    )
  })
})

describe('the to-complete list in plain words', () => {
  it('prints a template’s label and plain slot names, never its internal codes', () => {
    expect(toCompleteLine({ id: 'y', missing: ['y', 'adjusted', 'adjustedClass'], label: '3.4.3 adjustment' })).toBe(
      '3.4.3 adjustment: needs total adjustment (Y), adjusted percent alteration and class of the adjusted figure',
    )
    expect(toCompleteLine({ id: 'landform-outline', missing: ['the landform holding the block'] })).toBe(
      'landform outline: needs the landform holding the block',
    )
    const ctx = context('form-2001-analysed-photos', [viewpoint({ name: 'Lookout (VP2)' })])
    const report = assembleReport(recipe('board-comparison'), ctx)
    const wording = report.toComplete.filter((item) => item.part === 'Wording').map((item) => item.what)
    expect(wording.length).toBeGreaterThan(0)
    for (const line of wording) expect(line).not.toMatch(/\(needs |\b[a-z]+[A-Z]\w*\b/)
  })

  it('lists the 06 forms’ blank lines once, under Appendix 1, not again as wording', () => {
    const ctx = context('appendix-1-net-private-rock', [viewpoint({ name: 'Dam (VP2)' })])
    const report = assembleReport(recipe('appendix-1-report'), ctx)
    expect(report.toComplete.filter((item) => item.part === 'Wording')).toEqual([])
    expect(report.toComplete.some((item) => item.what.includes('rating'))).toBe(true)
  })
})

describe('21: simulated viewpoints named, a numbered pair and references', () => {
  const ctx = context('form-2001-analysed-photos', [viewpoint({ name: 'Lookout (VP2)' })])
  const report = assembleReport(recipe('board-comparison'), ctx)
  const md = reportMarkdown(report)

  it('names the simulated viewpoints in the methods and bounds the landform', () => {
    expect(md).toContain('- Viewpoint 2: Lookout')
    expect(md).toContain(
      'Lookout (VP2) is simulated because the run finds a line of sight from it to the proposed blocks.',
    )
    expect(md).toContain('generally bounded by ridges, drainage channels, valleys, shorelines and skylines')
  })

  it('numbers the pair after the overview map and captions it, and prints its references', () => {
    const pair = report.blocks.find((b) => b.kind === 'figurePair')
    expect(pair?.kind === 'figurePair' && pair.caption).toBe(
      'Figure 2. View from Lookout (VP2) before harvest, and the simulated view after harvest.',
    )
    expect(md).toContain('## References')
    // Other recipes' pairs stay unnumbered.
    const handbook = assembleReport(
      recipe('appendix-1-report'),
      context('appendix-1-net-private-rock', ctx.facts.viewpoints.slice()),
    )
    const plain = handbook.blocks.find((b) => b.kind === 'figurePair')
    expect(plain?.kind === 'figurePair' && plain.caption).toBeFalsy()
  })
})

describe('26: the memo points to its figure pages', () => {
  it('names the simulations’ figure numbers, and the views of a viewpoint that sees none', () => {
    const vps = [
      viewpoint({ name: 'Highway (VP1)' }),
      viewpoint({ name: 'Campground (VP6)' }),
      viewpoint({
        name: 'Beach (VP4)',
        areas: { landform: 10000, proposed: 0, nonVeg: 0, privateLand: 0, rock: 0 },
        blocks: [{ id: 'X1', status: 'not visible', visiblePercent: 0, screenedPercent: 0 }],
      }),
    ]
    const ctx = {
      ...context('referral-panoramas', vps),
      recipeParts: ['ea-visual-memo', 'overview-map', 'ea-figure-pages', 'references'],
    }
    expect(simulationFiguresSentence(ctx)?.text).toBe(
      'The simulations are Figures 2 and 3; Figure 4 shows the view from Beach (VP4).',
    )
    expect(simulationFiguresSentence({ ...ctx, recipeParts: ['ea-visual-memo'] })).toBeNull()
    const memo = all(findReportPart('ea-visual-memo')!.build(ctx).blocks)
    expect(memo).toContain('The simulations are Figures 2 and 3')
  })
})

describe('06 project table by inventory unit', () => {
  it('splits each block by the units it falls in, with the unit and its objective, once the inventory is read', () => {
    const ctx = context('appendix-1-net-private-rock', [viewpoint({ name: 'Dam (VP2)' })], {
      blocks: [
        { name: 'X1', areaHa: 30.1, system: 'Clearcut', retentionPercent: null, partialCut: null },
        { name: 'X2', areaHa: 5, system: 'Clearcut', retentionPercent: null, partialCut: null },
      ],
      inventoryRead: true,
      inventoryUnits: [
        { vsu: '24', vqo: 'M', blocks: { X1: 10 } },
        { vsu: '655', blocks: { X1: 20.1 } },
      ],
    })
    const table = findReportPart('project-information')!
      .build(ctx)
      .blocks.find((b) => b.kind === 'table')
    expect(table?.kind === 'table' && table.columns.slice(0, 4)).toEqual([
      'Block',
      'Gross area (ha)',
      'VLI polygon',
      'EVQO',
    ])
    expect(table?.kind === 'table' && table.rows.map((row) => row.slice(0, 4))).toEqual([
      ['X1', '10.0', '24', 'M'],
      ['X1', '20.1', '655', ''],
      ['X2', '5.0', 'None', ''],
    ])
  })
})

describe('Appendix 1 X sentence', () => {
  it('reads a figure past the last class as the scale’s term, and waits on line b away from the station', () => {
    const doc = resolveViaDocument(findDocumentFormat('appendix-1-net-private-rock')!, {
      project: 'Block X1',
      viewpoints: [
        viewpoint({
          name: 'Close (VP1)',
          areas: { landform: 1000, proposed: 442, nonVeg: 0, privateLand: 0, rock: 0 },
        }),
      ],
    })
    const x = doc.viewpoints[0].sentences.find((s) => s.id === 'x')!
    expect(x.text).toBeNull()
    expect(x.missing).toEqual(['b'])
    expect(x.label).toBe('3.4.2 initial % alteration')
  })
})
