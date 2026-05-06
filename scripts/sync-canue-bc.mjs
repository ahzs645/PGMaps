import { createInterface } from 'node:readline'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
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
const latestOnly = args['all-years'] !== 'true'
let boundaryIndex = []

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
  return yy >= 90 ? 1900 + yy : 2000 + yy
}

function datasetIdFromCsvName(name) {
  return path.basename(name, '.csv').replace(/_\d{2}$/, '')
}

function outputName(datasetId, year) {
  return `${datasetId}_${year}_${PROVINCE.toLowerCase()}.csv`
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

async function loadBoundaryIndex() {
  if (!BOUNDARY_PATH) return []
  const geojson = JSON.parse(await readFile(BOUNDARY_PATH, 'utf8'))
  const features = (geojson.features || []).filter((feature) => feature.geometry)
  return features.map((feature) => ({
    feature,
    bbox: bbox(feature),
  }))
}

function isInsideBoundary(longitude, latitude) {
  if (!boundaryIndex.length) return true
  const lng = Number(longitude)
  const lat = Number(latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false
  const pt = point([lng, lat])

  return boundaryIndex.some((entry) => {
    const [minLng, minLat, maxLng, maxLat] = entry.bbox
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
    return booleanPointInPolygon(pt, entry.feature)
  })
}

async function loadLocations(zipPath, year) {
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

  return locations
}

async function extractVariableCsv({ zipPath, member, datasetId, label, category, year }) {
  const locations = await loadLocations(zipPath, year)
  const relativeOutput = path.posix.join('annual', outputName(datasetId, year))
  const absoluteOutput = path.join(OUTPUT_DIR, relativeOutput)
  await mkdir(path.dirname(absoluteOutput), { recursive: true })

  const output = createWriteStream(absoluteOutput)
  const rl = createInterface({ input: unzipStream(zipPath, member), crlfDelay: Infinity })
  let headers = null
  let postalIndex = -1
  let provinceIndex = -1
  let rows = 0
  let withCoordinates = 0
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
      output.write(['postalcode', 'province', 'year', 'latitude', 'longitude', 'community', ...variables].join(',') + '\n')
      continue
    }

    const province = String(values[provinceIndex] || '').toUpperCase()
    const postalCode = normalizePostalCode(values[postalIndex])
    if (province !== PROVINCE && !postalCode.startsWith('V')) continue
    const location = locations.get(postalCode)
    if (!location) continue
    if (location.latitude && location.longitude) withCoordinates += 1
    const variableValues = variableIndexes.map((entry) => values[entry.index] ?? '')
    output.write(
      [postalCode, province || PROVINCE, year, location.latitude, location.longitude, location.community, ...variableValues]
        .map(csvValue)
        .join(',') + '\n',
    )
    rows += 1
  }

  await new Promise((resolve, reject) => {
    output.end(resolve)
    output.on('error', reject)
  })

  return {
    datasetId,
    label,
    category,
    year,
    sourceMember: member,
    output: `/data/canue/bc/${relativeOutput}`,
    rowCount: rows,
    coordinateCount: withCoordinates,
    variables,
  }
}

function selectVariableMembers(members) {
  const variableMembers = members
    .filter((member) => member.endsWith('.csv'))
    .filter((member) => !member.startsWith('DMTI_SLI_'))
    .map((member) => ({ member, year: yearFromName(member), datasetId: datasetIdFromCsvName(member) }))
    .filter((entry) => entry.year && entry.datasetId)

  const filteredByYear = requestedYears.size
    ? variableMembers.filter((entry) => requestedYears.has(String(entry.year)))
    : variableMembers

  if (!latestOnly || requestedYears.size) return filteredByYear

  const latest = filteredByYear.reduce((best, entry) => (!best || entry.year > best.year ? entry : best), null)
  return latest ? [latest] : []
}

async function main() {
  boundaryIndex = await loadBoundaryIndex()
  if (boundaryIndex.length) {
    console.log(`CANUE: clipping postal-code locations to ${path.relative(process.cwd(), BOUNDARY_PATH)}`)
  }
  const zips = await findZips(path.join(SOURCE_DIR, 'Annual'))
  await rm(OUTPUT_DIR, { recursive: true, force: true })
  await mkdir(path.join(OUTPUT_DIR, 'annual'), { recursive: true })

  const files = []
  const datasets = []

  for (const zipPath of zips) {
    const members = await unzipList(zipPath)
    const variableMembers = selectVariableMembers(members)
    if (variableMembers.length === 0) continue

    const relativeDir = path.relative(path.join(SOURCE_DIR, 'Annual'), path.dirname(zipPath))
    const [category = 'CANUE', label = path.basename(path.dirname(zipPath))] = relativeDir.split(path.sep)
    const datasetFiles = []

    for (const entry of variableMembers) {
      const extracted = await extractVariableCsv({
        zipPath,
        member: entry.member,
        datasetId: entry.datasetId,
        label,
        category,
        year: entry.year,
      })
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
    datasets,
    files,
  }
  await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`CANUE: wrote ${files.length} BC files to ${OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
