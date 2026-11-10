/**
 * Find the best route's lines on the plan: the roads it found, and where each failed search stopped.
 * Free of DOM access.
 */
import type { RouteStopPart } from './routeSearchStop'
import type { Coordinate } from './types'

export interface RoutePreviewLine {
  id: string
  label: string
  color: string
  selected: boolean
  coordinates: Coordinate[]
  /** Set on the parts of a failed search (`routeSearchStop.ts`); absent on a found road. */
  stop?: RouteStopPart['role']
  /** Called when this part is clicked on the plan, so the row it belongs to can be selected. */
  onSelect?: () => void
}

/**
 * The plan feature for one line. A found road is a `route-comparison` line; a failed search's parts
 * are `route-search-stop`, the stop and the named place as labelled points. `routeLineId` lets a
 * click on the plan find the row again.
 */
export function routePreviewFeature(line: RoutePreviewLine): GeoJSON.Feature {
  const point = line.stop === 'stopped' || line.stop === 'named'
  return {
    type: 'Feature',
    geometry: point
      ? { type: 'Point', coordinates: line.coordinates[0] }
      : { type: 'LineString', coordinates: line.coordinates },
    properties: {
      kind: line.stop ? 'route-search-stop' : 'route-comparison',
      color: line.color,
      selected: line.selected,
      label: line.label,
      routeLineId: line.id,
      ...(line.stop ? { role: line.stop } : {}),
    },
  }
}
