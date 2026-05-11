import { mkdir, writeFile } from 'node:fs/promises'
import simplify from '@turf/simplify'

const OUTPUT_DIR = 'public/data/dev/bc-fwa'
const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub'
const TOLERANCE = Number(process.env.FWA_SIMPLIFY_TOLERANCE ?? '0.002')

const LAYERS = [
  {
    id: 'major_watersheds',
    typeName: 'WHSE_BASEMAPPING.BC_MAJOR_WATERSHEDS',
    codeField: 'OBJECTID',
    nameField: 'MAJOR_WATERSHED_SYSTEM',
    keepFields: ['OBJECTID', 'MAJOR_WATERSHED_CODE', 'MAJOR_WATERSHED_SYSTEM', 'FEATURE_AREA_SQM'],
  },
  {
    id: 'watershed_groups',
    typeName: 'WHSE_BASEMAPPING.FWA_WATERSHED_GROUPS_POLY',
    codeField: 'WATERSHED_GROUP_CODE',
    nameField: 'WATERSHED_GROUP_NAME',
    keepFields: ['OBJECTID', 'WATERSHED_GROUP_ID', 'WATERSHED_GROUP_CODE', 'WATERSHED_GROUP_NAME', 'AREA_HA'],
  },
]

function getWfsUrl(typeName) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: `pub:${typeName}`,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    count: '1000',
  })

  return `${WFS_BASE}/${typeName}/ows?${params.toString()}`
}

function pickProperties(properties, layer) {
  const next = {
    sourceLayer: layer.typeName,
    boundaryCode: String(properties[layer.codeField] ?? '').trim(),
    boundaryName: String(properties[layer.nameField] ?? properties.OBJECTID ?? '').trim(),
  }

  for (const field of layer.keepFields) {
    if (properties[field] !== undefined && properties[field] !== null) {
      next[field] = properties[field]
    }
  }

  return next
}

function normalizeFeature(feature, layer) {
  if (!feature.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) {
    return null
  }

  const normalized = {
    type: 'Feature',
    id: feature.id,
    properties: pickProperties(feature.properties ?? {}, layer),
    geometry: feature.geometry,
  }

  return simplify(normalized, {
    tolerance: TOLERANCE,
    highQuality: false,
    mutate: true,
  })
}

async function syncLayer(layer) {
  const response = await fetch(getWfsUrl(layer.typeName))
  if (!response.ok) {
    throw new Error(`Failed to fetch ${layer.typeName}: ${response.status}`)
  }

  const source = await response.json()
  const features = source.features
    .map((feature) => normalizeFeature(feature, layer))
    .filter((feature) => feature && feature.properties.boundaryCode)

  const collection = {
    type: 'FeatureCollection',
    name: layer.id,
    metadata: {
      source: 'BC Freshwater Atlas / BC Geographic Warehouse',
      sourceLayer: layer.typeName,
      scope: 'Province-wide',
      simplifyTolerance: TOLERANCE,
      generatedAt: new Date().toISOString(),
      numberMatched: source.numberMatched ?? source.totalFeatures ?? features.length,
    },
    features,
  }

  const payload = `${JSON.stringify(collection)}\n`
  await writeFile(`${OUTPUT_DIR}/${layer.id}_province_simplified.geojson`, payload)
  console.log(`${layer.id}: wrote ${features.length} features (${Buffer.byteLength(payload).toLocaleString()} bytes)`)
}

await mkdir(OUTPUT_DIR, { recursive: true })
for (const layer of LAYERS) {
  await syncLayer(layer)
}
