/**
 * The VIA report's maps captured from the plan map: each planned map (`reportMaps.ts`) is taken at its camera from
 * the plan's own canvas (`captureAtCamera`, which puts the reviewer's view back exactly), and the figure drawn over it
 * from sheet operations (`sheetSvg`) is read back as a JPEG. Browser only.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

import { sheetSvg } from '@/lib/mapSheet/renderSvg'

import { captureAtCamera, rasterizeSheet } from './mapCapture'
import {
  composeReportMap,
  OVERVIEW_SHEET_PIXELS,
  type MapFrame,
  type ReportMapFeatures,
  type ReportMapPlan,
} from './reportMaps'
import type { ReportFigure } from './viaReport/model'

/** Longest side of a captured report map, pixels: sharp across a printed page. */
export const REPORT_MAP_MAX_SIDE = 2000

/** The attribution of every source the map is drawing, as plain text. */
export function mapAttribution(map: MapLibreMap): string {
  const sources = map.getStyle()?.sources ?? {}
  const parts = new Set<string>()
  for (const [id, source] of Object.entries(sources)) {
    const text = (source as { attribution?: string }).attribution
    if (!text || !map.getStyle().layers?.some((layer) => 'source' in layer && layer.source === id)) continue
    const plain = text
      .replace(/<[^>]*>/g, '')
      .replace(/&copy;/g, '©')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    if (plain) parts.add(plain)
  }
  return [...parts].join(' · ')
}

/**
 * One planned map: captured at its camera, the figure composed over it, as a report figure. The 11 × 17 sheet is
 * captured at up to its print width and drawn at exactly `OVERVIEW_SHEET_PIXELS` wide, so its furniture is sharp at
 * print size even when the canvas could not be drawn that large.
 */
export async function captureReportMap(
  map: MapLibreMap,
  plan: ReportMapPlan,
  features: ReportMapFeatures,
  frame: MapFrame,
): Promise<ReportFigure> {
  const sheet = plan.kind === 'sheet'
  const shot = await captureAtCamera(map, plan.camera, frame, sheet ? OVERVIEW_SHEET_PIXELS.width : REPORT_MAP_MAX_SIDE)
  const composed = composeReportMap(
    plan,
    features,
    frame,
    { url: shot.dataUrl, width: shot.width, height: shot.height, format: 'JPEG' },
    mapAttribution(map),
  )
  const image = await rasterizeSheet(
    sheetSvg(composed.ops, composed.width, composed.height),
    composed.width,
    composed.height,
    (sheet ? OVERVIEW_SHEET_PIXELS.width : shot.width) / Math.max(1, frame.width),
  )
  return {
    view: plan.key,
    caption: plan.caption,
    ...image,
    // The legend, scale bar and north arrow are drawn on the picture; the rows say what it shows.
    map: { inPicture: true, northUp: true, scale: composed.scale, legend: composed.legendRows },
  }
}

/** Resolves once `ready()` holds, checked every 50 ms; false when `timeoutMs` passes first. */
export function waitUntil(ready: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = performance.now()
    const check = () => {
      if (ready()) resolve(true)
      else if (performance.now() - started > timeoutMs) resolve(false)
      else window.setTimeout(check, 50)
    }
    check()
  })
}
