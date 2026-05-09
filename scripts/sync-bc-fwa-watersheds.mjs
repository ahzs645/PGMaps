import { mkdir, writeFile } from 'node:fs/promises'
import bboxClip from '@turf/bbox-clip'
import simplify from '@turf/simplify'

const OUTPUT_DIR = 'public/data/boundaries/BCFWA'
const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub'
const PG_REGION_BBOX = [-125, 52.5, -120, 55.5]

const LAYERS = [
  {
    id: 'major_watersheds',
    typeName: 'WHSE_BASEMAPPING.BC_MAJOR_WATERSHEDS',
    sourceLayer: 'WHSE_BASEMAPPING.BC_MAJOR_WATERSHEDS',
    codeField: 'MAJOR_WATERSHED_CODE',
    nameField: 'MAJOR_WATERSHED_SYSTEM',
    keepFields: ['OBJECTID', 'MAJOR_WATERSHED_CODE', 'MAJOR_WATERSHED_SYSTEM', 'FEATURE_AREA_SQM'],
    tolerance: 0.006,
  },
  {
    id: 'watershed_groups',
    typeName: 'WHSE_BASEMAPPING.FWA_WATERSHED_GROUPS_POLY',
    sourceLayer: 'WHSE_BASEMAPPING.FWA_WATERSHED_GROUPS_POLY',
    codeField: 'WATERSHED_GROUP_CODE',
    nameField: 'WATERSHED_GROUP_NAME',
    keepFields: ['OBJECTID', 'WATERSHED_GROUP_ID', 'WATERSHED_GROUP_CODE', 'WATERSHED_GROUP_NAME', 'AREA_HA'],
    tolerance: 0.004,
  },
  {
    id: 'assessment_watersheds',
    typeName: 'WHSE_BASEMAPPING.FWA_ASSESSMENT_WATERSHEDS_POLY',
    sourceLayer: 'WHSE_BASEMAPPING.FWA_ASSESSMENT_WATERSHEDS_POLY',
    codeField: 'WATERSHED_FEATURE_ID',
    nameField: 'GNIS_NAME_1',
    keepFields: [
      'OBJECTID',
      'WATERSHED_FEATURE_ID',
      'WATERSHED_GROUP_ID',
      'WATERSHED_GROUP_CODE',
      'GNIS_NAME_1',
      'GNIS_NAME_2',
      'GNIS_NAME_3',
      'FWA_WATERSHED_CODE',
      'LOCAL_WATERSHED_CODE',
      'AREA_HA',
    ],
    tolerance: 0.002,
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
    bbox: `${PG_REGION_BBOX.join(',')},EPSG:4326`,
  })

  return `${WFS_BASE}/${typeName}/ows?${params.toString()}`
}

function pickProperties(properties, keepFields, codeField, nameField, sourceLayer) {
  const next = {
    sourceLayer,
    boundaryCode: String(properties[codeField] ?? properties.OBJECTID ?? '').trim(),
    boundaryName: String(properties[nameField] ?? properties.GNIS_NAME_2 ?? properties.GNIS_NAME_3 ?? '').trim(),
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

  let clipped
  try {
    clipped = bboxClip(feature, PG_REGION_BBOX)
  } catch {
    return null
  }

  if (!clipped.geometry) return null

  const simplified = simplify(clipped, {
    tolerance: layer.tolerance,
    highQuality: false,
    mutate: true,
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
      source: 'BC Freshwater Atlas / BC Geographic Warehouse',
      sourceLayer: layer.sourceLayer,
      bbox: PG_REGION_BBOX,
      clippedTo: 'Prince George regional viewport',
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
