import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Builds a slimmed, same-origin copy of the ECCC public standard forecast zones
// so the AQ map doesn't fetch ~4.6 MB of full-precision polygons from the slow
// api.weather.gc.ca on every visit. We keep only the four properties the app
// reads and round coordinates to ~11 m precision (4 decimals) — imperceptible at
// the country/region zoom levels these zones are drawn at, but ~3x smaller over
// the wire (≈0.5 MB gzipped) and served straight from our CDN.
//
// Forecast zones are static administrative boundaries that change very rarely.
// The committed snapshot lives in the bcdatamapper submodule; PGMaps keeps only
// an ignored public/data copy assembled for local dev and deploy builds.

const SOURCE_URL =
  'https://api.weather.gc.ca/collections/public-standard-forecast-zones/items?f=json&limit=10000'
const COORD_DECIMALS = 4
const KEEP_PROPERTIES = ['NAME', 'NOM', 'CLC', 'FEATURE_ID']

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const VENDOR_OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  'vendor/bcdatamapper/datascrapers/eccc/output/forecast-zones.geojson',
)
const APP_OUTPUT_PATH = path.join(PROJECT_ROOT, 'public/data/aqmap/forecast-zones.geojson')
const onlyIfMissing = process.argv.includes('--if-missing')

const factor = 10 ** COORD_DECIMALS
const roundValue = (value) => Math.round(value * factor) / factor

function roundCoordinates(coordinates) {
  if (typeof coordinates[0] === 'number') {
    return [roundValue(coordinates[0]), roundValue(coordinates[1])]
  }
  return coordinates.map(roundCoordinates)
}

function trimFeature(feature) {
  const properties = {}
  for (const key of KEEP_PROPERTIES) {
    const value = feature.properties?.[key]
    if (value != null) properties[key] = value
  }
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: feature.geometry.type,
      coordinates: roundCoordinates(feature.geometry.coordinates),
    },
  }
}

async function main() {
  if (onlyIfMissing) {
    try {
      const existing = await stat(APP_OUTPUT_PATH)
      if (existing.size > 0) {
        console.log(
          `Forecast zones already exist at ${path.relative(PROJECT_ROOT, APP_OUTPUT_PATH)} ` +
            `(${(existing.size / 1e6).toFixed(2)} MB raw)`,
        )
        return
      }
    } catch {
      // Missing app file: copy the vendor snapshot or build it below.
    }

    try {
      const existing = await stat(VENDOR_OUTPUT_PATH)
      if (existing.size > 0) {
        await mkdir(path.dirname(APP_OUTPUT_PATH), { recursive: true })
        await copyFile(VENDOR_OUTPUT_PATH, APP_OUTPUT_PATH)
        console.log(
          `Copied forecast zones from ${path.relative(PROJECT_ROOT, VENDOR_OUTPUT_PATH)} ` +
            `-> ${path.relative(PROJECT_ROOT, APP_OUTPUT_PATH)}`,
        )
        return
      }
    } catch {
      // Missing vendor file: build it below.
    }
  }

  console.log(`Fetching forecast zones from ${SOURCE_URL} ...`)
  const response = await fetch(SOURCE_URL)
  if (!response.ok) {
    throw new Error(`Forecast zones request failed: ${response.status} ${response.statusText}`)
  }

  const source = await response.json()
  const features = (source.features ?? []).map(trimFeature)
  const output = { type: 'FeatureCollection', features }
  const body = JSON.stringify(output)

  await mkdir(path.dirname(VENDOR_OUTPUT_PATH), { recursive: true })
  await mkdir(path.dirname(APP_OUTPUT_PATH), { recursive: true })
  await writeFile(VENDOR_OUTPUT_PATH, body)
  await writeFile(APP_OUTPUT_PATH, body)

  console.log(
    `Wrote ${features.length} zones -> ${path.relative(PROJECT_ROOT, VENDOR_OUTPUT_PATH)} ` +
      `and ${path.relative(PROJECT_ROOT, APP_OUTPUT_PATH)} ` +
      `(${(body.length / 1e6).toFixed(2)} MB raw)`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
