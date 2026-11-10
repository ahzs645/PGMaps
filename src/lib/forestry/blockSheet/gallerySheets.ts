/**
 * What the block sheet symbol gallery shows: each preset at a few scales and papers, drawn from the
 * synthetic fixtures through the real composer, and the symbol catalogue in its groups. Nothing here
 * is real data. No DOM or network access.
 */
import type { PaperId } from '@/lib/mapSheet/layout'
import { SHEET_SCALES } from '@/lib/mapSheet/scale'
import { blockFacts } from './blockFacts'
import { galleryLayers, syntheticCanopy, syntheticImagery, syntheticTerrain } from './blockSheetFixtures'
import { composeSheet, sheetFocus, sheetFrame, type ComposedSheet } from './composeSheet'
import { prepareSheetTerrainNow } from './prepareSheet'
import { IMAGERY_BASEMAP, SHEET_KINDS, SHEET_PRESETS, type SheetKind } from './sheets'
import { CATALOGUE_GROUPS, SYMBOL_CATALOGUE, type CatalogueEntry } from './symbolCatalogue'

export interface GalleryVariant {
  kind: SheetKind
  paper: PaperId
  scale: number
}

/** Papers the gallery shows each preset on; each preset keeps its own orientation. */
export const GALLERY_PAPERS: readonly PaperId[] = ['tabloid', 'letter', 'a3', 'a4']

/** Each preset at every offered scale on tabloid, then on the other papers at its default scale. */
export function galleryVariants(kind: SheetKind): GalleryVariant[] {
  const preset = SHEET_PRESETS[kind]
  return [
    ...SHEET_SCALES.map((scale) => ({ kind, paper: 'tabloid' as const, scale })),
    ...GALLERY_PAPERS.filter((paper) => paper !== 'tabloid').map((paper) => ({
      kind,
      paper,
      scale: preset.defaultScale,
    })),
  ]
}
export const ALL_GALLERY_VARIANTS = SHEET_KINDS.flatMap(galleryVariants)

const FIELDS = {
  forestLicence: 'A00000',
  cuttingPermit: '101',
  blockId: 'BLK-001',
  operatingArea: 'North Slope',
  timbermark: 'XY1234',
}
const ISSUE = { date: '2026-11-10', preparedBy: 'Sample planner', organisation: 'Example Forest Co.', revision: 'A' }

/** A preset drawn from the fixtures. `dpi` sets the terrain raster: 40 for a thumbnail, 150 for print. */
export function gallerySheet(variant: GalleryVariant, dpi = 40): ComposedSheet {
  const frame = sheetFrame(variant.kind, variant.paper, variant.scale, { bounds: sheetFocus(galleryLayers)! })
  const products = prepareSheetTerrainNow(frame, { terrain: syntheticTerrain, canopy: syntheticCanopy }, dpi)
  const base =
    frame.preset.base === 'imagery'
      ? {
          image: syntheticImagery(
            Math.max(2, Math.round((frame.sheet.frame.w / 72) * dpi)),
            Math.max(2, Math.round((frame.sheet.frame.h / 72) * dpi)),
          ),
          attribution: `${IMAGERY_BASEMAP.attribution} (gallery: synthetic stand-in)`,
        }
      : products.base
  return composeSheet({
    frame,
    layers: galleryLayers,
    base,
    contours: products.contours,
    facts: blockFacts(galleryLayers.block!.geometry, { source: syntheticTerrain, spacingM: 10 }),
    terrainName: 'Synthetic terrain',
    fields: FIELDS,
    issue: ISSUE,
    comments:
      variant.kind === 'general-access'
        ? 'From the highway, take the Sample FSR east for 12 km, then Spur A to the block.'
        : undefined,
    sourceLine: 'Synthetic terrain and canopy (gallery fixture)',
    caveat: 'Symbol gallery sample, not a real block',
  })
}

/** File name for a variant's download. */
export const galleryFileName = (variant: GalleryVariant, extension: string) =>
  `block-sheet-${variant.kind}-${variant.paper}-1-${variant.scale}.${extension}`

/** The catalogue in its groups, in the source's order: what the gallery's swatch sheet lists. */
export function gallerySymbolGroups(): { id: string; title: string; entries: CatalogueEntry[] }[] {
  return CATALOGUE_GROUPS.map((group) => ({
    ...group,
    entries: SYMBOL_CATALOGUE.filter((entry) => entry.group === group.id),
  })).filter((group) => group.entries.length)
}
