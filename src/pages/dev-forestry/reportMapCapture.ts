/**
 * The VIA report's maps captured from the plan map: each planned map (`reportMaps.ts`) is taken at its camera from
 * the plan's own canvas (`captureAtCamera`, which puts the reviewer's view back exactly), and the figure drawn over it
 * from sheet operations (`sheetSvg`) is read back as a JPEG. Browser only.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

import { sheetSvg } from '@/lib/mapSheet/renderSvg'

import type { RasterImage } from '@/lib/mapSheet/drawOps'

import { collectPlacesFromMap, type BasemapQueryMap } from './basemapContext'
import { loadElevationGrid } from './demLoader'
import { captureAtCamera, rasterizeSheet } from './mapCapture'
import { composeEndMap, endMapBasemapFromMap, endMapContours, type EndMapBasemap } from './reportEndMap'
import {
  composeReportMap,
  END_MAP_PIXELS,
  figureRegionalLook,
  placeLayerIds,
  regionalTypeScale,
  regionalPlaceLabels,
  regionalForViewpoint,
  regionalWithPlace,
  FIGURE_REGIONAL_PLACE_READ_ZOOM,
  type BasemapLayerInfo,
  type LabelledPlace,
  type BasemapOverride,
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
): Promise<ReportFigure & { notes?: string[]; byViewpoint?: Record<string, ReportFigure> }> {
  if (plan.endMap) return captureEndMap(map, plan, features, frame, endMap)
  const sheet = plan.kind === 'sheet'
  const maxSide = sheet ? OVERVIEW_SHEET_PIXELS.width : REPORT_MAP_MAX_SIDE
  // 26's regional map is read as a road map: its look goes on the basemap for the capture alone, and comes off after.
  // It reads the place names drawn across the whole canvas at its camera, and is taken again to take in the nearest
  // one when that lies outside its frame (`regionalWithPlace`).
  const regional = plan.style === 'figure-page' && plan.kind === 'regional'
  const layers = (map.getStyle()?.layers ?? []) as BasemapLayerInfo[]
  const restore = regional
    ? applyBasemapOverrides(map, figureRegionalLook(layers, regionalTypeScale(frame.width)))
    : null
  let shot: Awaited<ReturnType<typeof captureAtCamera>>
  try {
    let drawn: LabelledPlace[] = []
    let known: LabelledPlace[] = []
    const placeLayers = regional ? placeLayerIds(layers).filter((id) => map.getLayer(id)) : []
    const readPlaces = (atCamera: MapLibreMap) => {
      if (placeLayers.length) drawn = drawnPlaces(atCamera, placeLayers)
      known = [...known, ...settlementsInTiles(atCamera)]
    }
    // The settlements the regional camera's own tiles leave out (hamlets come only from zoom 12), read at a closer
    // camera over the same centre, taken small: only its tiles are wanted.
    if (regional && plan.camera.zoom < FIGURE_REGIONAL_PLACE_READ_ZOOM)
      await captureAtCamera(
        map,
        { center: plan.camera.center, zoom: FIGURE_REGIONAL_PLACE_READ_ZOOM },
        frame,
        64,
        (atCamera) => (known = settlementsInTiles(atCamera)),
      ).catch(() => null)
    shot = await captureAtCamera(map, plan.camera, frame, maxSide, regional ? readPlaces : undefined)
    const fitted = regional ? regionalWithPlace(plan, [...drawn, ...known], features.viewpoints.length) : plan
    if (fitted !== plan) {
      plan = fitted
      shot = await captureAtCamera(map, plan.camera, frame, maxSide, readPlaces)
    }
    if (regional)
      plan = {
        ...plan,
        places: regionalPlaceLabels(
          plan,
          [...drawn, ...known],
          drawn.map((place) => place.name),
        ),
      }
  } finally {
    restore?.()
  }
  const attribution = mapAttribution(map)
  const figureOf = async (drawn: ReportMapPlan): Promise<ReportFigure> => {
    const composed = composeReportMap(
      drawn,
      features,
      frame,
      { url: shot.dataUrl, width: shot.width, height: shot.height, format: 'JPEG' },
      attribution,
    )
    const image = await rasterizeSheet(
      sheetSvg(composed.ops, composed.width, composed.height),
      composed.width,
      composed.height,
      (sheet ? OVERVIEW_SHEET_PIXELS.width : shot.width) / Math.max(1, frame.width),
    )
    return {
      view: drawn.key,
      caption: drawn.caption,
      ...image,
      // The legend, scale bar and north arrow are drawn on the picture; the rows say what it shows.
      map: { inPicture: true, northUp: true, scale: composed.scale, legend: composed.legendRows },
    }
  }
  const figure = await figureOf(plan)
  // 26's figure pages each star their own viewpoint: with several, the same capture is drawn once per viewpoint.
  if (!regional || features.viewpoints.length < 2) return figure
  const byViewpoint: Record<string, ReportFigure> = {}
  for (const viewpoint of features.viewpoints)
    byViewpoint[viewpoint.name] = await figureOf(regionalForViewpoint(plan, viewpoint))
  return { ...figure, byViewpoint }
}

/** The settlements the map's loaded vector tiles name (`collectPlacesFromMap`), drawn or not. */
function settlementsInTiles(map: MapLibreMap): LabelledPlace[] {
  try {
    return collectPlacesFromMap(map as unknown as BasemapQueryMap)
      .filter((place) => place.kind === 'settlement')
      .map((place) => ({ name: place.name, lng: place.lngLat[0], lat: place.lngLat[1] }))
  } catch {
    return []
  }
}

/** The place names the map has drawn on its canvas from `layers`, once each. */
function drawnPlaces(map: MapLibreMap, layers: string[]): LabelledPlace[] {
  const seen = new Set<string>()
  const places: LabelledPlace[] = []
  for (const feature of map.queryRenderedFeatures({ layers })) {
    const name = String(feature.properties?.name ?? '')
    if (!name || seen.has(name) || feature.geometry.type !== 'Point') continue
    seen.add(name)
    const [lng, lat] = feature.geometry.coordinates
    places.push({ name, lng, lat })
  }
  return places
}

/**
 * Sets each override on the map's own basemap layers and returns what puts every one back as it was: a paint property
 * the style left unset goes back to unset, a zoom range to the layer's own.
 */
function applyBasemapOverrides(map: MapLibreMap, overrides: readonly BasemapOverride[]): () => void {
  const undo: Array<() => void> = []
  for (const change of overrides) {
    const layer = map.getLayer(change.id)
    if (!layer) continue
    if (change.kind === 'paint') {
      const property = change.property as Parameters<MapLibreMap['setPaintProperty']>[1]
      const before = map.getPaintProperty(change.id, property) as Parameters<MapLibreMap['setPaintProperty']>[2]
      map.setPaintProperty(change.id, property, change.value)
      undo.push(() => map.setPaintProperty(change.id, property, before))
    } else if (change.kind === 'layout') {
      const property = change.property as Parameters<MapLibreMap['setLayoutProperty']>[1]
      const before = map.getLayoutProperty(change.id, property) as Parameters<MapLibreMap['setLayoutProperty']>[2]
      map.setLayoutProperty(change.id, property, change.value)
      undo.push(() => map.setLayoutProperty(change.id, property, before))
    } else {
      const { minzoom = 0, maxzoom = 24 } = layer
      map.setLayerZoomRange(change.id, change.minzoom, change.maxzoom)
      undo.push(() => map.setLayerZoomRange(change.id, minzoom, maxzoom))
    }
  }
  return () => {
    for (const step of undo.reverse()) if (map.getStyle()) step()
    map.triggerRepaint()
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
