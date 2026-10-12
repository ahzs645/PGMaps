import { MAX_ROAD_OBSERVERS } from '@/features/terrain-viewshed/combined'
import { roadPlacement, type RoadVertex } from './driveMath'

/** Include both selected endpoints, follow every bend, and bound the sightline budget. */
export function roadViewshedSelection(path: readonly RoadVertex[], start: number, end: number) {
  const length = path.at(-1)?.distanceAlongMeters ?? 0
  const from = Math.max(0, Math.min(length, start)),
    to = Math.max(from, Math.min(length, end))
  const segments = Math.max(1, Math.min(MAX_ROAD_OBSERVERS - 1, Math.ceil((to - from) / 100)))
  const spacing = (to - from) / segments
  const stations = Array.from(
    { length: to > from ? segments + 1 : 1 },
    (_, i) => roadPlacement(path, i === segments ? to : from + i * spacing)!,
  ).filter(Boolean)
  const first = roadPlacement(path, from),
    last = roadPlacement(path, to)
  const coordinates: [number, number][] =
    first && last
      ? [first, ...path.filter((p) => p.distanceAlongMeters > from && p.distanceAlongMeters < to), last].map((p) => [
          p.lng,
          p.lat,
        ])
      : []
  return { stations, spacing, from, to, coordinates }
}
