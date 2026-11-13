/**
 * A PDF sheet's contour surface as the project's terrain. The sheet prints no vertical datum, so
 * the person states it, as for any terrain that does not say. DOM and network free.
 */
import type { PdfContourSurface } from '@/lib/geoPdf/contours'
import type { PdfSource } from '@/lib/geoPdf/types'
import { localRasterResolution } from '../dev-forestry/localRaster'
import { rasterSource, roadProjection, TerrainImportQuestion, validateRoadRaster } from './terrain'
import type { TerrainMetadata, TerrainSource } from './types'

export function contourTerrain(
  surface: PdfContourSurface,
  source: PdfSource,
  verticalReference: string,
): { metadata: TerrainMetadata; source: TerrainSource; summary: string } {
  const file = source.file.split('/').at(-1) ?? source.file
  if (!verticalReference.trim())
    throw new TerrainImportQuestion(
      `${file} prints contour elevations but not what they are measured from. State the vertical datum to use them as terrain.`,
      { verticalDatum: { files: [file] } },
    )
  if (verticalReference.trim().length > 300) throw Error('Shorten the vertical datum to at most 300 characters.')
  const raster = validateRoadRaster({
    id: `terrain-${source.sha256.slice(0, 16)}-contours`,
    name: `Contours · ${file}`.slice(0, 200),
    kind: 'terrain',
    epsg: surface.epsg,
    origin: [...surface.origin],
    pixelSize: [surface.cellM, -surface.cellM],
    width: surface.width,
    height: surface.height,
    // Millimetres are far finer than a contour surface knows; they keep the saved project smaller.
    values: Array.from(surface.values, (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)),
    acquired: '',
    verticalReference: verticalReference.trim(),
    sha256: source.sha256,
  })
  const latitude = roadProjection(raster.epsg).inverse(raster.origin)[1]
  const metadata: TerrainMetadata = {
    kind: 'geotiff',
    name: raster.name,
    resolutionM: localRasterResolution(raster, latitude),
    epsg: raster.epsg,
    verticalReference: raster.verticalReference,
    sha256: source.sha256,
    raster,
  }
  const a = surface.assignment
  return {
    metadata,
    source: rasterSource(raster),
    summary: `Terrain from ${file}'s ${a.interval} m contours (${a.labelledLines} labelled, ${a.inferredLines} inferred lines; ${surface.cellM} m cells). Coarser than LiDAR; ground beyond the labelled contours is left missing.`,
  }
}

/** A terrain built by {@link contourTerrain}. */
export const isContourTerrain = (raster: { id: string } | undefined) => !!raster?.id.endsWith('-contours')

/**
 * How a contour surface's slope compared with the same block's printed slope sheet, scored on the
 * sheet's exact pixels by `scripts/forestry/check-pdf-contour-slope.ts` (one supplied company
 * sheet pair, November 2026). See `docs/forestry-road-design/source-pdf-import.md`.
 */
export const CONTOUR_SLOPE_CHECK =
  'On the one sheet pair checked, contour slope was in the same printed range for 43% of the sheet’s exact pixels and within one range for 69%; it agreed 87–91% on the 35%, 40% and 60% thresholds and read the 60%+ share low (38% against 42%).'
