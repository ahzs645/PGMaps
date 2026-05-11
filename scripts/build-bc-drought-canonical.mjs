import { readFile, writeFile } from 'node:fs/promises'
import booleanIntersects from '@turf/boolean-intersects'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import centroid from '@turf/centroid'

const INPUT_DIR = 'public/data/drought'
const OUTPUT_BASINS = `${INPUT_DIR}/basins.geojson`
const OUTPUT_TIMESERIES = `${INPUT_DIR}/timeseries.json`
const MANIFEST = `${INPUT_DIR}/manifest.json`
const CANONICAL_YEAR = 2025
const YEARS = Array.from({ length: 11 }, (_, index) => 2015 + index)

const DROUGHT_LEVEL_COLORS = {
  0: '#e7f0bd',
  1: '#f5f000',
  2: '#ffd17a',
  3: '#e4aa28',
  4: '#ed1c24',
  5: '#7b0d0d',
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function numericLevel(value) {
  if (value == null) return null
  const match = String(value).match(/[0-5]/)
  return match ? Number(match[0]) : null
}

function droughtColor(level, raw) {
  if (level != null) return DROUGHT_LEVEL_COLORS[level]
  return raw ? '#8a8f98' : 'rgba(0, 0, 0, 0)'
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function pickCanonicalBasins(canonicalCollection) {
  const byName = new Map()
  for (const feature of canonicalCollection.features) {
    const basinName = feature.properties?.basinName
    if (!basinName) continue
    const existing = byName.get(basinName)
    const end = Number(feature.properties?.endDateMs ?? 0)
    const existingEnd = Number(existing?.properties?.endDateMs ?? 0)
    if (!existing || end > existingEnd) byName.set(basinName, feature)
  }

  return Array.from(byName.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([basinName, feature], index) => {
      const basinId = slug(basinName)
      return {
        type: 'Feature',
        id: basinId,
        properties: {
          basinId,
          basinName,
          canonicalYear: CANONICAL_YEAR,
          sourceObjectId: feature.properties?.sourceObjectId ?? index + 1,
        },
        geometry: feature.geometry,
      }
    })
}

function getBasinIndex(basins) {
  return basins.map((basin) => ({
    basin,
    basinId: basin.properties.basinId,
    basinName: basin.properties.basinName,
    center: centroid(basin),
  }))
}

function findCanonicalBasins(sourceFeature, canonicalIndex) {
  const sourceName = String(sourceFeature.properties?.basinName ?? '').trim()
  const sourceSlug = slug(sourceName)
  const exact = canonicalIndex.find((item) => item.basinId === sourceSlug)
  if (exact) return [exact]

  const contained = canonicalIndex.filter((item) => {
    try {
      return booleanPointInPolygon(item.center, sourceFeature)
    } catch {
      return false
    }
  })
  if (contained.length > 0) return contained

  return canonicalIndex.filter((item) => {
    try {
      return booleanIntersects(item.basin, sourceFeature)
    } catch {
      return false
    }
  })
}

function getDateRange(records) {
  const dates = records
    .flatMap((record) => [record.startDate, record.endDate])
    .filter(Boolean)
    .sort()
  return {
    startDate: dates[0] ?? null,
    endDate: dates[dates.length - 1] ?? null,
  }
}

const manifest = await readJson(MANIFEST)
const canonicalCollection = await readJson(`${INPUT_DIR}/${CANONICAL_YEAR}.geojson`)
const basins = pickCanonicalBasins(canonicalCollection)
const canonicalIndex = getBasinIndex(basins)
const records = []
const yearSummaries = []

for (const year of YEARS) {
  const collection = await readJson(`${INPUT_DIR}/${year}.geojson`)
  let unmapped = 0
  let mappedRows = 0

  for (const feature of collection.features) {
    const matches = findCanonicalBasins(feature, canonicalIndex)
    if (matches.length === 0) {
      unmapped += 1
      continue
    }

    for (const match of matches) {
      const level = numericLevel(feature.properties?.droughtLevelRaw)
      records.push({
        id: `${year}-${feature.properties?.sourceObjectId ?? records.length}-${match.basinId}`,
        year,
        basinId: match.basinId,
        basinName: match.basinName,
        sourceBasinName: feature.properties?.basinName ?? null,
        sourceObjectId: feature.properties?.sourceObjectId ?? null,
        droughtLevel: level,
        droughtLevelRaw: feature.properties?.droughtLevelRaw ?? null,
        droughtColor: droughtColor(level, feature.properties?.droughtLevelRaw),
        startDate: feature.properties?.startDate ?? null,
        endDate: feature.properties?.endDate ?? null,
        startDateMs: feature.properties?.startDateMs ?? null,
        endDateMs: feature.properties?.endDateMs ?? null,
      })
      mappedRows += 1
    }
  }

  yearSummaries.push({
    year,
    sourceFeatureCount: collection.features.length,
    canonicalRecordCount: mappedRows,
    unmappedSourceFeatureCount: unmapped,
    ...getDateRange(collection.features.map((feature) => feature.properties ?? {})),
  })

  console.log(`${year}: ${collection.features.length} source rows -> ${mappedRows} canonical records (${unmapped} unmapped)`)
}

const generatedAt = new Date().toISOString()
const basinsCollection = {
  type: 'FeatureCollection',
  name: 'bc_drought_canonical_basins',
  metadata: {
    source: 'BC Drought Information Portal / ArcGIS Hub',
    canonicalYear: CANONICAL_YEAR,
    generatedAt,
    featureCount: basins.length,
    note: 'Canonical 2025 basin polygons used as the stable display geometry for historical drought time-series records.',
  },
  features: basins,
}

const timeseries = {
  title: 'B.C. drought levels canonical time series',
  source: 'BC Drought Information Portal / ArcGIS Hub',
  canonicalYear: CANONICAL_YEAR,
  generatedAt,
  basinCount: basins.length,
  recordCount: records.length,
  years: yearSummaries,
  records,
}

manifest.generatedAt = generatedAt
manifest.canonical = {
  basinFile: 'basins.geojson',
  timeseriesFile: 'timeseries.json',
  canonicalYear: CANONICAL_YEAR,
  basinCount: basins.length,
  recordCount: records.length,
  note: 'Yearly source files remain raw ArcGIS time-lapse rows. The canonical files use one stable 2025 basin geometry layer plus time-series records joined by basinId.',
}

await writeFile(OUTPUT_BASINS, `${JSON.stringify(basinsCollection)}\n`)
await writeFile(OUTPUT_TIMESERIES, `${JSON.stringify(timeseries)}\n`)
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`basins: wrote ${basins.length}`)
console.log(`timeseries: wrote ${records.length}`)
