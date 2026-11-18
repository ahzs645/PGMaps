/**
 * The road tool's block map sheet: which areas can be the block, what the project contributes to
 * the sheet's layers, and the run that builds the PDF or its preview. The sheet engine itself is
 * `src/lib/mapSheet` and the presets `src/lib/forestry/blockSheet`; see
 * docs/forestry-block-map-sheets.md. A sheet is written as PDF, SVG or PNG, or as a series of one
 * sheet per block (**Formats**, **Sheet series**). Module scope has no DOM or network access; the
 * run loads the imagery capture, jsPDF and the PNG rasteriser on demand.
 */
import { buildSheet, sheetNeeds, type BuiltSheet } from '@/lib/forestry/blockSheet/buildSheet'
import {
  sheetFocus,
  sheetFrame,
  type SheetIssue,
  type SheetLayers,
  type SheetNote,
  type SheetSymbols,
} from '@/lib/forestry/blockSheet/composeSheet'
import type { SheetTerrainSources } from '@/lib/forestry/blockSheet/prepareSheet'
import {
  IMAGERY_BASEMAP,
  MAX_SHEET_COMMENTS_LENGTH,
  parseSheetFields,
  SHEET_KINDS,
  SHEET_PRESETS,
  type SheetFields,
  type SheetKind,
} from '@/lib/forestry/blockSheet/sheets'
import {
  DEFAULT_SHEET_OUTPUT,
  fillSeriesFields,
  fillSeriesTokens,
  parseSheetOutputSettings,
  seriesPages,
  writeSheetSeries,
  type SheetOutputSettings,
  type SheetSeriesBlock,
  type SheetSeriesPage,
  type SheetSeriesProgress,
} from '@/lib/forestry/blockSheet/sheetSeries'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import type { SheetFileDeps, SheetFormat } from '@/lib/mapSheet/sheetFormats'
import { PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { MAX_SHEET_SCALE } from '@/lib/mapSheet/scale'
import { runCooperatively } from './cooperative'
import { arrowHead, type MapNote } from './mapNotes'
import { contextSheetKey, isDeactivatedRoad, riparianSheetKey } from './planSheetSymbols'
import { riparianMapFeatures } from './riparian'
import { mergeRiparianZones } from './riparianDisplay'
import { distinctRoadColors } from './roadColors'
import type { RoadAnalysis, RoadProject, TerrainSource } from './types'
import type { ExportBrand } from '@/branding/model'

export interface BlockSheetSettings {
  kind: SheetKind
  paper: PaperId
  scale: number | 'fit'
  /** `context:<id>` or `reference:<id>`; empty frames the roads instead. */
  block: string
  fields: SheetFields
  comments: string
  /**
   * What the map's features draw with: PGMaps' sheet symbols, or the styles this browser's style
   * library assigns to them (`styleLibrary.ts`), with PGMaps' symbol for every feature it leaves alone.
   */
  symbols: SheetSymbolChoice
  /**
   * How the sheet is written: format, one sheet or one per block, the series' blocks, order and file
   * names, and the mask outside the block. A saved sheet setup keeps all of it but the blocks chosen,
   * which are the project's (`sheetSetups.ts`).
   */
  output: SheetOutputSettings
}

export type SheetSymbolChoice = 'pgmaps' | 'library'
export const SHEET_SYMBOL_CHOICES: readonly { value: SheetSymbolChoice; label: string }[] = [
  { value: 'pgmaps', label: 'PGMaps sheet symbols' },
  { value: 'library', label: 'My saved styles' },
]

export const DEFAULT_BLOCK_SHEET: BlockSheetSettings = {
  kind: 'field-layout',
  paper: 'tabloid',
  scale: 10000,
  block: '',
  fields: {},
  comments: '',
  symbols: 'pgmaps',
  output: DEFAULT_SHEET_OUTPUT,
}

/** Validates settings read back from browser storage; anything unknown falls back to the default. */
export function parseBlockSheetSettings(raw: unknown): BlockSheetSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_BLOCK_SHEET
  const r = raw as Record<string, unknown>
  const scale =
    r.scale === 'fit'
      ? 'fit'
      : typeof r.scale === 'number' && r.scale > 0 && r.scale <= MAX_SHEET_SCALE
        ? r.scale
        : 10000
  return {
    kind: SHEET_KINDS.includes(r.kind as SheetKind) ? (r.kind as SheetKind) : DEFAULT_BLOCK_SHEET.kind,
    paper: typeof r.paper === 'string' && r.paper in PAPER_SIZES ? (r.paper as PaperId) : 'tabloid',
    scale,
    block: typeof r.block === 'string' ? r.block.slice(0, 200) : '',
    fields: parseSheetFields(r.fields),
    comments: typeof r.comments === 'string' ? r.comments.slice(0, MAX_SHEET_COMMENTS_LENGTH) : '',
    symbols: r.symbols === 'library' ? 'library' : 'pgmaps',
    output: parseSheetOutputSettings(r.output),
  }
}

/** Picking another sheet starts at its default scale and, when specified, its native paper. */
export function changeBlockSheetSettings(current: BlockSheetSettings, next: BlockSheetSettings): BlockSheetSettings {
  if (next.kind === current.kind) return next
  const preset = SHEET_PRESETS[next.kind]
  return { ...next, scale: preset.defaultScale, paper: preset.defaultPaper ?? next.paper }
}

/** Polygons that can be the sheet's block: harvest areas and imported reference areas. */
export function blockChoices(project: RoadProject): {
  value: string
  label: string
  geometry: GeoJSON.Polygon
  /** The area's source attributes, for a series' `{attr:FIELD}` tokens. */
  attributes?: Readonly<Record<string, string | number | boolean | null>>
}[] {
  return [
    ...project.context.flatMap((feature) =>
      feature.kind === 'harvest' && feature.geometry.type === 'Polygon'
        ? [
            {
              value: `context:${feature.id}`,
              label: feature.name || 'Unnamed block',
              geometry: feature.geometry,
              ...(feature.attributes ? { attributes: feature.attributes } : {}),
            },
          ]
        : [],
    ),
    ...(project.reference ?? []).flatMap((feature) =>
      feature.geometry.type === 'Polygon' && !feature.sheet && !feature.classGrid
        ? [
            {
              value: `reference:${feature.id}`,
              label: `${feature.name || 'Reference area'} (reference)`,
              geometry: feature.geometry,
              ...(feature.attributes ? { attributes: feature.attributes } : {}),
            },
          ]
        : [],
    ),
  ]
}

/** A plan note as review markup; a line ending in an arrow carries its arrowhead. */
function noteMarkup(note: MapNote): SheetNote {
  const head = note.kind === 'line' && note.arrow ? arrowHead(note.points) : null
  return {
    kind: note.kind === 'pin' ? 'pin' : note.kind === 'area' ? 'area' : 'line',
    points: note.points,
    color: note.color,
    text: note.text,
    ...(head ? { head } : {}),
  }
}

/**
 * What the project draws on a sheet: the chosen block, the other harvest areas, constraint areas,
 * the riparian screen, streams, mapped roads (crossed where deactivated), the designed roads in their
 * own colours, and the plan's notes as review markup. Context is classed by `contextSheetKey`, as on
 * the plan with sheet symbols on.
 */
export function blockSheetLayers(
  project: RoadProject,
  analyses: ReadonlyMap<string, RoadAnalysis>,
  block: string,
): SheetLayers {
  const choice = blockChoices(project).find((entry) => entry.value === block)
  const roads = project.alignments.filter((road) => road.id !== project.designPlaceholderId)
  const colors = distinctRoadColors(roads)
  return {
    ...(choice ? { block: { geometry: choice.geometry, name: choice.label.replace(/ \(reference\)$/, '') } } : {}),
    otherBlocks: project.context.flatMap((feature) =>
      feature.kind === 'harvest' && feature.geometry.type === 'Polygon' && `context:${feature.id}` !== block
        ? [{ geometry: feature.geometry, name: feature.name }]
        : [],
    ),
    constraints: project.context.flatMap((feature) =>
      feature.kind === 'avoid' && feature.geometry.type === 'Polygon' ? [{ geometry: feature.geometry }] : [],
    ),
    // One dissolved zone per band, not one buffer per stream reach (`riparianDisplay.ts`). The sheet
    // draws two bands, so the unresolved screen joins the management zone as before.
    riparian: mergeRiparianZones(riparianMapFeatures(project.context), (feature) => {
      const key = riparianSheetKey(feature.properties?.riparianBand)
      return key === 'riparianReserve' ? 'reserve' : key === 'riparianManagement' ? 'management' : null
    }).features.map((feature) => ({
      geometry: feature.geometry,
      band: feature.properties?.riparianBand === 'reserve' ? ('reserve' as const) : ('management' as const),
    })),
    streams: project.context.flatMap((feature) =>
      feature.kind === 'stream' && feature.geometry.type === 'LineString'
        ? [{ line: feature.geometry.coordinates as [number, number][], ncd: contextSheetKey(feature) === 'ncd' }]
        : [],
    ),
    existingRoads: project.context.flatMap((feature) =>
      feature.kind === 'existing-road' && feature.geometry.type === 'LineString'
        ? [
            {
              line: feature.geometry.coordinates as [number, number][],
              forestService: contextSheetKey(feature) === 'fsr',
              name: feature.name,
              deactivated: isDeactivatedRoad(feature),
            },
          ]
        : [],
    ),
    roads: roads.map((road) => {
      const analysis = analyses.get(road.id)
      const line = analysis?.centerline.length ? analysis.centerline : road.points.map((point) => point.coordinate)
      return {
        name: road.name,
        color: colors.get(road.id) ?? road.color,
        line: line.map((p) => [p[0], p[1]] as [number, number]),
        lengthM: analysis?.length ?? 0,
      }
    }),
    notes: (project.notes ?? []).map(noteMarkup),
  }
}

/** Why a sheet kind cannot be made for this project, or null. */
export function blockSheetUnavailable(kind: SheetKind, sources: SheetTerrainSources): string | null {
  const needs = sheetNeeds(kind, sources)
  if (needs === 'canopy')
    return 'Needs a canopy height grid. Add one as a named reference surface whose name includes "canopy" or "CHM".'
  if (needs === 'terrain') return 'Needs terrain under the block.'
  return null
}

/** A reference surface named as a canopy height model, if the terrain has one. */
export function canopySurfaceId(names: readonly { id: string; name: string }[]): string | null {
  return names.find((surface) => /canopy|\bchm\b/i.test(surface.name))?.id ?? null
}

export interface BlockSheetRun {
  branding?: ExportBrand
  settings: BlockSheetSettings
  project: RoadProject
  analyses: ReadonlyMap<string, RoadAnalysis>
  terrain: TerrainSource | null
  terrainName: string
  terrainResolutionM: number
  canopy: TerrainSource | null
  issue: SheetIssue
  logo?: RasterImage
  stamp?: string
  caveat: string
  signal?: AbortSignal
  /** Lower resolution for the on-screen preview. */
  preview?: boolean
  /**
   * The style library's symbols by feature (`roleOverrides`), read by the page. Drawn only when
   * `settings.symbols` is `library`; the map and the sheet's legend then both draw them.
   */
  librarySymbols?: SheetSymbols
  /**
   * Dim the map outside the block (`SheetOutputSettings.mask`). Set by the Block map sheet export
   * only, so the report package's sheets are unchanged.
   */
  maskOutsideBlock?: boolean
}

export type BuiltBlockSheet = BuiltSheet

/** Scale at and beyond which a sheet is an overview whose contours may come from regional terrain. */
export const OVERVIEW_SHEET_SCALE = 50000

/**
 * Where a sheet's contours come from. The road tool loads terrain for its roads' extent only (about
 * 3 x 4 km for a block), while a 1:50,000 frame covers about 20 x 15 km, so contours stopped at the
 * edge of a small box in the middle of the sheet. When the project's terrain does not cover the
 * frame, the frame gets regional terrain of its own if the project is on regional terrain anyway or
 * the sheet is an overview. A detailed (LiDAR) terrain on a design-scale sheet is never swapped for
 * 22 m contours: there contours stop at the data edge as before.
 */
export function sheetContourSource(
  terrain: { kind: string; bounds?: readonly number[] } | null | undefined,
  frameBounds: readonly [number, number, number, number],
  scale: number,
): 'project' | 'regional-frame' {
  const b = terrain?.bounds
  const covers =
    !!b &&
    b.length === 4 &&
    b[0] <= frameBounds[0] &&
    b[1] <= frameBounds[1] &&
    b[2] >= frameBounds[2] &&
    b[3] >= frameBounds[3]
  if (covers) return 'project'
  return terrain?.kind === 'regional' || scale >= OVERVIEW_SHEET_SCALE ? 'regional-frame' : 'project'
}

/** Frames, samples and composes the sheet. Imagery is captured only for the full PDF. */
export async function buildBlockSheet(run: BlockSheetRun): Promise<BuiltBlockSheet> {
  const { settings } = run
  const layers = blockSheetLayers(run.project, run.analyses, settings.block)
  const focus = sheetFocus(layers)
  if (!focus) throw Error('Choose a block, or draw a road, before making a block sheet.')
  const frame = sheetFrame(settings.kind, settings.paper, settings.scale, { bounds: focus })
  const sources: SheetTerrainSources = { terrain: run.terrain ?? undefined, canopy: run.canopy ?? undefined }
  const unavailable = blockSheetUnavailable(settings.kind, sources)
  if (unavailable) throw Error(unavailable)
  // Contours over the whole frame (`sheetContourSource`). The preview keeps the loaded terrain, as it
  // keeps a flat colour for imagery: a thumbnail should not fetch tiles on every setting change.
  let frameContours = false
  const contourMissing: string[] = []
  if (
    frame.preset.contours &&
    !run.preview &&
    sheetContourSource(run.project.terrain, frame.projection.bounds, frame.projection.scale) === 'regional-frame'
  ) {
    const [w, s, e, n] = frame.projection.bounds
    try {
      const { loadRegionalTerrain } = await import('./terrain')
      const loaded = await loadRegionalTerrain([w - 0.002, s - 0.002, e + 0.002, n + 0.002], run.signal)
      sources.contourTerrain = loaded.source
      frameContours = true
    } catch (cause) {
      if (run.signal?.aborted) throw cause
      contourMissing.push(
        `Regional terrain for the whole frame could not be loaded (${cause instanceof Error ? cause.message : 'unknown error'}); contours cover the project's terrain only.`,
      )
    }
  }
  const logo =
    run.logo ??
    (run.branding ? await (await import('@/branding/raster')).brandLogoRaster(run.branding.brand) : undefined)
  const built = await buildSheet(
    {
      frame,
      layers,
      symbols: settings.symbols === 'library' ? run.librarySymbols : undefined,
      sources,
      terrainName: run.terrainName,
      terrainSpacingM: run.terrainResolutionM,
      contourNote: frameContours ? ' from the regional DEM over the whole frame' : '',
      fields: settings.fields,
      comments: settings.comments,
      issue: run.issue,
      logo,
      stamp: run.stamp,
      caveat: run.caveat,
      signal: run.signal,
      preview: run.preview,
      maskOutsideBlock: run.maskOutsideBlock,
    },
    {
      drive: (steps) => runCooperatively(steps, { signal: run.signal }, 'Block sheet cancelled.'),
      captureImagery: async (projection, signal) =>
        (await import('@/lib/mapSheet/printCapture')).captureBasemap(IMAGERY_BASEMAP, projection, signal),
    },
  )
  const { sheet } = built
  if (run.branding && !run.logo && logo) {
    const placement = sheet.ops.find((op) => op.op === 'image' && op.image === logo)
    const minimum = run.branding.brand.profile.identity?.minimumLogoWidthMm ?? 0
    const clear = run.branding.brand.profile.identity?.logo?.clearSpaceRatio ?? 0
    if (!placement || placement.op !== 'image' || ((placement.w / (1 + 2 * clear)) * 25.4) / 72 < minimum)
      throw Error(
        'This sheet has insufficient room for the selected brand logo. Choose a larger sheet or turn export branding off.',
      )
  }
  return { ...built, missing: [...contourMissing, ...built.missing] }
}

/** Builds the sheet and returns its PDF. */
export async function blockSheetPdf(run: BlockSheetRun): Promise<{ blob: Blob; built: BuiltBlockSheet }> {
  const built = await buildBlockSheet(run)
  const [{ encodeSheetImages }, { createSheetPdf, drawSheetPdf }, jspdf] = await Promise.all([
    import('@/lib/mapSheet/png'),
    import('@/lib/mapSheet/renderPdf'),
    import('jspdf'),
  ])
  const ops = await encodeSheetImages(built.sheet.ops)
  if (run.signal?.aborted) throw new DOMException('Block sheet cancelled.', 'AbortError')
  const pdf = createSheetPdf(jspdf, built.sheet.width, built.sheet.height)
  const { configurePdfBrand } = await import('@/branding/pdf')
  const fonts = configurePdfBrand(pdf, run.branding)
  drawSheetPdf(pdf, jspdf, ops, run.branding ? fonts : undefined)
  return { blob: pdf.output('blob'), built }
}

/** Builds a low-resolution sheet as an SVG data URL for the export preview. */
export async function blockSheetPreview(run: BlockSheetRun) {
  const built = await buildBlockSheet({ ...run, preview: true })
  const [{ encodeSheetImages }, { sheetSvg }] = await Promise.all([
    import('@/lib/mapSheet/png'),
    import('@/lib/mapSheet/renderSvg'),
  ])
  const svg = sheetSvg(await encodeSheetImages(built.sheet.ops), built.sheet.width, built.sheet.height)
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: built.sheet.width,
    height: built.sheet.height,
    built,
  }
}

/** The blocks a series can take: the sheet's own block list, by id, the name printed and attributes. */
export function seriesBlocks(project: RoadProject): SheetSeriesBlock[] {
  return blockChoices(project).map((choice) => ({
    id: choice.value,
    name: choice.label.replace(/ \(reference\)$/, ''),
    ...(choice.attributes ? { attributes: choice.attributes } : {}),
  }))
}

/** The run for one page of a series: framed on its block, its typed fields' tokens filled for it. */
export function seriesPageRun(run: BlockSheetRun, page: SheetSeriesPage): BlockSheetRun {
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

/**
 * The series' first page, which the preview shows, and how many pages the series has. Throws when no
 * block is chosen.
 */
export function firstSeriesPage(blocks: readonly SheetSeriesBlock[], output: SheetOutputSettings) {
  const pages = seriesPages(blocks, { order: output.order, selected: output.blocks })
  if (!pages.length) throw Error('Choose at least one block for the series.')
  return { page: pages[0], total: pages.length }
}

/** What writing needs from the browser for `format`: jsPDF with the brand's fonts, or the PNG rasteriser. */
async function fileDeps(format: SheetFormat, run: BlockSheetRun): Promise<SheetFileDeps> {
  const [{ browserSheetFileDeps }, { configurePdfBrand }] = await Promise.all([
    import('@/lib/mapSheet/sheetFileDeps'),
    import('@/branding/pdf'),
  ])
  // Without a brand, no fonts: the graticule keeps its Times labels, as `blockSheetPdf` draws them.
  return browserSheetFileDeps(format, {
    configurePdf: (pdf) => (run.branding ? configurePdfBrand(pdf, run.branding) : undefined),
  })
}

/**
 * One sheet in `format`. PDF is `blockSheetPdf`, so a default sheet is written exactly as before;
 * SVG and PNG go through the shared writer (`sheetFile`).
 */
export async function blockSheetFile(
  run: BlockSheetRun,
  format: SheetFormat,
  deps?: SheetFileDeps,
): Promise<{ blob: Blob; built: BuiltBlockSheet }> {
  if (format === 'pdf' && !deps) return blockSheetPdf(run)
  const built = await buildBlockSheet(run)
  const { sheetFile } = await import('@/lib/mapSheet/sheetFormats')
  const title = blockSheetLayers(run.project, run.analyses, run.settings.block).block?.name
  const blob = await sheetFile(built.sheet, format, deps ?? (await fileDeps(format, run)), {
    title,
    signal: run.signal,
  })
  return { blob, built }
}

/** The sheet as a PNG at `SHEET_PNG_DPI`, for the clipboard. */
export const blockSheetPng = (run: BlockSheetRun) => blockSheetFile(run, 'png').then((file) => file.blob)

/**
 * One sheet per block (`writeSheetSeries`): each page framed on its block with its typed fields'
 * tokens filled, one after another, as one PDF or a ZIP. A page that cannot be built is left out by
 * name and the rest are written.
 */
export async function blockSheetSeries(
  run: BlockSheetRun,
  blocks: readonly SheetSeriesBlock[],
  options: { deps?: SheetFileDeps; onProgress?: (progress: SheetSeriesProgress) => void } = {},
) {
  const { output } = run.settings
  return writeSheetSeries({
    blocks,
    settings: output,
    build: async (page, signal) => {
      const built = await buildBlockSheet({ ...seriesPageRun(run, page), signal: signal ?? run.signal })
      return { sheet: built.sheet, missing: built.missing }
    },
    deps: options.deps ?? (await fileDeps(output.format, run)),
    signal: run.signal,
    onProgress: options.onProgress,
  })
}
