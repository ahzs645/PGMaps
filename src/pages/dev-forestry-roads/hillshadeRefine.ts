/**
 * The import's "read the ground between the contours from the hillshade" step: decodes the
 * hillshade sheet's stored tiles, lays them on the contour surface's cells and runs the refinement
 * (`@/lib/geoPdf/hillshadeRelief`) in a worker. Browser only: the platform decodes the tiles.
 */
import type { PdfContourSurface } from '@/lib/geoPdf/contours'
import { hillshadeOnGrid } from '@/lib/geoPdf/hillshadeRelief'
import { refineWithHillshadeInWorker } from '@/lib/geoPdf/hillshadeReliefClient'
import type { PdfImageMosaic } from '@/lib/geoPdf/types'
import type { ContourRelief } from './contourTerrain'
import { reliefSummary } from './hillshadeReliefSummary'
import { decodeMosaicTiles } from './pdfMosaicPixels'

/** The contour surface with its ground between contours read from `mosaic`, and what to record of it. */
export async function refineContourSurface(
  surface: PdfContourSurface,
  mosaic: PdfImageMosaic,
  file: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<{ surface: PdfContourSurface; relief: ContourRelief }> {
  if (!surface.anchors?.length) throw Error('this contour surface was read without its contour points')
  if (surface.method !== 'tin') throw Error('only the triangulated contour surface is refined')
  const pixels = await decodeMosaicTiles(mosaic)
  signal?.throwIfAborted()
  if (!pixels.some(Boolean)) throw Error('the hillshade tiles could not be decoded in this browser')
  const shade = hillshadeOnGrid(mosaic, pixels, surface)
  const result = await refineWithHillshadeInWorker(
    {
      width: surface.width,
      height: surface.height,
      cellM: surface.cellM,
      prior: surface.values,
      shade,
      anchors: surface.anchors,
      intervalM: surface.assignment.interval,
    },
    signal,
    onProgress,
  )
  const relief = reliefSummary(result, file, surface.assignment.interval)
  return {
    surface: { ...surface, values: result.values, notes: [...surface.notes, relief.summary] },
    relief,
  }
}
