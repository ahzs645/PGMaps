import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { copyFile, cp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bboxClip } from '@turf/turf'

// Fire danger is a CLASSIFIED VECTOR product (cffdrs fdr polygons). The WMS
// renders these fine polygons (~100 m boundaries); the 2 km WCS raster coverage
// is far coarser. So the deck.gl fire-danger layer renders the vector, snapshot
// here as a slimmed committed GeoJSON (GRIDCODE 0-4 = Low..Extreme).
//
// Keep six decimal places. Four decimals is only ~6-11 m in Canada, but it is
// visibly angular once users zoom in far enough to compare against WMS tiles.
const SOURCE_URL =
  'https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=public:fdr_current_shp&outputFormat=application/json&srsName=EPSG:4326'
const OUTPUT_NAME = 'fire-danger-vector.geojson.gz'
const TILE_DIR_NAME = 'fire-danger-vector-tiles'
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const VENDOR_PATH = path.join(PROJECT_ROOT, 'vendor/bcdatamapper/datascrapers/eccc/output', OUTPUT_NAME)
const APP_PATH = path.join(PROJECT_ROOT, 'public/data/aqmap', OUTPUT_NAME)
const VENDOR_TILE_DIR = path.join(PROJECT_ROOT, 'vendor/bcdatamapper/datascrapers/eccc/output', TILE_DIR_NAME)
const APP_TILE_DIR = path.join(PROJECT_ROOT, 'public/data/aqmap', TILE_DIR_NAME)
const onlyIfMissing = process.argv.includes('--if-missing')
const gzipAsync = promisify(gzip)
const COORD_DECIMALS = 6
const TILE_MIN_ZOOM = 5
const TILE_MAX_ZOOM = 5

function roundCoords(coords) {
  if (typeof coords[0] === 'number') return [Number(coords[0].toFixed(COORD_DECIMALS)), Number(coords[1].toFixed(COORD_DECIMALS))]
  return coords.map(roundCoords)
}

function visitPositions(coords, callback) {
  if (typeof coords[0] === 'number') {
    callback(coords)
    return
  }
  for (const entry of coords) visitPositions(entry, callback)
}

function featureBounds(feature) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  visitPositions(feature.geometry.coordinates, ([lng, lat]) => {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  })

  return { west, south, east, north }
}

function lonToTileX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z)
}

function latToTileY(lat, z) {
  const rad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

function clampTile(value, z) {
  return Math.max(0, Math.min(2 ** z - 1, value))
}

function tileRangeForBounds(bounds, z) {
  const minX = clampTile(lonToTileX(bounds.west, z), z)
  const maxX = clampTile(lonToTileX(bounds.east, z), z)
  const minY = clampTile(latToTileY(bounds.north, z), z)
  const maxY = clampTile(latToTileY(bounds.south, z), z)
  return { minX, maxX, minY, maxY }
}

function tileKey(z, x, y) {
  return `${z}/${x}/${y}`
}

function tileXToLon(x, z) {
  return (x / 2 ** z) * 360 - 180
}

function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

function tileBounds(z, x, y) {
  return {
    west: tileXToLon(x, z),
    south: tileYToLat(y + 1, z),
    east: tileXToLon(x + 1, z),
    north: tileYToLat(y, z),
  }
}

function boundsContain(container, bounds) {
  return (
    bounds.west >= container.west &&
    bounds.east <= container.east &&
    bounds.south >= container.south &&
    bounds.north <= container.north
  )
}

function clipFeatureToTile(feature, bounds) {
  try {
    return bboxClip(feature, [bounds.west, bounds.south, bounds.east, bounds.north])
  } catch (error) {
    console.warn(`Could not clip fire-danger feature to tile: ${(error instanceof Error ? error.message : String(error))}`)
    return null
  }
}

function isPosition(position) {
  return Array.isArray(position) && position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1])
}

function samePosition(a, b) {
  return a[0] === b[0] && a[1] === b[1]
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null
  const positions = ring.filter(isPosition)
  if (positions.length < 3) return null
  const first = positions[0]
  const last = positions[positions.length - 1]
  const closed = samePosition(first, last) ? positions : [...positions, first]
  return closed.length >= 4 ? closed : null
}

function normalizePolygonCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return null
  const rings = coordinates.map(normalizeRing).filter(Boolean)
  return rings.length > 0 ? rings : null
}

function normalizeTileFeature(feature) {
  if (!feature?.geometry) return null
  if (feature.geometry.type === 'Polygon') {
    const coordinates = normalizePolygonCoordinates(feature.geometry.coordinates)
    if (!coordinates) return null
    return {
      ...feature,
      geometry: { ...feature.geometry, coordinates: roundCoords(coordinates) },
    }
  }
  if (feature.geometry.type === 'MultiPolygon') {
    const coordinates = feature.geometry.coordinates
      .map(normalizePolygonCoordinates)
      .filter(Boolean)
    if (coordinates.length === 0) return null
    return {
      ...feature,
      geometry: { ...feature.geometry, coordinates: roundCoords(coordinates) },
    }
  }
  return null
}

async function fileHasContent(filePath) {
  try {
    return (await stat(filePath)).size > 0
  } catch {
    return false
  }
}

async function buildSnapshot() {
  console.log(`Fetching fire danger polygons from ${SOURCE_URL} ...`)
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Fire danger WFS failed: ${response.status} ${response.statusText}`)
  const source = JSON.parse(await response.text())

  const counts = [0, 0, 0, 0, 0]
  const features = source.features.map((feature) => {
    const cls = Math.max(0, Math.min(4, Math.round(Number(feature.properties?.GRIDCODE ?? 0))))
    counts[cls] += 1
    return {
      type: 'Feature',
      properties: { g: cls },
      geometry: { type: feature.geometry.type, coordinates: roundCoords(feature.geometry.coordinates) },
    }
  })

  console.log(`Slimmed ${features.length} polygons; class counts [Low..Extreme] = ${counts.join(', ')}`)
  return {
    type: 'FeatureCollection',
    properties: { source: 'CWFIS WFS public:fdr_current_shp', generatedAt: new Date().toISOString() },
    features,
  }
}

async function writeTileSet(collection, outputDir) {
  await rm(outputDir, { recursive: true, force: true })
  const tiles = new Map()
  const featureEntries = collection.features.map((feature) => ({ feature, bounds: featureBounds(feature) }))
  const tileBoundsByKey = new Map()

  for (let z = TILE_MIN_ZOOM; z <= TILE_MAX_ZOOM; z += 1) {
    for (const { feature, bounds } of featureEntries) {
      const range = tileRangeForBounds(bounds, z)
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          const key = tileKey(z, x, y)
          let tileBoundsForKey = tileBoundsByKey.get(key)
          if (!tileBoundsForKey) {
            tileBoundsForKey = tileBounds(z, x, y)
            tileBoundsByKey.set(key, tileBoundsForKey)
          }
          const tileFeature = boundsContain(tileBoundsForKey, bounds)
            ? feature
            : clipFeatureToTile(feature, tileBoundsForKey)
          const normalizedFeature = normalizeTileFeature(tileFeature)
          if (!normalizedFeature) continue
          const tile = tiles.get(key)
          if (tile) tile.push(normalizedFeature)
          else tiles.set(key, [normalizedFeature])
        }
      }
    }
  }

  let rawBytes = 0
  let gzipBytes = 0
  for (const [key, features] of tiles) {
    const tilePath = path.join(outputDir, `${key}.geojson.gz`)
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features,
    })
    const compressed = await gzipAsync(body, { level: 9 })
    rawBytes += body.length
    gzipBytes += compressed.length
    await mkdir(path.dirname(tilePath), { recursive: true })
    await writeFile(tilePath, compressed)
  }

  const manifest = {
    source: collection.properties.source,
    generatedAt: collection.properties.generatedAt,
    minZoom: TILE_MIN_ZOOM,
    maxZoom: TILE_MAX_ZOOM,
    tileCount: tiles.size,
    note: 'Tiles are gzip GeoJSON clipped to Web Mercator tile bounds.',
  }
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { tileCount: tiles.size, rawBytes, gzipBytes }
}

async function main() {
  if (onlyIfMissing) {
    if (await fileHasContent(APP_PATH)) {
      console.log(`Fire danger vector snapshot already present at ${path.relative(PROJECT_ROOT, APP_PATH)}`)
      return
    }
    if (await fileHasContent(VENDOR_PATH)) {
      await mkdir(path.dirname(APP_PATH), { recursive: true })
      await copyFile(VENDOR_PATH, APP_PATH)
      console.log(`Copied ${path.relative(PROJECT_ROOT, VENDOR_PATH)} -> ${path.relative(PROJECT_ROOT, APP_PATH)}`)
      try {
        await rm(APP_TILE_DIR, { recursive: true, force: true })
        await mkdir(path.dirname(APP_TILE_DIR), { recursive: true })
        await cp(VENDOR_TILE_DIR, APP_TILE_DIR, { recursive: true })
        console.log(`Copied ${path.relative(PROJECT_ROOT, VENDOR_TILE_DIR)} -> ${path.relative(PROJECT_ROOT, APP_TILE_DIR)}`)
      } catch {
        // Fall through to rebuild if tiles are unavailable.
      }
      return
    }
  }

  const snapshot = await buildSnapshot()
  const body = JSON.stringify(snapshot)
  const compressed = await gzipAsync(body, { level: 9 })
  await mkdir(path.dirname(VENDOR_PATH), { recursive: true })
  await mkdir(path.dirname(APP_PATH), { recursive: true })
  await writeFile(VENDOR_PATH, compressed)
  await writeFile(APP_PATH, compressed)
  const vendorTiles = await writeTileSet(snapshot, VENDOR_TILE_DIR)
  const appTiles = await writeTileSet(snapshot, APP_TILE_DIR)
  console.log(
    `Wrote ${OUTPUT_NAME} (${(body.length / 1e6).toFixed(2)} MB raw, ${(compressed.length / 1e6).toFixed(2)} MB gzip)`,
  )
  console.log(
    `Wrote ${vendorTiles.tileCount} fire-danger tiles z${TILE_MIN_ZOOM}-${TILE_MAX_ZOOM} ` +
      `(${(vendorTiles.rawBytes / 1e6).toFixed(2)} MB raw, ${(vendorTiles.gzipBytes / 1e6).toFixed(2)} MB gzip)`,
  )
  if (appTiles.tileCount !== vendorTiles.tileCount) {
    console.warn(`App tile count differed from vendor tile count: ${appTiles.tileCount} vs ${vendorTiles.tileCount}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
