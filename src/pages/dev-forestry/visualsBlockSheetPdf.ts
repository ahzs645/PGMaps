/**
 * Writes the visual quality page's block map sheet: the browser half of `visualsBlockSheet.ts`,
 * loaded only when the sheet is written. It reads the terrain tiles for each sheet's frame, takes
 * the imagery for the imagery sheet, and hands `writeVisualsSheet` the format's writer (jsPDF, or
 * the canvas rasteriser for a PNG; an SVG needs neither) through the block-sheet engine, as the
 * road designer's sheet is written. The PDF is drawn with no brand fonts, as it always was here.
 */
import { IMAGERY_BASEMAP } from '@/lib/forestry/blockSheet/sheets'
import { loadElevationGrid } from '@/lib/forestry/terrain/demLoader'
import { demTileCoordinates } from '@/lib/forestry/terrain/terrain'
import { sheetFile } from '@/lib/mapSheet/sheetFormats'
import { browserSheetFileDeps } from '@/lib/mapSheet/sheetFileDeps'
import { runCooperatively } from '../dev-forestry-roads/cooperative'
import { writeVisualsSheet, type VisualsSheetRun } from './visualsBlockSheet'

const CANCELLED = 'Block map sheet cancelled.'

/**
 * The sheet as a file, with what it was written without (`BuiltFile.notes`). A single sheet also
 * gives `copyPng`: the same drawn sheet as a PNG at `SHEET_PNG_DPI`, for the clipboard, made without
 * building the sheet again. A series' preview is its first sheet and says so (`previewOf`).
 */
export async function visualsSheetFile(
  run: VisualsSheetRun,
  options: { preview?: boolean; onProgress?: (text: string) => void } = {},
): Promise<{
  blob: Blob
  fileName: string
  notes?: string
  previewOf?: string
  copyPng?: () => Promise<Blob>
}> {
  const { signal } = run
  const format = run.settings.output.format
  const written = await writeVisualsSheet(
    run,
    {
      loadTerrain: async (range, pageSignal) => {
        const { grid, missingTileCount } = await loadElevationGrid({
          range,
          concurrency: 6,
          signal: pageSignal ?? signal,
        })
        // The loader tolerates a failed tile; with none loaded there is no terrain to draw from.
        if (missingTileCount >= demTileCoordinates(range).length) throw Error('no terrain tile could be read')
        return { source: grid, missingTileCount }
      },
      drive: (steps) => runCooperatively(steps, { signal }, CANCELLED),
      captureImagery: async (projection) =>
        (await import('@/lib/mapSheet/printCapture')).captureBasemap(IMAGERY_BASEMAP, projection, signal),
      files: await browserSheetFileDeps(format),
    },
    options,
  )
  const sheet = written.sheet
  return {
    blob: written.blob,
    fileName: written.fileName,
    ...(written.notes.length ? { notes: written.notes.join(' ') } : {}),
    ...(written.previewOf ? { previewOf: written.previewOf } : {}),
    ...(sheet
      ? {
          copyPng:
            format === 'png'
              ? async () => written.blob
              : async () => sheetFile(sheet, 'png', await browserSheetFileDeps('png')),
        }
      : {}),
  }
}
