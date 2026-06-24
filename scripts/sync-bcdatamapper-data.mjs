import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = join(root, 'vendor', 'bcdatamapper')
const target = join(root, 'public', 'data')
const clean = process.argv.includes('--clean')

const contentMappings = [
  ['datascrapers/air/output', '.'],
  ['datascrapers/bc/boundaries/output', 'boundaries'],
  ['datascrapers/bc/tenures/output', 'boundaries'],
]

const pathMappings = [
  ['datascrapers/manual/output/acknowledgement', 'acknowledgement'],
  ['datascrapers/manual/output/indicators', 'indicators'],
  ['data-sources/healthdata/bc_wait_times/output/bc-wait-specialists.json', 'bc-wait-specialists.json'],
  ['data-sources/healthdata/erstat/output/erstat-hospitals.json', 'erstat-hospitals.json'],
  ['data-sources/healthdata/health_place_registry/health_place_registry.csv', 'health/health-place-registry.csv'],
  ['data-sources/healthdata/health_place_registry/health_place_registry.geojson', 'health/health-place-registry.geojson'],
  ['data-sources/healthdata/health_place_registry/health_place_sites.csv', 'health/health-place-sites.csv'],
  ['data-sources/healthdata/health_place_registry/health_place_sites.geojson', 'health/health-place-sites.geojson'],
  ['data-sources/healthdata/statcan_odhf/output/statcan-odhf-bc.csv', 'health/statcan-odhf-bc.csv'],
  ['data-sources/healthdata/statcan_odhf/output/statcan-odhf-bc.geojson', 'health/statcan-odhf-bc.geojson'],
  ['datascrapers/fallout/output', 'fallout'],
  ['datascrapers/citypg/output', 'citypg'],
  ['datascrapers/citypg/output-boundaries/CityPG', 'boundaries/CityPG'],
  ['datascrapers/bc/drought/output', 'drought'],
  ['datascrapers/bc/assessment/output', 'bc-assessment'],
  ['datascrapers/census/output', 'census'],
  ['datascrapers/transit/output', 'transit'],
  ['datascrapers/icbc/output', 'icbc'],
  ['datascrapers/bc/wars/output', 'wars'],
  ['datascrapers/ev-charging/output', 'ev-charging'],
  ['datascrapers/network-availability/output', 'network-availability'],
  ['datascrapers/cell-coverage/output', 'cell-coverage'],
  ['datascrapers/healthyplan-pg/output', 'healthyplan-pg'],
  ['datascrapers/heat-shade/output', 'heat-shade'],
  ['datascrapers/eccc/output', 'aqmap'],
  ['datascrapers/citypg/source/heat-shade/citypg_trees.geojson', 'heat-shade/citypg_trees.geojson'],
  ['datascrapers/citypg/source/heat-shade/citypg_park_open_spaces.geojson', 'heat-shade/citypg_park_open_spaces.geojson'],
  ['datascrapers/citypg/source/heat-shade/citypg_intact_forest.geojson', 'heat-shade/citypg_intact_forest.geojson'],
  ['datascrapers/citypg/source/heat-shade/citypg_community_forests.geojson', 'heat-shade/citypg_community_forests.geojson'],
  ['datascrapers/citypg/source/heat-shade/citypg_community_facility.geojson', 'heat-shade/citypg_community_facility.geojson'],
  ['datascrapers/citypg/source/heat-shade/citypg_response_facilities.geojson', 'heat-shade/citypg_response_facilities.geojson'],
  ['datascrapers/walkability/output', 'walkability'],
  ['datascrapers/walkability/source', 'walkability/source'],
  ['datascrapers/citypg/source/public_gis', 'walkability/source/data/public_gis'],
  ['datascrapers/walkability/source/data/supplemental/osm_crossings.geojson', 'walkability/supplemental/osm_crossings.geojson'],
  ['datascrapers/walkability/source/data/supplemental/osm_daycares.geojson', 'walkability/supplemental/osm_daycares.geojson'],
  ['datascrapers/bc/childcare/output/bc_childcare_locations.geojson', 'walkability/source/data/supplemental/bc_childcare_locations.geojson'],
  ['datascrapers/bc/childcare/output/bc_childcare_locations.geojson', 'walkability/supplemental/bc_childcare_locations.geojson'],
  ['datascrapers/transit/source/intercity_bus_stops.geojson', 'walkability/source/data/supplemental/intercity_bus_stops.geojson'],
  ['datascrapers/transit/source/intercity_bus_stops.geojson', 'walkability/supplemental/intercity_bus_stops.geojson'],
  ['datascrapers/transit/source/bc_transit_pg_stops.geojson', 'walkability/source/data/supplemental/bc_transit_pg_stops.geojson'],
  ['datascrapers/walkability/source/data/supplemental/report_class3_crosswalks_geocoded.geojson', 'walkability/supplemental/report_class3_crosswalks_geocoded.geojson'],
  ['datascrapers/walkability/source/mobility_reconstruction/missing_poi_supplement.geojson', 'walkability/supplemental/missing_poi_supplement.geojson'],
  ['datascrapers/walkability/source/mobility_reconstruction/public_mobility_index_asset_scores.csv', 'walkability/assets/public_mobility_index_asset_scores.csv'],
  ['datascrapers/walkability/source/mobility_reconstruction/prioritization/asset_priority_ranked.csv', 'walkability/assets/asset_priority_ranked.csv'],
  ['datascrapers/walkability/source/mobility_reconstruction/prioritization/asset_priority_with_costs.csv', 'walkability/assets/asset_priority_with_costs.csv'],
  ['datascrapers/bc/flood/output', 'flood'],
  ['datascrapers/food-health/output/water', 'water'],
  ['datascrapers/food-health/output/geocoding', 'geocoding'],
  ['datascrapers/food-health/output/restaurants.json', 'restaurants.json'],
  ['datascrapers/food-health/output/restaurant-classifications.json', 'restaurant-classifications.json'],
  ['datascrapers/food-health/output/restaurant-location-overrides.json', 'restaurant-location-overrides.json'],
  ['datascrapers/bc/indigenous/snapshot', 'indigenous'],
  // Only the geojson map layers — not the multi-MB scraper state (nuxt-state.json, grants, source html).
  ['datascrapers/fpcc/output/language-geo.geojson', 'fpcc/language-geo.geojson'],
  ['datascrapers/fpcc/output/community-geo.geojson', 'fpcc/community-geo.geojson'],
  ['datascrapers/fpcc/output/placename-geo.geojson', 'fpcc/placename-geo.geojson'],
  ['datascrapers/native-land/snapshot', 'native-land'],
]

const skippedSourcePaths = new Set([
  // The walkability snapshot can contain an older childcare supplement. The
  // authoritative BC childcare scraper output is copied to the same public path
  // later in pathMappings.
  'datascrapers/walkability/output/supplemental/bc_childcare_locations.geojson',
])

if (process.env.PGMAPS_SKIP_VENDOR_DATA_SYNC === '1') {
  console.log('[data] skipped bcdatamapper data sync')
  process.exit(0)
}

if (clean && existsSync(target)) {
  rmSync(target, { recursive: true, force: true })
}

function copyPath(sourceRelative, targetRelative) {
  const source = join(vendorRoot, sourceRelative)
  const destination = join(target, targetRelative)

  if (!existsSync(source)) {
    console.error(`[data] Missing ${relative(root, source)}`)
    process.exit(1)
  }

  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (sourcePath) => !skippedSourcePaths.has(relative(vendorRoot, sourcePath)),
  })
}

function copyContents(sourceRelative, targetRelative) {
  const source = join(vendorRoot, sourceRelative)
  const destination = join(target, targetRelative)

  if (!existsSync(source)) {
    console.error(`[data] Missing ${relative(root, source)}`)
    process.exit(1)
  }

  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source)) {
    copyPath(join(sourceRelative, entry), join(targetRelative, entry))
  }
}

for (const [sourceRelative, targetRelative] of contentMappings) {
  copyContents(sourceRelative, targetRelative)
}

for (const [sourceRelative, targetRelative] of pathMappings) {
  copyPath(sourceRelative, targetRelative)
}

const staleAqmapExperimentPaths = [
  'modelled-pm25-example.geojson.gz',
  'modelled-pm25-example.grid.json.gz',
  'modelled-pm25-wms-stitch-vector.geojson.gz',
  'modelled-pm25-vector-tiles',
]
for (const stalePath of staleAqmapExperimentPaths) {
  rmSync(join(target, 'aqmap', stalePath), { recursive: true, force: true })
}

const pm25RasterArchive = join(target, 'aqmap', 'modelled-pm25-raster-tiles.tar.gz')
const pm25RasterTiles = join(target, 'aqmap', 'modelled-pm25-raster-tiles')
if (existsSync(pm25RasterArchive)) {
  rmSync(pm25RasterTiles, { recursive: true, force: true })
  mkdirSync(pm25RasterTiles, { recursive: true })
  execFileSync('tar', ['-xUzf', pm25RasterArchive, '-C', pm25RasterTiles], { stdio: 'inherit' })
}

console.log(`[data] assembled bcdatamapper scraper outputs -> ${relative(root, target)}`)
