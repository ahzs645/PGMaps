#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { PMTiles, SharedPromiseCache } from 'pmtiles'
import RBush from 'rbush'

const DEFAULT_CATALOG = '/Volumes/Main/canue-pmtiles-bc-v2/canue-bc-grid-v2-app-catalog.json'
const DEFAULT_PMTILES_DIR = '/Volumes/Main/canue-pmtiles-bc-v2'
const DEFAULT_OUTPUT_DIR = '/Volumes/Main/canue-aggregates-v2'
const DEFAULT_R2_PREFIX = 'canue/aggregates-v2'
const DEFAULT_PUBLIC_BASE_URL = 'https://data.map.ahmad.sh'

const BOUNDARY_LEVELS = [
  ['bcHealth', 'healthAuthority', 'public/data/boundaries/BCMoH/simplified/health_authorities.json', 'HLTH_AUTHORITY_CODE', 'HLTH_AUTHORITY_NAME'],
  ['bcHealth', 'hsda', 'public/data/boundaries/BCMoH/simplified/health_service_delivery_areas.json', 'HLTH_SERVICE_DLVR_AREA_CODE', 'HLTH_SERVICE_DLVR_AREA_NAME'],
  ['bcHealth', 'lha', 'public/data/boundaries/BCMoH/simplified/local_health_areas.json', 'LOCAL_HLTH_AREA_CODE', 'LOCAL_HLTH_AREA_NAME'],
  ['bcHealth', 'chsa', 'public/data/boundaries/BCMoH/simplified/community_health_service_areas.json', 'CMNTY_HLTH_SERV_AREA_CODE', 'CMNTY_HLTH_SERV_AREA_NAME'],
  ['regionalDistrict', 'regionalDistrict', 'public/data/boundaries/BC/regional_districts.geojson', 'LGL_ADMIN_AREA_ID', 'ADMIN_AREA_NAME'],
  ['census', 'cd', 'public/data/census/prince_george_cd.geo.json', 'id', 'name'],
  ['census', 'csd', 'public/data/census/prince_george_csd.geo.json', 'id', 'name'],
  ['census', 'ct', 'public/data/census/prince_george_ct.geo.json', 'id', 'name'],
  ['census', 'da', 'public/data/census/prince_george_da.geo.json', 'id', 'name'],
  ['census', 'db', 'public/data/census/prince_george_db.geo.json', 'id', 'name'],
  ['cityPG', 'elementarySchoolCatchment', 'public/data/boundaries/CityPG/elementary_school_catchments.geojson', 'OBJECTID', 'SchoolName'],
  ['cityPG', 'secondarySchoolCatchment', 'public/data/boundaries/CityPG/secondary_school_catchments.geojson', 'OBJECTID', 'SchoolNam'],
  ['watershed', 'majorWatershed', 'public/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson', 'boundaryCode', 'boundaryName'],
  ['watershed', 'watershedGroup', 'public/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson', 'boundaryCode', 'boundaryName'],
  ['watershed', 'assessmentWatershed', 'public/data/boundaries/BCFWA/assessment_watersheds.geojson', 'boundaryCode', 'boundaryName'],
  ['nrAdmin', 'nrArea', 'public/data/boundaries/BCNR/nr_areas.geojson', 'boundaryCode', 'boundaryName'],
  ['nrAdmin', 'nrRegion', 'public/data/boundaries/BCNR/nr_regions.geojson', 'boundaryCode', 'boundaryName'],
  ['nrAdmin', 'nrDistrict', 'public/data/boundaries/BCNR/nr_districts.geojson', 'boundaryCode', 'boundaryName'],
].map(([source, level, file, idField, nameField]) => ({
  source,
  level,
  file,
  idField,
  nameField,
}))

const args = parseArgs(process.argv.slice(2))

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) parsed[key] = 'true'
    else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath
  }

  getKey() {
    return this.filePath
  }

  async getBytes(offset, length) {
    const chunks = []
    let total = 0
    await new Promise((resolve, reject) => {
      const stream = createReadStream(this.filePath, { start: offset, end: offset + length - 1 })
      stream.on('data', (chunk) => {
        chunks.push(chunk)
        total += chunk.length
      })
      stream.on('error', reject)
      stream.on('end', resolve)
    })
    const data = Buffer.concat(chunks, total)
    return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }
  }
}

function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const latRad = clampedLat * Math.PI / 180
  return {
    x: Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n))),
    y: Math.max(0, Math.min(n - 1, Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n))),
  }
}

function tileCoverForBbox(bounds, zoom) {
  const [minLon, minLat, maxLon, maxLat] = bounds
  const northwest = lonLatToTile(minLon, maxLat, zoom)
  const southeast = lonLatToTile(maxLon, minLat, zoom)
  const coords = []
  for (let x = northwest.x; x <= southeast.x; x += 1) {
    for (let y = northwest.y; y <= southeast.y; y += 1) coords.push({ z: zoom, x, y })
  }
  return coords
}

function forEachPosition(geometry, visit) {
  if (!geometry) return
  if (geometry.type === 'Point') visit(geometry.coordinates)
  else if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') geometry.coordinates.forEach(visit)
  else if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') geometry.coordinates.flat(1).forEach(visit)
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.flat(2).forEach(visit)
  else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((child) => forEachPosition(child, visit))
}

function geometryBbox(geometry) {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  forEachPosition(geometry, ([lon, lat]) => {
    minLon = Math.min(minLon, lon)
    minLat = Math.min(minLat, lat)
    maxLon = Math.max(maxLon, lon)
    maxLat = Math.max(maxLat, lat)
  })
  return [minLon, minLat, maxLon, maxLat]
}

function collectionBbox(collection) {
  return collection.features.reduce((bounds, feature) => {
    if (!feature.geometry) return bounds
    const featureBounds = geometryBbox(feature.geometry)
    return [
      Math.min(bounds[0], featureBounds[0]),
      Math.min(bounds[1], featureBounds[1]),
      Math.max(bounds[2], featureBounds[2]),
      Math.max(bounds[3], featureBounds[3]),
    ]
  }, [Infinity, Infinity, -Infinity, -Infinity])
}

function featureBboxCenter(feature) {
  if (!feature.geometry) return [NaN, NaN]
  const [minLon, minLat, maxLon, maxLat] = geometryBbox(feature.geometry)
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2]
}

function pointInRing(point, ring) {
  const [x, y] = point
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index]
    const [xj, yj] = ring[previous]
    const intersects = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygonCoordinates(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false
  return !polygon.slice(1).some((hole) => pointInRing(point, hole))
}

function pointInBoundary(point, geometry) {
  if (geometry.type === 'Polygon') return pointInPolygonCoordinates(point, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(point, polygon))
  return false
}

function intersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function intersection(a, b) {
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ]
}

async function loadBoundary(config) {
  const filePath = path.resolve(config.file)
  const collection = JSON.parse(await readFile(filePath, 'utf8'))
  const features = collection.features.filter((feature) => feature.geometry)
  const boundaries = features.map((feature, index) => {
    const bounds = geometryBbox(feature.geometry)
    const id = String(feature.properties?.[config.idField] ?? feature.id ?? index)
    const name = String(feature.properties?.[config.nameField] ?? feature.properties?.name ?? id)
    return {
      minX: bounds[0],
      minY: bounds[1],
      maxX: bounds[2],
      maxY: bounds[3],
      id,
      name,
      feature,
      index,
    }
  })
  const tree = new RBush()
  tree.load(boundaries)
  return {
    ...config,
    filePath,
    bounds: collectionBbox({ type: 'FeatureCollection', features }),
    boundaries,
    tree,
  }
}

function createBuckets(boundarySet, variables) {
  return new Map(boundarySet.boundaries.map((boundary) => [
    boundary.id,
    {
      boundary,
      values: Object.fromEntries(variables.map((variable) => [variable.property, { sum: 0, count: 0, min: null, max: null }])),
    },
  ]))
}

function findBoundary(boundarySet, point) {
  const candidates = boundarySet.tree.search({ minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] })
  return candidates.find((candidate) => pointInBoundary(point, candidate.feature.geometry)) ?? null
}

function pmtilesPathForLayer(pmtilesDir, layer) {
  const name = path.basename(layer.pmtiles.path)
  const family = layer.pmtiles.path.split('/').at(-2)
  return path.join(pmtilesDir, family, name)
}

function isSidecarLayer(layer) {
  return path.basename(layer.pmtiles?.path || '').startsWith('._')
}

function outputPathForLayer(outputDir, boundarySet, family, year) {
  return path.join(outputDir, boundarySet.source, boundarySet.level, `${family}_${year}_aggregate.json`)
}

async function decodeTileFeatures(archive, tile, variables) {
  const response = await archive.getZxy(tile.z, tile.x, tile.y)
  if (!response?.data) return []
  const vectorTile = new VectorTile(new Pbf(new Uint8Array(response.data)))
  const layer = vectorTile.layers.canue
  if (!layer) return []
  const features = []
  for (let index = 0; index < layer.length; index += 1) {
    const tileFeature = layer.feature(index)
    const hasValue = variables.some((variable) => Number.isFinite(Number(tileFeature.properties[variable.property])))
    if (!hasValue) continue
    const geojsonFeature = tileFeature.toGeoJSON(tile.x, tile.y, tile.z)
    const center = featureBboxCenter(geojsonFeature)
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) continue
    features.push({ center, properties: tileFeature.properties })
  }
  return features
}

async function writeAggregate({
  outputDir,
  publicBaseUrl,
  r2Prefix,
  family,
  layer,
  boundarySet,
  variables,
  buckets,
  tileStats,
}) {
  let validBoundaryCount = 0
  const rows = []
  for (const bucket of buckets.values()) {
    const values = {}
    const counts = {}
    const min = {}
    const max = {}
    for (const variable of variables) {
      const stats = bucket.values[variable.property]
      if (stats.count <= 0) continue
      values[variable.property] = stats.sum / stats.count
      counts[variable.property] = stats.count
      min[variable.property] = stats.min
      max[variable.property] = stats.max
    }
    if (!Object.keys(values).length) continue
    validBoundaryCount += 1
    rows.push({
      boundaryId: bucket.boundary.id,
      boundaryName: bucket.boundary.name,
      values,
      counts,
      min,
      max,
    })
  }

  const relativePath = `${boundarySet.source}/${boundarySet.level}/${family.id}_${layer.year}_aggregate.json`
  const publicUrl = `${publicBaseUrl.replace(/\/$/, '')}/${r2Prefix}/${relativePath}`
  const aggregate = {
    version: 2,
    generatedAt: new Date().toISOString(),
    method: 'pmtiles-centroid',
    caveat: 'Aggregated from z/x/y MVT features decoded from PMTiles by grid-cell centroid. Use raw grid/source aggregates for analytical finalization when available.',
    family: family.id,
    familyLabel: family.label,
    year: layer.year,
    view: 'bc',
    mode: 'grid',
    source: boundarySet.source,
    level: boundarySet.level,
    idField: boundarySet.idField,
    nameField: boundarySet.nameField,
    boundaryCount: boundarySet.boundaries.length,
    validBoundaryCount,
    variables: variables.map((variable) => ({
      property: variable.property,
      dataset: variable.dataset,
      variable: variable.variable,
      metadataRef: variable.metadataRef,
    })),
    tileStats,
    rows,
    publicUrl,
  }
  const outPath = outputPathForLayer(outputDir, boundarySet, family.id, layer.year)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(aggregate)}\n`)
  return {
    source: boundarySet.source,
    level: boundarySet.level,
    family: family.id,
    year: layer.year,
    path: relativePath,
    url: publicUrl,
    bytes: (await stat(outPath)).size,
    boundaryCount: boundarySet.boundaries.length,
    validBoundaryCount,
    variables: variables.length,
    decodedFeatureCount: tileStats.decodedFeatureCount,
    matchedFeatureCount: tileStats.matchedFeatureCount,
  }
}

async function buildLayerForBoundaries({ outputDir, pmtilesDir, family, layer, boundarySets, zoom, skipExisting, publicBaseUrl, r2Prefix }) {
  const variables = layer.variables
  const pmtilesPath = pmtilesPathForLayer(pmtilesDir, layer)
  const archive = new PMTiles(new NodeFileSource(pmtilesPath), new SharedPromiseCache(100))
  const header = await archive.getHeader()
  const layerBounds = [header.minLon, header.minLat, header.maxLon, header.maxLat]
  const results = []

  for (const boundarySet of boundarySets) {
    const outPath = outputPathForLayer(outputDir, boundarySet, family.id, layer.year)
    if (skipExisting) {
      try {
        const existing = await stat(outPath)
        const relativePath = `${boundarySet.source}/${boundarySet.level}/${family.id}_${layer.year}_aggregate.json`
        results.push({
          skipped: true,
          source: boundarySet.source,
          level: boundarySet.level,
          family: family.id,
          year: layer.year,
          path: relativePath,
          url: `${publicBaseUrl.replace(/\/$/, '')}/${r2Prefix}/${relativePath}`,
          bytes: existing.size,
          boundaryCount: boundarySet.boundaries.length,
          variables: variables.length,
        })
        continue
      } catch {
        // build missing output
      }
    }

    if (!intersects(layerBounds, boundarySet.bounds)) continue
    const coverBounds = intersection(layerBounds, boundarySet.bounds)
    const tiles = tileCoverForBbox(coverBounds, zoom)
    const buckets = createBuckets(boundarySet, variables)
    const tileStats = {
      zoom,
      tileCount: tiles.length,
      decodedFeatureCount: 0,
      matchedFeatureCount: 0,
      pmtiles: path.relative(process.cwd(), pmtilesPath),
    }

    for (const tile of tiles) {
      const features = await decodeTileFeatures(archive, tile, variables)
      tileStats.decodedFeatureCount += features.length
      for (const feature of features) {
        const boundary = findBoundary(boundarySet, feature.center)
        if (!boundary) continue
        const bucket = buckets.get(boundary.id)
        if (!bucket) continue
        tileStats.matchedFeatureCount += 1
        for (const variable of variables) {
          const value = Number(feature.properties[variable.property])
          if (!Number.isFinite(value)) continue
          const stats = bucket.values[variable.property]
          stats.sum += value
          stats.count += 1
          stats.min = stats.min == null ? value : Math.min(stats.min, value)
          stats.max = stats.max == null ? value : Math.max(stats.max, value)
        }
      }
    }

    const result = await writeAggregate({
      outputDir,
      publicBaseUrl,
      r2Prefix,
      family,
      layer,
      boundarySet,
      variables,
      buckets,
      tileStats,
    })
    results.push(result)
    console.log(`${family.id} ${layer.year} ${boundarySet.source}/${boundarySet.level}: ${result.validBoundaryCount}/${result.boundaryCount} boundaries, ${tileStats.matchedFeatureCount}/${tileStats.decodedFeatureCount} features`)
  }

  return results
}

async function main() {
  const catalogPath = path.resolve(args.catalog || DEFAULT_CATALOG)
  const pmtilesDir = path.resolve(args['pmtiles-dir'] || DEFAULT_PMTILES_DIR)
  const outputDir = path.resolve(args['output-dir'] || DEFAULT_OUTPUT_DIR)
  const publicBaseUrl = args['public-base-url'] || DEFAULT_PUBLIC_BASE_URL
  const r2Prefix = args['r2-prefix'] || DEFAULT_R2_PREFIX
  const zoom = Number(args.zoom || 8)
  const skipExisting = args['skip-existing'] === 'true'
  const familyFilter = args.family || null
  const yearFilter = args.year ? Number(args.year) : null
  const levelFilter = args.level || null
  const sourceFilter = args.source || null

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  const boundaryConfigs = BOUNDARY_LEVELS.filter((boundary) =>
    (!sourceFilter || boundary.source === sourceFilter) &&
    (!levelFilter || boundary.level === levelFilter),
  )
  const boundarySets = await Promise.all(boundaryConfigs.map(loadBoundary))
  const outputs = []
  const errors = []

  await mkdir(outputDir, { recursive: true })

  for (const family of catalog.families) {
    if (familyFilter && family.id !== familyFilter) continue
    for (const layer of family.layers) {
      if (isSidecarLayer(layer)) continue
      if (yearFilter != null && layer.year !== yearFilter) continue
      try {
        const results = await buildLayerForBoundaries({
          outputDir,
          pmtilesDir,
          family,
          layer,
          boundarySets,
          zoom,
          skipExisting,
          publicBaseUrl,
          r2Prefix,
        })
        outputs.push(...results)
      } catch (error) {
        const failure = { family: family.id, year: layer.year, error: error.message }
        errors.push(failure)
        console.error(`FAILED ${family.id} ${layer.year}: ${error.stack || error.message}`)
        if (args['continue-on-error'] !== 'true') throw error
      }
    }
  }

  const aggregateCatalog = {
    version: 2,
    generatedAt: new Date().toISOString(),
    method: 'pmtiles-centroid',
    sourceCatalog: catalogPath,
    r2Prefix,
    publicBaseUrl,
    zoom,
    boundaryLevels: boundarySets.map((boundary) => ({
      source: boundary.source,
      level: boundary.level,
      path: boundary.file,
      idField: boundary.idField,
      nameField: boundary.nameField,
      boundaryCount: boundary.boundaries.length,
    })),
    files: outputs,
    errors,
  }
  await writeFile(path.join(outputDir, 'canue-bc-aggregates-v2-catalog.json'), `${JSON.stringify(aggregateCatalog, null, 2)}\n`)
  console.log(`Wrote ${outputs.length} aggregate files with ${errors.length} errors to ${outputDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
