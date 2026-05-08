import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { bbox, booleanPointInPolygon, point } from '@turf/turf'

const DEFAULT_MANIFEST = 'public/data/canue/bc/manifest.json'
const DEFAULT_OUTPUT = 'public/data/canue/bc/postal-boundary-membership.json'

const BOUNDARY_LEVELS = [
  {
    key: 'healthAuthority',
    path: 'public/data/boundaries/BCMoH/simplified/health_authorities.json',
    idField: 'HLTH_AUTHORITY_CODE',
    nameField: 'HLTH_AUTHORITY_NAME',
  },
  {
    key: 'hsda',
    path: 'public/data/boundaries/BCMoH/simplified/health_service_delivery_areas.json',
    idField: 'HLTH_SERVICE_DLVR_AREA_CODE',
    nameField: 'HLTH_SERVICE_DLVR_AREA_NAME',
  },
  {
    key: 'lha',
    path: 'public/data/boundaries/BCMoH/simplified/local_health_areas.json',
    idField: 'LOCAL_HLTH_AREA_CODE',
    nameField: 'LOCAL_HLTH_AREA_NAME',
  },
  {
    key: 'chsa',
    path: 'public/data/boundaries/BCMoH/simplified/community_health_service_areas.json',
    idField: 'CMNTY_HLTH_SERV_AREA_CODE',
    nameField: 'CMNTY_HLTH_SERV_AREA_NAME',
  },
  {
    key: 'cd',
    path: 'public/data/census/prince_george_cd.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  {
    key: 'csd',
    path: 'public/data/census/prince_george_csd.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  {
    key: 'ct',
    path: 'public/data/census/prince_george_ct.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  {
    key: 'da',
    path: 'public/data/census/prince_george_da.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  {
    key: 'db',
    path: 'public/data/census/prince_george_db.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  {
    key: 'elementarySchoolCatchment',
    path: 'public/data/boundaries/CityPG/elementary_school_catchments.geojson',
    idField: 'OBJECTID',
    nameField: 'SchoolName',
  },
  {
    key: 'secondarySchoolCatchment',
    path: 'public/data/boundaries/CityPG/secondary_school_catchments.geojson',
    idField: 'OBJECTID',
    nameField: 'SchoolNam',
  },
]

const args = parseArgs(process.argv.slice(2))
const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST)
const outputPath = path.resolve(args.output || DEFAULT_OUTPUT)

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

function normalizePostalCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase()
}

async function loadBoundaryLevel(config) {
  const geojson = JSON.parse(await readFile(path.resolve(config.path), 'utf8'))
  return {
    ...config,
    features: (geojson.features || [])
      .filter((feature) => feature.geometry)
      .map((feature, index) => ({
        feature,
        bbox: bbox(feature),
        id: String(feature.properties?.[config.idField] ?? feature.id ?? index),
        name: String(feature.properties?.[config.nameField] ?? feature.properties?.name ?? feature.id ?? index),
      })),
  }
}

function findBoundary(level, longitude, latitude) {
  const lng = Number(longitude)
  const lat = Number(latitude)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const pt = point([lng, lat])

  return level.features.find((entry) => {
    const [minLng, minLat, maxLng, maxLat] = entry.bbox
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false
    return booleanPointInPolygon(pt, entry.feature)
  }) ?? null
}

async function loadPostalPoints(manifest) {
  const postalPoints = new Map()

  for (const file of manifest.files || []) {
    const sourcePath = path.resolve('public', file.output.replace(/^\/+data\//, 'data/'))
    const input = sourcePath.endsWith('.gz')
      ? createReadStream(sourcePath).pipe(createGunzip())
      : createReadStream(sourcePath)
    const rl = createInterface({ input, crlfDelay: Infinity })
    let headers = null
    let postalIndex = -1
    let latitudeIndex = -1
    let longitudeIndex = -1
    let communityIndex = -1

    for await (const line of rl) {
      if (!line) continue
      const values = splitCsvLine(line)
      if (!headers) {
        headers = values
        postalIndex = headers.indexOf('postalcode')
        latitudeIndex = headers.indexOf('latitude')
        longitudeIndex = headers.indexOf('longitude')
        communityIndex = headers.indexOf('community')
        continue
      }

      const postalcode = normalizePostalCode(values[postalIndex])
      if (!postalcode || postalPoints.has(postalcode)) continue
      postalPoints.set(postalcode, {
        postalcode,
        latitude: Number(values[latitudeIndex]),
        longitude: Number(values[longitudeIndex]),
        community: values[communityIndex] || '',
      })
    }
  }

  return Array.from(postalPoints.values())
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const [postalPoints, boundaryLevels] = await Promise.all([
    loadPostalPoints(manifest),
    Promise.all(BOUNDARY_LEVELS.map(loadBoundaryLevel)),
  ])

  const records = postalPoints.map((postalPoint) => {
    const boundaries = {}
    for (const level of boundaryLevels) {
      const boundary = findBoundary(level, postalPoint.longitude, postalPoint.latitude)
      if (boundary) boundaries[level.key] = boundary.id
    }
    return { postalcode: postalPoint.postalcode, boundaries }
  })

  const levelMetadata = Object.fromEntries(
    boundaryLevels.map((level) => [
      level.key,
      {
        path: level.path,
        idField: level.idField,
        nameField: level.nameField,
        featureCount: level.features.length,
      },
    ]),
  )

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceManifest: '/data/canue/bc/manifest.json',
    levels: levelMetadata,
    records,
  })}\n`)

  console.log(`CANUE membership: wrote ${records.length} postal codes to ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
