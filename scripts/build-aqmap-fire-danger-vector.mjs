import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { copyFile, cp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { roundCoordinates, writeGeoJsonTileSet } from './lib/geojson-tile-utils.mjs'

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
  return roundCoordinates(coords, COORD_DECIMALS)
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
  return writeGeoJsonTileSet(collection, outputDir, {
    coordDecimals: COORD_DECIMALS,
    minZoom: TILE_MIN_ZOOM,
    maxZoom: TILE_MAX_ZOOM,
    note: 'Tiles are gzip GeoJSON clipped to Web Mercator tile bounds.',
  })
}

async function main() {
  if (onlyIfMissing) {
    if (await fileHasContent(APP_PATH) && await fileHasContent(path.join(APP_TILE_DIR, 'manifest.json'))) {
      console.log(`Fire danger vector artifacts already present in public/data/aqmap`)
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
