/**
 * Report parts that lay out pictures and maps: the overview map, overhead and oblique renders, a figure page per
 * viewpoint with its location and regional maps over before / after pictures, and photograph / simulation pairs.
 * Pictures come from `ReportContext.images` (the page's captures) and each view's analysis figure from
 * `ctx.figures`; a missing one prints a box saying what goes there and is listed to complete. Captions are the
 * format's wording (`FIGURE_WORDING`, by document format id) or a part's own (`figurePagesPart` and the other
 * factories), never a reference document's own titles. Figures are numbered in the order the recipe lists these
 * parts. Registered in `registry.ts`. No DOM or network access.
 */
import { field, text, type FieldRow, type FigureSlot, type ReportBlock, type ReportFigure } from './model'
import { blank, figureFor, type PartOutput, type ReportContext, type ReportPart } from './parts'

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
    ...(before ? { note: BEFORE_NOTE[before.source] } : {}),
  }
}

function afterSlot(ctx: ReportContext, name: string, label: string, markBlocks?: FigureSlot['markBlocks']): FigureSlot {
  const plain = ctx.images?.after?.[name]
  return {
    label,
    // The plain simulation when the page sent one; else the view's analysis figure, which labels its own blocks.
    figure: plain ?? figureFor(ctx, name),
    placeholder: `${name}: the simulation; save the viewpoint in the road view`,
    ...(plain && markBlocks ? { markBlocks } : {}),
  }
}

/** A figure page's slot as a panorama when the recipe asks for one (26). */
const panoramic = (ctx: ReportContext, slot: FigureSlot): FigureSlot =>
  ctx.recipeOptions?.figurePanorama && slot.figure?.landformRows
    ? { ...slot, panorama: ctx.recipeOptions.figurePanorama }
    : slot

const NO_VIEWPOINT = 'No saved viewpoint yet: save one in the road view.'

/** "A12345 CP 7", the licence alone, or null. */
function projectNumber(ctx: ReportContext): string | null {
  const licence = blank(ctx.office.licence)
  const permit = blank(ctx.office.cuttingPermit)
  return licence || permit ? [licence, permit ? `CP ${permit}` : null].filter(Boolean).join(' ') : null
}

const longDate = (date: Date) =>
  date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

// ------------------------------------------------------------------ parts

/**
 * One landscape page per viewpoint (26): the figure's number and title, the project number and date, the location map
 * with the view and the regional map down the left; before and after down the right.
 */
export function figurePagesPart(id = 'ea-figure-pages', wording?: FigureWording): ReportPart {
  FIGURE_COUNTS.set(id, (ctx) => ctx.facts.viewpoints.length)
  return {
    id,
    title: 'Figure pages',
    sources: ['26'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const names = viewpointNames(ctx)
      if (!names.length) return { blocks: [text(NO_VIEWPOINT, 'run')], toComplete: ['Figure pages: save a viewpoint'] }
      const first = firstFigureNumber(ctx, id)
      const project = projectNumber(ctx)
      const facts: FieldRow[] = [
        field(w.page.projectNumber, project, 'scene'),
        field(w.page.date, longDate(ctx.date), 'run'),
      ]
      const regional = ctx.images?.figurePageMaps?.regional ?? ctx.images?.regionalMap ?? null
      const toComplete: string[] = []
      if (!project) toComplete.push('Project number (licence and cutting permit)')
      if (!regional) toComplete.push('Regional map')
      const blocks = names.map((name, i): ReportBlock => {
        const location = ctx.images?.figurePageMaps?.location[name] ?? ctx.images?.locationMaps?.[name] ?? null
        const before = beforeSlot(ctx, name, { photo: w.page.before, render: w.page.before })
        const after = afterSlot(ctx, name, w.page.after, 'unseen')
        if (!location) toComplete.push(`${name}: location map and viewpoint`)
        if (!before.figure) toComplete.push(`${name}: picture before the project (field photograph or render)`)
        if (!after.figure) toComplete.push(`${name}: simulation (save the viewpoint)`)
        return {
          kind: 'figurePage',
          number: fill(w.number, { n: first + i }),
          title: fill(w.page.title, { viewpoint: name }),
          facts,
          side: [
            {
              label: w.page.locationMap,
              figure: location,
              placeholder: `${name}: location map with the viewpoint and its field of view`,
            },
            {
              label: w.page.regionalMap,
              figure: regional,
              placeholder: 'Regional map placing the project in its region',
            },
          ],
          main: [panoramic(ctx, before), panoramic(ctx, after)],
        }
      })
      return { blocks, toComplete }
    },
  }
}

/**
 * Per viewpoint, the picture before the proposal over the simulation (01 pp. 8–11, 05 pp. 9–12, 06's panels): the
 * before label says whether it is a field photograph or a render. With several viewpoints the captions are numbered.
 */
export function photoSimulationPairsPart(id = 'photo-simulation-pairs', wording?: FigureWording): ReportPart {
  // A recipe that numbers its pairs (21) counts one figure per viewpoint; otherwise the pairs take no number.
  FIGURE_COUNTS.set(id, (ctx) => (ctx.recipeOptions?.numberedPairs ? ctx.facts.viewpoints.length : 0))
  return {
    id,
    title: 'Photographs and simulations',
    sources: ['01', '02', '05', '06'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const names = viewpointNames(ctx)
      if (!names.length)
        return { blocks: [text(NO_VIEWPOINT, 'run')], toComplete: ['Photographs and simulations: save a viewpoint'] }
      const toComplete: string[] = []
      const many = names.length > 1
      const first = firstFigureNumber(ctx, id)
      const numbered = !!ctx.recipeOptions?.numberedPairs
      const blocks = names.map((name, i): ReportBlock => {
        const caption = (label: string) =>
          w.pair.placement === 'caption' ? `${label}${many ? ` ${i + 1}` : ''}: ${name}` : label
        const before = beforeSlot(ctx, name, w.pair.before)
        const after = afterSlot(ctx, name, w.pair.after, 'all')
        if (!before.figure) toComplete.push(`${name}: field photograph or render before harvest`)
        if (!after.figure) toComplete.push(`${name}: simulation (save the viewpoint)`)
        const sentence = w.pair.figure ?? DEFAULT_FIGURE_WORDING.pair.figure!
        return {
          kind: 'figurePair',
          ...(w.pair.placement === 'inset' ? { title: name } : {}),
          ...(numbered
            ? {
                caption: `${fill(w.number, { n: first + i })}. ${fill(
                  sentence[ctx.images?.before?.[name]?.source ?? 'photo'],
                  { viewpoint: name },
                )}`,
              }
            : {}),
          placement: w.pair.placement,
          slots: [
            { ...before, label: caption(before.label) },
            { ...after, label: caption(after.label) },
          ],
        }
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
  FIGURE_COUNTS.set(id, () => 1)
  return {
    id,
    title: 'Overview map',
    sources: ['01', '22', '23', '26'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const map = ctx.images?.overviewMap ?? null
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
        toComplete: map ? [] : ['Overview map'],
      }
    },
  }
}

/**
 * The overview as an 11 x 17 topographic sheet (05's 1:40,000 map, 22/23's Appendix A1): printed full-size on a sheet
 * page of its own, its legend, scale and north arrow drawn on it. Without a sheet it prints the overview map.
 */
export function overviewSheetPart(id = 'overview-sheet', wording?: FigureWording): ReportPart {
  FIGURE_COUNTS.set(id, () => 1)
  const fallback = overviewMapPart(id, wording)
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
      return { blocks: [{ kind: 'figure', figure: sheet, caption }] }
    },
  }
}

const isOblique = (figure: ReportFigure) => /oblique/i.test(`${figure.caption} ${figure.view}`)

/**
 * The overhead renders, each one figure, then the obliques, one figure between them. With none at all, one overhead
 * placeholder and one oblique placeholder; with only one kind, only that kind.
 */
function overheadLayout(ctx: ReportContext) {
  const all = ctx.images?.overhead ?? []
  const overhead = all.filter((f) => !isOblique(f))
  const oblique = all.filter(isOblique)
  const tops: Array<ReportFigure | null> = overhead.length ? overhead : oblique.length ? [] : [null]
  return { tops, oblique, obliqueFigure: oblique.length > 0 || !overhead.length }
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
      const { tops, oblique, obliqueFigure } = overheadLayout(ctx)
      let n = firstFigureNumber(ctx, id)
      const number = () => fill(w.number, { n: n++ })
      const names = ctx.blocks.map((block) => block.name)
      const blockList = names.length ? ` - ${names.length > 1 ? 'Blocks' : 'Block'} ${andList(names)}` : ''
      // The renders start a page of their own (01 p7), so the overhead and its obliques print together.
      const blocks: ReportBlock[] = obliqueFigure && tops.length === 1 ? [{ kind: 'pageBreak' }] : []
      const toComplete: string[] = []
      for (const figure of tops) {
        const caption = `${number()}: ${w.overhead}`
        blocks.push({
          kind: 'mapFigure',
          caption,
          slot: { label: caption, figure, placeholder: 'Overhead render of the blocks on the terrain model' },
          // One overhead shares its page with the obliques under it, as 01 p7 prints them.
          ...(obliqueFigure && tops.length === 1 ? { compact: true } : {}),
        })
        if (!figure) toComplete.push('Overhead render of the blocks')
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
        if (!oblique.length) toComplete.push('Oblique renders of the blocks')
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
 * renders together on one more landscape page. A view with neither prints a placeholder and is listed.
 */
export function simulationPagesPart(id = 'simulation-pages', wording?: FigureWording): ReportPart {
  FIGURE_COUNTS.set(id, (ctx) => ctx.facts.viewpoints.length + (overheadLayout(ctx).oblique.length ? 1 : 0))
  return {
    id,
    title: 'Simulations',
    sources: ['02'],
    build: (ctx): PartOutput => {
      const w = wording ?? figureWording(ctx.document.format.id)
      const names = viewpointNames(ctx)
      if (!names.length) return { blocks: [text(NO_VIEWPOINT, 'run')], toComplete: ['Simulations: save a viewpoint'] }
      let n = firstFigureNumber(ctx, id)
      const toComplete: string[] = []
      const blocks = names.map((name): ReportBlock => {
        const figure = figureFor(ctx, name) ?? ctx.images?.after?.[name] ?? null
        if (!figure) toComplete.push(`${name}: simulation (save the viewpoint)`)
        return {
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
        }
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
