/**
 * The VIA report's maps captured from the plan map: each planned map (`reportMaps.ts`) is taken at its camera from
 * the plan's own canvas (`captureAtCamera`, which puts the reviewer's view back exactly), and the figure drawn over it
 * from sheet operations (`sheetSvg`) is read back as a JPEG. Browser only.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

import { sheetSvg } from '@/lib/mapSheet/renderSvg'

import type { RasterImage } from '@/lib/mapSheet/drawOps'

import { loadElevationGrid } from './demLoader'
import { captureAtCamera, rasterizeSheet } from './mapCapture'
import { composeEndMap, endMapBasemapFromMap, endMapContours, type EndMapBasemap } from './reportEndMap'
import {
  composeReportMap,
  END_MAP_PIXELS,
  OVERVIEW_SHEET_PIXELS,
  type MapFrame,
  type ReportMapFeatures,
  type ReportMapPlan,
} from './reportMaps'
import { demTileRange } from './terrain'
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
  /** The portrait end map's title block: the printed logo (`printedLogoRaster`) and the project line. */
  endMap: { logo: RasterImage | null; project: string | null } = { logo: null, project: null },
): Promise<ReportFigure & { notes?: string[] }> {
  if (plan.endMap) return captureEndMap(map, plan, features, frame, endMap)
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

/**
 * The portrait end map (`reportEndMap.ts`): the key map captured at its regional camera, the sheet's camera captured
 * on the plain vector map while its water, parks, creeks and roads are read from the loaded tiles, and contours traced
 * from the terrain tiles (read at the plan's `demZoom`, alongside the captures) — nothing is added to the map, so
 * there is nothing to put back beyond what `captureAtCamera` restores. The page is drawn at exactly `END_MAP_PIXELS`.
 * What could not be read is drawn without, and said in `notes`.
 */
async function captureEndMap(
  map: MapLibreMap,
  plan: ReportMapPlan,
  features: ReportMapFeatures,
  frame: MapFrame,
  title: { logo: RasterImage | null; project: string | null },
): Promise<ReportFigure & { notes: string[] }> {
  const end = plan.endMap!
  const notes: string[] = []
  const terrain = loadElevationGrid({ range: demTileRange(end.projection.bounds, end.demZoom), concurrency: 6 }).then(
    ({ grid, missingTileCount }) => {
      if (missingTileCount) notes.push(`The end map's contours are missing ${missingTileCount} terrain tile(s).`)
      return grid
    },
    (error: unknown) => {
      notes.push(`The end map has no contours: ${error instanceof Error ? error.message : String(error)}`)
      return null
    },
  )
  const keyShot = await captureAtCamera(map, end.keyMap.camera, end.keyMap.frame, 900).catch((error: unknown) => {
    notes.push(`The end map's key map could not be captured: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })
  let basemap: EndMapBasemap | null = null
  const shot = await captureAtCamera(map, plan.camera, frame, END_MAP_PIXELS.height, (atCamera) => {
    const read = endMapBasemapFromMap(
      atCamera as unknown as Parameters<typeof endMapBasemapFromMap>[0],
      end.projection.bounds,
    )
    if (read.water.length + read.parks.length + read.creeks.length + read.roads.length + read.highways.length)
      basemap = read
  })
  if (!basemap) notes.push('The end map could not read water and roads from the basemap; it is drawn on the map image.')
  const grid = await terrain
  const contours = grid ? endMapContours(end.projection, grid, end.contours) : null
  if (grid && !contours) notes.push('The terrain tiles hold no ground inside the end map, so it has no contours.')
  const composed = composeEndMap({
    plan,
    features,
    basemap,
    contours,
    mapImage: { kind: 'url', url: shot.dataUrl, format: 'JPEG', width: shot.width, height: shot.height },
    keyMapImage: keyShot
      ? { kind: 'url', url: keyShot.dataUrl, format: 'JPEG', width: keyShot.width, height: keyShot.height }
      : null,
    logo: title.logo,
    project: title.project,
    attribution: mapAttribution(map),
  })
  const image = await rasterizeSheet(
    sheetSvg(composed.ops, composed.width, composed.height),
    composed.width,
    composed.height,
    END_MAP_PIXELS.height / composed.height,
  )
  return {
    view: plan.key,
    caption: plan.caption,
    ...image,
    map: { inPicture: true, northUp: true, scale: composed.scale, legend: composed.legendRows },
    notes,
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
