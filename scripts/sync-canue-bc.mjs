import { createInterface } from 'node:readline'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { booleanPointInPolygon, bbox, point } from '@turf/turf'

const DEFAULT_SOURCE =
  '/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/University/Research/Grad/Data/Canue'
const DEFAULT_OUTPUT = 'public/data/canue/bc'
const DEFAULT_BC_BOUNDARY = 'public/data/boundaries/BCMoH/simplified/health_authorities.json'

const args = parseArgs(process.argv.slice(2))
const SOURCE_DIR = path.resolve(args.source || process.env.PG_CANUE_DIR || DEFAULT_SOURCE)
const OUTPUT_DIR = path.resolve(args.output || DEFAULT_OUTPUT)
const BOUNDARY_PATH = args['boundary-path'] === 'none'
  ? null
  : path.resolve(args['boundary-path'] || DEFAULT_BC_BOUNDARY)
const PROVINCE = String(args.province || 'BC').toUpperCase()
const requestedYears = new Set(
  String(args.years || '')
    .split(',')
    .map((year) => year.trim())
    .filter(Boolean),
)
const requestedCadence = String(args.cadence || 'annual').toLowerCase()
const includePatterns = String(args.include || '')
  .split(',')
  .map((pattern) => pattern.trim())
  .filter(Boolean)
  .map((pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`))
const latestOnly = args['all-years'] !== 'true'
const resume = args.resume === 'true'
const gzipOutput = args.gzip === 'true'
const outputDataDir = gzipOutput ? 'annual-gzip' : 'annual'
let boundaryIndex = []
const locationCache = new Map()

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

function unzipStream(zipPath, member) {
  const child = spawn('unzip', ['-p', zipPath, member], { stdio: ['ignore', 'pipe', 'inherit'] })
  child.on('error', (error) => {
    throw error
  })
  return child.stdout
}

function byteCount(text) {
  return Buffer.byteLength(text)
}

function unzipList(zipPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-Z1', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `unzip failed for ${zipPath}`))
        return
      }
      resolve(stdout.split(/\r?\n/).filter(Boolean))
    })
  })
}

function findZips(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn('find', [dir, '-name', '*.zip', '-type', 'f'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `find failed for ${dir}`))
        return
      }
      resolve(stdout.split(/\r?\n/).filter(Boolean).sort())
    })
  })
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

function csvValue(value) {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function yearFromName(name) {
  const match = name.match(/_(\d{2})\.csv$/)
  if (!match) return null
  const yy = Number(match[1])
  return yy >= 80 ? 1900 + yy : 2000 + yy
}

function datasetIdFromCsvName(name) {
  return path.basename(name, '.csv').replace(/_\d{2}$/, '')
}

function archiveDatasetId(zipPath) {
  const base = path.basename(zipPath, '.zip')
  return base.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(annual|monthly)$/i, '')
}

function archiveCadence(zipPath) {
  const match = path.basename(zipPath).match(/_(annual|monthly)\.zip$/i)
  return match ? match[1].toLowerCase() : 'annual'
}

function cadenceEnabled(cadence) {
  return requestedCadence === 'both' || requestedCadence === cadence
}

function datasetEnabled(datasetId) {
  return includePatterns.length === 0 || includePatterns.some((pattern) => pattern.test(datasetId))
}

function outputName(datasetId, year) {
  return `${datasetId}_${year}_${PROVINCE.toLowerCase()}.csv`
}

async function summarizeExistingCsv({ absoluteOutput, relativeOutput, datasetId, label, category, year, cadence, member }) {
  const rl = createInterface({ input: createReadStream(absoluteOutput), crlfDelay: Infinity })
  let headers = null
  let rows = 0
  let withCoordinates = 0
  let latitudeIndex = -1
  let longitudeIndex = -1
  let variables = []

  for await (const line of rl) {
    if (!line) continue
    const values = splitCsvLine(line)
    if (!headers) {
      headers = values.map(normalizeHeader)
      latitudeIndex = headers.indexOf('latitude')
      longitudeIndex = headers.indexOf('longitude')
      variables = headers.filter((header) => !['postalcode', 'province', 'year', 'latitude', 'longitude', 'community'].includes(header))
      continue
    }

    rows += 1
    if (values[latitudeIndex] && values[longitudeIndex]) withCoordinates += 1
  }

  return {
    datasetId,
    label,
    category,
    cadence,
    year,
    sourceMember: member,
    output: `/data/canue/bc/${relativeOutput}`,
    rowCount: rows,
    coordinateCount: withCoordinates,
    variables,
  }
}

function normalizePostalCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase()
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim()
}

function toSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function loadBoundaryIndex(boundaryPath, idField, nameField) {
  if (!boundaryPath) return []
  const geojson = JSON.parse(await readFile(boundaryPath, 'utf8'))
  const features = (geojson.features || []).filter((feature) => feature.geometry)
  return features.map((feature) => ({
    feature,
    bbox: bbox(feature),
    id: idField ? String(feature.properties?.[idField] ?? feature.id ?? '') : '',
    name: nameField ? String(feature.properties?.[nameField] ?? feature.properties?.name ?? feature.id ?? '') : '',
  }))
}

function findBoundary(index, longitude, latitude) {
  if (!index.length) return null
  const lng = Number(longitude)
  const lat = Number(latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const pt = point([lng, lat])

  return index.find((entry) => {
    const [minLng, minLat, maxLng, maxLat] = entry.bbox
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
    return booleanPointInPolygon(pt, entry.feature)
  }) ?? null
}

function isInsideBoundary(longitude, latitude) {
  if (!boundaryIndex.length) return true
  return Boolean(findBoundary(boundaryIndex, longitude, latitude))
}

async function loadLocations(zipPath, year) {
  if (locationCache.has(year)) return locationCache.get(year)
  const yy = String(year).slice(-2)
  const member = `DMTI_SLI_${yy}.csv`
  const locations = new Map()
  const rl = createInterface({ input: unzipStream(zipPath, member), crlfDelay: Infinity })
  let headers = null

  for await (const line of rl) {
    if (!line) continue
    const values = splitCsvLine(line)
    if (!headers) {
      headers = values.map(normalizeHeader)
      continue
    }
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
    if (String(row.PROV_16 || row[`PROV_${yy}`] || '').toUpperCase() !== PROVINCE) continue
    const postalCode = normalizePostalCode(row.POSTALCODE16 || row[`POSTALCODE${yy}`])
    if (!postalCode) continue
    const latitude = row.LATITUDE_16 || row[`LATITUDE_${yy}`] || ''
    const longitude = row.LONGITUDE_16 || row[`LONGITUDE_${yy}`] || ''
    if (!isInsideBoundary(longitude, latitude)) continue
    locations.set(postalCode, {
      latitude,
      longitude,
      community: row.COMM_NAME_16 || row[`COMM_NAME_${yy}`] || '',
    })
  }

  locationCache.set(year, locations)
  return locations
}

async function extractVariableCsv({ zipPath, member, datasetId, label, category, year, cadence }) {
  const relativeOutput = path.posix.join(outputDataDir, `${outputName(datasetId, year)}${gzipOutput ? '.gz' : ''}`)
  const absoluteOutput = path.join(OUTPUT_DIR, relativeOutput)
  if (resume && existsSync(absoluteOutput)) {
    return summarizeExistingCsv({ absoluteOutput, relativeOutput, datasetId, label, category, year, cadence, member })
  }

  const locations = await loadLocations(zipPath, year)
  await mkdir(path.dirname(absoluteOutput), { recursive: true })

  const fileOutput = createWriteStream(absoluteOutput)
  const gzip = gzipOutput ? createGzip({ level: 9 }) : null
  const output = gzip ?? fileOutput
  if (gzip) gzip.pipe(fileOutput)
  const rl = createInterface({ input: unzipStream(zipPath, member), crlfDelay: Infinity })
  let headers = null
  let postalIndex = -1
  let provinceIndex = -1
  let rows = 0
  let withCoordinates = 0
  let sourceSize = 0
  let variables = []
  let variableIndexes = []

  for await (const line of rl) {
    if (!line) continue
    const values = splitCsvLine(line)
    if (!headers) {
      headers = values.map(normalizeHeader)
      postalIndex = headers.findIndex((header) => /^postalcode\d{2}$/i.test(header))
      provinceIndex = headers.findIndex((header) => /^province$/i.test(header))
      variableIndexes = headers
        .map((header, index) => ({ header, index }))
        .filter((entry) => entry.index !== postalIndex && entry.index !== provinceIndex)
      variables = variableIndexes.map((entry) => entry.header)
      const outputLine = ['postalcode', 'province', 'year', 'latitude', 'longitude', 'community', ...variables].join(',') + '\n'
      sourceSize += byteCount(outputLine)
      output.write(outputLine)
      continue
    }

    const province = String(values[provinceIndex] || '').toUpperCase()
    const postalCode = normalizePostalCode(values[postalIndex])
    if (province !== PROVINCE && !postalCode.startsWith('V')) continue
    const location = locations.get(postalCode)
    if (!location) continue
    if (location.latitude && location.longitude) withCoordinates += 1
    const variableValues = variableIndexes.map((entry) => values[entry.index] ?? '')
    const outputLine = [postalCode, province || PROVINCE, year, location.latitude, location.longitude, location.community, ...variableValues]
      .map(csvValue)
      .join(',') + '\n'
    sourceSize += byteCount(outputLine)
    output.write(outputLine)
    rows += 1
  }

  await new Promise((resolve, reject) => {
    output.end()
    fileOutput.on('finish', resolve)
    output.on('error', reject)
    fileOutput.on('error', reject)
  })
  const outputStats = await stat(absoluteOutput)

  return {
    datasetId,
    label,
    category,
    cadence,
    year,
    sourceMember: member,
    output: `/data/canue/bc/${relativeOutput}`,
    rowCount: rows,
    coordinateCount: withCoordinates,
    variables,
    ...(gzipOutput ? {
      compression: 'gzip',
      sourceCsv: `/data/canue/bc/annual/${outputName(datasetId, year)}`,
      sourceSize,
      gzipSize: outputStats.size,
      compressionRatio: sourceSize ? Number((outputStats.size / sourceSize).toFixed(4)) : null,
    } : {}),
  }
}

function selectVariableMembers(members, zipPath) {
  const cadence = archiveCadence(zipPath)
  const archiveId = archiveDatasetId(zipPath)
  const variableMembers = members
    .filter((member) => member.endsWith('.csv'))
    .filter((member) => !member.startsWith('DMTI_SLI_'))
    .map((member) => ({
      member,
      year: yearFromName(member),
      datasetId: cadence === 'monthly' ? archiveId : datasetIdFromCsvName(member),
      cadence,
    }))
    .filter((entry) => entry.year && entry.datasetId)

  const filteredByYear = requestedYears.size
    ? variableMembers.filter((entry) => requestedYears.has(String(entry.year)))
    : variableMembers

  if (!latestOnly || requestedYears.size) return filteredByYear

  const latest = filteredByYear.reduce((best, entry) => (!best || entry.year > best.year ? entry : best), null)
  return latest ? [latest] : []
}

async function main() {
  boundaryIndex = await loadBoundaryIndex(BOUNDARY_PATH)
  if (boundaryIndex.length) {
    console.log(`CANUE: clipping postal-code locations to ${path.relative(process.cwd(), BOUNDARY_PATH)}`)
  }
  const annualRoot = path.join(SOURCE_DIR, 'Annual')
  const monthlyRoot = path.join(SOURCE_DIR, 'Monthly')
  const allZips = await findZips(SOURCE_DIR)
  const zips = allZips.filter((zipPath) => {
    const cadence = archiveCadence(zipPath)
    const datasetId = archiveDatasetId(zipPath)
    if (!cadenceEnabled(cadence)) return false
    if (!datasetEnabled(datasetId)) return false
    if (zipPath.includes(`${path.sep}Annual${path.sep}`)) return cadence === 'annual'
    if (zipPath.includes(`${path.sep}Monthly${path.sep}`)) return cadence === 'monthly'
    return path.dirname(zipPath) === SOURCE_DIR
  })
  if (!resume) await rm(OUTPUT_DIR, { recursive: true, force: true })
  await mkdir(path.join(OUTPUT_DIR, outputDataDir), { recursive: true })

  const files = []
  const datasets = []
  const skippedArchives = []
  const seenOutputs = new Set()

  for (const zipPath of zips) {
    let members = []
    try {
      members = await unzipList(zipPath)
    } catch (error) {
      skippedArchives.push({
        sourceArchive: path.relative(SOURCE_DIR, zipPath),
        reason: (error instanceof Error ? error.message : String(error)).trim(),
      })
      console.warn(`CANUE: skipped unreadable archive ${path.relative(SOURCE_DIR, zipPath)}`)
      continue
    }
    const variableMembers = selectVariableMembers(members, zipPath)
    if (variableMembers.length === 0) continue

    const cadence = archiveCadence(zipPath)
    const root = zipPath.includes(`${path.sep}Monthly${path.sep}`) ? monthlyRoot : annualRoot
    const relativeDir = path.relative(root, path.dirname(zipPath))
    const archiveId = archiveDatasetId(zipPath)
    const [category = cadence === 'monthly' ? 'CANUE Monthly' : 'CANUE', label = archiveId] =
      relativeDir && !relativeDir.startsWith('..') && relativeDir !== '.'
        ? relativeDir.split(path.sep)
        : [cadence === 'monthly' ? 'CANUE Monthly' : 'CANUE', archiveId]
    const datasetFiles = []

    for (const entry of variableMembers) {
      const output = `/data/canue/bc/${path.posix.join(outputDataDir, `${outputName(entry.datasetId, entry.year)}${gzipOutput ? '.gz' : ''}`)}`
      if (seenOutputs.has(output)) continue
      const extracted = await extractVariableCsv({
        zipPath,
        member: entry.member,
        datasetId: entry.datasetId,
        label,
        category,
        year: entry.year,
        cadence: entry.cadence,
      })
      seenOutputs.add(extracted.output)
      files.push(extracted)
      datasetFiles.push(extracted)
      console.log(`${extracted.datasetId} ${extracted.year}: ${extracted.rowCount} ${PROVINCE} rows`)
    }

    datasets.push({
      id: toSlug(label),
      label,
      category,
      sourceArchive: path.relative(SOURCE_DIR, zipPath),
      files: datasetFiles.map((file) => file.output),
    })
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_DIR,
    province: PROVINCE,
    boundaryClip: BOUNDARY_PATH ? path.relative(process.cwd(), BOUNDARY_PATH) : null,
    mode: latestOnly && requestedYears.size === 0 ? 'latest-year-per-dataset' : 'selected-years',
    include: includePatterns.length ? String(args.include || '').split(',').map((pattern) => pattern.trim()).filter(Boolean) : null,
    skippedArchives,
    datasets,
    files,
  }
  await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (gzipOutput) {
    await writeFile(path.join(OUTPUT_DIR, outputDataDir, 'manifest.json'), `${JSON.stringify({
      ...manifest,
      compression: {
        format: 'gzip',
        level: 9,
        sourceBytes: files.reduce((sum, file) => sum + (file.sourceSize || 0), 0),
        gzipBytes: files.reduce((sum, file) => sum + (file.gzipSize || 0), 0),
      },
    }, null, 2)}\n`)
  }
  console.log(`CANUE: wrote ${files.length} BC files to ${OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
