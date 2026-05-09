import { mkdir, writeFile } from 'node:fs/promises'
import bboxClip from '@turf/bbox-clip'
import simplify from '@turf/simplify'

const OUTPUT_DIR = 'public/data/boundaries/BCMineral'
const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub'
const PG_REGION_BBOX = [-125, 52.5, -120, 55.5]

const LAYER = {
  id: 'mineral_tenures',
  typeName: 'WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
  sourceLayer: 'WHSE_MINERAL_TENURE.MTA_ACQUIRED_TENURE_SVW',
  geomField: 'GEOMETRY',
  cqlFilter: 'TERMINATION_DATE IS NULL',
  keepFields: [
    'OBJECTID',
    'TENURE_NUMBER_ID',
    'CLAIM_NAME',
    'TENURE_TYPE_CODE',
    'TENURE_TYPE_DESCRIPTION',
    'TENURE_SUB_TYPE_CODE',
    'TENURE_SUB_TYPE_DESCRIPTION',
    'TITLE_TYPE_CODE',
    'TITLE_TYPE_DESCRIPTION',
    'ISSUE_DATE',
    'GOOD_TO_DATE',
    'AREA_IN_HECTARES',
    'OWNER_NAME',
    'NUMBER_OF_OWNERS',
  ],
  tolerance: 0.0008,
}

function getWfsUrl(layer) {
  // BCGW WFS rejects bbox + CQL_FILTER together, so fold the bbox into the
  // filter using the 6-arg BBOX form (default CRS is the layer's native BC
  // Albers, so the EPSG:4326 hint is required).
  const bboxClause = `BBOX(${layer.geomField},${PG_REGION_BBOX.join(',')},'EPSG:4326')`
  const cqlFilter = layer.cqlFilter ? `(${layer.cqlFilter}) AND ${bboxClause}` : bboxClause

  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: `pub:${layer.typeName}`,
    outputFormat: 'json',
    srsName: 'EPSG:4326',
    maxFeatures: '30000',
    CQL_FILTER: cqlFilter,
  })

  return `${WFS_BASE}/${layer.typeName}/ows?${params.toString()}`
}

function pickProperties(properties, keepFields, sourceLayer) {
  const code = String(properties.TENURE_NUMBER_ID ?? properties.OBJECTID ?? '').trim()

  const tenureType = String(properties.TENURE_TYPE_DESCRIPTION ?? '').trim()
  const subType = String(properties.TENURE_SUB_TYPE_DESCRIPTION ?? '').trim()
  const claimName = String(properties.CLAIM_NAME ?? '').trim()
  const labelParts = [`#${code}`]
  if (tenureType) labelParts.push(tenureType)
  if (subType) labelParts.push(subType.toLowerCase())
  if (claimName) labelParts.push(claimName)

  const next = {
    sourceLayer,
    boundaryCode: code,
    boundaryName: labelParts.join(' · ') || code,
  }

  for (const field of keepFields) {
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

  let clipped
  try {
    clipped = bboxClip(feature, PG_REGION_BBOX)
  } catch {
    return null
  }

  if (!clipped.geometry) return null

  let simplifiedGeometry = clipped.geometry
  try {
    const simplified = simplify(clipped, {
      tolerance: layer.tolerance,
      highQuality: false,
      mutate: true,
    })
    simplifiedGeometry = simplified.geometry
  } catch {
    // Some BCGW polygons have degenerate rings that turf.simplify rejects.
  }

  return {
    type: 'Feature',
    id: feature.id,
    properties: pickProperties(feature.properties ?? {}, layer.keepFields, layer.sourceLayer),
    geometry: simplifiedGeometry,
  }
}

async function syncLayer(layer) {
  const response = await fetch(getWfsUrl(layer))
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
      source: 'BC Geographic Warehouse / Mineral Titles Online',
      sourceLayer: layer.sourceLayer,
      bbox: PG_REGION_BBOX,
      clippedTo: 'Prince George regional viewport',
      cqlFilter: layer.cqlFilter ?? null,
      generatedAt: new Date().toISOString(),
    },
    features,
  }

  await writeFile(`${OUTPUT_DIR}/${layer.id}.geojson`, `${JSON.stringify(collection)}\n`)
  console.log(`${layer.id}: wrote ${features.length} features`)
}

await mkdir(OUTPUT_DIR, { recursive: true })
await syncLayer(LAYER)
