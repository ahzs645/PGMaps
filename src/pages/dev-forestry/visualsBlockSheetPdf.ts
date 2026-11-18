/**
 * Writes the visual quality page's block map sheet as a PDF: the browser half of
 * `visualsBlockSheet.ts`, loaded only when the sheet is written. It reads the terrain tiles for the
 * sheet's frame, takes the imagery for the imagery sheet, and draws the composed sheet with jsPDF
 * through the block-sheet engine, as the road designer's sheet is drawn.
 */
import { IMAGERY_BASEMAP } from '@/lib/forestry/blockSheet/sheets'
import { loadElevationGrid } from '@/lib/forestry/terrain/demLoader'
import { demTileCoordinates } from '@/lib/forestry/terrain/terrain'
import { runCooperatively } from '../dev-forestry-roads/cooperative'
import { buildVisualsSheet, visualsSheetFileName, type VisualsSheetRun } from './visualsBlockSheet'

const CANCELLED = 'Block map sheet cancelled.'

/** The sheet as a file, with what it was written without (`BuiltFile.notes`). */
export async function visualsSheetPdf(run: VisualsSheetRun): Promise<{ blob: Blob; fileName: string; notes?: string }> {
  const { signal } = run
  const built = await buildVisualsSheet(run, {
    loadTerrain: async (range) => {
      const { grid, missingTileCount } = await loadElevationGrid({ range, concurrency: 6, signal })
      // The loader tolerates a failed tile; with none loaded there is no terrain to draw from.
      if (missingTileCount >= demTileCoordinates(range).length) throw Error('no terrain tile could be read')
      return { source: grid, missingTileCount }
    },
    drive: (steps) => runCooperatively(steps, { signal }, CANCELLED),
    captureImagery: async (projection) =>
      (await import('@/lib/mapSheet/printCapture')).captureBasemap(IMAGERY_BASEMAP, projection, signal),
  })
  const [{ encodeSheetImages }, { createSheetPdf, drawSheetPdf }, jspdf] = await Promise.all([
    import('@/lib/mapSheet/png'),
    import('@/lib/mapSheet/renderPdf'),
    import('jspdf'),
  ])
  const ops = await encodeSheetImages(built.sheet.ops)
  if (signal?.aborted) throw new DOMException(CANCELLED, 'AbortError')
  const pdf = createSheetPdf(jspdf, built.sheet.width, built.sheet.height)
  drawSheetPdf(pdf, jspdf, ops)
  const blockName = run.scene.targets.find((target) => target.id === run.settings.block)?.name
  return {
    blob: pdf.output('blob'),
    fileName: visualsSheetFileName(run.settings, blockName),
    ...(built.missing.length ? { notes: built.missing.join(' ') } : {}),
  }
}
