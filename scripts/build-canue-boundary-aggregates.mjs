import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { bbox, booleanPointInPolygon, point } from '@turf/turf'

const DEFAULT_MANIFEST = 'public/data/canue/bc/manifest.json'
const DEFAULT_BOUNDARY = 'public/data/boundaries/BCMoH/simplified/community_health_service_areas.json'
const DEFAULT_OUTPUT = 'public/data/canue/bc/boundaries/chsa'

const args = parseArgs(process.argv.slice(2))
const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST)
const boundaryPath = path.resolve(args.boundary || DEFAULT_BOUNDARY)
const outputDir = path.resolve(args.output || DEFAULT_OUTPUT)
const boundaryIdField = args['id-field'] || 'CMNTY_HLTH_SERV_AREA_CODE'
const boundaryNameField = args['name-field'] || 'CMNTY_HLTH_SERV_AREA_NAME'
const outputLevel = args.level || 'chsa'

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
    } else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

function splitCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }

  values.push(value)
  return values
}

function buildBoundaryIndex(boundaries) {
  return boundaries.features.map((feature, index) => ({
    index,
    feature,
    bbox: bbox(feature),
    id: String(feature.properties?.[boundaryIdField] ?? feature.id ?? index),
    name: String(feature.properties?.[boundaryNameField] ?? feature.properties?.name ?? feature.id ?? index),
  }))
}

function findBoundary(boundaryIndex, longitude, latitude) {
  const lng = Number(longitude)
  const lat = Number(latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const pt = point([lng, lat])

  return boundaryIndex.find((entry) => {
    const [minLng, minLat, maxLng, maxLat] = entry.bbox
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
    return booleanPointInPolygon(pt, entry.feature)
  }) ?? null
}

function createAccumulator(boundaryIndex, variables) {
  return boundaryIndex.map((boundary) => ({
    boundary,
    rowCount: 0,
    variables: Object.fromEntries(
      variables.map((variable) => [
        variable,
        { sum: 0, count: 0, min: null, max: null },
      ]),
    ),
  }))
}

async function aggregateFile(file, boundaryIndex, boundaries) {
  const sourcePath = path.resolve('public', file.output.replace(/^\/+data\//, 'data/'))
  const rl = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity })
  let headers = null
  let latitudeIndex = -1
  let longitudeIndex = -1
  let matchedRows = 0
  const accumulator = createAccumulator(boundaryIndex, file.variables)

  for await (const line of rl) {
    if (!line) continue
    const values = splitCsvLine(line)
    if (!headers) {
      headers = values
      latitudeIndex = headers.indexOf('latitude')
      longitudeIndex = headers.indexOf('longitude')
      continue
    }

    const boundary = findBoundary(boundaryIndex, values[longitudeIndex], values[latitudeIndex])
    if (!boundary) continue
    const bucket = accumulator[boundary.index]
    bucket.rowCount += 1
    matchedRows += 1

    for (const variable of file.variables) {
      const index = headers.indexOf(variable)
      if (index < 0) continue
      const value = Number(values[index])
      if (!Number.isFinite(value) || value === -9999) continue
      const stats = bucket.variables[variable]
      stats.sum += value
      stats.count += 1
      stats.min = stats.min == null ? value : Math.min(stats.min, value)
      stats.max = stats.max == null ? value : Math.max(stats.max, value)
    }
  }

  const features = boundaries.features.map((feature, index) => {
    const bucket = accumulator[index]
    const properties = {
      ...feature.properties,
      boundaryId: bucket.boundary.id,
      boundaryName: bucket.boundary.name,
      datasetId: file.datasetId,
      datasetLabel: file.label,
      category: file.category,
      year: file.year,
      rowCount: bucket.rowCount,
    }

    for (const variable of file.variables) {
      const stats = bucket.variables[variable]
      properties[variable] = stats.count > 0 ? stats.sum / stats.count : null
      properties[`${variable}_count`] = stats.count
      properties[`${variable}_min`] = stats.min
      properties[`${variable}_max`] = stats.max
    }

    return {
      ...feature,
      id: bucket.boundary.id,
      properties,
    }
  })

  const relativeOutput = `${file.datasetId}_${file.year}_${outputLevel}.geojson`
  const outputPath = path.join(outputDir, relativeOutput)
  await writeFile(outputPath, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`)

  return {
    datasetId: file.datasetId,
    label: file.label,
    category: file.category,
    year: file.year,
    level: outputLevel,
    output: `/data/canue/bc/boundaries/${outputLevel}/${relativeOutput}`,
    boundaryCount: features.length,
    sourceRowCount: file.rowCount,
    matchedRowCount: matchedRows,
    variables: file.variables,
  }
}

async function main() {
  const [manifest, boundaries] = await Promise.all([
    readFile(manifestPath, 'utf8').then(JSON.parse),
    readFile(boundaryPath, 'utf8').then(JSON.parse),
  ])
  const boundaryIndex = buildBoundaryIndex(boundaries)

  await mkdir(outputDir, { recursive: true })
  const files = []

  for (const file of manifest.files) {
    const aggregated = await aggregateFile(file, boundaryIndex, boundaries)
    files.push(aggregated)
    console.log(
      `${aggregated.datasetId} ${aggregated.year}: ${aggregated.matchedRowCount}/${aggregated.sourceRowCount} rows into ${aggregated.boundaryCount} ${outputLevel} boundaries`,
    )
  }

  const aggregateManifest = {
    generatedAt: new Date().toISOString(),
    sourceManifest: `/data/canue/bc/manifest.json`,
    boundary: path.relative(process.cwd(), boundaryPath),
    level: outputLevel,
    idField: boundaryIdField,
    nameField: boundaryNameField,
    files,
  }
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(aggregateManifest, null, 2)}\n`)
  console.log(`CANUE boundaries: wrote ${files.length} files to ${outputDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
