import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataRoot = join(root, 'public', 'data')
const outputDirectory = join(dataRoot, 'boundary-search')

const SOURCE_METADATA = {
  cityCommunity: { label: 'Community polygons', group: 'Local' },
  cityPG: { label: 'School catchments', group: 'Local' },
  bcHealth: { label: 'Health boundaries', group: 'Administrative' },
  bcEr: { label: 'BCER admin zones', group: 'Administrative' },
  regionalDistrict: { label: 'Regional district', group: 'Administrative' },
  bcMunicipality: { label: 'Municipalities', group: 'Administrative' },
  census: { label: 'Census boundaries', group: 'Administrative' },
  watershed: { label: 'Watershed boundaries', group: 'Natural / resource' },
  namedWatershed: { label: 'Named watersheds', group: 'Natural / resource' },
  bcDrainage: { label: 'BC drainage basins', group: 'Natural / resource' },
  bcWildfire: { label: 'BC fire zones', group: 'Natural / resource' },
  bcRfc: { label: 'BC RFC basins', group: 'Natural / resource' },
  nrAdmin: { label: 'Natural Resource admin', group: 'Natural / resource' },
}

const LEVEL_LABELS = {
  communityPolygon: 'Community polygons',
  elementarySchoolCatchment: 'Elementary School Catchment',
  secondarySchoolCatchment: 'Secondary School Catchment',
  healthAuthority: 'Health Authority',
  hsda: 'HSDA',
  lha: 'LHA',
  chsa: 'CHSA',
  bcerAdminZone: 'Administrative Zone',
  regionalDistrict: 'Regional District',
  municipality: 'Municipality',
  cd: 'Census Division',
  csd: 'Census Subdivision',
  northSouthCsd: 'North / South CSDs',
  ct: 'Census Tract',
  da: 'Dissemination Area',
  majorWatershed: 'Major River Basin',
  watershedGroup: 'Watershed Group',
  assessmentWatershed: 'Assessment Watershed',
  oceanDrainageArea: 'Ocean Drainage Area',
  drainageRegion: 'Drainage Region',
  fireCentre: 'Fire Centre',
  fireZone: 'Fire Zone',
  rfcSnowBasin: 'RFC Snow Basin',
  nrArea: 'NR Area',
  nrRegion: 'NR Region',
  nrDistrict: 'NR District',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `namedWatershedOrder${index + 1}`,
    `Stream Order ${index + 1}`,
  ])),
}

function normalizeSearchText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function readJson(relativePath) {
  const path = join(dataRoot, relativePath)
  if (!existsSync(path)) throw new Error(`Missing boundary search source: public/data/${relativePath}`)
  const bytes = await readFile(path)
  const text = relativePath.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
  return JSON.parse(text)
}

function scalarFields(properties) {
  return Object.entries(properties ?? {})
    .filter(([key, value]) => (
      typeof value === 'string'
      || typeof value === 'boolean'
      || (typeof value === 'number' && /(id|code|uid|object)/i.test(key))
    ))
    .map(([key, value]) => [key, String(value).trim()])
    .filter(([, value]) => value.length > 0 && value.length <= 240)
}

function isInheritedHierarchyField(source, level, key) {
  if (/^parent/i.test(key)) return true

  if (source === 'census') {
    if (level === 'da') return /^(?:PRUID|CD(?:UID|NAME|TYPE)|CSD(?:UID|NAME|TYPE))$/i.test(key)
    if (level === 'csd' || level === 'northSouthCsd') return /^(?:PRUID|CD(?:UID|NAME|TYPE))$/i.test(key)
    if (level === 'cd') return /^PRUID$/i.test(key)
  }

  if (source === 'bcHealth') {
    if (level === 'chsa') return /^(?:LOCAL_HLTH_AREA|HLTH_SERVICE_DLVR_AREA|HLTH_AUTHORITY)/i.test(key)
    if (level === 'lha') return /^(?:HLTH_SERVICE_DLVR_AREA|HLTH_AUTHORITY)/i.test(key)
    if (level === 'hsda') return /^HLTH_AUTHORITY/i.test(key)
  }

  if (source === 'watershed' && level === 'assessmentWatershed') {
    return /^WATERSHED_GROUP_(?:ID|CODE|NAME)$/i.test(key)
  }

  if (source === 'bcDrainage') {
    if (level === 'drainageRegion') return /^(?:ODA_|Code_ADO$)/i.test(key)
    if (level === 'oceanDrainageArea') return /^drainageRegionNames$/i.test(key)
  }

  if (source === 'bcWildfire') {
    if (level === 'fireZone') return /^FIRE_CENTRE$/i.test(key)
    if (level === 'fireCentre') return /^(?:fireZoneNames|headquarters)$/i.test(key)
  }

  return false
}

function firstValue(properties, keys, fallback = '') {
  for (const key of keys) {
    const value = properties?.[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return fallback
}

function featureBounds(feature) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      bounds[0] = Math.min(bounds[0], coordinates[0])
      bounds[1] = Math.min(bounds[1], coordinates[1])
      bounds[2] = Math.max(bounds[2], coordinates[0])
      bounds[3] = Math.max(bounds[3], coordinates[1])
      return
    }
    coordinates.forEach(visit)
  }
  visit(feature?.geometry?.coordinates)
  return bounds.every(Number.isFinite) ? bounds : null
}

function unionBounds(features) {
  const available = features.map(featureBounds).filter(Boolean)
  if (available.length === 0) return null
  return available.reduce((result, bounds) => [
    Math.min(result[0], bounds[0]),
    Math.min(result[1], bounds[1]),
    Math.max(result[2], bounds[2]),
    Math.max(result[3], bounds[3]),
  ])
}

function makeRecord({ source, level, code, name, feature, fields, bounds = featureBounds(feature) }) {
  if (!source || !level || !code || !name || !bounds) return null
  const sourceMetadata = SOURCE_METADATA[source]
  if (!sourceMetadata) throw new Error(`Missing source metadata for ${source}`)
  const levelLabel = LEVEL_LABELS[level] ?? level
  const normalizedFields = (fields ?? scalarFields(feature?.properties))
    .filter(([key]) => !isInheritedHierarchyField(source, level, key))
  const searchText = normalizeSearchText([
    name,
    code,
    sourceMetadata.label,
    sourceMetadata.group,
    levelLabel,
    ...normalizedFields.flatMap(([key, value]) => [key, value]),
  ].join(' '))

  return {
    id: `${source}:${level}:${code}`,
    source,
    sourceLabel: sourceMetadata.label,
    group: sourceMetadata.group,
    level,
    levelLabel,
    code,
    name,
    bounds,
    fields: normalizedFields,
    searchText,
  }
}

async function recordsFromFile({ source, level, path, codeKeys, nameKeys }) {
  const collection = await readJson(path)
  return (collection.features ?? []).map((feature) => {
    const properties = feature.properties ?? {}
    const code = firstValue(properties, codeKeys, feature.id == null ? '' : String(feature.id))
    const name = firstValue(properties, nameKeys, code)
    return makeRecord({ source, level, code, name, feature })
  }).filter(Boolean)
}

async function censusDaRecords() {
  const manifest = await readJson('census/bc-da-simplified/manifest.json')
  const chunks = manifest.levels?.find((level) => level.id === 'overview')?.chunks ?? manifest.chunks ?? []
  const collections = await Promise.all(chunks.map((chunk) => readJson(`census/bc-da-simplified/${chunk.path}`)))
  return collections.flatMap((collection) => (collection.features ?? []).map((feature) => {
    const properties = feature.properties ?? {}
    const code = firstValue(properties, ['boundaryCode', 'DAUID', 'id'])
    const name = firstValue(properties, ['boundaryName', 'name'], `DA ${code}`)
    return makeRecord({ source: 'census', level: 'da', code, name, feature })
  }).filter(Boolean))
}

async function drainageRecords() {
  const collection = await readJson('boundaries/BCDrainage/drainage_basins.geojson')
  const features = collection.features ?? []
  const drainageRegions = features.map((feature) => {
    const properties = feature.properties ?? {}
    const code = firstValue(properties, ['boundaryCode', 'DR_Code', 'FID'])
    const name = firstValue(properties, ['boundaryName', 'DR_Name'], code)
    return makeRecord({ source: 'bcDrainage', level: 'drainageRegion', code, name, feature })
  }).filter(Boolean)

  const byOceanArea = new Map()
  features.forEach((feature) => {
    const properties = feature.properties ?? {}
    const name = firstValue(properties, ['ODA_Name'])
    if (!name) return
    const current = byOceanArea.get(name) ?? []
    current.push(feature)
    byOceanArea.set(name, current)
  })
  const oceanAreas = [...byOceanArea.entries()].map(([name, areaFeatures]) => {
    const code = firstValue(areaFeatures[0]?.properties, ['ODA_Code'], name)
    const fields = scalarFields(areaFeatures[0]?.properties)
    fields.push(['drainageRegionNames', areaFeatures.map((feature) => firstValue(feature.properties, ['DR_Name'])).filter(Boolean).join(', ')])
    return makeRecord({
      source: 'bcDrainage',
      level: 'oceanDrainageArea',
      code,
      name,
      fields,
      bounds: unionBounds(areaFeatures),
    })
  }).filter(Boolean)
  return [...oceanAreas, ...drainageRegions]
}

async function wildfireRecords() {
  const collection = await readJson('boundaries/BCWildfire/fire_zones.geojson')
  const features = collection.features ?? []
  const zones = features.map((feature) => {
    const properties = feature.properties ?? {}
    const code = firstValue(properties, ['boundaryCode', 'FIRE_ZONE_CODE', 'OBJECTID'])
    const name = firstValue(properties, ['boundaryName', 'FIRE_ZONE'], code)
    return makeRecord({ source: 'bcWildfire', level: 'fireZone', code, name, feature })
  }).filter(Boolean)

  const byCentre = new Map()
  features.forEach((feature) => {
    const centre = firstValue(feature.properties, ['FIRE_CENTRE'])
    if (!centre) return
    const current = byCentre.get(centre) ?? []
    current.push(feature)
    byCentre.set(centre, current)
  })
  const centres = [...byCentre.entries()].map(([centre, centreFeatures]) => makeRecord({
    source: 'bcWildfire',
    level: 'fireCentre',
    code: centre,
    name: centre,
    bounds: unionBounds(centreFeatures),
    fields: [
      ['FIRE_CENTRE', centre],
      ['fireZoneNames', centreFeatures.map((feature) => firstValue(feature.properties, ['FIRE_ZONE'])).filter(Boolean).join(', ')],
      ['headquarters', centreFeatures.map((feature) => firstValue(feature.properties, ['HEADQUARTERS'])).filter(Boolean).join(', ')],
    ],
  })).filter(Boolean)
  return [...centres, ...zones]
}

const FILE_SOURCES = [
  { source: 'cityCommunity', level: 'communityPolygon', path: 'walkability/community_walkability.geojson', codeKeys: ['communityId', 'OBJECTID'], nameKeys: ['communityName', 'CommunityName'] },
  { source: 'cityPG', level: 'elementarySchoolCatchment', path: 'boundaries/CityPG/elementary_school_catchments.geojson', codeKeys: ['OBJECTID'], nameKeys: ['SchoolName'] },
  { source: 'cityPG', level: 'secondarySchoolCatchment', path: 'boundaries/CityPG/secondary_school_catchments.geojson', codeKeys: ['OBJECTID'], nameKeys: ['SchoolNam'] },
  { source: 'bcHealth', level: 'healthAuthority', path: 'boundaries/BCMoH/simplified/health_authorities.json', codeKeys: ['HLTH_AUTHORITY_CODE'], nameKeys: ['HLTH_AUTHORITY_NAME'] },
  { source: 'bcHealth', level: 'hsda', path: 'boundaries/BCMoH/simplified/health_service_delivery_areas.json', codeKeys: ['HLTH_SERVICE_DLVR_AREA_CODE'], nameKeys: ['HLTH_SERVICE_DLVR_AREA_NAME'] },
  { source: 'bcHealth', level: 'lha', path: 'boundaries/BCMoH/simplified/local_health_areas.json', codeKeys: ['LOCAL_HLTH_AREA_CODE'], nameKeys: ['LOCAL_HLTH_AREA_NAME'] },
  { source: 'bcHealth', level: 'chsa', path: 'boundaries/BCMoH/simplified/community_health_service_areas.json', codeKeys: ['CMNTY_HLTH_SERV_AREA_CODE'], nameKeys: ['CMNTY_HLTH_SERV_AREA_NAME'] },
  { source: 'bcEr', level: 'bcerAdminZone', path: 'boundaries/BCER/admin_zones.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName', 'NAME'] },
  { source: 'regionalDistrict', level: 'regionalDistrict', path: 'boundaries/BC/regional_districts.geojson', codeKeys: ['ADMIN_AREA_ABBREVIATION', 'LGL_ADMIN_AREA_ID'], nameKeys: ['ADMIN_AREA_NAME'] },
  { source: 'bcMunicipality', level: 'municipality', path: 'boundaries/BC/municipalities.geojson', codeKeys: ['boundaryCode', 'ADMIN_AREA_ABBREVIATION', 'LGL_ADMIN_AREA_ID'], nameKeys: ['boundaryName', 'ADMIN_AREA_NAME'] },
  { source: 'census', level: 'cd', path: 'census/bc-da-simplified/parents/cd.geojson', codeKeys: ['boundaryCode', 'id', 'CDUID'], nameKeys: ['boundaryName', 'name', 'CDNAME'] },
  { source: 'census', level: 'csd', path: 'census/canada-csd-simplified.geojson', codeKeys: ['boundaryCode', 'id', 'CSDUID'], nameKeys: ['boundaryName', 'name', 'CSDNAME'] },
  { source: 'census', level: 'northSouthCsd', path: 'census/canada-csd-simplified.geojson', codeKeys: ['boundaryCode', 'id', 'CSDUID'], nameKeys: ['boundaryName', 'name', 'CSDNAME'] },
  { source: 'census', level: 'ct', path: 'census/bc-da-simplified/parents/ct.geojson', codeKeys: ['boundaryCode', 'id', 'CTUID'], nameKeys: ['boundaryName', 'name', 'CTNAME'] },
  { source: 'watershed', level: 'majorWatershed', path: 'boundaries/BCFWA/major_watersheds_province_simplified.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName'] },
  { source: 'watershed', level: 'watershedGroup', path: 'boundaries/BCFWA/watershed_groups_province_simplified.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName', 'WATERSHED_GROUP_NAME'] },
  { source: 'watershed', level: 'assessmentWatershed', path: 'boundaries/BCFWA/assessment_watersheds.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName', 'GNIS_NAME_1'] },
  ...Array.from({ length: 10 }, (_, index) => ({
    source: 'namedWatershed',
    level: `namedWatershedOrder${index + 1}`,
    path: `boundaries/BCFWA/named_watersheds_stream_order_${index + 1}_50m.geojson.gz`,
    codeKeys: ['boundaryCode', 'namedWatershedId'],
    nameKeys: ['boundaryName', 'name'],
  })),
  { source: 'bcRfc', level: 'rfcSnowBasin', path: 'boundaries/BCSnowSurvey/snow_survey_admin_basins.geojson', codeKeys: ['basin_id', 'boundaryCode'], nameKeys: ['basin_name', 'boundaryName'] },
  { source: 'nrAdmin', level: 'nrArea', path: 'boundaries/BCNR/nr_areas.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName', 'AREA_NAME'] },
  { source: 'nrAdmin', level: 'nrRegion', path: 'boundaries/BCNR/nr_regions.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName', 'REGION_NAME'] },
  { source: 'nrAdmin', level: 'nrDistrict', path: 'boundaries/BCNR/nr_districts.geojson', codeKeys: ['boundaryCode', 'OBJECTID'], nameKeys: ['boundaryName', 'DISTRICT_NAME'] },
]

const batches = await Promise.all(FILE_SOURCES.map(recordsFromFile))
const records = [
  ...batches.flat(),
  ...await censusDaRecords(),
  ...await drainageRecords(),
  ...await wildfireRecords(),
].sort((a, b) => (
  a.group.localeCompare(b.group)
  || a.sourceLabel.localeCompare(b.sourceLabel)
  || a.levelLabel.localeCompare(b.levelLabel)
  || a.name.localeCompare(b.name)
  || a.code.localeCompare(b.code)
))

const seenIds = new Set()
for (const record of records) {
  if (seenIds.has(record.id)) throw new Error(`Duplicate boundary search id: ${record.id}`)
  seenIds.add(record.id)
}

const catalog = JSON.stringify({ version: 1, records })
const compressed = gzipSync(catalog, { level: 9 })
const revision = createHash('sha256').update(compressed).digest('hex').slice(0, 12)
const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  records: records.length,
  sources: [...new Set(records.map((record) => record.source))].length,
  levels: [...new Set(records.map((record) => `${record.source}:${record.level}`))].length,
  catalog: {
    file: 'catalog.json.gz',
    revision,
    rawBytes: Buffer.byteLength(catalog),
    gzipBytes: compressed.length,
  },
}

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeFile(join(outputDirectory, 'catalog.json.gz'), compressed),
  writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
])

console.log(`Generated ${records.length.toLocaleString()} searchable boundaries (${(compressed.length / 1024 / 1024).toFixed(2)} MiB gzip, revision ${revision}).`)
