/**
 * The road tool's block map sheet: which areas can be the block, what the project contributes to
 * the sheet's layers, and the run that builds the PDF or its preview. The sheet engine itself is
 * `src/lib/mapSheet` and the presets `src/lib/forestry/blockSheet`; see
 * docs/forestry-block-map-sheets.md. Module scope has no DOM or network access; the run loads the
 * imagery capture and jsPDF on demand.
 */
import { blockFacts, type BlockFacts } from '@/lib/forestry/blockSheet/blockFacts'
import {
  composeSheet,
  sheetFocus,
  sheetFrame,
  type ComposedSheet,
  type SheetIssue,
  type SheetLayers,
  type SheetNote,
} from '@/lib/forestry/blockSheet/composeSheet'
import { prepareSheetTerrain, type SheetTerrainSources } from '@/lib/forestry/blockSheet/prepareSheet'
import {
  IMAGERY_BASEMAP,
  MAX_SHEET_COMMENTS_LENGTH,
  parseSheetFields,
  SHEET_KINDS,
  SHEET_PRESETS,
  type SheetFields,
  type SheetKind,
} from '@/lib/forestry/blockSheet/sheets'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import { PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { MAX_SHEET_SCALE } from '@/lib/mapSheet/scale'
import { runCooperatively } from './cooperative'
import { arrowHead, type MapNote } from './mapNotes'
import { contextSheetKey, isDeactivatedRoad, riparianSheetKey } from './planSheetSymbols'
import { riparianMapFeatures } from './riparian'
import { distinctRoadColors } from './roadColors'
import type { RoadAnalysis, RoadProject, TerrainSource } from './types'

export interface BlockSheetSettings {
  kind: SheetKind
  paper: PaperId
  scale: number | 'fit'
  /** `context:<id>` or `reference:<id>`; empty frames the roads instead. */
  block: string
  fields: SheetFields
  comments: string
}

export const DEFAULT_BLOCK_SHEET: BlockSheetSettings = {
  kind: 'field-layout',
  paper: 'tabloid',
  scale: 10000,
  block: '',
  fields: {},
  comments: '',
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
  }
}

/** Settings after an edit in the setup form: picking another sheet starts it at that sheet's default scale. */
export function changeBlockSheetSettings(current: BlockSheetSettings, next: BlockSheetSettings): BlockSheetSettings {
  return next.kind === current.kind ? next : { ...next, scale: SHEET_PRESETS[next.kind].defaultScale }
}

/** Polygons that can be the sheet's block: harvest areas and imported reference areas. */
export function blockChoices(project: RoadProject): { value: string; label: string; geometry: GeoJSON.Polygon }[] {
  return [
    ...project.context.flatMap((feature) =>
      feature.kind === 'harvest' && feature.geometry.type === 'Polygon'
        ? [{ value: `context:${feature.id}`, label: feature.name || 'Unnamed block', geometry: feature.geometry }]
        : [],
    ),
    ...(project.reference ?? []).flatMap((feature) =>
      feature.geometry.type === 'Polygon'
        ? [
            {
              value: `reference:${feature.id}`,
              label: `${feature.name || 'Reference area'} (reference)`,
              geometry: feature.geometry,
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
    riparian: riparianMapFeatures(project.context).flatMap((feature) => {
      const key = riparianSheetKey(feature.properties?.riparianBand)
      const geometry = feature.geometry
      if (!key || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return []
      return [{ geometry, band: key === 'riparianReserve' ? ('reserve' as const) : ('management' as const) }]
    }),
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
  const base = SHEET_PRESETS[kind].base
  if (base === 'canopy-height' && !sources.canopy)
    return 'Needs a canopy height grid. Add one as a named reference surface whose name includes "canopy" or "CHM".'
  if ((base === 'slope' || base === 'hillshade') && !sources.terrain) return 'Needs terrain under the block.'
  return null
}

/** A reference surface named as a canopy height model, if the terrain has one. */
export function canopySurfaceId(names: readonly { id: string; name: string }[]): string | null {
  return names.find((surface) => /canopy|\bchm\b/i.test(surface.name))?.id ?? null
}

export interface BlockSheetRun {
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
}

export interface BuiltBlockSheet {
  sheet: ComposedSheet
  facts: BlockFacts | null
  missing: string[]
}

/** Preview rasters are coarse: the preview is a thumbnail, not a proof. */
const PREVIEW_DPI = 40

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
  const facts = layers.block
    ? blockFacts(
        layers.block.geometry,
        run.terrain ? { source: run.terrain, spacingM: Math.max(1, run.terrainResolutionM) } : undefined,
      )
    : null
  const products = await runCooperatively(
    prepareSheetTerrain(frame, sources, run.preview ? PREVIEW_DPI : undefined),
    { signal: run.signal },
    'Block sheet cancelled.',
  )
  let base = products.base
  if (frame.preset.base === 'imagery') {
    if (run.preview)
      base = {
        image: { kind: 'rgba', data: new Uint8ClampedArray([62, 84, 58, 255]), width: 1, height: 1 },
        attribution: `${IMAGERY_BASEMAP.attribution} (preview: imagery loads in the PDF)`,
      }
    else {
      const { captureBasemap } = await import('@/lib/mapSheet/printCapture')
      const captured = await captureBasemap(IMAGERY_BASEMAP, frame.projection, run.signal)
      base = { image: captured.image, attribution: captured.attribution }
    }
  }
  const preset = frame.preset
  const sourceParts = [
    preset.base === 'slope'
      ? `Slope % from ${run.terrainName}`
      : preset.base === 'hillshade'
        ? `Hillshade 315°/45° from ${run.terrainName}`
        : preset.base === 'canopy-height'
          ? 'Canopy height from the canopy surface'
          : '',
    products.contours
      ? `contours ${products.contours.result.interval} m${products.contours.result.widened ? ' (widened to fit)' : ''}`
      : '',
  ].filter(Boolean)
  const sheet = composeSheet({
    frame,
    layers,
    base,
    contours: products.contours,
    facts,
    terrainName: run.terrainName,
    fields: settings.fields,
    issue: run.issue,
    logo: run.logo,
    comments: settings.comments,
    sourceLine: sourceParts.join('; '),
    stamp: run.stamp,
    caveat: run.caveat,
  })
  return { sheet, facts, missing: products.missing }
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
  drawSheetPdf(pdf, jspdf, ops)
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
