import { describe, expect, it } from 'vitest'

import { findDocumentFormat, T1, T5, TABLE_1, TABLE_2, TABLE_3 } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts, type DocumentViewpoint } from '../viaDocument/resolve'
import { reportMarkdown } from './html'
import type { ReportBlock } from './model'
import { calculationFields, landformBounding, type ReportContext } from './parts'
import {
  appendixEntries,
  CERTIFICATION_STATEMENTS,
  CONSULTANT_RECIPE_PARTS,
  keyViewpointCites,
  viewpointLocations,
} from './partsConsultant'
import type { ReportSetting } from './setting'
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
    // A scene that maps no retention patch inside A1 says so, and leaves whether any are kept to the reviewer.
    expect(text).toContain(
      'The scene records no islands or patches of timber inside Block A1; any kept there are the reviewer’s to describe.',
    )
    expect(text).not.toContain('No islands or patches of timber are kept')
    expect(text).toContain('Block A2 keeps 2 internal retention patches, islands of timber inside the opening.')
    expect(out.toComplete).toEqual([
      'Block A1 – VSU 1083: islands or patches of timber kept, if any (none recorded in the scene)',
      'Block A2 – Landform 5a (traced): islands rating',
    ])
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

  it('leave Table 5’s islands to the reviewer, and number Tables 4 and 5 with their notes', () => {
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
    // The scene mapping no patch in A1 is not a finding that none are kept: the rating stays blank.
    expect([a1[islands], a2[islands]]).toEqual(['', ''])
    expect(t5.rows.some((row) => row[1].includes('E5'))).toBe(false)
  })

  it('sign off with a peer reviewer beside the preparer, each with a signature and a date', () => {
    const out = build('sign-off-peer', context('perspective-report-net-private'))
    const [table] = tables(out.blocks)
    expect(table.columns).toEqual(['', 'Prepared by', 'Peer reviewed by'])
    expect(table.rows.map((row) => row[0])).toEqual([
      'Name',
      'Professional designation and seal',
      'Certification',
      'Signature',
      'Date',
    ])
    expect(table.rows[0]).toEqual(['Name', 'R. Planner, RPF', ''])
    // The statements the 2001 forms sign under: the preparer supervised the work, the peer reviewed without supervising.
    expect(table.rows[2]).toEqual([
      'Certification',
      CERTIFICATION_STATEMENTS.supervised,
      CERTIFICATION_STATEMENTS.reviewed,
    ])
    expect(JSON.stringify(table)).not.toMatch(/Association|ABCFP|Chartwell/i)
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
    // With no figure the format's own conclusion is empty: the run's facts conclude, never a placeholder.
    const fromRun = words(build('conclusion', empty).blocks)
    expect(fromRun).toContain('Bay sees none of Blocks A1 and A2.')
    expect(fromRun).not.toContain('The conclusion is written once the extent')
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
    expect(CONSULTANT_RECIPE_PARTS['consultant-gross']).toContain('sign-off-certified')
  })

  it('keep T1 in step with Table 1', () => {
    expect(TABLE_1.columns).toEqual(Object.values(T1))
  })
})

describe('consultant discussion: each block’s own distance', () => {
  it('gives the block’s own distance when the run measured it, else only the bound the nearest block sets', () => {
    // A2 shares the Lake view with A1, so the viewpoint's distance (0.7 km, the nearest block in view) is not A2's.
    const bound = words(build('block-discussion', context('perspective-report-net-private')).blocks)
    expect(bound).toContain(
      'Block A2 is at least 0.7 km from the Lake viewpoint, the distance to the nearest block in view; its own distance was not measured.',
    )
    expect(bound).not.toContain('The nearest block in view is 0.7 km')
    // With the run's own distance for A2 (its nearest sample seen), the sentence and its rating are A2's.
    const measured: DocumentFacts = {
      ...FACTS,
      viewpoints: FACTS.viewpoints.map((entry) =>
        entry.name === 'Lake'
          ? { ...entry, blocks: entry.blocks.map((b) => (b.id === 'A2' ? { ...b, distanceKm: 3.4 } : b)) }
          : entry,
      ),
    }
    const own = words(build('block-discussion', context('perspective-report-net-private', {}, measured)).blocks)
    expect(own).toContain('The block is located at a moderate viewing distance of 3.4 km from the Lake viewpoint.')
    const [, t5] = tables(build('assessment-tables', context('perspective-report-net-private', {}, measured)).blocks)
    const distance = t5.columns.indexOf(T5.distance)
    expect(t5.rows.find((row) => row[1] === 'Block A2')![distance]).toBe('Moderate 3.4 km')
    const [, unmeasured] = tables(build('assessment-tables', context('perspective-report-net-private')).blocks)
    expect(unmeasured.rows.find((row) => row[1] === 'Block A2')![distance]).toBe('at least 0.7 km')
  })
})

// ------------------------------------------------------------------ the templates from the reference comparison

const SETTING: ReportSetting = {
  places: [
    { name: 'Townsite', kind: 'settlement', distanceKm: 6.52, direction: 'north' },
    { name: 'Long Inlet', kind: 'water', distanceKm: 2.5, direction: 'east' },
    { name: 'Grey Creek', kind: 'settlement', distanceKm: 0.84, direction: 'southeast' },
  ],
  ground: { aspect: 'west', slopePercent: 38.4 },
  landformSlopePercent: 31.2,
  stand: {
    species: [
      { name: 'Douglas-fir', percent: 62 },
      { name: 'western hemlock', percent: 21 },
      { name: 'western redcedar', percent: 12 },
    ],
    heightM: 33.4,
    coverPercent: 84,
  },
}
const picture = (view: string, width = 2400, height = 900) => ({
  view,
  caption: `${view}: picture`,
  dataUrl: 'data:image/png;base64,AA',
  width,
  height,
})
const recipeContext = (id: string, over: Partial<ReportContext> = {}) => {
  const recipe = REPORT_RECIPES.find((entry) => entry.id === id)!
  return context(recipe.format, { recipeParts: recipe.parts, recipeOptions: recipe.options, ...over })
}

describe('consultant summary and landscape (22, 23)', () => {
  it('place the blocks from named places and their ground, and cite the appendix', () => {
    const out = build('summary', recipeContext('consultant-gross', { setting: SETTING }))
    const text = words(out.blocks)
    expect(text).toContain('This report summarizes the visual impact assessment (VIA) of proposed Blocks A1 and A2.')
    expect(text).toContain(
      'These two blocks are located 0.8 km southeast of Grey Creek, 6.5 km north of Townsite and 2.5 km east of Long Inlet, on west-facing ground averaging a 38% slope.',
    )
    expect(text).toContain(
      'shown on the viewpoint map (Appendix A1), and the renders from each viewpoint are Appendices A2 to A3.',
    )
    expect(out.toComplete).toEqual([])
    // Without place names the sentence is left out and listed, never guessed.
    const bare = build('summary', recipeContext('consultant-gross'))
    expect(words(bare.blocks)).not.toContain('located')
    expect(bare.toComplete).toEqual([
      'Where the blocks lie from named places (no place names were read for this report)',
    ])
  })

  it('describe the ground and the stands from the run, count the landforms and leave the terrain’s words to the reviewer', () => {
    const facts: DocumentFacts = {
      ...FACTS,
      viewpoints: [...FACTS.viewpoints, vp({ name: 'Point 2', landform: 'Landform 5b (traced)', blocks: [] })],
    }
    const ctx = recipeContext('consultant-net-private', {
      setting: SETTING,
      facts,
      document: resolveViaDocument(findDocumentFormat('perspective-report-net-private')!, facts),
    })
    const out = build('landforms-and-viewpoints', ctx)
    const text = words(out.blocks)
    expect(text).toContain(
      'The landforms’ ground the run sampled averages a 31% slope; the blocks’ ground faces west at an average 38%.',
    )
    expect(text).toContain(
      'The forest inventory records Douglas-fir-leading stands with western hemlock and western redcedar over the landforms, with a mean projected height of 33 m (84% of the landforms’ sampled ground lies in a recorded treed stand).',
    )
    expect(text).toContain(
      'As viewed from the selected viewpoints, the landscape is composed of 2 landforms (Table 2), with Landform 5 divided into Landform 5a and Landform 5b when viewed from Lake and Point 2.',
    )
    expect(text).toContain(
      'Blocks A1 and A2 are seen on landforms read against visual sensitivity unit #1083 (Table 1).',
    )
    expect(text).toContain('listed in Table 3 and shown on the viewpoint map (Appendix A1).')
    expect(out.toComplete).toEqual(['The topography’s character in words (slopes, ridges, draws, benches)'])
    // The inventory's own record of which unit holds each block, when it was read.
    const read = build(
      'landforms-and-viewpoints',
      recipeContext('consultant-net-private', {
        inventoryUnits: [{ vsu: '1107', blocks: { A1: 4 } }, { vsu: '1101', blocks: { A2: 9 } }, { vsu: '1200' }],
      }),
    )
    expect(words(read.blocks)).toContain(
      'Blocks A1 and A2 are located within visual sensitivity units #1107 and #1101 (Table 1).',
    )
    expect(read.toComplete).toContain('The landforms’ slope and stands (not read for this report)')
  })

  it('name a sub-landform once when two viewpoints read it through outlines of their own', () => {
    // Doc 22: Klein Lake 1 reads Landform 5a as traced, Klein Lake 2 as its own visible face.
    const facts: DocumentFacts = {
      ...FACTS,
      viewpoints: [
        ...FACTS.viewpoints,
        vp({ name: 'Point 2', landform: 'Landform 5b (traced)', blocks: [] }),
        vp({ name: 'Point 3', landform: 'Landform 5a (visible face)', blocks: [] }),
      ],
    }
    const ctx = recipeContext('consultant-net-private', {
      facts,
      document: resolveViaDocument(findDocumentFormat('perspective-report-net-private')!, facts),
    })
    const text = words(build('landforms-and-viewpoints', ctx).blocks)
    expect(text).toContain('with Landform 5 divided into Landform 5a and Landform 5b when viewed from')
    expect(text).not.toContain('Landform 5a, Landform 5a')
  })

  it('say where the viewpoints are, counting those at one place, and cite each key viewpoint’s sheet', () => {
    const named = (names: string[]): ReportContext => {
      const facts = { ...FACTS, viewpoints: names.map((name) => vp({ name })) }
      return context('perspective-report-net-private', {}, facts)
    }
    expect(
      viewpointLocations(named(['Point (VP1)', 'Ruby Lake 1 (VP12)', 'Klein Lake 2', 'Ruby Lake 4 (VP17)', 'Hill 3']))
        ?.text,
    ).toBe(
      'The selected viewpoints (Table 3) are located at Point, at two locations on Ruby Lake, Klein Lake 2 and Hill 3.',
    )
    const ctx = recipeContext('consultant-net-private')
    expect(keyViewpointCites(ctx).map((s) => s.text)).toEqual([
      'The viewpoint Bay (see Appendix A3) was selected for the detailed assessment of Block A1 (Table 5).',
      'The viewpoint Lake (see Appendix A5) was selected for the detailed assessment of Block A2 (Table 5).',
    ])
  })
})

describe('consultant appendix (22, 23)', () => {
  it('number the map A1, then each viewpoint’s photo, plain page and analysis sheet in Table 3’s order', () => {
    const ctx = recipeContext('consultant-net-private', {
      images: { before: { Lake: { ...picture('Lake'), source: 'photo' } }, after: { Bay: picture('Bay') } },
    })
    expect(appendixEntries(ctx).map((entry) => `${entry.number} ${entry.title}`)).toEqual([
      'A1 Viewpoint map',
      'A2 Perspective Viewpoint – Bay',
      'A3 Perspective Viewpoint Analysis – Bay – VSU 1083',
      'A4 Photo from viewpoint – Lake',
      'A5 Perspective Viewpoint – Lake',
      'A6 Perspective Viewpoint Analysis – Lake – Landform 5a (traced)',
    ])
    const list = tables(build('appendix-list', ctx).blocks)[0]
    expect(list.rows[0]).toEqual(['A1', 'Viewpoint map'])
    const out = build('appendix-sheets', { ...ctx, figures: [picture('Bay', 1224, 792)] })
    const pairs = out.blocks.filter((b): b is Extract<ReportBlock, { kind: 'figurePair' }> => b.kind === 'figurePair')
    // The plain simulation is the page's own after picture; a missing one prints a placeholder and is listed.
    // Each is an 11 x 17 page like the analysis sheets, its heading on the page.
    expect(pairs.map((pair) => [pair.title, pair.slots[0].label, !!pair.slots[0].figure, pair.sheet])).toEqual([
      ['Appendix A2: Perspective Viewpoint – Bay', 'Perspective Viewpoint – Bay', true, true],
      ['Appendix A4: Photo from viewpoint – Lake', 'Photo from viewpoint – Lake', true, true],
      ['Appendix A5: Perspective Viewpoint – Lake', 'Perspective Viewpoint – Lake', false, true],
    ])
    const headings = out.blocks.filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text)
    expect(headings).toEqual([
      'Appendix A3: Perspective Viewpoint Analysis – Bay – VSU 1083',
      'Appendix A6: Perspective Viewpoint Analysis – Lake – Landform 5a (traced)',
    ])
    expect(out.toComplete).toEqual([
      'Perspective Viewpoint pages not captured: Lake',
      'Perspective Viewpoint Analysis sheets not saved: Lake',
    ])
  })

  it('print 23’s appendix as the analysis sheets alone, and say so in the method', () => {
    const ctx = recipeContext('consultant-gross', { images: { after: { Bay: picture('Bay') } } })
    expect(appendixEntries(ctx).map((entry) => `${entry.number} ${entry.title}`)).toEqual([
      'A1 Viewpoint map',
      'A2 Perspective Viewpoint Analysis – Bay – VSU 1083',
      'A3 Perspective Viewpoint Analysis – Lake – Landform 5a (traced)',
    ])
    expect(build('appendix-sheets', ctx).blocks.some((b) => b.kind === 'figurePair')).toBe(false)
    const method = words(build('assessment-method', ctx).blocks)
    expect(method).toContain('Each viewpoint’s Perspective Viewpoint Analysis page shows the view')
    expect(method).not.toContain('Each viewpoint’s Perspective Viewpoint page')
  })

  it('sign 23 with the preparer’s certification statement', () => {
    const out = build('sign-off-certified', recipeContext('consultant-gross'))
    expect(words(out.blocks)).toContain(CERTIFICATION_STATEMENTS.supervised)
    expect(out.toComplete).toEqual(['Prepared by: designation, seal, signature and date'])
  })
})

describe('Table 1 from the inventory read', () => {
  it('gives every unit a block lies in its own row, with the blocks inside it, beside the viewpoints’ units', () => {
    const ctx = context('perspective-report-net-private', {
      inventoryUnits: [
        { vsu: '1083', vsc: '2', vac: 'M', evc: 'PR', vqo: 'PR', blocks: { A1: 4.2 } },
        { vsu: '2001', vsc: '3', vac: 'H', evc: 'R', vqo: 'R', blocks: { A2: 9 } },
        { vsu: '3005', vsc: '4', vac: 'L', evc: 'M', vqo: 'M' },
      ],
    })
    const [table] = tables(build('table-1-vsu', ctx).blocks)
    const units = table.rows.map((row) => row[0])
    expect(units).toContain('VSU #2001')
    expect(table.rows.find((row) => row[0] === 'VSU #2001')).toEqual([
      'VSU #2001',
      'A2',
      '3',
      'H',
      'R',
      'R - Retention',
    ])
    // A unit no block lies in stays out.
    expect(units).not.toContain('VSU #3005')
  })
})

describe('landforms seen beside a viewpoint’s own (23: Landform 1, 1a and 1b from the Golf Club)', () => {
  const facts: DocumentFacts = {
    ...FACTS,
    viewpoints: [
      FACTS.viewpoints[0],
      {
        ...FACTS.viewpoints[1],
        otherLandforms: [
          {
            landform: 'Landform 5 (traced)',
            objective: 'PR',
            areas: { landform: 30000, proposed: 400, nonVeg: 300, privateLand: 0, rock: 0 },
            blocks: ['A1', 'A2'],
          },
          {
            landform: 'Landform 5b (traced)',
            objective: 'R',
            areas: { landform: 9000, proposed: 0, nonVeg: 180, privateLand: 0, rock: 0 },
            blocks: [],
          },
        ],
      },
    ],
  }
  const ctx = recipeContext('consultant-gross', {
    facts,
    document: resolveViaDocument(findDocumentFormat('perspective-report-gross')!, facts),
  })

  it('give each a Table 2 row with its own blocks and objective, and count the landforms they belong to', () => {
    const rows = tables(build('table-2-landforms', ctx).blocks)[0].rows
    expect(rows.map((row) => [row[0], row[1], row[6]])).toEqual([
      ['VSU 1083', 'A1, E5*', 'PR'],
      ['Landform 5a (traced)', 'A1, A2', 'PR'],
      ['Landform 5 (traced)', 'A1, A2', 'PR'],
      ['Landform 5b (traced)', 'None in view', 'R'],
    ])
    // 5b's description reads its own pass: no private land in it.
    expect(rows[3][7]).toBe('Sub-landform of Landform 5. Read from Lake at 0.7 km.')
    expect(words(build('landforms-and-viewpoints', ctx).blocks)).toContain(
      'As viewed from the selected viewpoints, the landscape is composed of 2 landforms (Table 2), with Landform 5 divided into Landform 5a and Landform 5b when viewed from Lake.',
    )
  })

  it('give each a Table 4 row in the report’s assessment tables', () => {
    const table = tables(build('assessment-tables', ctx).blocks).find((entry) => entry.title?.startsWith('Table 4'))!
    expect(table.rows.filter((row) => row[0] === 'Lake').map((row) => row[1])).toEqual([
      'Landform 5 (traced)',
      'Landform 5a (traced)',
      'Landform 5b (traced)',
    ])
  })
})

describe('each block cited on the landform it lies in (22: Klein Lake 2 reads 5a and 5b)', () => {
  // Lake reads Landform 5a with A1 in it, and 5b beside it with A2; A3 lies in neither.
  const lake = vp({
    name: 'Lake',
    landform: 'Landform 5a (traced)',
    areas: { landform: 10000, proposed: 400, nonVeg: 0, privateLand: 0, rock: 0 },
    landformBlocks: ['A1'],
    otherLandforms: [
      {
        landform: 'Landform 5b (traced)',
        objective: 'PR',
        areas: { landform: 8000, proposed: 240, nonVeg: 0, privateLand: 0, rock: 0 },
        blocks: ['A2'],
      },
    ],
    blocks: [
      { id: 'A1', status: 'visible', visiblePercent: 20, share: 0.4 },
      { id: 'A2', status: 'visible', visiblePercent: 35, share: 0.5 },
      { id: 'A3', status: 'visible', visiblePercent: 10, share: 0.1 },
    ],
  })
  const facts: DocumentFacts = { ...FACTS, viewpoints: [FACTS.viewpoints[0], lake] }
  const document = resolveViaDocument(findDocumentFormat('perspective-report-net-private')!, facts)
  const ctx = recipeContext('consultant-net-private', { facts, document })
  const section = (block: string) => document.discussion.find((entry) => entry.blocks.includes(block))!
  const text = (block: string) =>
    section(block)
      .paragraphs.flatMap((p) => p.sentences)
      .map((s) => s.text)
      .join(' ')

  it('write each block’s text on its own landform’s figure, and say so when none holds it', () => {
    expect(section('A2').heading).toBe('Block A2 – Landform 5b (traced)')
    expect(text('A2')).toContain('Block A2 is located in Landform 5 within Landform 5b (traced)')
    expect(text('A2')).toContain('(3.00% alteration)')
    expect(text('A2')).not.toContain('Landform 5a')
    expect(section('A3').landform).toBeNull()
    expect(text('A3')).toContain('Block A3 lies outside the landforms outlined from the Lake viewpoint')
    expect(text('A3')).toContain('none of Landform 5a (traced) and Landform 5b (traced) takes in the block')
    expect(text('A3')).not.toContain('% alteration')
  })

  it('list and rate each block on its landform in Tables 2, 4 and 5', () => {
    const t2 = tables(build('table-2-landforms', ctx).blocks)[0].rows
    expect(t2.filter((row) => row[0].startsWith('Landform')).map((row) => [row[0], row[1]])).toEqual([
      ['Landform 5a (traced)', 'A1'],
      ['Landform 5b (traced)', 'A2'],
    ])
    const [t4, t5] = tables(build('assessment-tables', ctx).blocks)
    const lakeRows = t4.rows.filter((row) => row[0] === 'Lake')
    expect(lakeRows.map((row) => [row[1], row[3]])).toEqual([
      ['Landform 5a (traced)', 'A1'],
      ['Landform 5b (traced)', 'A2'],
    ])
    const landform = t5.columns.indexOf(T5.landform)
    const percent = t5.columns.indexOf(T5.percent)
    const row = (block: string) => t5.rows.find((entry) => entry[0] === 'Lake' && entry[1] === `Block ${block}`)!
    expect([row('A2')[landform], row('A2')[percent]]).toEqual(['Landform 5b (traced)', '3.00'])
    expect([row('A3')[landform], row('A3')[percent]]).toEqual(['Outside the landforms outlined', ''])
  })

  it('quote in the conclusion the figure of the landform holding the blocks a viewpoint is key for', () => {
    const conclusion = document.summary.map((s) => s.text).join(' ')
    // Lake is key for A2 (on 5b, 3.00%) and A1 (on 5a, its own landform, 4.00%): each landform's figure, 5b named.
    expect(conclusion).toMatch(/3\.00% \([^)]*\) on Landform 5b at Lake\b/)
    expect(conclusion).not.toContain('on Landform 5a')
  })

  it('read every block on the view’s landform when the view recorded no list', () => {
    const bare: DocumentViewpoint = { ...lake, landformBlocks: undefined, otherLandforms: undefined }
    const old = resolveViaDocument(findDocumentFormat('perspective-report-net-private')!, {
      ...FACTS,
      viewpoints: [FACTS.viewpoints[0], bare],
    })
    const a3 = old.discussion.find((entry) => entry.blocks.includes('A3'))!
    expect(a3.heading).toBe('Block A3 – Landform 5a (traced)')
  })
})

describe("the viewpoint calculation names what the existing openings' green-up rests on", () => {
  it('prints the basis beside the existing-openings figure only when the facts give one', () => {
    const basis = 'supplied estimate for 7 of 19 openings, modelled for 12'
    const lake = { ...FACTS.viewpoints[1], greenUp: basis }
    const facts: DocumentFacts = { ...FACTS, viewpoints: [FACTS.viewpoints[0], lake] }
    const ctx = context('perspective-report-net-private', {}, facts)
    expect(words([calculationFields(ctx, lake)])).toContain(`"Green-up of existing openings","value":"${basis}"`)
    expect(words([calculationFields(ctx, FACTS.viewpoints[0])])).not.toContain('Green-up of existing openings')
  })
})
