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
  blockList,
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
  blockFacts,
  calculationFields,
  CERTIFICATION_STATEMENTS,
  figureFor,
  inventoryAdoption,
  landformNames,
  landformNote,
  landformParent,
  paragraph,
  proposedBlocks,
  type ReportContext,
  type ReportPart,
} from './parts'
import type { ReportSetting } from './setting'

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
    // Where the viewpoints are, what the appendix pages show, and the key viewpoints with their sheets.
    const located = viewpointLocations(ctx)
    if (located) blocks.push(...paragraph([located]))
    const plain = appendixEntries(ctx).filter((entry) => entry.kind === 'plain' || entry.kind === 'analysis')
    if (plain.length)
      blocks.push(
        text(
          `The renders from each viewpoint are in ${cite(plain)}. Each viewpoint’s Perspective Viewpoint page shows the view as the model simulates it after harvest, with nothing drawn over it; the Perspective Viewpoint Analysis page after it shows the same view with the landform’s boundary, the blocks and the calculated percent alteration.`,
          'run',
        ),
      )
    blocks.push(...paragraph(keyViewpointCites(ctx)))
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
    // When the inventory was read, every unit a block lies in gets its row, with the blocks inside it by area, not
    // only the units the viewpoints' landforms are read against.
    for (const unit of ctx.inventoryUnits ?? []) {
      const inside = Object.keys(unit.blocks ?? {})
      if (!inside.length || rows.some((row) => row[T1.vsu] === `VSU #${unit.vsu}`)) continue
      rows.push({
        [T1.vsu]: `VSU #${unit.vsu}`,
        [T1.blocks]: inside.map((name) => blockFacts(ctx, name)?.name ?? name).join(', '),
        [T1.vsc]: unit.vsc ?? '',
        [T1.vac]: unit.vac ?? '',
        [T1.evc]: unit.evc ?? '',
        [T1.vqo]: vqoCell(unit.vqo),
      })
    }
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

// ------------------------------------------------------------------ the appendix and its numbers

/** One page of the appendix: its number ("A3"), its title, what it holds and the viewpoint it belongs to. */
export interface AppendixEntry {
  number: string
  title: string
  kind: 'map' | 'photo' | 'plain' | 'analysis'
  viewpoint?: string
}

/** A landform or viewpoint name without the outline's source in brackets ("Landform 1a (traced)" → "Landform 1a"). */
const plainName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim() || name

/**
 * The appendix as the consultant reports number it (22, 23): the viewpoint map as A1, then per viewpoint in Table 3's
 * order its field photograph where one is lined up, its Perspective Viewpoint page (the plain simulation) and its
 * Perspective Viewpoint Analysis sheet. Only pages the recipe prints are numbered.
 */
export function appendixEntries(ctx: ReportContext): AppendixEntry[] {
  const prints = (id: string) => !ctx.recipeParts || ctx.recipeParts.includes(id)
  const out: AppendixEntry[] = []
  const next = () => `A${out.length + 1}`
  if (prints('overview-sheet')) {
    const scale = (ctx.images?.overviewSheet ?? ctx.images?.overviewMap)?.map?.scale
    out.push({ number: next(), title: `Viewpoint map${scale ? ` ${scale}` : ''}`, kind: 'map' })
  }
  if (!prints('appendix-sheets')) return out
  for (const vp of ctx.facts.viewpoints) {
    if (ctx.images?.before?.[vp.name]?.source === 'photo')
      out.push({ number: next(), title: `Photo from viewpoint – ${vp.name}`, kind: 'photo', viewpoint: vp.name })
    out.push({ number: next(), title: `Perspective Viewpoint – ${vp.name}`, kind: 'plain', viewpoint: vp.name })
    out.push({
      number: next(),
      title: `Perspective Viewpoint Analysis – ${vp.name} – ${vp.landform}`,
      kind: 'analysis',
      viewpoint: vp.name,
    })
  }
  return out
}

/** "Appendix A1", "Appendix A2 to A9": the entries' numbers as the text cites them. */
function cite(entries: readonly AppendixEntry[]): string | null {
  if (!entries.length) return null
  return entries.length === 1
    ? `Appendix ${entries[0].number}`
    : `Appendices ${entries[0].number} to ${entries[entries.length - 1].number}`
}
const mapCite = (ctx: ReportContext) => cite(appendixEntries(ctx).filter((entry) => entry.kind === 'map'))
const viewpointCite = (ctx: ReportContext, name: string, kind: AppendixEntry['kind'] = 'analysis') =>
  cite(appendixEntries(ctx).filter((entry) => entry.viewpoint === name && entry.kind === kind))

/** The appendix's list of pages, as the references print it in their contents (22, 23). */
const appendixList: ReportPart = {
  id: 'appendix-list',
  title: 'Appendix',
  sources: ['22', '23'],
  build: (ctx) => {
    const entries = appendixEntries(ctx)
    if (!entries.length) return { blocks: [] }
    return {
      blocks: [
        heading('Appendix'),
        {
          kind: 'table',
          columns: ['Appendix', 'Title'],
          rows: entries.map((entry) => [entry.number, entry.title]),
          source: 'run',
        },
      ],
    }
  },
}

/**
 * The appendix pages after the viewpoint map (22, 23), each with its number: per viewpoint the lined-up field
 * photograph where there is one, the Perspective Viewpoint page (the plain simulation, `ReportImages.after`) and the
 * Perspective Viewpoint Analysis sheet with its calculation. Replaces the shared calculations part in these reports.
 */
const appendixSheets: ReportPart = {
  id: 'appendix-sheets',
  title: 'Appendix pages',
  sources: ['22', '23'],
  build: (ctx) => {
    const blocks: ReportBlock[] = []
    const missingPlain: string[] = []
    const missingSheet: string[] = []
    for (const entry of appendixEntries(ctx)) {
      const vp = ctx.facts.viewpoints.find((candidate) => candidate.name === entry.viewpoint)
      if (!vp) continue
      if (entry.kind === 'photo' || entry.kind === 'plain') {
        const figure =
          entry.kind === 'photo' ? (ctx.images?.before?.[vp.name] ?? null) : (ctx.images?.after?.[vp.name] ?? null)
        if (entry.kind === 'plain' && !figure) missingPlain.push(vp.name)
        blocks.push({
          kind: 'figurePair',
          title: `Appendix ${entry.number}`,
          slots: [
            {
              label: entry.title,
              figure,
              placeholder: 'The view’s framed capture, drawn without outlines or figures, goes here.',
              note:
                entry.kind === 'photo'
                  ? 'Field photograph from the viewpoint, lined up with the simulation’s camera.'
                  : 'Simulated view after harvest, as modelled: no landform boundary, outlines or figures.',
            },
          ],
          placement: 'caption',
          landscape: true,
        })
        continue
      }
      const figure = figureFor(ctx, vp.name)
      if (!figure) missingSheet.push(vp.name)
      blocks.push(
        heading(`Appendix ${entry.number}: ${entry.title}`, 3),
        figure
          ? { kind: 'figure', figure, caption: figure.caption }
          : {
              kind: 'figure',
              figure: null,
              caption: entry.title,
              placeholder: 'Save the view with its analysis sheet to print it here.',
            },
        calculationFields(ctx, vp),
      )
    }
    return {
      blocks,
      toComplete: [
        ...(missingPlain.length && ctx.images
          ? [`Perspective Viewpoint pages not captured: ${andList(missingPlain)}`]
          : []),
        ...(missingSheet.length ? [`Perspective Viewpoint Analysis sheets not saved: ${andList(missingSheet)}`] : []),
      ],
    }
  },
}

// ------------------------------------------------------------------ the summary

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const km1 = (value: number) => `${value.toFixed(1)} km`

/** "6.5 km north of the town, 0.8 km southeast of the creek and 2.5 km east of the inlet", nearest kinds first. */
function placesPhrase(places: ReportSetting['places']): string | null {
  const order: Record<string, number> = { settlement: 0, island: 1, peak: 2, water: 3, other: 4 }
  const sorted = [...places].sort((a, b) => order[a.kind] - order[b.kind] || a.distanceKm - b.distanceKm)
  return sorted.length
    ? andList(sorted.map((place) => `${km1(place.distanceKm)} ${place.direction} of ${place.name}`))
    : null
}

/**
 * The summary the consultant reports open with (22, 23): the blocks assessed, where they lie from named places and
 * which way their ground faces (`ReportContext.setting`), and how the report is laid out, citing the appendix.
 */
const summary: ReportPart = {
  id: 'summary',
  title: 'Summary',
  sources: ['22', '23'],
  build: (ctx) => {
    const ids = proposedBlocks(ctx).map((block) => block.name)
    const setting = ctx.setting
    const where = setting ? placesPhrase(setting.places) : null
    const ground = setting?.ground
    const facing = ground?.aspect
      ? `, on ${ground.aspect}-facing ground${ground.slopePercent === null ? '' : ` averaging a ${Math.round(ground.slopePercent)}% slope`}`
      : ''
    const area = blank(ctx.office.generalLocation)
    const map = mapCite(ctx)
    const renders = cite(appendixEntries(ctx).filter((entry) => entry.kind !== 'map'))
    const these = ids.length > 1 ? `These ${NUMBER_WORDS[ids.length] ?? ids.length} blocks are` : 'The block is'
    const sentences: Sentence[] = [
      fillSentence(
        'summary-scope',
        `This report summarizes the visual impact assessment (VIA) of {blocks}${area ? `, in ${area}` : ''}.`,
        { blocks: ids.length ? `proposed ${blockList(ids)}` : 'the proposed blocks' },
        'scene',
      ),
      ...(where || facing
        ? [fillSentence('summary-location', `${these} located${where ? ' {where}' : ''}${facing}.`, { where }, 'run')]
        : []),
      fillSentence(
        'summary-method',
        `The assessment rates the alteration seen from significant public viewpoints at the landform scale against the established visual quality objectives. The viewpoints are shown on the viewpoint map${
          map ? ` (${map})` : ''
        }${renders ? `, and the renders from each viewpoint are ${renders}` : ''}. Tables 1 to 5 summarize the results, and a discussion of each block’s visual impact supports the conclusion.`,
        {},
        'run',
      ),
    ]
    return {
      blocks: [heading('Summary'), ...paragraph(sentences)],
      toComplete: where
        ? []
        : [
            setting
              ? 'Where the blocks lie from named places (the basemap named none within reach of them)'
              : 'Where the blocks lie from named places (no place names were read for this report)',
          ],
    }
  },
}

// ------------------------------------------------------------------ landforms and viewpoints

/** At or above this share of the landforms' samples in a recorded stand, the stand sentence does not state the share. */
const FULL_COVER_PERCENT = 90

/** The units the proposed blocks lie in: the inventory's own record where it was read, else Table 1's reading. */
function blockUnits(ctx: ReportContext): { units: string[]; read: boolean } {
  const ids = new Set(proposedBlocks(ctx).map((block) => block.name))
  const read = (ctx.inventoryUnits ?? []).filter((unit) => Object.keys(unit.blocks ?? {}).some((name) => ids.has(name)))
  if (read.length) return { units: read.map((unit) => unit.vsu), read: true }
  const seenOn = viewpointsOf(ctx).filter((vp) => vp.blocks.some((block) => seen(block) && !isOtherPlanned(block)))
  return { units: [...new Set(seenOn.map(vsuOf).filter((vsu): vsu is string => !!vsu))], read: false }
}

/**
 * The landscape the references describe before their tables (22, 23): the units the blocks lie in, the slope and the
 * stands the run read (`ReportContext.setting`), how many landforms the viewpoints read and which are divided into
 * sub-landforms, and where the viewpoints are listed. The terrain's character in words is the reviewer's.
 */
const landformsAndViewpoints: ReportPart = {
  id: 'landforms-and-viewpoints',
  title: 'Landforms and viewpoints',
  sources: ['22', '23'],
  build: (ctx) => {
    const setting = ctx.setting
    const toComplete: string[] = []
    const ids = proposedBlocks(ctx).map((block) => block.name)
    const subject = ids.length ? blockList(ids) : 'The proposed blocks'
    const plural = ids.length !== 1
    const { units, read } = blockUnits(ctx)
    const located: Sentence[] = units.length
      ? [
          fillSentence(
            'blocks-units',
            `{subject} ${plural ? 'are' : 'is'} ${read ? 'located within' : 'seen on landforms read against'} visual sensitivity unit${
              units.length > 1 ? 's' : ''
            } {units} (Table 1).`,
            { subject, units: andList(units.map((vsu) => `#${vsu}`)) },
            'run',
          ),
        ]
      : []
    // The ground, from the run's samples: the landforms' slope and the way the blocks' ground faces.
    const ground = setting?.ground
    const land: Sentence[] = []
    if (setting?.landformSlopePercent != null || ground) {
      const parts = [
        setting?.landformSlopePercent != null
          ? `the landforms’ ground the run sampled averages a ${Math.round(setting.landformSlopePercent)}% slope`
          : null,
        ground
          ? `the blocks’ ground ${ground.aspect ? `faces ${ground.aspect}` : 'faces no one way'}${
              ground.slopePercent === null ? '' : ` at an average ${Math.round(ground.slopePercent)}%`
            }`
          : null,
      ].filter((part): part is string => !!part)
      land.push(fillSentence('terrain', '{text}.', { text: parts.join('; ') }, 'run'))
    }
    toComplete.push('The topography’s character in words (slopes, ridges, draws, benches)')
    const stand = setting?.stand
    if (stand?.species.length) {
      const [lead, ...rest] = stand.species
      const others = rest.length ? ` with ${andList(rest.map((entry) => entry.name))}` : ''
      const height = stand.heightM === null ? '' : `, with a mean projected height of ${Math.round(stand.heightM)} m`
      const cover =
        stand.coverPercent < FULL_COVER_PERCENT
          ? ` (${stand.coverPercent}% of the landforms’ sampled ground lies in a recorded treed stand)`
          : ''
      land.push(
        fillSentence(
          'stands',
          `The forest inventory records {lead}-leading stands${others} over the landforms${height}${cover}.`,
          { lead: lead.name },
          'run',
        ),
      )
    } else
      toComplete.push(
        setting
          ? 'The stands over the landforms (the run read no forest inventory there)'
          : 'The landforms’ slope and stands (not read for this report)',
      )
    // How many landforms the viewpoints read, and which are divided into sub-landforms, from which viewpoints.
    const names = landformNames(ctx)
    const subs = names.filter((name) => landformParent(ctx, name))
    const parents = [...new Set(subs.map((name) => landformParent(ctx, name)!))]
    const top = new Set([
      ...names.filter((name) => !landformParent(ctx, name)).map(plainName),
      ...parents.map(plainName),
    ])
    const count: Sentence[] = names.length
      ? [
          fillSentence(
            'landform-count',
            `As viewed from the selected viewpoints, the landscape is composed of {count} landform${top.size === 1 ? '' : 's'} (Table 2)${
              parents.length
                ? `, with ${andList(
                    parents.map((parent) => {
                      const own = subs.filter((name) => landformParent(ctx, name) === parent)
                      const from = andList(
                        viewpointsOf(ctx)
                          .filter((vp) => own.includes(vp.landform))
                          .map((vp) => plainName(vp.name)),
                      )
                      return `${plainName(parent)} divided into ${andList(own.map(plainName))}${from ? ` when viewed from ${from}` : ''}`
                    }),
                  )}`
                : ''
            }.`,
            { count: top.size },
            'scene',
          ),
        ]
      : []
    const map = mapCite(ctx)
    return {
      blocks: [
        heading('Landforms and viewpoints'),
        ...paragraph([...located, ...land]),
        ...paragraph(count),
        text(
          `The significant public viewpoints from which the blocks were assessed, and their relative significance, are listed in Table 3${
            map ? ` and shown on the viewpoint map (${map})` : ''
          }.`,
          'run',
        ),
      ],
      toComplete,
    }
  },
}

// ------------------------------------------------------------------ the viewpoints in the method

/** A viewpoint's place name without its number or sheet tag ("Ruby Lake 4 (VP17)" → "Ruby Lake"). */
const viewpointStem = (name: string) =>
  plainName(name)
    .replace(/\s*[-–]?\s*(?:perspective|p)\s*\d+$/i, '')
    .replace(/\s+\d+[a-z]?$/i, '')
    .trim()
const WATER = /\b(lake|river|inlet|sound|bay|channel|arm|creek|harbour|harbor|passage|strait|reservoir)$/i

/**
 * "The selected viewpoints (Table 3) are located at …" (22, 23): each viewpoint by its place, those sharing a place
 * counted ("at three locations on Ruby Lake"), in Table 3's order.
 */
export function viewpointLocations(ctx: ReportContext): Sentence | null {
  const groups = new Map<string, string[]>()
  for (const vp of ctx.facts.viewpoints) {
    const stem = viewpointStem(vp.name) || plainName(vp.name)
    groups.set(stem, [...(groups.get(stem) ?? []), plainName(vp.name)])
  }
  if (!groups.size) return null
  // One viewpoint at a place keeps its own name ("North Lake 4"); several are counted at the place.
  const items = [...groups].map(([stem, names]) =>
    names.length === 1
      ? names[0]
      : `at ${NUMBER_WORDS[names.length] ?? names.length} locations ${WATER.test(stem) ? 'on' : 'near'} ${stem}`,
  )
  return fillSentence(
    'viewpoint-locations',
    'The selected viewpoints (Table 3) are located at {list}.',
    {
      list: andList(items),
    },
    'run',
  )
}

/**
 * The key viewpoints with their appendix sheets (22, 23's "The viewpoint … (see Appendix A6) was selected for detailed
 * analysis"), from the run's choice: one sentence per key viewpoint, naming the blocks assessed from it.
 */
export function keyViewpointCites(ctx: ReportContext): Sentence[] {
  const byViewpoint = new Map<string, string[]>()
  for (const section of ctx.document.discussion ?? [])
    if (section.viewpoint)
      byViewpoint.set(section.viewpoint, [...(byViewpoint.get(section.viewpoint) ?? []), ...section.blocks])
  return [...byViewpoint].map(([viewpoint, blocks]) => {
    const sheet = viewpointCite(ctx, viewpoint)
    return fillSentence(
      'key-viewpoint-cite',
      `The viewpoint {viewpoint}${sheet ? ` (see ${sheet})` : ''} was selected for the detailed assessment of {blocks} (Table 5).`,
      { viewpoint: plainName(viewpoint), blocks: blockList(blocks) },
      'run',
    )
  })
}

// ------------------------------------------------------------------ sign-off

export { CERTIFICATION_STATEMENTS } from './parts'

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
            ['Certification', CERTIFICATION_STATEMENTS.supervised, CERTIFICATION_STATEMENTS.reviewed],
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

/** The preparer's sign-off with the certification statement (23): one professional, who did or supervised the work. */
const signOffCertified: ReportPart = {
  id: 'sign-off-certified',
  title: 'Sign-off',
  sources: ['23'],
  build: (ctx) => {
    const preparer = blank(ctx.office.evaluator)
    return {
      blocks: [
        heading('Sign-off'),
        {
          kind: 'fields',
          rows: [
            { label: 'Visual impact assessment prepared by', value: preparer, source: 'scene' },
            { label: 'Professional designation and seal', value: null, source: 'reviewer' },
          ],
        },
        text(CERTIFICATION_STATEMENTS.supervised, 'fixed'),
        { kind: 'signature', lines: ['Signature', 'Date'] },
      ],
      toComplete: [...(preparer ? [] : ['Prepared by: name']), 'Prepared by: designation, seal, signature and date'],
    }
  },
}

export const CONSULTANT_PARTS: readonly ReportPart[] = [
  summary,
  assessmentMethod,
  landformsAndViewpoints,
  table1,
  table2,
  table3,
  signOffPeer,
  signOffCertified,
  appendixList,
  appendixSheets,
]

/**
 * The consultant reports' parts in the references' order (22, 23): summary, background, method, the landscape, Tables
 * 1-5, the discussion, conclusion and sign-off, then the appendix: its list, the viewpoint map (A1) and each
 * viewpoint's pages. 22 signs with a peer reviewer; 23 with the preparer alone, its limitations under the conclusion.
 */
export const CONSULTANT_RECIPE_PARTS: Readonly<
  Record<'consultant-net-private' | 'consultant-gross', readonly string[]>
> = {
  'consultant-net-private': [
    'cover',
    'summary',
    'regulatory-frame',
    'three-elements',
    'extent-scale',
    'vocabulary',
    'methodology',
    'assessment-method',
    'landforms-and-viewpoints',
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
    'appendix-list',
    'overview-sheet',
    'appendix-sheets',
  ],
  'consultant-gross': [
    'cover',
    'summary',
    'regulatory-frame',
    'three-elements',
    'extent-scale',
    'vocabulary',
    'methodology',
    'assessment-method',
    'landforms-and-viewpoints',
    'table-1-vsu',
    'table-2-landforms',
    'table-3-viewpoints',
    'assessment-tables',
    'block-discussion',
    'recommendations',
    'conclusion',
    'limitations',
    'sign-off-certified',
    'references',
    'appendix-list',
    'overview-sheet',
    'appendix-sheets',
  ],
}
