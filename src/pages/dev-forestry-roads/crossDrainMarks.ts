/**
 * Plan marks for cross-drain candidates. A drainage run reports each site as a point carrying its
 * chainage span; on the plan it becomes a band along the road over the stretch where flow leaves
 * it, and a tick across the road where a culvert would go. Both are drawn in metres on the
 * ground, so they shrink with the map instead of piling up as dots when zoomed out.
 *
 * Pure: reads the road's calculated stations, never the map.
 */
import { offsetCoordinate } from './engine'
import type { Coordinate, RoadAnalysis, RoadStation } from './types'

/** The band runs this far past a site's first and last outlet, so a one-outlet site still shows. */
export const CROSS_DRAIN_BAND_PAD_M = 15
/** The tick runs this far past each formation edge, across the ditch to where a pipe would end. */
export const CROSS_DRAIN_TICK_PAST_EDGE_M = 4

function stationPose(stations: RoadStation[], chainage: number) {
  let hi = stations.findIndex((s) => s.chainage >= chainage)
  if (hi < 0) hi = stations.length - 1
  const lo = Math.max(0, hi - 1)
  const a = stations[lo],
    b = stations[hi]
  const t = b.chainage > a.chainage ? Math.min(1, Math.max(0, (chainage - a.chainage) / (b.chainage - a.chainage))) : 0
  const near = t < 0.5 ? a : b
  const coordinate: Coordinate = [
    a.coordinate[0] + (b.coordinate[0] - a.coordinate[0]) * t,
    a.coordinate[1] + (b.coordinate[1] - a.coordinate[1]) * t,
  ]
  return { coordinate, bearing: near.bearing, leftWidth: near.leftWidth, rightWidth: near.rightWidth }
}

function centrelineBetween(stations: RoadStation[], from: number, to: number): Coordinate[] {
  const line = [stationPose(stations, from).coordinate]
  for (const s of stations) if (s.chainage > from && s.chainage < to) line.push(s.coordinate)
  line.push(stationPose(stations, to).coordinate)
  return line
}

/**
 * Replace each `low-point` site that carries its chainages with a `cross-drain-band` line and a
 * `cross-drain-tick` line. Every other feature, and a site without chainages, passes through.
 */
export function crossDrainMarks(
  drainage: GeoJSON.FeatureCollection,
  analysis: Pick<RoadAnalysis, 'stations' | 'length'>,
): GeoJSON.FeatureCollection {
  const stations = analysis.stations
  if (stations.length < 2) return drainage
  const features: GeoJSON.Feature[] = []
  for (const feature of drainage.features) {
    const p = feature.properties ?? {}
    const { chainage, fromChainage, toChainage } = p as Record<string, unknown>
    if (
      p.role !== 'low-point' ||
      typeof chainage !== 'number' ||
      typeof fromChainage !== 'number' ||
      typeof toChainage !== 'number'
    ) {
      features.push(feature)
      continue
    }
    const from = Math.max(0, fromChainage - CROSS_DRAIN_BAND_PAD_M),
      to = Math.min(analysis.length, toChainage + CROSS_DRAIN_BAND_PAD_M)
    const shared = { ...p, siteId: p.id }
    if (to > from)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: centrelineBetween(stations, from, to) },
        properties: { ...shared, role: 'cross-drain-band' },
      })
    const pose = stationPose(stations, chainage)
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          offsetCoordinate(pose.coordinate, pose.bearing - 90, pose.leftWidth + CROSS_DRAIN_TICK_PAST_EDGE_M),
          offsetCoordinate(pose.coordinate, pose.bearing + 90, pose.rightWidth + CROSS_DRAIN_TICK_PAST_EDGE_M),
        ],
      },
      properties: { ...shared, role: 'cross-drain-tick', legend: false },
    })
  }
  return { type: 'FeatureCollection', features }
}
