import { describe, expect, it } from 'vitest'

import { findDocumentFormat, T1, T5, TABLE_1, TABLE_2, TABLE_3 } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts, type DocumentViewpoint } from '../viaDocument/resolve'
import { reportMarkdown } from './html'
import type { ReportBlock } from './model'
import { landformBounding, type ReportContext } from './parts'
import { CONSULTANT_RECIPE_PARTS } from './partsConsultant'
import { findReportPart } from './registry'
import { assembleReport, REPORT_RECIPES } from './recipes'

// Names are placeholders; the shapes follow the consultant reports (22, 23).
const vp = (over: Partial<DocumentViewpoint>): DocumentViewpoint => ({
  name: 'Bay',
  landform: 'Landform 1',
  objective: 'PR',
  areas: { landform: 10000, proposed: 300, nonVeg: 0, privateLand: 2000, rock: 0 },
  sightlinePercent: 3,
  distanceKm: 1.4,
  lngLat: [-123.9, 49.7],
  blocks: [],
  ...over,
})

const FACTS: DocumentFacts = {
  project: 'the proposed blocks',
  viewpoints: [
    vp({
      name: 'Bay',
      landform: 'VSU 1083',
      blocks: [
        { id: 'A1', status: 'visible', visiblePercent: 60 },
        { id: 'E5 (S33, other planned)', status: 'possible glimpses', visiblePercent: 2 },
      ],
    }),
    vp({
      name: 'Lake',
      landform: 'Landform 5a (traced)',
      areas: { landform: 10000, proposed: 400, nonVeg: 120, privateLand: 0, rock: 0 },
      blocks: [
        { id: 'A1', status: 'visible', visiblePercent: 20 },
        { id: 'A2', status: 'visible', visiblePercent: 35 },
      ],
      distanceKm: 0.7,
    }),
  ],
}

function context(formatId: string, over: Partial<ReportContext> = {}, facts: DocumentFacts = FACTS): ReportContext {
  return {
    date: new Date('2026-11-14T12:00:00Z'),
    office: { evaluator: 'R. Planner, RPF' },
    blocks: [
      { name: 'A1', areaHa: 12, system: 'Clearcut', retentionPercent: null, partialCut: null, islands: 0 },
      { name: 'A2', areaHa: 9, system: 'Clearcut', retentionPercent: null, partialCut: null, islands: 2 },
      { name: 'E5 (S33, other planned)', areaHa: 5, system: 'Clearcut', retentionPercent: null, partialCut: null },
    ],
    landform: { name: 'Landform 5a (traced)', objective: 'PR', vac: 'M', areaHa: 0, source: 'drawn in step 1' },
    inventory: null,
    inventoryRead: false,
    facts,
    document: resolveViaDocument(findDocumentFormat(formatId)!, facts),
    assessment: null,
    review: null,
    breakdown: null,
    method: { terrain: 'the terrain', vegetation: 'VRI', eyeHeightM: 1.6 },
    measures: [],
    figures: [],
    ...over,
  }
}

const build = (id: string, ctx: ReportContext) => findReportPart(id)!.build(ctx)
const tables = (blocks: ReportBlock[]) =>
  blocks.filter((b): b is Extract<ReportBlock, { kind: 'table' }> => b.kind === 'table')
const words = (blocks: ReportBlock[]) => JSON.stringify(blocks)

describe('consultant parts: Tables 1-3', () => {
  const ctx = context('perspective-report-net-private')

  it('number Table 1 as the references do, with its footnotes, one row per unit the landforms are read against', () => {
    const [table] = tables(build('table-1-vsu', ctx).blocks)
    expect(table.title).toBe('Table 1: Summary of visual sensitivity unit attributes')
    expect(table.columns).toEqual(['VSU polygon', 'Blocks within VSU', 'VSC¹', 'VAC²', 'EVC³', 'VQO'])
    expect(table.rows).toEqual([['VSU #1083', 'A1, E5*', '', '', '', 'PR - Partial Retention']])
    for (const note of TABLE_1.footnotes!) expect(table.note).toContain(note)
    expect(table.note).toContain('* Planned under another sale')
    expect(build('table-1-vsu', ctx).toComplete).toEqual(['Table 1: VSC, VAC and EVC of each unit'])
    // An inventory read fills the unit's attributes and adopts it in a sentence.
    const read = context('perspective-report-net-private', {
      inventory: { vsu: '1083', vsc: '2', vac: 'M', evc: 'PR', vqo: 'PR' },
      inventoryRead: true,
    })
    const out = build('table-1-vsu', read)
    expect(tables(out.blocks)[0].rows[0].slice(2)).toEqual(['2', 'M', 'PR', 'PR - Partial Retention'])
    expect(words(out.blocks)).toContain('takes visual sensitivity unit 1083 from the visual landscape inventory')
  })

  it('give Table 2 one row per landform with a description: the reviewer’s, else which viewpoints read it', () => {
    const [table] = tables(build('table-2-landforms', ctx).blocks)
    expect(table.title).toBe('Table 2: Landform summary')
    expect(table.columns).toEqual(TABLE_2.columns)
    expect(table.rows.map((row) => row[0])).toEqual(['VSU 1083', 'Landform 5a (traced)'])
    expect(table.rows[0][7]).toBe('Read from Bay at 1.4 km. Private land is up to 20% of it in the picture.')
    expect(table.rows[1][1]).toBe('A1, A2')
    const described = context('perspective-report-net-private', {
      landforms: [
        { name: 'Landform 5a (traced)', description: 'Low rolling slopes north of the lake.', evc: 'R' },
        { name: 'VSU 1083', description: 'Steep slopes west of the lake.', parent: 'Landform 5', divider: 'a draw' },
      ],
    })
    const out = build('table-2-landforms', described)
    const rows = tables(out.blocks)[0].rows
    expect(rows[1][5]).toBe('R (LF)')
    expect(rows[1][7]).toBe('Sub-landform of Landform 5. Low rolling slopes north of the lake.')
    expect(rows[0][7]).toBe('Sub-landform of Landform 5, divided at a draw. Steep slopes west of the lake.')
    expect(words(out.blocks)).toContain(
      'VSU 1083 is assessed as a sub-landform of Landform 5, divided from the rest of it at a draw',
    )
    expect(out.toComplete).toEqual(['Where Landform 5a (traced) is divided from the rest of the landform'])
    // A name read the references' way gives the parent when the scene records none; where it is divided is asked.
    const derived = build('table-2-landforms', ctx)
    expect(tables(derived.blocks)[0].rows[1][7]).toMatch(/^Sub-landform of Landform 5\. Read from/)
    expect(words(derived.blocks)).toContain(
      'Landform 5a (traced) is assessed as a sub-landform of Landform 5, as it reads as a landform of its own from',
    )
    expect(derived.toComplete).toContain('Where Landform 5a (traced) is divided from the rest of the landform')
    // A landform that is not a sub-landform has no split sentence.
    const plain = context('perspective-report-net-private', {
      landform: { name: 'Landform 5 (traced)', objective: 'PR', vac: 'M', areaHa: 0, source: 'drawn in step 1' },
      facts: {
        ...FACTS,
        viewpoints: FACTS.viewpoints.map((vp) => ({ ...vp, landform: vp.landform.replace('5a', '5') })),
      },
    })
    expect(words(build('table-2-landforms', plain).blocks)).not.toContain('sub-landform of')
  })

  it('give Table 3 the blocks each viewpoint sees and the reviewer’s reasons, never invented', () => {
    const [table] = tables(build('table-3-viewpoints', ctx).blocks)
    expect(table.title).toBe('Table 3: Summary of viewpoints and significance')
    expect(table.columns).toEqual(TABLE_3.columns)
    expect(table.rows[0].slice(0, 2)).toEqual(['Bay', 'A1, E5* (glimpses)'])
    expect(table.rows[1][1]).toBe('A1, A2, existing openings not greened up')
    expect(table.rows[0][2]).toBe('At 49.7000, -123.9000, 1.4 km from the nearest block it sees.')
    expect(build('table-3-viewpoints', ctx).toComplete).toEqual([
      'Table 3: why each viewpoint was chosen, its viewing experience and significance (2 of 2 viewpoints)',
    ])
    const reviewed: DocumentFacts = {
      ...FACTS,
      viewpoints: [
        {
          ...FACTS.viewpoints[0],
          review: {
            selectionReason: 'its boat traffic',
            viewingExperience: 'sustained focal views',
            importance: 'Moderate (3)',
          },
        },
      ],
    }
    const row = tables(build('table-3-viewpoints', context('perspective-report-net-private', {}, reviewed)).blocks)[0]
      .rows[0]
    expect(row[2]).toBe(
      'At 49.7000, -123.9000, 1.4 km from the nearest block it sees. The viewpoint was chosen for its boat traffic. The viewing experience is sustained focal views.',
    )
    expect(row[3]).toBe('Moderate (3)')
  })
})

describe('consultant parts: method, discussion and sign-off', () => {
  it('state where the objectives are held, what Tables 4 and 5 rate, the key-viewpoint rule and the other sale’s blocks once', () => {
    const perBlock = words(build('assessment-method', context('perspective-report-net-private')).blocks)
    expect(perBlock).toContain('held in the BC Geographic Warehouse')
    expect(perBlock).toContain('The inventory was not read for this report')
    expect(perBlock).toContain('Table 4 rates each landform from every viewpoint')
    expect(perBlock).toContain('Each block is assessed from its own key viewpoint')
    expect(perBlock.match(/Block E5 is planned under another sale or cutting permit \(S33\)/g)).toHaveLength(1)
    const group = words(build('assessment-method', context('perspective-report-gross')).blocks)
    expect(group).toContain('One key viewpoint is chosen for the blocks as a group')
  })

  it('say how the landform was bounded from where it came from, and from the names where they say', () => {
    const at = (source: string, names: string[]) =>
      landformBounding(
        context(
          'perspective-report-net-private',
          {
            landform: { name: names[0], objective: 'PR', vac: null, areaHa: 0, source },
          },
          { project: 'x', viewpoints: names.map((name) => vp({ landform: name })) },
        ),
      )
    expect(at('BC Visual Landscape Inventory polygons 337 and 350, joined', ['North face'])).toBe(
      'North face was taken from the visual sensitivity units of the visual landscape inventory (BC Visual Landscape Inventory polygons 337 and 350, joined).',
    )
    expect(at('drawn in step 1', ['North face'])).toMatch(
      /^North face was outlined on the map as seen from each viewpoint/,
    )
    expect(at('Terrain candidate from station 4', ['North face'])).toMatch(/proposed from the terrain/)
    expect(at('Imported blocks.kml', ['North face'])).toBe('North face was imported from Imported blocks.kml.')
    // A stored case: the names say which were traced and which are inventory units.
    expect(at('the library case', ['VSU 1083', 'Landform 5a (traced)', 'Landform 7b (traced)'])).toBe(
      'VSU 1083 was taken from the visual sensitivity units of the visual landscape inventory; Landform 5a (traced) and Landform 7b (traced) were outlined on the map as seen from each viewpoint, following the skyline, shorelines and major breaks in the terrain such as ridges, valleys and draws.',
    )
  })

  it('discuss each block once under its own heading, with its islands after the edges and none for the other sale', () => {
    const out = build('block-discussion', context('perspective-report-net-private'))
    const headings = out.blocks.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.text : ''))
    expect(headings).toEqual(['Discussion', 'Block A1 – VSU 1083', 'Block A2 – Landform 5a (traced)'])
    const text = words(out.blocks)
    expect(text).toContain('No islands or patches of timber are kept inside Block A1.')
    expect(text).toContain('Block A2 keeps 2 internal retention patches, islands of timber inside the opening.')
    expect(out.toComplete).toEqual(['Block A2 – Landform 5a (traced): islands rating'])
    expect(text).not.toContain('Block E5 is located')
  })

  it('label the group’s paragraphs as 23 does, and only when a paragraph has a sentence', () => {
    const facts: DocumentFacts = {
      project: 'x',
      viewpoints: [
        vp({
          blocks: [
            { id: 'A1', status: 'visible', visiblePercent: 90 },
            { id: 'A2', status: 'visible', visiblePercent: 80 },
          ],
          distanceKm: 6.1,
        }),
      ],
    }
    const out = build('block-discussion', context('perspective-report-gross', {}, facts))
    const paragraphs = out.blocks
      .filter((b) => b.kind === 'paragraph')
      .map((b) => (b.kind === 'paragraph' ? b.sentences.map((s) => s.text).join(' ') : ''))
    expect(paragraphs[1]).toMatch(/^Size and scale – Assessed as a group/)
    expect(paragraphs[2]).toMatch(/^Visual design – /)
    // The visibility terms are the reviewer's: with none given, no "Visibility –" label stands alone.
    expect(paragraphs.some((p) => p.startsWith('Visibility –'))).toBe(false)
  })

  it('mark Table 5’s islands None for a block that keeps none, and number Tables 4 and 5 with their notes', () => {
    const [t4, t5] = tables(build('assessment-tables', context('perspective-report-net-private')).blocks)
    expect(t4.title).toMatch(/^Table 4: /)
    expect(t4.note).toContain('⁶ Visibility, in the terms of FPPR s. 1.1')
    expect(t4.note).toContain('* Planned under another sale')
    expect(t5.title).toMatch(/^Table 5: /)
    expect(t5.columns).toHaveLength(13)
    expect(t5.note).toContain('¹⁹ Distance from the viewpoint')
    expect(t5.note).toContain('Poor under 2 km; Moderate 2 to 5 km; Good over 5 km')
    const islands = t5.columns.indexOf(T5.islands)
    const a1 = t5.rows.find((row) => row[1] === 'Block A1')!
    const a2 = t5.rows.find((row) => row[1] === 'Block A2')!
    expect([a1[islands], a2[islands]]).toEqual(['None', ''])
    expect(t5.rows.some((row) => row[1].includes('E5'))).toBe(false)
  })

  it('sign off with a peer reviewer beside the preparer, each with a signature and a date', () => {
    const out = build('sign-off-peer', context('perspective-report-net-private'))
    const [table] = tables(out.blocks)
    expect(table.columns).toEqual(['', 'Prepared by', 'Peer reviewed by'])
    expect(table.rows.map((row) => row[0])).toEqual([
      'Name',
      'Professional designation and seal',
      'Statement',
      'Signature',
      'Date',
    ])
    expect(table.rows[0]).toEqual(['Name', 'R. Planner, RPF', ''])
    expect(out.toComplete).toEqual([
      'Prepared by: designation, seal, signature and date',
      'Peer reviewed by: name, designation, seal, signature and date',
    ])
  })

  it('leave the other sale’s blocks off the cover and the conclusion, and never print an empty conclusion', () => {
    const ctx = context('perspective-report-net-private')
    expect(words(build('cover', ctx).blocks)).toContain('"label":"Blocks","value":"A1, A2"')
    const conclusion = words(build('conclusion', ctx).blocks)
    expect(conclusion).toContain('From the key viewpoints, the percent alteration is')
    const empty = context('perspective-report-net-private', {}, { project: 'x', viewpoints: [vp({ areas: null })] })
    expect(words(build('conclusion', empty).blocks)).toContain('The conclusion is written once the extent')
  })
})

describe('consultant recipes', () => {
  it('list the references’ parts in order, every one registered, and assemble without placeholders', () => {
    for (const [id, parts] of Object.entries(CONSULTANT_RECIPE_PARTS)) {
      for (const part of parts) expect(findReportPart(part), `${id}: ${part}`).not.toBeNull()
      const recipe = { ...REPORT_RECIPES.find((entry) => entry.id === id)!, parts }
      const markdown = reportMarkdown(assembleReport(recipe, context(recipe.format)))
      expect(markdown, id).not.toMatch(/\{\w+\}|undefined|NaN|the The|from from/)
      const order = ['Table 1:', 'Table 2:', 'Table 3:', 'Table 4:', 'Table 5:'].map((title) => markdown.indexOf(title))
      expect(
        order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])),
        id,
      ).toBe(true)
    }
    expect(CONSULTANT_RECIPE_PARTS['consultant-net-private']).toContain('sign-off-peer')
    expect(CONSULTANT_RECIPE_PARTS['consultant-gross']).toContain('sign-off')
  })

  it('keep T1 in step with Table 1', () => {
    expect(TABLE_1.columns).toEqual(Object.values(T1))
  })
})
