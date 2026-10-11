import { contours } from 'd3'
import { lngLatToMercator, mercatorToLngLat } from '../dev-forestry/terrain'
import { VIEWSHED_COLORS, type ViewshedResult } from './model'
import type { OverlayMode } from './ViewshedOverlay'

/** Trace visible cells, including occluded holes, into a terrain-draped boundary. */
export function visibilityOutline(result: ViewshedResult | null, mode: OverlayMode): GeoJSON.FeatureCollection {
  if (!result) return { type: 'FeatureCollection', features: [] }
  const nw = lngLatToMercator(result.bounds[0], result.bounds[3])
  const se = lngLatToMercator(result.bounds[2], result.bounds[1])
  const groups = mode === 'compare' ? [2, 3, 4] : [mode === 'seated' ? 2 : 3]
  return {
    type: 'FeatureCollection',
    features: groups.flatMap((group) => {
      const values = Array.from(result.cells, (cell) =>
        mode === 'compare' ? Number(cell === group) : Number(cell === group || cell === 4),
      )
      const shape = contours().size([result.size, result.size]).thresholds([0.5])(values)[0]
      if (!shape.coordinates.length) return []
      return [
        {
          type: 'Feature' as const,
          properties: {
            color:
              mode !== 'compare'
                ? VIEWSHED_COLORS.visible
                : group === 4
                  ? VIEWSHED_COLORS.both
                  : group === 2
                    ? VIEWSHED_COLORS.aOnly
                    : VIEWSHED_COLORS.bOnly,
          },
          geometry: {
            type: 'MultiPolygon' as const,
            coordinates: shape.coordinates.map((polygon) =>
              polygon.map((ring) =>
                ring.map(([x, y]) =>
                  mercatorToLngLat(
                    nw[0] + (x / result.size) * (se[0] - nw[0]),
                    nw[1] + (y / result.size) * (se[1] - nw[1]),
                  ),
                ),
              ),
            ),
          },
        },
      ]
    }),
  }
}

/** Visible, unknown, and optionally hidden regions for MapLibre's native terrain fill. */
export function visibilityAreas(
  result: ViewshedResult | null,
  mode: OverlayMode,
  showHidden: boolean,
): GeoJSON.FeatureCollection {
  const areas = visibilityOutline(result, mode)
  if (!result) return areas
  for (const [cell, color] of [[5, VIEWSHED_COLORS.unknown], ...(showHidden ? [[1, VIEWSHED_COLORS.hidden]] : [])] as [
    number,
    string,
  ][]) {
    const mask = { ...result, cells: Uint8Array.from(result.cells, (value) => (value === cell ? 4 : 0)) }
    const shape = visibilityOutline(mask, 'standing')
    for (const feature of shape.features) {
      feature.properties = { color }
      areas.features.push(feature)
    }
  }
  for (const feature of areas.features)
    feature.properties = { ...feature.properties, size: result.size, bounds: result.bounds }
  return areas
}
