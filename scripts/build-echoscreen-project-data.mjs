// Build the compact vector layers used by the EchoScreen climate-health
// project from canonical bcdatamapper sources.
//
// The derived files live under gitignored public/data paths and are rebuilt
// after every bcdatamapper data sync.

/* global process */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const watershedSourceDirectory = path.join(root, 'vendor/bcdatamapper/datascrapers/bc/boundaries/output/BCFWA')
const watershedOutputPath = path.join(root, 'public/data/boundaries/BCFWA/echoscreen_fraser_nechako.geojson')
const hospitalSourcePath = path.join(
  root,
  'vendor/bcdatamapper/data-sources/healthdata/health_place_registry/health_place_registry.geojson',
)
const hospitalOutputPath = path.join(root, 'public/data/health/echoscreen-northern-health-hospitals.geojson')

const watershedSelections = [
  { namedWatershedId: 11541, name: 'Fraser River', streamOrder: 10 },
  { namedWatershedId: 8886, name: 'Nechako River', streamOrder: 8 },
]

function writeCollection(outputPath, collection) {
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(collection)}\n`)
}

function readSelectedWatershed(selection) {
  const filename = `named_watersheds_stream_order_${selection.streamOrder}_50m.geojson.gz`
  const sourcePath = path.join(watershedSourceDirectory, filename)
  const collection = JSON.parse(gunzipSync(readFileSync(sourcePath)).toString('utf8'))
  const feature = collection.features.find(
    (candidate) => Number(candidate.properties?.namedWatershedId) === selection.namedWatershedId,
  )

  if (!feature) {
    throw new Error(`Missing named watershed ${selection.namedWatershedId} in ${filename}`)
  }
  if (
    feature.properties?.name !== selection.name ||
    Number(feature.properties?.streamOrder) !== selection.streamOrder
  ) {
    throw new Error(
      `Named watershed ${selection.namedWatershedId} no longer matches ${selection.name}, stream order ${selection.streamOrder}`,
    )
  }

  return feature
}

const watershedResult = {
  type: 'FeatureCollection',
  name: 'echoscreen_fraser_nechako',
  metadata: {
    source: 'Government of British Columbia Freshwater Atlas',
    sourceLayer: 'FWA_NAMED_WATERSHEDS_POLY',
    derivation: 'Exact feature selection from 50 metre topology-preserved stream-order shards',
    namedWatershedIds: watershedSelections.map((selection) => selection.namedWatershedId),
  },
  features: watershedSelections.map(readSelectedWatershed),
}

writeCollection(watershedOutputPath, watershedResult)

const watershedSummary = watershedResult.features
  .map(
    (feature) =>
      `${feature.properties.name} ${feature.properties.namedWatershedId} (${feature.properties.areaKm2.toLocaleString()} km²)`,
  )
  .join(', ')
process.stdout.write(`[echoscreen-data] wrote ${path.relative(root, watershedOutputPath)}: ${watershedSummary}\n`)

function hospitalCoordinateKey(feature) {
  return feature.geometry.coordinates.map((coordinate) => Number(coordinate).toFixed(6)).join(',')
}

function hospitalId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const hospitalRegistry = JSON.parse(readFileSync(hospitalSourcePath, 'utf8'))
const hospitalByCoordinate = new Map()

for (const feature of hospitalRegistry.features) {
  const properties = feature.properties ?? {}
  if (feature.geometry?.type !== 'Point') continue
  if (properties.place_type !== 'hospital') continue
  if (!String(properties.source_url ?? '').includes('northernhealth.ca')) continue

  const key = hospitalCoordinateKey(feature)
  const existing = hospitalByCoordinate.get(key)
  const existingVerified = existing?.properties?.verification_status === 'verified'
  const candidateVerified = properties.verification_status === 'verified'
  if (!existing || (candidateVerified && !existingVerified)) hospitalByCoordinate.set(key, feature)
}

const hospitalFeatures = [...hospitalByCoordinate.values()]
  .map((feature) => {
    const properties = feature.properties
    return {
      type: 'Feature',
      properties: {
        id: hospitalId(properties.canonical_name),
        name: properties.canonical_name,
        locality: properties.locality,
        address: properties.address,
        healthAuthority: properties.health_authority ?? 'Northern Health',
        sourceLabel: properties.source_label,
        sourceUrl: properties.source_url,
        verificationStatus: properties.verification_status,
      },
      geometry: feature.geometry,
    }
  })
  .sort((left, right) => left.properties.name.localeCompare(right.properties.name))

if (hospitalFeatures.length !== 18) {
  throw new Error(`Expected 18 unique Northern Health hospitals, found ${hospitalFeatures.length}`)
}

const hospitalResult = {
  type: 'FeatureCollection',
  name: 'echoscreen_northern_health_hospitals',
  metadata: {
    source: 'BC Data Mapper health place registry',
    derivation: 'Northern Health hospital pages, deduplicated by point coordinate',
    features: hospitalFeatures.length,
  },
  features: hospitalFeatures,
}

writeCollection(hospitalOutputPath, hospitalResult)
process.stdout.write(
  `[echoscreen-data] wrote ${path.relative(root, hospitalOutputPath)}: ${hospitalFeatures.length} hospital points\n`,
)
