/**
 * Report parts that lay out pictures and maps: the overview map, overhead and oblique renders, a figure page per
 * viewpoint with its location and regional maps over before / after pictures, and photograph / simulation pairs.
 * Pictures come from `ReportContext.images` (the page's captures) and each view's analysis figure from
 * `ctx.figures`. A missing one is always listed to complete; in the draft (`ReportContext.draft`) it also keeps its
 * place with a box saying what goes there, and in a file it prints nothing, its caption with it. Captions are the
 * format's wording (`FIGURE_WORDING`, by document format id) or a part's own (`figurePagesPart` and the other
 * factories), never a reference document's own titles. Figures are numbered in the order the recipe lists these
 * parts, counting only the figures the report prints. Registered in `registry.ts`. No DOM or network access.
 */
import { UNSEEN_STATUS } from './blockMarks'
import { field, text, type FieldRow, type FigureSlot, type ReportBlock, type ReportFigure } from './model'
import {
  blank,
  figureFor,
  printedSlots,
  showsMissing,
  type PartOutput,
  type ReportContext,
  type ReportPart,
} from './parts'

// ------------------------------------------------------------------ wording

/** Captions and labels for the figure layouts. `{n}` is the figure's number, `{viewpoint}` the view's name. */
export interface FigureWording {
  /** How a figure is numbered: "Figure {n}", "Appendix A{n}". */
  number: string
  /** The figure page (26's layout). */
  page: {
    title: string
    before: string
    after: string
    locationMap: string
    regionalMap: string
    projectNumber: string
    date: string
  }
  /**
   * Pictures of one view stacked: the before label by its source, the after label, where labels print, and the
   * sentence a numbered pair is captioned with (`numberedPairs`), by the before picture's source.
   */
  pair: {
    before: { photo: string; render: string }
    after: string
    placement: 'inset' | 'caption'
    figure?: { photo: string; render: string }
  }
  /** The overview map's caption, for one viewpoint and for several. */
  overview: { one: string; many: string }
  /** An overhead render's caption. */
  overhead: string
  /** The oblique renders' caption, for one picture and for several; the blocks' names follow it. */
  oblique: { one: string; many: string }
}

export const DEFAULT_FIGURE_WORDING: FigureWording = {
  number: 'Figure {n}',
  page: {
    title: 'Visualization from {viewpoint}',
    before: 'Before project',
    after: 'After project',
    locationMap: 'Location map and viewpoint',
    regionalMap: 'Regional map',
    projectNumber: 'Project Number',
    date: 'Date',
  },
  pair: {
    before: { photo: 'Photograph', render: 'Before-harvest render' },
    after: 'Simulation',
    placement: 'caption',
    figure: {
      photo: 'View from {viewpoint} before harvest, and the simulated view after harvest.',
      render:
        'View from {viewpoint} before harvest (rendered from the terrain model), and the simulated view after harvest.',
    },
  },
  overview: { one: 'Viewpoint location and proposed harvest', many: 'Viewpoint locations and proposed harvest' },
  overhead: 'Overhead render, model confirmation',
  oblique: { one: 'Oblique render, model confirmation', many: 'Oblique renders, model confirmation' },
}

const insetPair = (before: string, render: string, after: string): FigureWording['pair'] => ({
  before: { photo: before, render },
  after,
  placement: 'inset',
})

/**
 * The wording each document format's reports use (`viaDocument/formats.ts` ids), over the default. Structure only:
 * generic words in the shape the references print them, no reference's own titles or place names.
 */
export const FIGURE_WORDING: Readonly<Record<string, Partial<FigureWording>>> = {
  // 2001 forms with analysis sheets, and the partial-cut form (01, 03): captions under each picture.
  'form-2001-analysis-sheets': {
    overview: {
      one: 'Visual landscape inventory map with proposed harvest',
      many: 'Visual landscape inventory map with proposed harvest',
    },
  },
  // District rationale (02): the existing view and the simulated cutblocks.
  'district-summary': {
    pair: {
      before: { photo: 'Existing view', render: 'Existing view, rendered before harvest' },
      after: 'Simulated cutblocks',
      placement: 'caption',
    },
  },
  // 2001 form with existing / proposed / analysed panels (05, 21): labels in the picture's corner.
  'form-2001-analysed-photos': {
    pair: insetPair('Existing Condition', 'Existing Condition (render)', 'Proposed Development'),
  },
  // 2022 handbook Appendix 1 (06, 07).
  'appendix-1-net-private-rock': { pair: insetPair('Photo', 'Render before harvest', 'Simulation') },
  'appendix-1-net-rock': { pair: insetPair('Photo', 'Render before harvest', 'Simulation') },
  // Consultant reports (22, 23): the map is the first appendix sheet.
  'perspective-report-net-private': {
    number: 'Appendix A{n}',
    overview: { one: 'Viewpoint map', many: 'Viewpoint map' },
  },
  'perspective-report-gross': { number: 'Appendix A{n}', overview: { one: 'Viewpoint map', many: 'Viewpoint map' } },
  // Environmental assessment memo (26).
  'referral-panoramas': {
    overview: { one: 'Observer viewpoint location', many: 'Observer viewpoint locations' },
  },
}

/** The wording for a document format: its own entries over the default. */
export function figureWording(formatId: string | null | undefined): FigureWording {
  const own = (formatId && FIGURE_WORDING[formatId]) || {}
  return {
    ...DEFAULT_FIGURE_WORDING,
    ...own,
    page: { ...DEFAULT_FIGURE_WORDING.page, ...own.page },
    pair: { ...DEFAULT_FIGURE_WORDING.pair, ...own.pair },
  }
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))

/** "X1", "X1 and X2", "X1, X2 and X3". */
export const andList = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

// ------------------------------------------------------------------ numbering

/** How many numbered figures each figure part prints, by part id; the factories register their parts here. */
const FIGURE_COUNTS = new Map<string, (ctx: ReportContext) => number>()

/**
 * The first figure number a part prints: one more than the figures the recipe's earlier figure parts number, or 1 for
 * a part the recipe does not list.
 */
export function firstFigureNumber(ctx: ReportContext, partId: string): number {
  const parts = ctx.recipeParts ?? []
  const at = parts.indexOf(partId)
  return 1 + (at < 0 ? 0 : parts.slice(0, at).reduce((n, id) => n + (FIGURE_COUNTS.get(id)?.(ctx) ?? 0), 0))
}

// ------------------------------------------------------------------ shared pieces

const viewpointNames = (ctx: ReportContext) => ctx.facts.viewpoints.map((vp) => vp.name)

const BEFORE_NOTE: Record<'photo' | 'render', string> = {
  photo: 'Field photograph, lined up with the view',
  render: 'Rendered before harvest from the terrain model and drawn timber; not a photograph',
}

/** The view's picture before the proposal, labelled by where it came from. */
function beforeSlot(ctx: ReportContext, name: string, labels: { photo: string; render: string }): FigureSlot {
  const before = ctx.images?.before?.[name] ?? null
  return {
    label: before ? labels[before.source] : labels.photo,
    figure: before,
    placeholder: `${name}: a field photograph lined up with the view, or a render before harvest`,
    ...(before ? { note: beforeNote(before) } : {}),
  }
}

/** Where a before picture came from; a render by another engine names it, as its simulation is drawn by it too. */
function beforeNote(before: ReportFigure & { source: 'photo' | 'render' }): string {
  if (before.source === 'render' && before.renderer && before.renderer !== 'PGMaps')
    return `Rendered before harvest by ${before.renderer} from the terrain model and drawn timber, as the simulation is; not a photograph`
  return BEFORE_NOTE[before.source]
}

function afterSlot(ctx: ReportContext, name: string, label: string, markBlocks?: FigureSlot['markBlocks']): FigureSlot {
  const plain = ctx.images?.after?.[name]
  return {
    label,
    // The plain simulation when the page sent one; else the view's analysis figure, which labels its own blocks.
    figure: plain ?? figureFor(ctx, name),
    placeholder: `${name}: the simulation; save the viewpoint in the road view`,
    ...(plain && markBlocks ? { markBlocks } : {}),
    // Why the simulation was drawn as it was: PGMaps for both pictures when the engine had no before picture.
    ...(plain?.note ? { note: plain.note } : {}),
  }
}

/** The block marks a slot's picture draws (`htmlFigures.ts`): every one, or with `unseen` only those not plainly seen. */
const drawnMarks = (slot: FigureSlot): ReadonlyArray<{ y: number }> =>
  slot.markBlocks && slot.figure?.marks
    ? slot.figure.marks.filter((m) => slot.markBlocks === 'all' || UNSEEN_STATUS[m.status])
    : []

/**
 * A figure page's slot as a panorama when the recipe asks for one (26), its band keeping the marks `marked` draws (the
 * after slot), so the before and after pictures show the same band and no marked block is cut.
 */
const panoramic = (ctx: ReportContext, slot: FigureSlot, marked: FigureSlot): FigureSlot => {
  if (!ctx.recipeOptions?.figurePanorama || !slot.figure?.landformRows) return slot
  const hold = drawnMarks(marked)
  return { ...slot, panorama: ctx.recipeOptions.figurePanorama, ...(hold.length ? { panoramaHold: hold } : {}) }
}

const NO_VIEWPOINT = 'No saved viewpoint yet: save one in the road view.'

/** What a composed map could not draw (`MapFurniture.missing`, the end map's key map), each to complete. */
const notDrawn = (figure: ReportFigure, what: string) => (figure.map?.missing ?? []).map((part) => `${what}: ${part}`)

/** The draft's line where a part has no viewpoint to lay out; a file prints nothing there (the list names it). */
const noViewpoint = (ctx: ReportContext): ReportBlock[] => (showsMissing(ctx) ? [text(NO_VIEWPOINT, 'run')] : [])

/** The view's simulation: its plain one when the page sent one, else its analysis figure. */
const simulationOf = (ctx: ReportContext, name: string) => ctx.images?.after?.[name] ?? figureFor(ctx, name)

/**
 * The viewpoints that get a figure page (`figurePagesPart`) or a photograph / simulation pair, in order: every one in
 * the draft; in a file, those with a picture before or after, since the page or pair is the view's visualization.
 * Their figure numbers follow this list.
 */
export function figurePageViewpoints(ctx: ReportContext): string[] {
  const names = viewpointNames(ctx)
  return showsMissing(ctx) ? names : names.filter((name) => ctx.images?.before?.[name] || simulationOf(ctx, name))
}

/** "A12345 CP 7", the licence alone, or null. */
function projectNumber(ctx: ReportContext): string | null {
  const licence = blank(ctx.office.licence)
  const permit = blank(ctx.office.cuttingPermit)
  return licence || permit ? [licence, permit ? `CP ${permit}` : null].filter(Boolean).join(' ') : null
}

const longDate = (date: Date) =>
  date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** A photograph's ISO date ("2020-05-27", or a timestamp starting with one) as the references print it, or null. */
export function photoDate(iso: string | null | undefined): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso?.trim() ?? '')
  if (!day) return null
  const date = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])))
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day[3]) ? null : longDate(date)
}

// ------------------------------------------------------------------ parts

/**
 * One landscape page per viewpoint (26): the figure's number and title, the project number and date, the location map
 * with the view and the regional map down the left; before and after down the right.
 */
export function figurePagesPart(id = 'ea-figure-pages', wording?: FigureWording): ReportPart {
  FIGURE_COUNTS.set(id, (ctx) => figurePageViewpoints(ctx).length)
  return {
    id,
    title: 'Figure pages',
    sources: ['26'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const names = viewpointNames(ctx)
      if (!names.length) return { blocks: noViewpoint(ctx), toComplete: ['Figure pages: save a viewpoint'] }
      const first = firstFigureNumber(ctx, id)
      const paged = figurePageViewpoints(ctx)
      const project = projectNumber(ctx)
      const facts: FieldRow[] = [
        field(w.page.projectNumber, project, 'scene'),
        field(w.page.date, longDate(ctx.date), 'run'),
      ]
      const regional = ctx.images?.figurePageMaps?.regional ?? ctx.images?.regionalMap ?? null
      const toComplete: string[] = []
      if (!project) toComplete.push('Project number (licence and cutting permit)')
      if (!regional) toComplete.push('Regional map')
      const blocks = names.flatMap((name): ReportBlock[] => {
        const location = ctx.images?.figurePageMaps?.location[name] ?? ctx.images?.locationMaps?.[name] ?? null
        // The regional map starring this page's own viewpoint when the report has several.
        const ownRegional = ctx.images?.figurePageMaps?.regionalFor?.[name] ?? regional
        const before = beforeSlot(ctx, name, { photo: w.page.before, render: w.page.before })
        // Every block the picture holds is marked, as 26 does: a seen one led to by its name (Figure 2's "Visible
        // Disturbance"), one not plainly seen ringed (Figure 3). The memo's text counts the same blocks in view.
        const after = afterSlot(ctx, name, w.page.after, 'all')
        if (!location) toComplete.push(`${name}: location map and viewpoint`)
        if (!before.figure) toComplete.push(`${name}: picture before the project (field photograph or render)`)
        if (!after.figure) toComplete.push(`${name}: simulation (save the viewpoint)`)
        // In a file, a view with no picture before or after has no page; one that has prints only what it has.
        const at = paged.indexOf(name)
        if (at < 0) return []
        return [
          {
            kind: 'figurePage',
            number: fill(w.number, { n: first + at }),
            title: fill(w.page.title, { viewpoint: name }),
            facts,
            side: printedSlots(ctx, [
              {
                label: w.page.locationMap,
                figure: location,
                placeholder: `${name}: location map with the viewpoint and its field of view`,
              },
              {
                label: w.page.regionalMap,
                figure: ownRegional,
                placeholder: 'Regional map placing the project in its region',
              },
            ]),
            main: printedSlots(ctx, [panoramic(ctx, before, after), panoramic(ctx, after, after)]),
          },
        ]
      })
      return { blocks, toComplete }
    },
  }
}

/** A numbered pair's caption when a file prints only one of its pictures. */
const LONE_PICTURE = {
  before: {
    photo: 'View from {viewpoint} before harvest.',
    render: 'View from {viewpoint} before harvest, rendered from the terrain model.',
  },
  after: 'The simulated view from {viewpoint} after harvest.',
}

/**
 * Per viewpoint, the picture before the proposal over the simulation (01 pp. 8–11, 05 pp. 9–12, 06's panels): the
 * before label says whether it is a field photograph or a render. With several viewpoints the captions are numbered.
 */
export function photoSimulationPairsPart(id = 'photo-simulation-pairs', wording?: FigureWording): ReportPart {
  // A recipe that numbers its pairs (21) counts one figure per pair it prints; otherwise the pairs take no number.
  FIGURE_COUNTS.set(id, (ctx) => (ctx.recipeOptions?.numberedPairs ? figurePageViewpoints(ctx).length : 0))
  return {
    id,
    title: 'Photographs and simulations',
    sources: ['01', '02', '05', '06'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const names = viewpointNames(ctx)
      if (!names.length)
        return { blocks: noViewpoint(ctx), toComplete: ['Photographs and simulations: save a viewpoint'] }
      const toComplete: string[] = []
      // Numbered over the pairs the report prints: in a file, a view with neither picture has none.
      const paired = figurePageViewpoints(ctx)
      const many = paired.length > 1
      const first = firstFigureNumber(ctx, id)
      const numbered = !!ctx.recipeOptions?.numberedPairs
      const blocks = names.flatMap((name): ReportBlock[] => {
        const i = paired.indexOf(name)
        const caption = (label: string, date: string | null = null) =>
          w.pair.placement === 'caption'
            ? `${label}${many ? ` ${i + 1}` : ''}: ${name}${date ? ` (${date})` : ''}`
            : label
        const before = beforeSlot(ctx, name, w.pair.before)
        const after = afterSlot(ctx, name, w.pair.after, 'all')
        // A field photograph is dated as the references date theirs (01: "Photograph 1: … (May 27, 2020)"), from the
        // date it carried; one without a date has it to complete, never a date assumed.
        const photo = ctx.images?.before?.[name]
        const takenOn = photo?.source === 'photo' ? photoDate(photo.takenOn) : null
        if (photo?.source === 'photo' && !takenOn) toComplete.push(`${name}: the date the photograph was taken`)
        if (!before.figure) toComplete.push(`${name}: field photograph or render before harvest`)
        if (!after.figure) toComplete.push(`${name}: simulation (save the viewpoint)`)
        if (i < 0) return []
        const slots = printedSlots(ctx, [
          { ...before, label: caption(before.label, takenOn) },
          { ...after, label: caption(after.label) },
        ])
        // The numbered caption says what the pair shows: both pictures, or (in a file) the one it has.
        const source = ctx.images?.before?.[name]?.source ?? 'photo'
        const sentence =
          slots.length === 2
            ? (w.pair.figure ?? DEFAULT_FIGURE_WORDING.pair.figure!)[source]
            : slots[0].figure === after.figure
              ? LONE_PICTURE.after
              : LONE_PICTURE.before[source]
        return [
          {
            kind: 'figurePair',
            ...(w.pair.placement === 'inset' ? { title: name } : {}),
            ...(numbered
              ? { caption: `${fill(w.number, { n: first + i })}. ${fill(sentence, { viewpoint: name })}` }
              : {}),
            placement: w.pair.placement,
            slots,
          },
        ]
      })
      return { blocks, toComplete }
    },
  }
}

/**
 * The overview map: the blocks, the viewpoints and the visual inventory on one map (01 p6, 22 Appendix A1, 26
 * Figure 1), with its legend, scale and north arrow when the map gives them (`ReportFigure.map`).
 */
export function overviewMapPart(id = 'overview-map', wording?: FigureWording): ReportPart {
  FIGURE_COUNTS.set(id, (ctx) => (showsMissing(ctx) || ctx.images?.overviewMap ? 1 : 0))
  return {
    id,
    title: 'Overview map',
    sources: ['01', '22', '23', '26'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const map = ctx.images?.overviewMap ?? null
      // In a file, a map nobody drew prints nothing, its caption and number with it.
      if (!map && !showsMissing(ctx)) return { blocks: [], toComplete: ['Overview map'] }
      const caption = `${fill(w.number, { n: firstFigureNumber(ctx, id) })}: ${
        ctx.facts.viewpoints.length > 1 ? w.overview.many : w.overview.one
      }`
      return {
        blocks: [
          {
            kind: 'mapFigure',
            caption,
            slot: {
              label: caption,
              figure: map,
              placeholder: 'Overview map: the proposed blocks, the viewpoints and the visual landscape inventory',
            },
          },
        ],
        toComplete: map ? notDrawn(map, 'Overview map') : ['Overview map'],
      }
    },
  }
}

/**
 * The overview as an 11 x 17 topographic sheet (05's 1:40,000 map, 22/23's Appendix A1): printed full-size on a sheet
 * page of its own, its legend, scale and north arrow drawn on it. Without a sheet it prints the overview map.
 */
export function overviewSheetPart(id = 'overview-sheet', wording?: FigureWording): ReportPart {
  const fallback = overviewMapPart(id, wording)
  FIGURE_COUNTS.set(id, (ctx) => (showsMissing(ctx) || ctx.images?.overviewSheet || ctx.images?.overviewMap ? 1 : 0))
  return {
    id,
    title: 'Overview sheet',
    sources: ['05', '22', '23'],
    build: (ctx): PartOutput => {
      const sheet = ctx.images?.overviewSheet ?? null
      if (!sheet) return fallback.build(ctx)
      const w = wording ?? figureWording(ctx.document.format.id)
      const caption = `${fill(w.number, { n: firstFigureNumber(ctx, id) })}: ${
        ctx.facts.viewpoints.length > 1 ? w.overview.many : w.overview.one
      }${sheet.map?.scale ? ` (${sheet.map.scale} at 11 × 17)` : ''}`
      return { blocks: [{ kind: 'figure', figure: sheet, caption }], toComplete: notDrawn(sheet, 'Overview sheet') }
    },
  }
}

const isOblique = (figure: ReportFigure) => /oblique/i.test(`${figure.caption} ${figure.view}`)

/**
 * The overhead renders, each one figure, then the obliques, one figure between them. With none at all, the draft has
 * one overhead placeholder and one oblique placeholder and a file nothing; with only one kind, only that kind.
 */
function overheadLayout(ctx: ReportContext) {
  const all = ctx.images?.overhead ?? []
  const overhead = all.filter((f) => !isOblique(f))
  const oblique = all.filter(isOblique)
  const none = !all.length
  const placeholders = none && showsMissing(ctx)
  const tops: Array<ReportFigure | null> = overhead.length ? overhead : placeholders ? [null] : []
  return { tops, oblique, obliqueFigure: oblique.length > 0 || placeholders, none }
}

/**
 * Model confirmation (01 p7): each overhead render of the blocks as a figure across the page, then the oblique renders
 * side by side under one caption naming the blocks. A render whose caption or view says "oblique" is an oblique one.
 */
export function overheadRendersPart(id = 'overhead-renders', wording?: FigureWording): ReportPart {
  FIGURE_COUNTS.set(id, (ctx) => {
    const { tops, obliqueFigure } = overheadLayout(ctx)
    return tops.length + (obliqueFigure ? 1 : 0)
  })
  return {
    id,
    title: 'Overhead and oblique renders',
    sources: ['01'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const { tops, oblique, obliqueFigure, none } = overheadLayout(ctx)
      let n = firstFigureNumber(ctx, id)
      const number = () => fill(w.number, { n: n++ })
      const names = ctx.blocks.map((block) => block.name)
      const blockList = names.length ? ` - ${names.length > 1 ? 'Blocks' : 'Block'} ${andList(names)}` : ''
      // The renders start a page of their own (01 p7), so the overhead and its obliques print together.
      const blocks: ReportBlock[] = obliqueFigure && tops.length === 1 ? [{ kind: 'pageBreak' }] : []
      const toComplete: string[] = none ? ['Overhead render of the blocks', 'Oblique renders of the blocks'] : []
      for (const figure of tops) {
        const caption = `${number()}: ${w.overhead}`
        blocks.push({
          kind: 'mapFigure',
          caption,
          slot: { label: caption, figure, placeholder: 'Overhead render of the blocks on the terrain model' },
          // One overhead shares its page with the obliques under it, as 01 p7 prints them.
          ...(obliqueFigure && tops.length === 1 ? { compact: true } : {}),
        })
      }
      if (obliqueFigure) {
        const caption = `${number()}: ${oblique.length > 1 ? w.oblique.many : w.oblique.one}${blockList}`
        blocks.push({
          kind: 'figureGrid',
          columns: oblique.length === 1 ? 1 : oblique.length === 2 || oblique.length === 4 ? 2 : 3,
          caption,
          slots: oblique.length
            ? oblique.map((figure) => ({ label: figure.caption || figure.view, figure, placeholder: '' }))
            : [{ label: 'Oblique render', figure: null, placeholder: 'Oblique renders of the blocks, one per block' }],
        })
      }
      return { blocks, toComplete }
    },
  }
}

/** What a simulation is and is not, printed under each simulation page (02 prints its own under its simulation). */
export const SIMULATION_DISCLAIMER =
  'Simulated from a terrain model and timber drawn from the forest inventory; not a field-verified photograph. A simulation is only as accurate as the data it is drawn from, and conditions on the site may differ.'

/**
 * The simulations on landscape pages of their own (02 pp. 5-6): per viewpoint, the view's figure (its own style's
 * labels on it) else its plain simulation across the page with the accuracy disclaimer under it; then the oblique
 * renders together on one more landscape page. A view with neither is listed to complete; in the draft it keeps its
 * page with a placeholder, in a file it has no page and no number.
 */
export function simulationPagesPart(id = 'simulation-pages', wording?: FigureWording): ReportPart {
  const simulated = (ctx: ReportContext) =>
    viewpointNames(ctx).filter((name) => showsMissing(ctx) || figureFor(ctx, name) || ctx.images?.after?.[name])
  FIGURE_COUNTS.set(id, (ctx) => simulated(ctx).length + (overheadLayout(ctx).oblique.length ? 1 : 0))
  return {
    id,
    title: 'Simulations',
    sources: ['02'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const names = viewpointNames(ctx)
      if (!names.length) return { blocks: noViewpoint(ctx), toComplete: ['Simulations: save a viewpoint'] }
      let n = firstFigureNumber(ctx, id)
      const toComplete: string[] = []
      const printed = new Set(simulated(ctx))
      const blocks = names.flatMap((name): ReportBlock[] => {
        const figure = figureFor(ctx, name) ?? ctx.images?.after?.[name] ?? null
        if (!figure) toComplete.push(`${name}: simulation (save the viewpoint)`)
        if (!printed.has(name)) return []
        return [
          {
            kind: 'figurePair',
            placement: 'caption',
            landscape: true,
            slots: [
              {
                label: `${fill(w.number, { n: n++ })}: ${name} – ${w.pair.after}`,
                figure,
                placeholder: `${name}: the simulation; save the viewpoint in the road view`,
                note: SIMULATION_DISCLAIMER,
              },
            ],
          },
        ]
      })
      const { oblique } = overheadLayout(ctx)
      if (oblique.length)
        blocks.push({
          kind: 'figureGrid',
          landscape: true,
          columns: oblique.length === 1 ? 1 : oblique.length === 2 || oblique.length === 4 ? 2 : 3,
          caption: `${fill(w.number, { n: n++ })}: ${oblique.length > 1 ? w.oblique.many : w.oblique.one}`,
          slots: oblique.map((figure) => ({ label: figure.caption || figure.view, figure, placeholder: '' })),
        })
      return { blocks, toComplete }
    },
  }
}

export const FIGURE_PARTS: readonly ReportPart[] = [
  simulationPagesPart(),
  overviewMapPart(),
  overviewSheetPart(),
  overheadRendersPart(),
  figurePagesPart(),
  photoSimulationPairsPart(),
]
