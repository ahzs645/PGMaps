import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUTPUT_DIR = 'public/data/icbc'
const INTERSECTIONS_PATH = 'public/data/citypg/road_intersections.geojson'

// ICBC's NC/cyclist/pedestrian/motorcycle dashboards accept a Year= URL filter
// returning per-intersection counts for that year. Coverage observed: 2020–2024.
const YEARS = [2020, 2021, 2022, 2023, 2024]

const TABLEAU_EXPORTS = [
  {
    id: 'all_crashes',
    title: 'All reported crash locations',
    workbook: 'NorthCentralCrashes',
    view: 'NCDashboard',
    outputCsv: 'prince_george_crash_locations.csv',
    outputGeojson: 'prince_george_crash_locations.geojson',
    rowFilter: () => true,
  },
  {
    id: 'cyclist_crashes',
    title: 'Crashes involving cyclists',
    workbook: 'BC-CrashesinvolvingCyclists-',
    view: 'CyclistsDashboard',
    outputCsv: 'prince_george_cyclist_crashes.csv',
    outputGeojson: 'prince_george_cyclist_crashes.geojson',
    rowFilter: isPrinceGeorgeRow,
  },
  {
    id: 'pedestrian_crashes',
    title: 'Crashes involving pedestrians',
    workbook: 'BC-CrashesinvolvingPedestrians-',
    view: 'PedestriansDashboard',
    outputCsv: 'prince_george_pedestrian_crashes.csv',
    outputGeojson: 'prince_george_pedestrian_crashes.geojson',
    rowFilter: isPrinceGeorgeRow,
  },
  {
    id: 'motorcycle_crashes',
    title: 'Crashes involving motorcycles',
    workbook: 'BC-CrashesinvolvingMotorcycles_0',
    view: 'MotorcycleDashboard',
    outputCsv: 'prince_george_motorcycle_crashes.csv',
    outputGeojson: 'prince_george_motorcycle_crashes.geojson',
    rowFilter: isPrinceGeorgeRow,
  },
]

const DERIVED_CAR_CRASHES = {
  id: 'car_crashes',
  title: 'Car crashes',
  outputCsv: 'prince_george_car_crashes.csv',
  outputGeojson: 'prince_george_car_crashes.geojson',
  sourceDatasetId: 'all_crashes',
  excludedDatasetIds: ['pedestrian_crashes', 'cyclist_crashes', 'motorcycle_crashes'],
}

function tableauCsvUrl({ workbook, view }, year) {
  const base = `https://public.tableau.com/views/${workbook}/${view}.csv?:showVizHome=no`
  return year == null ? base : `${base}&Year=${year}`
}

function isPrinceGeorgeRow(row) {
  return row.Municipality?.trim().toUpperCase() === 'PRINCE GEORGE'
}

function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      field += '"'
      i += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(field)
      field = ''
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((value) => value.length > 0)) rows.push(row)
  }

  if (rows.length === 0) return []
  const headers = dedupeHeaders(rows[0])
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  )
}

function dedupeHeaders(headers) {
  const seen = new Map()
  return headers.map((header) => {
    const clean = header.trim()
    const count = seen.get(clean) ?? 0
    seen.set(clean, count + 1)
    return count === 0 ? clean : `${clean}_${count + 1}`
  })
}

function toCsv(rows) {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => quoteCsv(row[header] ?? '')).join(','))
  }
  return `${lines.join('\n')}\n`
}

function quoteCsv(value) {
  const text = String(value)
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function normalizeLocationName(value) {
  return value
    .toUpperCase()
    .replaceAll('.', '')
    .replaceAll('#', '')
    .replace(/\bHIGHWAY\b/g, 'HWY')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bCRESCENT\b/g, 'CRES')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\bCOURT\b/g, 'CRT')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bFRONTAGE\b/g, 'FRTG')
    .replace(/\bTURNING LN\b/g, 'TURNING LANE')
    .replace(/\s+/g, ' ')
    .trim()
}

function locationParts(value) {
  return normalizeLocationName(value)
    .split('&')
    .map((part) => part.trim())
    .filter((part) => part && part !== 'TURNING LANE')
    .filter((part) => !/\d{4,}\s+TO\s+\d{4,}/.test(part))
}

function centroid(geometry) {
  const points = []
  collectPoints(geometry.coordinates, points)
  if (points.length === 0) return null

  const sums = points.reduce(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
    [0, 0],
  )
  return [sums[0] / points.length, sums[1] / points.length]
}

function collectPoints(coordinates, points) {
  if (!Array.isArray(coordinates)) return
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    points.push(coordinates)
    return
  }
  for (const coordinate of coordinates) collectPoints(coordinate, points)
}

async function loadIntersectionIndex() {
  const geojson = JSON.parse(await readFile(INTERSECTIONS_PATH, 'utf8'))
  const byKey = new Map()
  const entries = []

  for (const feature of geojson.features ?? []) {
    const name = feature.properties?.IntersectionName ?? feature.properties?.Location
    if (!name || !feature.geometry) continue
    const parts = locationParts(name)
    if (parts.length < 2) continue
    const entry = {
      name,
      parts,
      coordinates: centroid(feature.geometry),
    }
    byKey.set([...parts].sort().join('|'), entry)
    entries.push(entry)
  }

  return { byKey, entries }
}

function geocodeRow(row, intersectionIndex) {
  const parts = locationParts(row.Location ?? '')
  if (parts.length < 2) return null

  const exact = intersectionIndex.byKey.get([...parts].sort().join('|'))
  if (exact?.coordinates) return { ...exact, matchType: 'exact_intersection_name' }

  const partSet = new Set(parts)
  const candidates = intersectionIndex.entries
    .map((entry) => {
      const overlap = entry.parts.filter((part) => partSet.has(part)).length
      const cityIsSubset = overlap === entry.parts.length
      const tableauIsSubset = overlap === parts.length
      const matched = overlap >= 2 && (cityIsSubset || tableauIsSubset)
      return matched ? { ...entry, overlap } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.overlap - a.overlap || a.parts.length - b.parts.length)

  if (candidates[0]?.coordinates) {
    return { ...candidates[0], matchType: 'subset_intersection_name' }
  }

  return null
}

function normalizeRow(row, dataset, year, intersectionIndex) {
  const match = geocodeRow(row, intersectionIndex)
  const crashCount = Number(row.CrashCount ?? row['Crash Count'] ?? row['Real Count'] ?? 0)

  return {
    dataset: dataset.id,
    datasetTitle: dataset.title,
    year,
    location: row.Location ?? '',
    municipality: row.Municipality || 'PRINCE GEORGE',
    crashCount,
    sourceLocationName: match?.name ?? '',
    longitude: match?.coordinates?.[0] ?? '',
    latitude: match?.coordinates?.[1] ?? '',
    geocodeMatchType: match?.matchType ?? '',
  }
}

function rowLocationKey(row) {
  return `${row.municipality ?? ''}|${row.location ?? ''}|${row.year ?? ''}`.toUpperCase()
}

function buildCarCrashRows(rowsByDataset) {
  const allRows = rowsByDataset.get(DERIVED_CAR_CRASHES.sourceDatasetId) ?? []
  const excludedCounts = new Map()

  for (const datasetId of DERIVED_CAR_CRASHES.excludedDatasetIds) {
    for (const row of rowsByDataset.get(datasetId) ?? []) {
      const key = rowLocationKey(row)
      excludedCounts.set(key, (excludedCounts.get(key) ?? 0) + (Number(row.crashCount) || 0))
    }
  }

  return allRows
    .map((row) => {
      const crashCount = Math.max(0, (Number(row.crashCount) || 0) - (excludedCounts.get(rowLocationKey(row)) ?? 0))
      return {
        ...row,
        dataset: DERIVED_CAR_CRASHES.id,
        datasetTitle: DERIVED_CAR_CRASHES.title,
        crashCount,
      }
    })
    .filter((row) => row.crashCount > 0)
}

function toGeoJson(rows) {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((row) => row.longitude !== '' && row.latitude !== '')
      .map((row) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(row.longitude), Number(row.latitude)],
        },
        properties: {
          dataset: row.dataset,
          datasetTitle: row.datasetTitle,
          year: row.year,
          location: row.location,
          municipality: row.municipality,
          crashCount: row.crashCount,
          sourceLocationName: row.sourceLocationName,
          geocodeMatchType: row.geocodeMatchType,
        },
      })),
  }
}

async function fetchCsv(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  return response.text()
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const intersectionIndex = await loadIntersectionIndex()
  const rowsByDataset = new Map()
  const sourceUrlByDataset = new Map()
  const manifest = {
    source: 'ICBC Tableau Public',
    sourceProfile: 'https://public.tableau.com/app/profile/icbc/vizzes#!/',
    sourceLicense: 'ICBC Open Data Licence',
    city: 'Prince George',
    yearStart: YEARS[0],
    yearEnd: YEARS[YEARS.length - 1],
    generatedAt: new Date().toISOString(),
    datasets: [],
  }

  for (const dataset of TABLEAU_EXPORTS) {
    sourceUrlByDataset.set(dataset.id, tableauCsvUrl(dataset))

    const rows = []
    for (const year of YEARS) {
      const url = tableauCsvUrl(dataset, year)
      const rawRows = parseCsv(await fetchCsv(url))
      for (const raw of rawRows) {
        if (!dataset.rowFilter(raw)) continue
        rows.push(normalizeRow(raw, dataset, year, intersectionIndex))
      }
    }

    const geojson = toGeoJson(rows)
    rowsByDataset.set(dataset.id, rows)

    await writeFile(path.join(OUTPUT_DIR, dataset.outputCsv), toCsv(rows))
    await writeFile(path.join(OUTPUT_DIR, dataset.outputGeojson), `${JSON.stringify(geojson)}\n`)

    manifest.datasets.push({
      id: dataset.id,
      title: dataset.title,
      sourceUrl: sourceUrlByDataset.get(dataset.id),
      csv: `/data/icbc/${dataset.outputCsv}`,
      geojson: `/data/icbc/${dataset.outputGeojson}`,
      rows: rows.length,
      geocodedRows: geojson.features.length,
      yearStart: YEARS[0],
      yearEnd: YEARS[YEARS.length - 1],
      fields: rows.length > 0 ? Object.keys(rows[0]) : [],
    })

    console.log(`${dataset.title}: wrote ${rows.length} rows across ${YEARS.length} years, ${geojson.features.length} geocoded`)
  }

  const carRows = buildCarCrashRows(rowsByDataset)
  const carGeojson = toGeoJson(carRows)
  await writeFile(path.join(OUTPUT_DIR, DERIVED_CAR_CRASHES.outputCsv), toCsv(carRows))
  await writeFile(path.join(OUTPUT_DIR, DERIVED_CAR_CRASHES.outputGeojson), `${JSON.stringify(carGeojson)}\n`)

  manifest.datasets.splice(1, 0, {
    id: DERIVED_CAR_CRASHES.id,
    title: DERIVED_CAR_CRASHES.title,
    sourceUrl: sourceUrlByDataset.get(DERIVED_CAR_CRASHES.sourceDatasetId) ?? '',
    csv: `/data/icbc/${DERIVED_CAR_CRASHES.outputCsv}`,
    geojson: `/data/icbc/${DERIVED_CAR_CRASHES.outputGeojson}`,
    rows: carRows.length,
    geocodedRows: carGeojson.features.length,
    yearStart: YEARS[0],
    yearEnd: YEARS[YEARS.length - 1],
    fields: carRows.length > 0 ? Object.keys(carRows[0]) : [],
  })

  console.log(`${DERIVED_CAR_CRASHES.title}: wrote ${carRows.length} rows, ${carGeojson.features.length} geocoded`)

  await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
