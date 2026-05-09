import { mkdir, writeFile } from 'node:fs/promises'
import simplify from '@turf/simplify'

const OUTPUT_DIR = 'public/data/boundaries/BCNR'
const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub'

const LAYERS = [
  {
    id: 'nr_areas',
    typeName: 'WHSE_ADMIN_BOUNDARIES.ADM_NR_AREAS_SPG',
    sourceLayer: 'WHSE_ADMIN_BOUNDARIES.ADM_NR_AREAS_SPG',
    codeField: 'AREA_NUMBER',
    nameField: 'AREA_NAME',
    keepFields: ['OBJECTID', 'AREA_NUMBER', 'AREA_NAME', 'FEATURE_AREA_SQM'],
    tolerance: 0.01,
  },
  {
    id: 'nr_regions',
    typeName: 'WHSE_ADMIN_BOUNDARIES.ADM_NR_REGIONS_SPG',
    sourceLayer: 'WHSE_ADMIN_BOUNDARIES.ADM_NR_REGIONS_SPG',
    codeField: 'ORG_UNIT',
    nameField: 'REGION_NAME',
    keepFields: ['OBJECTID', 'ORG_UNIT', 'ORG_UNIT_NAME', 'REGION_NAME', 'FEATURE_AREA_SQM'],
    tolerance: 0.008,
  },
  {
    id: 'nr_districts',
    typeName: 'WHSE_ADMIN_BOUNDARIES.ADM_NR_DISTRICTS_SPG',
    sourceLayer: 'WHSE_ADMIN_BOUNDARIES.ADM_NR_DISTRICTS_SPG',
    codeField: 'ORG_UNIT',
    nameField: 'DISTRICT_NAME',
    keepFields: [
      'OBJECTID',
      'ORG_UNIT',
      'ORG_UNIT_NAME',
      'DISTRICT_NAME',
      'REGION_ORG_UNIT',
      'REGION_ORG_UNIT_NAME',
      'FEATURE_AREA_SQM',
    ],
    tolerance: 0.005,
  },
]

function getWfsUrl(typeName) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: `pub:${typeName}`,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
  })

  return `${WFS_BASE}/${typeName}/ows?${params.toString()}`
}

function pickProperties(properties, keepFields, codeField, nameField, sourceLayer) {
  const next = {
    sourceLayer,
    boundaryCode: String(properties[codeField] ?? properties.OBJECTID ?? '').trim(),
    boundaryName: String(properties[nameField] ?? '').trim(),
  }

  for (const field of keepFields) {
    if (properties[field] !== undefined && properties[field] !== null) {
      next[field] = properties[field]
    }
  }

  if (!next.boundaryName) {
    next.boundaryName = next.boundaryCode
  }

  return next
}

function normalizeFeature(feature, layer) {
  if (!feature.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) {
    return null
  }

  const simplified = simplify(feature, {
    tolerance: layer.tolerance,
    highQuality: false,
    mutate: false,
  })

  return {
    type: 'Feature',
    id: feature.id,
    properties: pickProperties(feature.properties ?? {}, layer.keepFields, layer.codeField, layer.nameField, layer.sourceLayer),
    geometry: simplified.geometry,
  }
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
      source: 'BC Geographic Warehouse',
      sourceLayer: layer.sourceLayer,
      coverage: 'BC-wide (administrative boundaries)',
      generatedAt: new Date().toISOString(),
    },
    features,
  }

  await writeFile(`${OUTPUT_DIR}/${layer.id}.geojson`, `${JSON.stringify(collection)}\n`)
  console.log(`${layer.id}: wrote ${features.length} features`)
}

await mkdir(OUTPUT_DIR, { recursive: true })
for (const layer of LAYERS) {
  await syncLayer(layer)
}
