/**
 * Builds a block map sheet from a tool's own layers: the block's facts, the terrain products on the
 * sheet's frame, the imagery base and the composed sheet. The road designer and the visual quality
 * page both print through it, so a sheet type is the same sheet in either
 * (docs/forestry-block-map-sheets.md, **Adopting it in another tool**).
 * No DOM or network access: the slice runner and the imagery capture are passed in.
 */
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import type { FrameProjection } from '@/lib/mapSheet/scale'
import { blockFacts, type BlockFacts } from './blockFacts'
import {
  composeSheet,
  type ComposedSheet,
  type SheetFrame,
  type SheetIssue,
  type SheetLayers,
  type SheetSymbols,
} from './composeSheet'
import { prepareSheetTerrain, type PublishedBase, type SheetTerrainSources } from './prepareSheet'
import { IMAGERY_BASEMAP, SHEET_PRESETS, type SheetFields, type SheetKind } from './sheets'

/** Preview rasters are coarse: the preview is a thumbnail, not a proof. */
export const SHEET_PREVIEW_DPI = 40

export interface SheetBuild {
  frame: SheetFrame
  layers: SheetLayers
  /** Symbols that replace the sheet's own (`ComposeInput.symbols`). */
  symbols?: SheetSymbols
  sources: SheetTerrainSources
  /** Where elevations came from, e.g. "Regional DEM, 22 m". */
  terrainName: string
  /** Spacing of the block's elevation samples, metres. */
  terrainSpacingM: number
  /** Said after the contour interval when contours came from another terrain than the base's. */
  contourNote?: string
  fields: SheetFields
  comments: string
  issue: SheetIssue
  logo?: RasterImage
  stamp?: string
  caveat: string
  signal?: AbortSignal
  /** Lower resolution, and a flat colour for imagery: the on-screen preview. */
  preview?: boolean
  /** Dim the map outside the block of interest (`ComposeInput.maskOutsideBlock`); off by default. */
  maskOutsideBlock?: boolean
}

export interface SheetBuildDeps {
  /** Runs the terrain sampling in slices, so the page stays live and Cancel works. */
  drive: <Result>(steps: Generator<number, Result>) => Promise<Result>
  /** The imagery sheet's base on the frame. Never called for a preview. */
  captureImagery: (
    projection: FrameProjection,
    signal?: AbortSignal,
  ) => Promise<{ image: RasterImage; attribution: string }>
}

export interface BuiltSheet {
  sheet: ComposedSheet
  facts: BlockFacts | null
  /** What the sheet wanted and could not draw, each a sentence. */
  missing: string[]
}

/** Why a sheet type cannot be made from these sources, or null. A tool words its own remedy. */
export function sheetNeeds(kind: SheetKind, sources: SheetTerrainSources): 'canopy' | 'terrain' | null {
  const base = SHEET_PRESETS[kind].base
  // A published raster of the sheet's base stands in for the heights it would be worked out from.
  if (sources.published?.[base as PublishedBase]) return null
  if (base === 'canopy-height' && !sources.canopy) return 'canopy'
  if ((base === 'slope' || base === 'hillshade') && !sources.terrain) return 'terrain'
  return null
}

/** Samples the terrain on the frame, takes the imagery where the sheet has it, and composes the sheet. */
export async function buildSheet(run: SheetBuild, deps: SheetBuildDeps): Promise<BuiltSheet> {
  const { frame, layers, sources } = run
  const facts = layers.block
    ? blockFacts(
        layers.block.geometry,
        sources.terrain ? { source: sources.terrain, spacingM: Math.max(1, run.terrainSpacingM) } : undefined,
      )
    : null
  const products = await deps.drive(prepareSheetTerrain(frame, sources, run.preview ? SHEET_PREVIEW_DPI : undefined))
  let base = products.base
  if (frame.preset.base === 'imagery') {
    if (run.preview)
      base = {
        image: { kind: 'rgba', data: new Uint8ClampedArray([62, 84, 58, 255]), width: 1, height: 1 },
        attribution: `${IMAGERY_BASEMAP.attribution} (preview: imagery loads in the PDF)`,
      }
    else {
      const captured = await deps.captureImagery(frame.projection, run.signal)
      base = { image: captured.image, attribution: captured.attribution }
    }
  }
  const preset = frame.preset
  const published = products.published
  const sourceParts = [
    published
      ? published.source
      : preset.base === 'slope'
        ? `Slope % from ${run.terrainName}`
        : preset.base === 'hillshade'
          ? `Hillshade 315°/45° from ${run.terrainName}`
          : preset.base === 'canopy-height'
            ? 'Canopy height from the canopy surface'
            : '',
    products.contours
      ? `contours ${products.contours.result.interval} m${products.contours.result.widened ? ' (widened to fit)' : ''}${run.contourNote ?? ''}`
      : '',
  ].filter(Boolean)
  const sheet = composeSheet({
    frame,
    layers,
    symbols: run.symbols,
    base,
    contours: products.contours,
    facts,
    terrainName: run.terrainName,
    fields: run.fields,
    issue: run.issue,
    logo: run.logo,
    comments: run.comments,
    sourceLine: sourceParts.join('; '),
    stamp: run.stamp,
    caveat: run.caveat,
    maskOutsideBlock: run.maskOutsideBlock,
  })
  return { sheet, facts, missing: products.missing }
}
