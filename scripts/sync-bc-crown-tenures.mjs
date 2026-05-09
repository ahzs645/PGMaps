import { mkdir, writeFile } from 'node:fs/promises'
import bboxClip from '@turf/bbox-clip'
import simplify from '@turf/simplify'

const OUTPUT_DIR = 'public/data/boundaries/BCTantalis'
const WFS_BASE = 'https://openmaps.gov.bc.ca/geo/pub'
const PG_REGION_BBOX = [-125, 52.5, -120, 55.5]

// Excludes historical conveyances (Crown grants) and replaced/expired/completed
// records per the BC Data Catalogue description for TA_CROWN_TENURES_SVW.
const LAYER = {
  id: 'crown_tenures',
  typeName: 'WHSE_TANTALIS.TA_CROWN_TENURES_SVW',
  sourceLayer: 'WHSE_TANTALIS.TA_CROWN_TENURES_SVW',
  geomField: 'SHAPE',
  cqlFilter: "TENURE_STAGE='TENURE'",
  keepFields: [
    'OBJECTID',
    'INTRID_SID',
    'CROWN_LANDS_FILE',
    'TENURE_STAGE',
    'TENURE_STATUS',
    'TENURE_TYPE',
    'TENURE_SUBTYPE',
    'TENURE_PURPOSE',
    'TENURE_SUBPURPOSE',
    'TENURE_LOCATION',
    'TENURE_AREA_IN_HECTARES',
    'TENURE_EXPIRY',
    'RESPONSIBLE_BUSINESS_UNIT',
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
    maxFeatures: '20000',
    CQL_FILTER: cqlFilter,
  })

  return `${WFS_BASE}/${layer.typeName}/ows?${params.toString()}`
}

function pickProperties(properties, keepFields, sourceLayer) {
  const code = String(properties.INTRID_SID ?? properties.CROWN_LANDS_FILE ?? properties.OBJECTID ?? '').trim()

  const tenureType = String(properties.TENURE_TYPE ?? '').trim()
  const tenurePurpose = String(properties.TENURE_PURPOSE ?? '').trim()
  const tenureLocation = String(properties.TENURE_LOCATION ?? '').trim()
  const file = String(properties.CROWN_LANDS_FILE ?? '').trim()
  const labelParts = []
  if (file) labelParts.push(file)
  if (tenureType) labelParts.push(tenureType)
  if (tenurePurpose) labelParts.push(tenurePurpose.toLowerCase())
  if (tenureLocation) labelParts.push(`(${tenureLocation})`)

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
    // Fall back to the clipped (unsimplified) geometry rather than dropping.
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
      source: 'BC Geographic Warehouse / TANTALIS',
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
