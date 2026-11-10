/**
 * Builds the D-line sheet for Files → Save & export: gathers the D-line's profile on its own
 * ground, its current support-layout result (checking the saved layout in the cable-layout worker
 * when none is current), its stake-out table and limits, then draws the sheet as a PDF (jsPDF
 * passed in, rasters through `png.ts`) or as an SVG preview. jsPDF loads only when asked for.
 */
import { riggingErrors } from '../cableMechanics'
import { analyzeCableLayout } from '../cableLayout/cableLayoutClient'
import type { CableLayoutResult } from '../cableLayout/cableLayout'
import { layoutLimitRows } from '../cableLayout/limits'
import { DEFAULT_SUPPORT_LAYOUT, layoutRun, savedLayoutToAnalyse, supportLayoutErrors } from '../cableLayout/settings'
import { currentLayoutResult } from '../cableLayout/useCableLayout'
import { analyzeCable } from '../engine'
import { exportGrid } from '../terrain'
import type { CableLine, RoadProject, TerrainSource } from '../types'
import { cableGroundSource, fieldProfileErrors } from './fieldProfile'
import { dLineFrame } from './frame'
import { dLineExtras } from './outputs'
import { buildDLineSheet, type DLineSheetInput } from './sheet'

/** Why the sheet cannot be made for this D-line, or null. Its own invalid inputs refuse it. */
export function dLineSheetUnavailable(line: CableLine | undefined): string | null {
  if (!line) return 'Draw a D-line in Review first.'
  const frame = dLineFrame(line)
  if (!frame) return 'The D-line’s geometry is invalid: correct its ends or insets.'
  if (frame.lengthM < 1) return 'The D-line has no length.'
  if (line.sagModel === 'mechanics' && line.rigging) {
    const rigging = riggingErrors(line.rigging)
    if (rigging.length) return `Correct the D-line’s rigging first. ${rigging[0]}`
    const settings = supportLayoutErrors(line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT)
    if (settings.length) return `Correct the D-line’s support settings first. ${settings[0]}`
  }
  if (line.fieldProfile) {
    const field = fieldProfileErrors(line.fieldProfile)
    if (field.length) return `Correct the D-line’s field profile first. ${field[0]}`
  }
  return null
}

export interface DLineSheetRequest {
  project: RoadProject
  line: CableLine
  terrain: TerrainSource
  issue: DLineSheetInput['issue']
  stamp?: string
  caveat: string
  signal?: AbortSignal
}

/** Everything the sheet draws. Checks the saved layout in the worker when no result is current. */
export async function prepareDLineSheet(request: DLineSheetRequest): Promise<DLineSheetInput> {
  const { project, line, terrain, signal } = request
  const reason = dLineSheetUnavailable(line)
  if (reason) throw Error(reason)
  const ground = cableGroundSource(line, terrain)
  const analysis = analyzeCable(line, ground)
  if (!analysis.samples.length) throw Error('The D-line profile is unavailable.')
  let layout: CableLayoutResult | null = null
  const settings = line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT
  if (line.sagModel === 'mechanics' && line.rigging) {
    layout = currentLayoutResult(line, ground)
    if (!layout && line.supportLayout?.saved) {
      const prepared = layoutRun(line, ground, settings)
      const saved = prepared.ok ? savedLayoutToAnalyse(prepared.run, line.supportLayout.saved) : null
      if (prepared.ok && saved) layout = await analyzeCableLayout(prepared.run.input, saved, { signal })
    }
  }
  signal?.throwIfAborted()
  const frame = dLineFrame(line)!
  const extras = dLineExtras({
    line,
    analysis,
    terrain,
    ground,
    layout,
    grid: exportGrid(project.terrain, frame.yarder),
    riggingSets: project.riggingSets,
  })
  return {
    projectName: project.name,
    line,
    analysis,
    extras,
    limits: extras.layout && line.rigging ? layoutLimitRows(extras.layout, settings, line.rigging.minClearanceM) : null,
    terrain,
    terrainName: project.terrain.name,
    verticalReference: project.terrain.verticalReference,
    issue: request.issue,
    stamp: request.stamp,
    caveat: request.caveat,
  }
}

/** The sheet as a PDF. */
export async function dLineSheetPdf(request: DLineSheetRequest): Promise<Blob> {
  const sheet = buildDLineSheet(await prepareDLineSheet(request))
  const [{ encodeSheetImages }, { createSheetPdf, drawSheetPdf }, jspdf] = await Promise.all([
    import('@/lib/mapSheet/png'),
    import('@/lib/mapSheet/renderPdf'),
    import('jspdf'),
  ])
  const ops = await encodeSheetImages(sheet.ops)
  request.signal?.throwIfAborted()
  const pdf = createSheetPdf(jspdf, sheet.width, sheet.height)
  drawSheetPdf(pdf, jspdf, ops)
  return pdf.output('blob')
}

/** The sheet as an SVG data URL, for the export preview. */
export async function dLineSheetPreview(request: DLineSheetRequest) {
  const sheet = buildDLineSheet(await prepareDLineSheet(request))
  const { sheetSvg } = await import('@/lib/mapSheet/renderSvg')
  const svg = sheetSvg(sheet.ops, sheet.width, sheet.height)
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    width: sheet.width,
    height: sheet.height,
  }
}
