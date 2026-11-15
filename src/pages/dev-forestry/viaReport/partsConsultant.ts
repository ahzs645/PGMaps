/**
 * Report parts for the consultant perspective reports (22, 23): the assessment method, the numbered Tables 1-3 (the
 * visual sensitivity units, the landform summary, the viewpoints and their significance), and the sign-off with a
 * peer reviewer. Tables 4 and 5 are the format's own (`assessment-tables`, `viaDocument/formats.ts`).
 *
 * Structure only, never branding: the words are PGMaps' own, the slots the run's, the scene's or the reviewer's. Blocks
 * of another sale or permit are marked * wherever a table lists them and named once, in the method. Registered in
 * `registry.ts`. No DOM or network access.
 */
import { T1, TABLE_1, TABLE_2, TABLE_3, type DocumentTable } from '../viaDocument/formats'
import {
  andList,
  isOtherPlanned,
  normalizeBlock,
  type BlockAtStation,
  type DocumentViewpoint,
} from '../viaDocument/resolve'
import { CLASS_NAMES, type ClassCode } from '../viaDocument/scales'
import { fillSentence, type Sentence } from '../viaDocument/wording'
import { heading, text, type ReportBlock } from './model'
import {
  blank,
  inventoryAdoption,
  landformNames,
  landformNote,
  landformParent,
  paragraph,
  type ReportContext,
  type ReportPart,
} from './parts'

const seen = (block: BlockAtStation) => block.status === 'visible' || block.status === 'possible glimpses'
const marked = (block: BlockAtStation) => `${block.id}${isOtherPlanned(block) ? '*' : ''}`
const OTHER_NOTE = '* Planned under another sale or cutting permit and assessed in its own VIA.'

/** A table block from one of the numbered definitions, its footnotes as the note. */
function numberedTable(table: DocumentTable, rows: string[][], extraNotes: string[] = []): ReportBlock {
  const notes = [...(table.footnotes ?? []), ...extraNotes]
  return {
    kind: 'table',
    title: table.title,
    columns: [...table.columns],
    rows,
    ...(notes.length ? { note: notes.join(' ') } : {}),
    source: 'run',
  }
}

/** The viewpoints with blocks of another sale read as such, whether flagged or only named so. */
const viewpointsOf = (ctx: ReportContext): DocumentViewpoint[] =>
  ctx.facts.viewpoints.map((vp) => ({ ...vp, blocks: vp.blocks.map(normalizeBlock) }))

/** "VSU 1284" or "VSU #1284" names its unit; a landform named otherwise names none. */
const vsuFromName = (name: string) => /^\s*VSU\s*#?\s*(\d+)\b/i.exec(name)?.[1] ?? null
const vsuOf = (vp: DocumentViewpoint) => vp.inventory?.vsu ?? vsuFromName(vp.landform)
const vqoCell = (code: string | null | undefined) =>
  code ? (code in CLASS_NAMES ? `${code} - ${CLASS_NAMES[code as ClassCode]}` : code) : ''

/** The blocks seen from these viewpoints, once each, other planned ones marked *. */
function seenBlocks(vps: readonly DocumentViewpoint[]): { names: string[]; other: boolean } {
  const out = new Map<string, BlockAtStation>()
  for (const vp of vps) for (const block of vp.blocks) if (seen(block) && !out.has(block.id)) out.set(block.id, block)
  const blocks = [...out.values()]
  return { names: blocks.map(marked), other: blocks.some(isOtherPlanned) }
}

// ------------------------------------------------------------------ the method

/**
 * What the references' method section says beyond the shared methods part: where the objectives are held, what
 * Tables 4 and 5 rate, how the key viewpoint is chosen, and the blocks of another sale named once.
 */
const assessmentMethod: ReportPart = {
  id: 'assessment-method',
  title: 'Assessment method',
  sources: ['22', '23'],
  build: (ctx) => {
    const group = ctx.document.keyViewpoints?.mode === 'group'
    const blocks: ReportBlock[] = [
      heading('Assessment method', 3),
      text(
        `Visual quality objectives are established for the visual sensitivity units of the Visual Landscape Inventory, which is held in the BC Geographic Warehouse (REC_VISUAL_LANDSCAPE_INVENTORY) and published through DataBC; the units and objectives that apply here are listed in Table 1. ${
          ctx.inventoryRead
            ? 'The inventory was read live for this report.'
            : 'The inventory was not read for this report, so Table 1 holds the office fields.'
        }`,
        'run',
      ),
      text(
        'Where a landform holds more than one unit, the unit covering most of it and its objective are taken for the landform (Table 2).',
        'fixed',
      ),
      text(
        'The assessment has two stages. Table 4 rates each landform from every viewpoint against the definition of the objective, on the three elements together: visibility, size and scale, and visual design. Table 5 then assesses the proposal from its key viewpoint on the factors within those three elements: the level of impact, the response to the lines of force, how the alteration borrows from the natural character of the landscape, its edges, the islands of timber kept inside it, the viewing distance and its position on the landform (see the notes to Table 5). Whether the objective is met is a judgement weighing them all.',
        'fixed',
      ),
      text(
        ctx.document.format.keyViewpointRule === 'impact'
          ? group
            ? 'One key viewpoint is chosen for the blocks as a group, the one from which the visual impact is most significant: of the viewpoints that see the most of them, the most significant (Table 3), and of those the one showing the most alteration of the landform. The blocks are discussed and rated together from it; a block it does not see is assessed from its own key viewpoint.'
            : 'Each block is assessed from the viewpoint from which its visual impact is most significant: of the viewpoints that see it, the most significant (Table 3), and of those the one showing the most alteration of the landform. Each block is discussed and rated once, from that viewpoint.'
          : group
            ? 'One key viewpoint is chosen for the blocks as a group: the viewpoint that sees the most of them, and of those the one that sees the largest share of their ground together, so the blocks are most visible together from there. The blocks are discussed and rated together from it; a block it does not see is assessed from its own key viewpoint.'
            : 'Each block is assessed from its own key viewpoint: the viewpoint that sees the largest share of the block’s ground, so the block is most visible and most directly in view from there. Each block is discussed and rated once, from that viewpoint.',
        'fixed',
      ),
    ]
    const other = ctx.document.otherPlanned?.sentence
    if (other?.text) blocks.push(...paragraph([other]))
    return { blocks }
  },
}

// ------------------------------------------------------------------ Table 1

/** Table 1: each visual sensitivity unit the viewpoints' landforms are read against, with its attributes. */
const table1: ReportPart = {
  id: 'table-1-vsu',
  title: 'Table 1: Visual sensitivity units',
  sources: ['22', '23'],
  build: (ctx) => {
    const units = new Map<string, DocumentViewpoint[]>()
    for (const vp of viewpointsOf(ctx)) {
      const vsu = vsuOf(vp)
      if (vsu) units.set(vsu, [...(units.get(vsu) ?? []), vp])
    }
    const office = ctx.inventory?.vsu ?? blank(ctx.office.vliPolygon)
    if (office && !units.has(office)) units.set(office, [])
    const rows = [...units].map(([vsu, vps]) => {
      const unit = vps.find((vp) => vp.inventory)?.inventory ?? (vsu === ctx.inventory?.vsu ? ctx.inventory : null)
      const fallback = vsu === office && !unit
      const { names } = seenBlocks(vps)
      return {
        [T1.vsu]: `VSU #${vsu}`,
        [T1.blocks]: names.join(', ') || 'None in view',
        [T1.vsc]: unit?.vsc ?? (fallback ? (blank(ctx.office.vsc) ?? '') : ''),
        [T1.vac]: unit?.vac ?? (fallback ? (ctx.landform?.vac ?? '') : ''),
        [T1.evc]: unit?.evc ?? (fallback ? (blank(ctx.office.evc) ?? '') : ''),
        [T1.vqo]: vqoCell(unit?.vqo ?? vps.find((vp) => vp.objective)?.objective ?? ctx.landform?.objective),
      }
    })
    const other = rows.some((row) => row[T1.blocks].includes('*'))
    const blocks: ReportBlock[] = [
      heading('Visual sensitivity units'),
      numberedTable(
        TABLE_1,
        rows.map((row) => TABLE_1.columns.map((c) => row[c as keyof typeof row] ?? '')),
        [
          'Blocks are listed against the unit their viewpoint’s landform is read against.',
          ...(other ? [OTHER_NOTE] : []),
        ],
      ),
    ]
    const adopted = inventoryAdoption(ctx)
    if (adopted) blocks.push(...paragraph([adopted]))
    const gaps = rows.some((row) => !row[T1.vsc] || !row[T1.vac] || !row[T1.evc])
    return {
      blocks,
      toComplete: [
        ...(rows.length ? [] : ['Table 1: the visual sensitivity units (inventory not read, no VLI polygon given)']),
        ...(gaps ? ['Table 1: VSC, VAC and EVC of each unit'] : []),
      ],
    }
  },
}

// ------------------------------------------------------------------ Table 2

/**
 * A landform's description from the run where the reviewer has given none: the viewpoints that read it, how far,
 * and how much of it is private land in the picture. The terrain words are the reviewer's.
 */
function runDescription(vps: readonly DocumentViewpoint[]): string {
  const distances = vps.map((vp) => vp.distanceKm).filter((d): d is number => d !== null)
  const near = distances.length ? Math.min(...distances) : null
  const far = distances.length ? Math.max(...distances) : null
  const span =
    near === null
      ? ''
      : near.toFixed(1) === far!.toFixed(1)
        ? ` at ${near.toFixed(1)} km`
        : ` at ${near.toFixed(1)}-${far!.toFixed(1)} km`
  const privateShare = Math.max(
    0,
    ...vps.map((vp) =>
      vp.areas && vp.areas.landform > 0 ? (100 * (vp.areas.privateLand ?? 0)) / vp.areas.landform : 0,
    ),
  )
  const names = andList(vps.map((vp) => vp.name))
  return `Read from ${names}${span}.${
    privateShare >= 1 ? ` Private land is up to ${Math.round(privateShare)}% of it in the picture.` : ''
  }`
}

/** Table 2: each landform the viewpoints read, with its blocks, unit, attributes and a description. */
const table2: ReportPart = {
  id: 'table-2-landforms',
  title: 'Table 2: Landform summary',
  sources: ['22', '23'],
  build: (ctx) => {
    const names = landformNames(ctx)
    if (!names.length && ctx.landform) names.push(ctx.landform.name)
    let other = false
    let described = true
    const rows = names.map((name) => {
      const vps = viewpointsOf(ctx).filter((vp) => vp.landform === name)
      const note = landformNote(ctx, name)
      const unit = vps.find((vp) => vp.inventory)?.inventory ?? (name === ctx.landform?.name ? ctx.inventory : null)
      const vsu = vps.map(vsuOf).find(Boolean) ?? unit?.vsu ?? ''
      const seenHere = seenBlocks(vps)
      other ||= seenHere.other
      const evc = unit?.evc ?? ''
      const description = blank(note?.description)
      if (!description) described = false
      const parent = landformParent(ctx, name)
      const sub = parent ? `Sub-landform of ${parent}${note?.divider ? `, divided at ${note.divider}` : ''}. ` : ''
      return [
        name,
        seenHere.names.join(', ') || 'None in view',
        vsu ? `#${vsu}` : '',
        unit?.vsc ?? '',
        unit?.vac ?? (name === ctx.landform?.name ? (ctx.landform.vac ?? '') : ''),
        note?.evc ? `${evc ? `${evc} (VSU) / ` : ''}${note.evc} (LF)` : evc,
        vps.find((vp) => vp.objective)?.objective ??
          (name === ctx.landform?.name ? (ctx.landform.objective ?? '') : ''),
        `${sub}${description ?? (vps.length ? runDescription(vps) : '')}`,
      ]
    })
    // The split sentence, per sub-landform (recorded, or read from its name): where it is divided is the reviewer's
    // unless the scene records it, so a split without a divider asks for one.
    const subs = names.filter((name) => landformParent(ctx, name))
    const splits: Sentence[] = subs.map((name) => {
      const note = landformNote(ctx, name)
      const readFrom = andList(
        viewpointsOf(ctx)
          .filter((vp) => vp.landform === name)
          .map((vp) => vp.name),
      )
      return fillSentence(
        'sub-landform-split',
        note?.divider
          ? '{landform} is assessed as a sub-landform of {parent}, divided from the rest of it at {divider}, as it reads as a landform of its own from {readFrom}; its percent alteration is read on its own.'
          : '{landform} is assessed as a sub-landform of {parent}, as it reads as a landform of its own from {readFrom}; its percent alteration is read on its own.',
        {
          landform: name,
          parent: landformParent(ctx, name),
          divider: note?.divider,
          readFrom: readFrom || 'the viewpoints',
        },
        'scene',
      )
    })
    const undivided = subs.filter((name) => !landformNote(ctx, name)?.divider)
    return {
      blocks: [
        heading('Landforms'),
        numberedTable(TABLE_2, rows, [
          ...(described ? [] : ['Descriptions not given by the reviewer say which viewpoints read the landform.']),
          ...(other ? [OTHER_NOTE] : []),
        ]),
        ...paragraph(splits),
      ],
      toComplete: [
        ...(described ? [] : ['Table 2: describe each landform’s terrain and existing condition']),
        ...(undivided.length
          ? [
              `Where ${andList(undivided)} ${undivided.length === 1 ? 'is' : 'are'} divided from the rest of the landform`,
            ]
          : []),
      ],
    }
  },
}

// ------------------------------------------------------------------ Table 3

/** Table 3: per viewpoint, the blocks it sees, why it was chosen and what viewing from it is like, its significance. */
const table3: ReportPart = {
  id: 'table-3-viewpoints',
  title: 'Table 3: Viewpoints and significance',
  sources: ['22', '23'],
  build: (ctx) => {
    let other = false
    let open = 0
    const rows = viewpointsOf(ctx).map((vp) => {
      const inView = vp.blocks.filter(seen)
      other ||= inView.some(isOtherPlanned)
      const listed = inView.map((b) => `${marked(b)}${b.status === 'possible glimpses' ? ' (glimpses)' : ''}`)
      if (vp.areas && vp.areas.nonVeg > 0) listed.push('existing openings not greened up')
      const where = [
        vp.lngLat ? `At ${vp.lngLat[1].toFixed(4)}, ${vp.lngLat[0].toFixed(4)}` : null,
        vp.distanceKm === null ? null : `${vp.distanceKm.toFixed(1)} km from the nearest block it sees`,
      ].filter(Boolean)
      const run = where.length ? `${where.join(', ')}.` : ''
      const reviewer = [
        fillSentence(
          'selection',
          'The viewpoint was chosen for {reason}.',
          { reason: vp.review?.selectionReason },
          'reviewer',
        ),
        fillSentence(
          'experience',
          'The viewing experience is {experience}.',
          { experience: vp.review?.viewingExperience },
          'reviewer',
        ),
      ]
      if (reviewer.some((s) => !s.text) || !vp.review?.importance) open++
      return [
        vp.name,
        listed.join(', ') || (vp.blocks.length ? 'None visible' : ''),
        [run, ...reviewer.map((s) => s.text).filter(Boolean)].join(' '),
        vp.review?.importance ?? '',
      ]
    })
    return {
      blocks: [heading('Viewpoints'), numberedTable(TABLE_3, rows, other ? [OTHER_NOTE] : [])],
      toComplete: open
        ? [
            `Table 3: why each viewpoint was chosen, its viewing experience and significance (${open} of ${rows.length} viewpoints)`,
          ]
        : [],
    }
  },
}

// ------------------------------------------------------------------ sign-off with a peer reviewer

/** The sign-off in two columns: the professional who prepared the report and the one who peer reviewed it (22). */
const signOffPeer: ReportPart = {
  id: 'sign-off-peer',
  title: 'Sign-off and peer review',
  sources: ['22'],
  build: (ctx) => {
    const preparer = blank(ctx.office.evaluator)
    return {
      blocks: [
        heading('Sign-off'),
        {
          kind: 'table',
          columns: ['', 'Prepared by', 'Peer reviewed by'],
          rows: [
            ['Name', preparer ?? '', ''],
            ['Professional designation and seal', '', ''],
            [
              'Statement',
              'I carried out or directly supervised the work described here, and it meets the standards expected of a member of my profession.',
              'I reviewed this document without supervising the work it describes, and judge that the work meets the standards expected of a member of my profession.',
            ],
            ['Signature', '', ''],
            ['Date', '', ''],
          ],
          source: 'reviewer',
        },
      ],
      toComplete: [
        ...(preparer ? [] : ['Prepared by: name']),
        'Prepared by: designation, seal, signature and date',
        'Peer reviewed by: name, designation, seal, signature and date',
      ],
    }
  },
}

export const CONSULTANT_PARTS: readonly ReportPart[] = [assessmentMethod, table1, table2, table3, signOffPeer]

/**
 * The consultant reports' parts in the references' order (22, 23), for `recipes.ts`. 22 signs with a peer reviewer;
 * 23 with the preparer alone, its limitations under the conclusion.
 */
export const CONSULTANT_RECIPE_PARTS: Readonly<
  Record<'consultant-net-private' | 'consultant-gross', readonly string[]>
> = {
  'consultant-net-private': [
    'cover',
    'regulatory-frame',
    'three-elements',
    'extent-scale',
    'vocabulary',
    'methodology',
    'assessment-method',
    'table-1-vsu',
    'table-2-landforms',
    'table-3-viewpoints',
    'assessment-tables',
    'block-discussion',
    'recommendations',
    'conclusion',
    'limitations',
    'sign-off-peer',
    'references',
    'calculations',
  ],
  'consultant-gross': [
    'cover',
    'regulatory-frame',
    'three-elements',
    'extent-scale',
    'vocabulary',
    'methodology',
    'assessment-method',
    'table-1-vsu',
    'table-2-landforms',
    'table-3-viewpoints',
    'assessment-tables',
    'block-discussion',
    'recommendations',
    'conclusion',
    'limitations',
    'sign-off',
    'references',
    'calculations',
  ],
}
