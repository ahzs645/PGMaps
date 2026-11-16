/**
 * The stand profile's strip on the plan map: the rectangle the dialog's side view is cut from
 * (`standProfile`, `prescriptionCharts.ts`), through the stand's centre along the strip's bearing, as
 * long as the trees in it reach. DOM-free.
 */

import { metersPerDegree } from '../visibility'
import { PROFILE_STRIP_WIDTH_M, principalAxisBearing } from './prescriptionCharts'
import type { Stand } from './standTrees'

export type ProfileStripChoice = { bearingDegrees: number | null; widthMeters: number }

export function profileStripPolygon(stand: Stand, choice: ProfileStripChoice): GeoJSON.Polygon | null {
  const trees = stand.trees
  if (trees.length === 0) return null
  const bearing =
    choice.bearingDegrees != null && Number.isFinite(choice.bearingDegrees)
      ? ((choice.bearingDegrees % 180) + 180) % 180
      : principalAxisBearing(trees)
  const width = Math.max(1, choice.widthMeters || PROFILE_STRIP_WIDTH_M)
  let cx = 0
  let cy = 0
  let lng = 0
  let lat = 0
  for (const tree of trees) {
    cx += tree.x
    cy += tree.y
    lng += tree.lng
    lat += tree.lat
  }
  cx /= trees.length
  cy /= trees.length
  lng /= trees.length
  lat /= trees.length
  const radians = (bearing * Math.PI) / 180
  const ax = Math.sin(radians)
  const ay = Math.cos(radians)
  let from = Infinity
  let to = -Infinity
  for (const tree of trees) {
    const dx = tree.x - cx
    const dy = tree.y - cy
    if (Math.abs(dx * ay - dy * ax) > width / 2) continue
    const along = dx * ax + dy * ay
    if (along < from) from = along
    if (along > to) to = along
  }
  if (!Number.isFinite(from)) return null
  const scale = metersPerDegree(lat)
  // Right of the bearing: (ay, −ax) in east/north metres.
  const corner = (along: number, across: number): [number, number] => [
    lng + (along * ax + across * ay) / scale.lng,
    lat + (along * ay - across * ax) / scale.lat,
  ]
  const half = width / 2
  const ring = [corner(from, -half), corner(to, -half), corner(to, half), corner(from, half)]
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
}
