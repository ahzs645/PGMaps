/**
 * The visual quality page's block map sheet: the printed sheet types the road designer prints (field
 * layout, LiDAR slope, canopy height and hillshade, 1:50,000 access, imagery, operating plan), drawn
 * from the assessment's scene through the shared sheet builder
 * (`src/lib/forestry/blockSheet/buildSheet.ts`, docs/forestry-block-map-sheets.md).
 *
 * The sheet is a map of the scene and reads nothing from the run: no percentage is printed on it.
 * Its **map style** is PGMaps' sheet symbols or one of the VIA figure styles (`presets.ts`), whose
 * landform, block, opening, private-land and rock symbols then draw the same features on the map as
 * on that style's analysis sheet. It is written as a PDF, an editable SVG or a PNG, as one sheet or
 * as a series of one sheet per block (`sheetSeries.ts`), optionally dimmed outside the block. No DOM
 * or network access: the terrain tiles, the slice runner, the imagery capture, jsPDF and the PNG
 * rasteriser are passed in.
 */
import { buildSheet, type BuiltSheet, type SheetBuildDeps } from '@/lib/forestry/blockSheet/buildSheet'
import {
  DEFAULT_SHEET_OUTPUT,
  fillSeriesFields,
  fillSeriesTokens,
  MAX_SHEET_SERIES_PAGES,
  parseSheetOutputSettings,
  SERIES_NOTES_FILE,
  seriesContainer,
  seriesFileNames,
  seriesPages,
  writeSheetSeries,
  type SheetOutputSettings,
  type SheetSeriesBlock,
  type SheetSeriesPage,
  type SheetSeriesProgress,
} from '@/lib/forestry/blockSheet/sheetSeries'
import {
  SHEET_FORMAT_INFO,
  sheetFile,
  withSheetExtension,
  type SheetFileDeps,
  type SheetFormat,
} from '@/lib/mapSheet/sheetFormats'
import {
  sheetFocus,
  sheetFrame,
  type SheetExtra,
  type SheetIssue,
  type SheetLayers,
  type SheetSymbols,
} from '@/lib/forestry/blockSheet/composeSheet'
import {
  MAX_SHEET_COMMENTS_LENGTH,
  parseSheetFields,
  SHEET_KINDS,
  SHEET_PRESETS,
  type SheetFields,
  type SheetKind,
} from '@/lib/forestry/blockSheet/sheets'
import { VIA_OVERVIEW_MAP } from '@/lib/forestry/blockSheet/styles'
import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import {
  demResolutionMeters,
  demTileRange,
  MAX_DEM_ZOOM,
  MIN_DEM_ZOOM,
  type DemTileRange,
  type ElevationSource,
} from '@/lib/forestry/terrain/terrain'
import {
  DEFAULT_FIGURE_STYLE,
  findPreset,
  ROLE_NAMES,
  VIA_STYLE_PRESETS,
  type ViaRole,
  type ViaStylePreset,
} from '@/lib/forestry/viaFigure/presets'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import { PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { formatScale, MAX_SHEET_SCALE } from '@/lib/mapSheet/scale'
import type { AreaSymbol, LineSymbol } from '@/lib/mapSheet/symbols'
import type { AssessmentMask, TargetPolygon, Viewpoint } from './types'

/** The map style that draws PGMaps' own sheet symbols. Any other value is a figure style's id. */
export const SHEET_SYMBOLS_STYLE = 'sheet'

export interface VisualsSheetSettings {
  kind: SheetKind
  paper: PaperId
  scale: number | 'fit'
  /** The proposed block the sheet is about; one not in the scene falls back to the first block. */
  block: string
  fields: SheetFields
  comments: string
  /** `SHEET_SYMBOLS_STYLE`, or the id of a VIA figure style. */
  style: string
  /**
   * How the sheet is written (`MapSheetOutput`): PDF, SVG or PNG, one sheet or one per block, and the mask outside the
   * block. Kept with the rest, in this browser; the series' block ids are matched against the scene each time
   * (`visualsSheetOutputPlan`).
   */
  output: SheetOutputSettings
}

export const DEFAULT_VISUALS_SHEET: VisualsSheetSettings = {
  kind: 'general-access',
  paper: 'tabloid',
  scale: SHEET_PRESETS['general-access'].defaultScale,
  block: '',
  fields: {},
  comments: '',
  style: SHEET_SYMBOLS_STYLE,
  output: DEFAULT_SHEET_OUTPUT,
}

/** Validates settings read back from browser storage; anything unknown falls back to the default. */
export function parseVisualsSheetSettings(raw: unknown): VisualsSheetSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_VISUALS_SHEET
  const r = raw as Record<string, unknown>
  const kind = SHEET_KINDS.includes(r.kind as SheetKind) ? (r.kind as SheetKind) : DEFAULT_VISUALS_SHEET.kind
  return {
    kind,
    paper: typeof r.paper === 'string' && r.paper in PAPER_SIZES ? (r.paper as PaperId) : 'tabloid',
    scale:
      r.scale === 'fit'
        ? 'fit'
        : typeof r.scale === 'number' && r.scale > 0 && r.scale <= MAX_SHEET_SCALE
          ? r.scale
          : SHEET_PRESETS[kind].defaultScale,
    block: typeof r.block === 'string' ? r.block.slice(0, 200) : '',
    fields: parseSheetFields(r.fields),
    comments: typeof r.comments === 'string' ? r.comments.slice(0, MAX_SHEET_COMMENTS_LENGTH) : '',
    style: typeof r.style === 'string' && findPreset(r.style) ? r.style : SHEET_SYMBOLS_STYLE,
    output: parseSheetOutputSettings(r.output),
  }
}

/** Picking another sheet starts at its default scale and, when it has one, its native paper. */
export function changeVisualsSheetSettings(
  current: VisualsSheetSettings,
  next: VisualsSheetSettings,
): VisualsSheetSettings {
  if (next.kind === current.kind) return next
  const preset = SHEET_PRESETS[next.kind]
  return { ...next, scale: preset.defaultScale, paper: preset.defaultPaper ?? next.paper }
}

/**
 * A sheet's name and printed title on this page. The road designer's three terrain sheets are named
 * for LiDAR; here their ground is the terrain tiles, so the name drops the claim and the sheet's
 * source bar says where the terrain came from.
 */
const withoutLidar = (text: string) => text.replace(/^LiDAR /, '')
export const visualsSheetLabel = (kind: SheetKind) => withoutLidar(SHEET_PRESETS[kind].label)
export const visualsSheetTitle = (kind: SheetKind) => withoutLidar(SHEET_PRESETS[kind].title)

// ---------------------------------------------------------------- the map style

/** The scene's areas a figure style has a symbol for, and the figure role each draws as. */
type SheetAreaRole = Extract<ViaRole, 'landform' | 'proposedBlock' | 'existingNonVeg' | 'privateLand' | 'rockNonVeg'>
const AREA_ROLES: readonly SheetAreaRole[] = [
  'landform',
  'proposedBlock',
  'existingNonVeg',
  'privateLand',
  'rockNonVeg',
]

/** A style's own area symbol for a role, under the name its legend gives it; null when it draws none. */
function presetArea(preset: ViaStylePreset | null, role: SheetAreaRole): AreaSymbol | null {
  const symbol = preset?.symbols[role]?.symbol
  if (!symbol || symbol.kind !== 'area') return null
  return { ...symbol, label: preset!.legend.order.find((entry) => entry.role === role)?.label ?? ROLE_NAMES[role] }
}

/** The first figure style that draws `role` as an area, named as PGMaps names the role. */
function catalogueArea(role: SheetAreaRole): AreaSymbol | null {
  for (const preset of [findPreset(DEFAULT_FIGURE_STYLE), ...VIA_STYLE_PRESETS]) {
    const symbol = preset?.symbols[role]?.symbol
    if (symbol?.kind === 'area') return { ...symbol, label: ROLE_NAMES[role] }
  }
  return null
}

const PLAIN_OUTLINE = (label: string): AreaSymbol => ({
  kind: 'area',
  label,
  outline: [{ color: '#57534e', width: 0.75, join: 'round' }],
})

/**
 * What each of the scene's areas draws with under a map style. PGMaps' sheet symbols leave the
 * blocks to the sheet (`BLOCK_OF_INTEREST`, `OTHER_BLOCK`) and take existing openings and private
 * land from the sheet catalogue; a figure style supplies every role it draws, and the rest keep
 * the sheet's. A role no style in the catalogue draws as an area gets a plain outline.
 */
export function visualsSheetSymbols(styleId: string): {
  /** Null: the sheet's own block symbols. */
  block: AreaSymbol | null
  landform: AreaSymbol
  opening: AreaSymbol
  privateLand: AreaSymbol
  rock: AreaSymbol
} {
  const preset = styleId === SHEET_SYMBOLS_STYLE ? null : findPreset(styleId)
  return {
    block: presetArea(preset, 'proposedBlock'),
    landform: presetArea(preset, 'landform') ?? catalogueArea('landform') ?? PLAIN_OUTLINE(ROLE_NAMES.landform),
    opening: presetArea(preset, 'existingNonVeg') ?? { ...VIA_OVERVIEW_MAP.harvested, label: 'Existing opening' },
    privateLand: presetArea(preset, 'privateLand') ?? (catalogueEntry('private-land').symbol as AreaSymbol),
    rock: presetArea(preset, 'rockNonVeg') ?? catalogueArea('rockNonVeg') ?? PLAIN_OUTLINE(ROLE_NAMES.rockNonVeg),
  }
}

/**
 * A figure style's block and opening symbols for the VIA report's maps (`ReportMapStyle`, `reportMaps.ts`): only
 * the roles the style itself draws, so a map keeps its own symbol for the other. Undefined for the maps' own symbols.
 */
export function figureMapStyle(styleId: string): { block?: AreaSymbol; opening?: AreaSymbol } | undefined {
  const preset = styleId === SHEET_SYMBOLS_STYLE ? null : findPreset(styleId)
  if (!preset) return undefined
  const block = presetArea(preset, 'proposedBlock')
  const opening = presetArea(preset, 'existingNonVeg')
  return block || opening ? { ...(block ? { block } : {}), ...(opening ? { opening } : {}) } : undefined
}

/** The figure styles that restyle the report's maps: those with a block or an opening symbol of their own. */
export function reportMapStyles(): { value: string; label: string }[] {
  return [
    { value: SHEET_SYMBOLS_STYLE, label: 'The report’s own map symbols' },
    ...VIA_STYLE_PRESETS.filter((preset) => figureMapStyle(preset.id)).map((preset) => ({
      value: preset.id,
      label: preset.name,
    })),
  ]
}

/** The map styles the sheet offers: PGMaps' sheet symbols, then every figure style that draws an area of the scene. */
export function visualsSheetStyles(): { value: string; label: string }[] {
  return [
    { value: SHEET_SYMBOLS_STYLE, label: 'PGMaps sheet symbols' },
    ...VIA_STYLE_PRESETS.filter((preset) => AREA_ROLES.some((role) => presetArea(preset, role))).map((preset) => ({
      value: preset.id,
      label: preset.name,
    })),
  ]
}

/** The style's name as the dialog and the file's contents list print it. */
export const visualsSheetStyleName = (styleId: string) =>
  visualsSheetStyles().find((style) => style.value === styleId)?.label ?? 'PGMaps sheet symbols'

// ---------------------------------------------------------------- the layers

/** What the page hands the sheet: the scene's shapes and the planned views. */
export interface VisualsSheetScene {
  /** `planning` (the imported block, licence, permit and opening) fills a series' `{attr:…}` tokens. */
  targets: readonly (Pick<TargetPolygon, 'id' | 'name' | 'role' | 'geometry'> &
    Partial<Pick<TargetPolygon, 'planning'>>)[]
  masks: readonly Pick<AssessmentMask, 'kind' | 'geometry'>[]
  viewpoint: Pick<Viewpoint, 'name' | 'mode' | 'coordinates'>
  /** Views of interest; a view left out of the package is left out here too. */
  views: readonly { name: string; lng: number; lat: number }[]
  /** Inventory polygons with an established VQO, when the page has read the inventory. Never read for the sheet. */
  vqo?: readonly { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[]
}

/** The proposed blocks a sheet can be about. */
export function visualsSheetBlocks(scene: Pick<VisualsSheetScene, 'targets'>): { value: string; label: string }[] {
  return scene.targets
    .filter((target) => target.role === 'block')
    .map((target) => ({ value: target.id, label: target.name || 'Unnamed block' }))
}

/** The block a setting names, else the scene's first. */
export const visualsSheetBlockId = (scene: Pick<VisualsSheetScene, 'targets'>, block: string) => {
  const blocks = visualsSheetBlocks(scene)
  return blocks.some((entry) => entry.value === block) ? block : (blocks[0]?.value ?? '')
}

// ---------------------------------------------------------------- formats and series

/** The formats the sheet is written in, PDF first. */
export const VISUALS_SHEET_FORMATS: readonly SheetFormat[] = ['pdf', 'svg', 'png']

/**
 * The scene's proposed blocks as a series takes them, in the scene's order: each block's id, its name as printed and
 * the attributes its import gave (`planning`), which `{attr:BLOCK}`, `{attr:FL}`, `{attr:CP}` and `{attr:OPENING}`
 * read. An attribute the import did not give is absent, so its token stays as typed.
 */
export function visualsSeriesBlocks(scene: Pick<VisualsSheetScene, 'targets'>): SheetSeriesBlock[] {
  return scene.targets
    .filter((target) => target.role === 'block')
    .map((target) => {
      const planning = target.planning ?? {}
      const attributes = Object.fromEntries(
        (
          [
            ['BLOCK', planning.blockId],
            ['FL', planning.licenceId],
            ['CP', planning.permitId],
            ['OPENING', planning.openingId],
          ] as const
        ).filter(([, value]) => typeof value === 'string' && value.trim()),
      )
      return {
        id: target.id,
        name: target.name || 'Unnamed block',
        ...(Object.keys(attributes).length ? { attributes } : {}),
      }
    })
}

/** What the output settings write for this scene, worked out once for the form, *What goes in* and the file. */
export interface VisualsSheetOutputPlan {
  format: SheetFormat
  /** One sheet per block: asked for, and the scene has two blocks or more. */
  series: boolean
  /** The series' pages in order, by block id and name; empty for one sheet. */
  pages: { id: string; name: string }[]
  /** The ids the settings keep, less those no longer in the scene: what the form shows ticked. */
  selection: 'all' | string[]
  /** Blocks chosen earlier that this scene does not have, by count: left out, never replaced. */
  stale: number
  /** What the download is: the format for one sheet, else one PDF or a ZIP. */
  container: SheetFormat | 'zip'
  /** Each page's file name inside a ZIP; empty otherwise. */
  fileNames: string[]
  mask: boolean
  /** Why the series cannot be written as chosen, or null. */
  problem: string | null
}

/**
 * The output settings read against the scene. A list of chosen blocks is matched by id: ids the scene no longer has
 * (a block removed, or a list kept from another scene in this browser) are dropped and counted in `stale`, never
 * swapped for another block, so a series prints only blocks the person ticked. With every chosen id gone, the series
 * has no pages and says so; *All* takes in every block, new ones included.
 */
export function visualsSheetOutputPlan(
  scene: Pick<VisualsSheetScene, 'targets'>,
  output: SheetOutputSettings,
): VisualsSheetOutputPlan {
  const blocks = visualsSeriesBlocks(scene)
  const known = new Set(blocks.map((block) => block.id))
  const selection = output.blocks === 'all' ? 'all' : output.blocks.filter((id) => known.has(id))
  const stale = output.blocks === 'all' ? 0 : output.blocks.length - selection.length
  const series = output.series && blocks.length > 1
  const pages = series
    ? seriesPages(blocks, { order: output.order, selected: selection }).map(({ id, name }) => ({ id, name }))
    : []
  const container = series ? seriesContainer(output) : output.format
  const problem = !series
    ? null
    : !pages.length
      ? stale
        ? 'The blocks chosen for the series are no longer in the scene. Choose the blocks again.'
        : 'Choose at least one block for the series.'
      : pages.length > MAX_SHEET_SERIES_PAGES
        ? `A series is at most ${MAX_SHEET_SERIES_PAGES} sheets; ${pages.length} blocks are chosen. Choose fewer blocks.`
        : null
  return {
    format: output.format,
    series,
    pages,
    selection,
    stale,
    container,
    fileNames:
      series && container === 'zip'
        ? seriesFileNames(
            output.fileName,
            seriesPages(blocks, { order: output.order, selected: selection }),
            SHEET_FORMAT_INFO[output.format].extension,
          )
        : [],
    mask: output.mask,
    problem,
  }
}

/** The extension the download has, with its dot: the format's for one sheet, else `.pdf` or `.zip`. */
export const visualsSheetExtension = (plan: Pick<VisualsSheetOutputPlan, 'container'>) =>
  `.${plan.container === 'zip' ? 'zip' : SHEET_FORMAT_INFO[plan.container].extension}`

/** Names listed in *What goes in* before "and N more". */
const LISTED_NAMES = 6

const listed = (names: readonly string[]) =>
  names.length > LISTED_NAMES
    ? `${names.slice(0, LISTED_NAMES).join(', ')} and ${names.length - LISTED_NAMES} more`
    : names.join(', ')

/** The sheet types that read terrain tiles for their frame (contours, slope or hillshade). */
const readsTerrain = (kind: SheetKind) => {
  const preset = SHEET_PRESETS[kind]
  return preset.base === 'slope' || preset.base === 'hillshade' || !!preset.contours
}

/**
 * The file as *What goes in* lists it, from the same plan the file is written from: the format, what the download is
 * (one sheet, one PDF of N pages or a ZIP of N files), which blocks in what order, blocks chosen earlier that are gone,
 * the ZIP's file names, the mask, and the terrain (and imagery) a series reads once per sheet. `note` says what the
 * format holds and, for a series, how a sheet that cannot be made is reported.
 */
export function visualsSheetFileRows(
  scene: Pick<VisualsSheetScene, 'targets'>,
  settings: Pick<VisualsSheetSettings, 'kind' | 'output'>,
): { rows: { label: string; value: string }[]; note: string; plan: VisualsSheetOutputPlan } {
  const plan = visualsSheetOutputPlan(scene, settings.output)
  const info = SHEET_FORMAT_INFO[plan.format]
  const ext = info.extension.toUpperCase()
  const n = plan.pages.length
  const terrain = readsTerrain(settings.kind)
  const imagery = SHEET_PRESETS[settings.kind].base === 'imagery'
  const rows = [
    { label: 'Format', value: info.label },
    {
      label: 'Written as',
      value: !plan.series
        ? `One sheet, ${ext}`
        : plan.problem
          ? `Nothing: ${plan.problem.replace(/\.$/, '').toLowerCase()}`
          : plan.container === 'pdf'
            ? `One PDF of ${count(n, 'page')}, one a block`
            : `A ZIP of ${count(n, `${ext} file`)}, one a block`,
    },
    ...(plan.series && n ? [{ label: 'Blocks, in order', value: listed(plan.pages.map((page) => page.name)) }] : []),
    ...(plan.series && plan.stale
      ? [{ label: 'Chosen earlier', value: `${count(plan.stale, 'block')} no longer in the scene: left out` }]
      : []),
    ...(plan.fileNames.length ? [{ label: 'File names', value: listed(plan.fileNames) }] : []),
    { label: 'Outside the block', value: plan.mask ? 'Dimmed, and the sheet says so' : 'Drawn evenly' },
    ...(terrain
      ? [
          {
            label: 'Terrain read',
            value:
              plan.series && n > 1
                ? `Up to ${SHEET_DEM_TILE_BUDGET} tiles a sheet, ${n * SHEET_DEM_TILE_BUDGET} at most for the series`
                : `Up to ${SHEET_DEM_TILE_BUDGET} tiles`,
          },
        ]
      : []),
    ...(imagery && plan.series && n > 1
      ? [{ label: 'Imagery', value: `Captured once for each of the ${n} sheets` }]
      : []),
  ]
  const note = plan.series
    ? `${info.description} Each sheet is framed on its own block, drawn there as the block of interest with the others as other blocks; typed fields and comments fill their {name}, {page}, {total} and {attr:…} tokens for it. The sheets are made one after another, each reading its own terrain${imagery ? ' and imagery' : ''}, so a long series takes a while; Download says which sheet it is on, and closing the dialog stops it. A sheet that cannot be made is left out by name and said beside the saved file${plan.container === 'zip' ? ` and in the ZIP's ${SERIES_NOTES_FILE}` : ''}. The preview shows the first sheet.`
    : info.description
  return { rows, note, plan }
}

/** One page of a series: the run framed on that page's block, its typed fields and comments filled for it. */
export function visualsSeriesPageRun(run: VisualsSheetRun, page: SheetSeriesPage): VisualsSheetRun {
  return {
    ...run,
    settings: {
      ...run.settings,
      block: page.id,
      fields: fillSeriesFields(run.settings.fields, page),
      comments: fillSeriesTokens(run.settings.comments, page),
    },
  }
}

/** The series' own file name before its extension, which `withSheetExtension` adds for its container. */
export const visualsSeriesFileName = (settings: Pick<VisualsSheetSettings, 'kind'>) =>
  `visual-quality-block-sheets-${settings.kind}`

/** A series' progress as Download shows it. */
export const seriesProgressText = (progress: SheetSeriesProgress) =>
  progress.page === null
    ? `Writing the file: ${count(progress.total, 'sheet')}…`
    : `Making sheet ${progress.done + 1} of ${progress.total}: ${progress.page}…`

const ASSESSED_ROAD: LineSymbol = { ...VIA_OVERVIEW_MAP.highway, label: 'Assessed road' }
const RETENTION: AreaSymbol = { ...VIA_OVERVIEW_MAP.wtra, label: 'Wildlife tree patch / retention' }
const VQO_LINEWORK: AreaSymbol = { ...VIA_OVERVIEW_MAP.vqo, label: 'Established VQO polygon' }

const finite = (lng: number, lat: number) => Number.isFinite(lng) && Number.isFinite(lat)

/**
 * The sheet's layers and the symbols that replace the sheet's own. The chosen block is the block of
 * interest and the other proposed blocks draw as other blocks; the landform, existing openings,
 * masks, the assessed road or viewpoint and the views of interest draw as catalogue features, each
 * listed in the legend only when it falls in the frame. A permanent non-forestry disturbance has no
 * symbol in any catalogue and is left off.
 */
export function visualsSheetLayers(
  scene: VisualsSheetScene,
  block: string,
  styleId: string,
): { layers: SheetLayers; symbols: SheetSymbols } {
  const style = visualsSheetSymbols(styleId)
  const blockId = visualsSheetBlockId(scene, block)
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const chosen = blocks.find((target) => target.id === blockId)
  const area = (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, symbol: AreaSymbol): SheetExtra => ({
    geometry,
    symbol,
  })
  const extras: SheetExtra[] = [
    ...(scene.vqo ?? []).map((unit) => area(unit.geometry, VQO_LINEWORK)),
    ...scene.targets.filter((t) => t.role === 'harvested').map((t) => area(t.geometry, style.opening)),
    ...scene.masks.flatMap((mask) =>
      mask.kind === 'private'
        ? [area(mask.geometry, style.privateLand)]
        : mask.kind === 'natural'
          ? [area(mask.geometry, style.rock)]
          : mask.kind === 'retained'
            ? [area(mask.geometry, RETENTION)]
            : [],
    ),
    // Over the openings and masks it holds, under the blocks.
    ...scene.targets.filter((t) => t.role === 'landscape').map((t) => area(t.geometry, style.landform)),
  ]
  const station = scene.viewpoint.coordinates.filter(([lng, lat]) => finite(lng, lat))
  if (scene.viewpoint.mode === 'corridor' && station.length > 1)
    extras.push({ geometry: { type: 'LineString', coordinates: station }, symbol: ASSESSED_ROAD })
  const points: [number, number][] = [
    ...(scene.viewpoint.mode !== 'corridor' && station.length ? [station[0]] : []),
    ...scene.views.filter((view) => finite(view.lng, view.lat)).map((view): [number, number] => [view.lng, view.lat]),
  ]
  for (const coordinates of points)
    extras.push({ geometry: { type: 'Point', coordinates }, symbol: VIA_OVERVIEW_MAP.viewpoint })
  return {
    layers: {
      ...(chosen ? { block: { geometry: chosen.geometry, name: chosen.name || 'Unnamed block' } } : {}),
      otherBlocks: blocks
        .filter((target) => target.id !== blockId)
        .map((target) => ({ geometry: target.geometry, name: target.name })),
      extras,
    },
    symbols: style.block ? { block: style.block, otherBlock: style.block } : {},
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The sheet as the export dialog lists it, from the same settings and scene the file is written from:
 * its choices in words and what the scene puts on its map. Null when the scene has no block.
 */
export function visualsSheetSummary(
  scene: VisualsSheetScene,
  settings: VisualsSheetSettings,
): {
  block: string
  sheet: string
  paper: string
  scale: string
  style: string
  unavailable: string | null
  drawn: { label: string; value: string }[]
  /** The file: its format, what it is written as, which blocks, the mask (`visualsSheetFileRows`). */
  file: { label: string; value: string }[]
  /** What the file says about itself: the format, or a series' terrain cost and how a page is left out. */
  fileNote: string
  /** Why the series cannot be written as chosen, or null. */
  problem: string | null
  /** The download's extension, with its dot. */
  extension: string
} | null {
  const blocks = visualsSheetBlocks(scene)
  if (!blocks.length) return null
  const blockId = visualsSheetBlockId(scene, settings.block)
  const { rows: file, note: fileNote, plan } = visualsSheetFileRows(scene, settings)
  const of = (role: TargetPolygon['role']) => scene.targets.filter((target) => target.role === role).length
  const masks = (kind: AssessmentMask['kind']) => scene.masks.filter((mask) => mask.kind === kind).length
  const left = masks('permanent')
  const corridor = scene.viewpoint.mode === 'corridor' && scene.viewpoint.coordinates.length > 1
  const drawn = [
    plan.series
      ? { label: 'Block of interest', value: 'Each chosen block on its own sheet' }
      : { label: 'Block of interest', value: blocks.find((entry) => entry.value === blockId)?.label ?? 'None' },
    ...(blocks.length > 1
      ? [{ label: 'Other blocks', value: plan.series ? 'The rest, on every sheet' : String(blocks.length - 1) }]
      : []),
    { label: 'Landform', value: of('landscape') ? count(of('landscape'), 'outline') : 'None in the scene' },
    ...(of('harvested') ? [{ label: 'Existing openings', value: String(of('harvested')) }] : []),
    ...(masks('private') ? [{ label: 'Private land', value: count(masks('private'), 'area') }] : []),
    ...(masks('natural') ? [{ label: 'Natural non-green ground', value: count(masks('natural'), 'area') }] : []),
    ...(masks('retained')
      ? [{ label: 'Wildlife tree patch / retention', value: count(masks('retained'), 'area') }]
      : []),
    ...(left
      ? [{ label: 'Permanent non-forestry disturbance', value: `${count(left, 'area')}, not drawn: no symbol` }]
      : []),
    {
      label: corridor ? 'Assessed road' : 'Viewpoint',
      value: scene.viewpoint.name || (corridor ? 'The road assessed from' : 'The viewpoint assessed from'),
    },
    ...(scene.views.length ? [{ label: 'Views of interest', value: String(scene.views.length) }] : []),
    ...(scene.vqo?.length ? [{ label: 'Established VQO polygons', value: String(scene.vqo.length) }] : []),
  ]
  return {
    block: plan.series
      ? `Each chosen block on its own sheet (${plan.pages.length} of ${blocks.length})`
      : (blocks.find((entry) => entry.value === blockId)?.label ?? 'None'),
    sheet: visualsSheetLabel(settings.kind),
    paper: PAPER_SIZES[settings.paper].label,
    scale: settings.scale === 'fit' ? 'Fit the block' : formatScale(settings.scale),
    style: visualsSheetStyleName(settings.style),
    unavailable: visualsSheetUnavailable(settings.kind),
    drawn,
    file,
    fileNote,
    problem: plan.problem,
    extension: visualsSheetExtension(plan),
  }
}

/** Why a sheet type cannot be made on this page, or null. */
export function visualsSheetUnavailable(kind: SheetKind): string | null {
  return SHEET_PRESETS[kind].base === 'canopy-height'
    ? 'Needs a canopy height grid, which this page does not load. The road designer prints it from a canopy surface.'
    : null
}

// ---------------------------------------------------------------- terrain for the frame

/** Most terrain tiles one sheet reads; a frame that needs more reads a coarser zoom. */
export const SHEET_DEM_TILE_BUDGET = 64

const tileCount = (range: DemTileRange) => (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)

/** The finest terrain zoom whose tiles over `bounds` stay within the budget. */
export function sheetDemRange(bounds: [number, number, number, number], budget = SHEET_DEM_TILE_BUDGET): DemTileRange {
  for (let zoom = MAX_DEM_ZOOM; zoom > MIN_DEM_ZOOM; zoom -= 1) {
    const range = demTileRange(bounds, zoom)
    if (tileCount(range) <= budget) return range
  }
  return demTileRange(bounds, MIN_DEM_ZOOM)
}

// ---------------------------------------------------------------- the run

/** F.L., CP and Forest District a sheet prints when its own field is blank: the FS1252 office fields. */
export function officeSheetFields(metadata: {
  licence?: string
  cuttingPermit?: string
  district?: string
}): SheetFields {
  const fields: SheetFields = {}
  if (metadata.licence?.trim()) fields.forestLicence = metadata.licence.trim()
  if (metadata.cuttingPermit?.trim()) fields.cuttingPermit = metadata.cuttingPermit.trim()
  if (metadata.district?.trim()) fields.forestDistrict = metadata.district.trim()
  return fields
}

/** The typed fields over the office fields: a typed value wins, a blank one takes the office field. */
export function effectiveSheetFields(typed: SheetFields, office: SheetFields): SheetFields {
  const fields: SheetFields = { ...office }
  for (const [id, value] of Object.entries(typed) as [keyof SheetFields, string | undefined][])
    if (value?.trim()) fields[id] = value
  return fields
}

export const VISUALS_SHEET_CAVEAT = 'Desk assessment map · confirm viewpoints and boundaries in the field'

export interface VisualsSheetRun {
  settings: VisualsSheetSettings
  scene: VisualsSheetScene
  /** The FS1252 office fields that fill blank sheet fields (`officeSheetFields`). */
  office: SheetFields
  issue: SheetIssue
  logo?: RasterImage
  signal?: AbortSignal
}

export interface VisualsSheetDeps extends SheetBuildDeps {
  /** Terrain over the frame; a missing tile leaves a gap the sheet draws without. */
  loadTerrain: (
    range: DemTileRange,
    signal?: AbortSignal,
  ) => Promise<{ source: ElevationSource; missingTileCount: number }>
}

/** One sheet's file name: the block and the sheet type, with the format's extension. */
export function visualsSheetFileName(
  settings: Pick<VisualsSheetSettings, 'kind'>,
  blockName: string | undefined,
  format: SheetFormat = 'pdf',
): string {
  const stem = (blockName ?? 'visual-quality')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${stem || 'block'}-${settings.kind}.${SHEET_FORMAT_INFO[format].extension}`
}

/**
 * Frames the sheet on the block, reads terrain for the frame and builds the sheet. Terrain that does
 * not load leaves the sheet without contours or a classed base, which `missing` says; it never fails
 * a sheet that has a base of its own.
 */
export async function buildVisualsSheet(run: VisualsSheetRun, deps: VisualsSheetDeps): Promise<BuiltSheet> {
  const { settings } = run
  const unavailable = visualsSheetUnavailable(settings.kind)
  if (unavailable) throw Error(unavailable)
  const { layers, symbols } = visualsSheetLayers(run.scene, settings.block, settings.style)
  const focus = sheetFocus(layers)
  if (!focus) throw Error('Add a cutblock in step 1 to print its map sheet.')
  const framed = sheetFrame(settings.kind, settings.paper, settings.scale, { bounds: focus })
  const preset = { ...framed.preset, title: visualsSheetTitle(settings.kind) }
  const frame = { ...framed, preset }
  const wantsTerrain = preset.base === 'slope' || preset.base === 'hillshade' || !!preset.contours
  const missing: string[] = []
  let terrain: ElevationSource | undefined
  let terrainName = 'terrain tiles'
  let spacingM = 30
  if (wantsTerrain) {
    const range = sheetDemRange(frame.projection.bounds)
    const [, south, , north] = frame.projection.bounds
    spacingM = demResolutionMeters((south + north) / 2, range.zoom)
    // The tiles' zoom, not a resolution: their ground is SRTM/CDEM, coarser than a tile's pixel.
    terrainName = `terrain tiles (SRTM/CDEM, zoom ${range.zoom})`
    try {
      const loaded = await deps.loadTerrain(range, run.signal)
      terrain = loaded.source
      if (loaded.missingTileCount)
        missing.push(`${loaded.missingTileCount} terrain tile(s) did not load; the sheet has a gap there.`)
    } catch (cause) {
      if (run.signal?.aborted) throw cause
      if (preset.base === 'slope' || preset.base === 'hillshade')
        throw Error(
          `The terrain for this sheet did not load: ${cause instanceof Error ? cause.message : 'unknown error'}`,
        )
      missing.push(
        `The terrain did not load (${cause instanceof Error ? cause.message : 'unknown error'}); the sheet has no contours or block elevations.`,
      )
    }
  }
  const built = await buildSheet(
    {
      frame,
      layers,
      symbols,
      sources: { terrain },
      terrainName,
      terrainSpacingM: spacingM,
      fields: effectiveSheetFields(settings.fields, run.office),
      comments: settings.comments,
      issue: run.issue,
      logo: run.logo,
      caveat: VISUALS_SHEET_CAVEAT,
      maskOutsideBlock: settings.output.mask,
      signal: run.signal,
    },
    deps,
  )
  // "No terrain is loaded" would repeat the reason already given.
  return { ...built, missing: [...missing, ...(terrain || !wantsTerrain ? built.missing : [])] }
}

// ---------------------------------------------------------------- the file

/** What writing adds to building: the format's writer (jsPDF, the PNG rasteriser), passed in. */
export interface VisualsSheetFileDeps extends VisualsSheetDeps {
  files: SheetFileDeps
}

export interface VisualsSheetWritten {
  blob: Blob
  fileName: string
  /** What the file was written without, one sentence each: a sheet left out of a series, terrain that did not load. */
  notes: string[]
  /** One sheet as drawn, so it can be copied as a PNG without being built again; absent for a series. */
  sheet?: BuiltSheet['sheet']
  /** Set when the file is a preview of part of the download (a series' first sheet): what it is, in words. */
  previewOf?: string
}

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)

/**
 * The sheet as the person chose to write it (`settings.output`): one sheet in its format, or a series of one sheet per
 * chosen block as one PDF or a ZIP (`writeSheetSeries`), each page framed on its block with its tokens filled. With
 * `preview`, a series writes only its first sheet, as the series writes it, and says so in `previewOf`. A series that
 * cannot be written as chosen (no block left, too many) is refused with the plan's reason before anything is read.
 */
export async function writeVisualsSheet(
  run: VisualsSheetRun,
  deps: VisualsSheetFileDeps,
  options: { preview?: boolean; onProgress?: (text: string) => void } = {},
): Promise<VisualsSheetWritten> {
  const { settings, signal } = run
  const output = settings.output
  const plan = visualsSheetOutputPlan(run.scene, output)
  if (plan.problem) throw Error(plan.problem)
  if (!plan.series) {
    const blockId = visualsSheetBlockId(run.scene, settings.block)
    const name = visualsSheetBlocks(run.scene).find((entry) => entry.value === blockId)?.label
    const built = await buildVisualsSheet({ ...run, settings: { ...settings, block: blockId } }, deps)
    return {
      blob: await sheetFile(built.sheet, output.format, deps.files, { title: name, signal }),
      fileName: visualsSheetFileName(settings, name, output.format),
      notes: built.missing.map(sentence),
      sheet: built.sheet,
    }
  }
  const blocks = visualsSeriesBlocks(run.scene)
  const base = visualsSeriesFileName(settings)
  if (options.preview) {
    const [first] = seriesPages(blocks, { order: output.order, selected: plan.selection })
    const built = await buildVisualsSheet(visualsSeriesPageRun(run, first), deps)
    const whole =
      plan.container === 'pdf'
        ? `one PDF of ${count(first.total, 'page')}`
        : `a ZIP of ${count(first.total, `${SHEET_FORMAT_INFO[output.format].extension.toUpperCase()} file`)}`
    return {
      blob: await sheetFile(built.sheet, output.format, deps.files, { title: first.name, signal }),
      fileName: withSheetExtension(base, plan.container),
      notes: built.missing.map((text) => `${first.name}: ${sentence(text)}`),
      previewOf: `The first sheet of ${first.total}, ${first.name}, as the series writes it. Download makes every sheet and writes ${whole}.`,
    }
  }
  const result = await writeSheetSeries({
    blocks,
    settings: { ...output, blocks: plan.selection },
    build: async (page, pageSignal) => {
      const built = await buildVisualsSheet({ ...visualsSeriesPageRun(run, page), signal: pageSignal ?? signal }, deps)
      return { sheet: built.sheet, missing: built.missing }
    },
    deps: deps.files,
    signal,
    onProgress: options.onProgress && ((progress) => options.onProgress!(seriesProgressText(progress))),
  })
  return {
    blob: result.blob,
    fileName: withSheetExtension(base, result.container),
    notes: result.notes.map(sentence),
  }
}
