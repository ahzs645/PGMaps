/**
 * Convert the KML-derived MU 7-42 planning GeoJSON (produced by
 * `npm run outdoors:kml:import` in vendor/bcdatamapper) into the bundled
 * sample plan shown by the /dev/outdoors planner.
 *
 * Usage: npx tsx scripts/generate-outdoors-sample-plan.ts [input.geojson]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { planFromGeoJson, type OutdoorsPlan } from '../src/maps/outdoors/plan'

const repoRoot = path.resolve(import.meta.dirname, '..')
const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'build/bc-outdoors-plans/mu-7-42/plan.geojson')
const outputPath = path.join(repoRoot, 'src/maps/outdoors/sample-plan-mu-7-42.json')

const result = planFromGeoJson(JSON.parse(readFileSync(inputPath, 'utf8')))
if (!result) {
  console.error(`No plan features found in ${inputPath}`)
  process.exit(1)
}

const { plan } = result
plan.name = 'MU 7-42 field plan (sample)'
plan.activity = 'hunt'
plan.species = 'Elk'
plan.notes =
  'Sample plan converted from a field-planning KML for MU 7-42: vehicle closures, ' +
  'designated corridors, the LEH area, navigable water, launches, and candidate access points. ' +
  'Personal features are examples, not scouting advice — verify closures and seasons in the ' +
  'official regulations.'
plan.wmus = [{ id: '7-42', name: 'Management Unit 7-42' }]

// Frame the opening view on the trip's focal cluster (the waypoints) rather
// than the full extent — the Muskwa-Kechika closure polygon alone spans half
// of northeast BC and would zoom the sample out to a region-scale view.
const lngs: number[] = []
const lats: number[] = []
const collect = ([lng, lat]: [number, number]) => {
  lngs.push(lng)
  lats.push(lat)
}
if (plan.waypoints.length > 0) {
  plan.waypoints.forEach((waypoint) => collect([waypoint.lng, waypoint.lat]))
} else {
  plan.routes.forEach((route) => route.coordinates.forEach(collect))
  plan.areas.forEach((area) => area.rings.forEach((ring) => ring.forEach(collect)))
}

const lngSpan = Math.max(...lngs) - Math.min(...lngs)
const latSpan = Math.max(...lats) - Math.min(...lats)
// Rough fit for the planner's default 16:9-ish map pane, with margin.
const zoom = Math.min(
  Math.log2(360 / (lngSpan * 1.6)),
  Math.log2(180 / (latSpan * 1.6)),
)
plan.viewport = {
  center: [
    Math.round(((Math.min(...lngs) + Math.max(...lngs)) / 2) * 1e5) / 1e5,
    Math.round(((Math.min(...lats) + Math.max(...lats)) / 2) * 1e5) / 1e5,
  ],
  zoom: Math.round(Math.min(Math.max(zoom, 4), 12) * 100) / 100,
}

const json = `${JSON.stringify(plan satisfies OutdoorsPlan)}\n`
writeFileSync(outputPath, json)
console.log(
  `Wrote ${outputPath} (${(json.length / 1024).toFixed(1)} KB): ` +
    `${plan.waypoints.length} waypoints, ${plan.routes.length} routes, ${plan.areas.length} areas, ` +
    `${result.skippedCount} source features skipped`,
)
