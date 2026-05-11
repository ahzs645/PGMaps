import { mkdir, writeFile } from 'node:fs/promises'

const OUTPUT_DIR = 'public/data/drought'

const SERVICES = [
  {
    year: 2015,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2015/FeatureServer',
    fields: {
      basinName: 'basinName',
      basinId: 'basinID',
      droughtLevel: 'LevelOfDrought',
      startDate: 'startDate',
      endDate: 'endDate',
    },
  },
  {
    year: 2016,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2016/FeatureServer',
    fields: {
      basinName: 'BasinName',
      basinId: 'basinID',
      droughtLevel: 'DroughtLev',
      startDate: 'Start_Date',
      endDate: 'End_Date',
    },
  },
  {
    year: 2017,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Drought_Levels_Over_Time_2017/FeatureServer',
  },
  {
    year: 2018,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Drought_Levels_Archive_2018_Compiled_1/FeatureServer',
  },
  {
    year: 2019,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2019/FeatureServer',
  },
  {
    year: 2020,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2020/FeatureServer',
  },
  {
    year: 2021,
    url: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2021/FeatureServer',
  },
  {
    year: 2022,
    url: 'https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/BC_Drought_Level_Archive_2022/FeatureServer',
  },
  {
    year: 2023,
    url: 'https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2023/FeatureServer',
  },
  {
    year: 2024,
    url: 'https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/Drought_Levels_2024/FeatureServer',
  },
  {
    year: 2025,
    url: 'https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/BC_Drought_Levels_Time_Lapse_2025/FeatureServer',
  },
]

const DEFAULT_FIELDS = {
  basinName: 'BasinName',
  basinId: 'BasinID',
  droughtLevel: 'DroughtLevel',
  startDate: 'Start_Date',
  endDate: 'End_Date',
}

const DROUGHT_LEVEL_COLORS = {
  0: '#e7f0bd',
  1: '#f5f000',
  2: '#ffd17a',
  3: '#e4aa28',
  4: '#ed1c24',
  5: '#7b0d0d',
}

function getJsonUrl(url, params = {}) {
  const search = new URLSearchParams({ f: 'json', ...params })
  return `${url}?${search.toString()}`
}

function getQueryUrl(url, params = {}) {
  const search = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.01',
    geometryPrecision: '5',
    f: 'geojson',
    ...params,
  })
  return `${url}/query?${search.toString()}`
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) {
        throw new Error(`Request failed ${response.status}: ${url}`)
      }
      const json = await response.json()
      if (json.error) {
        throw new Error(`${json.error.message}: ${url}`)
      }
      return json
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await wait(750 * attempt)
      }
    }
  }
  throw lastError
}

function toIsoDate(value) {
  if (value == null || value === '') return null
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function toMillis(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  const millis = new Date(value).getTime()
  return Number.isNaN(millis) ? null : millis
}

function normalizeLevel(value) {
  if (value == null) return null
  const match = String(value).match(/[0-5]/)
  return match ? Number(match[0]) : null
}

function normalizeFeature(feature, service, index) {
  const fields = { ...DEFAULT_FIELDS, ...(service.fields ?? {}) }
  const properties = feature.properties ?? {}
  const objectId = properties.OBJECTID ?? properties.FID ?? index + 1
  const droughtLevelRaw = properties[fields.droughtLevel] ?? null
  const droughtLevel = normalizeLevel(droughtLevelRaw)
  const startDateRaw = properties[fields.startDate] ?? null
  const endDateRaw = properties[fields.endDate] ?? null
  const basinName = String(properties[fields.basinName] ?? '').trim()

  return {
    ...feature,
    id: `${service.year}-${objectId}`,
    properties: {
      ...properties,
      sourceYear: service.year,
      sourceObjectId: objectId,
      basinName,
      basinId: properties[fields.basinId] ?? null,
      droughtLevel,
      droughtLevelRaw,
      droughtColor: droughtLevel == null ? '#8a8f98' : DROUGHT_LEVEL_COLORS[droughtLevel],
      startDate: toIsoDate(startDateRaw),
      endDate: toIsoDate(endDateRaw),
      startDateMs: toMillis(startDateRaw),
      endDateMs: toMillis(endDateRaw),
    },
  }
}

async function getFirstLayerUrl(serviceUrl) {
  const service = await fetchJson(getJsonUrl(serviceUrl))
  const layer = service.layers?.[0]
  if (!layer) {
    throw new Error(`No layer found for ${serviceUrl}`)
  }
  return `${serviceUrl}/${layer.id}`
}

async function getFeatureCount(layerUrl) {
  const count = await fetchJson(getQueryUrl(layerUrl, { returnCountOnly: 'true', returnGeometry: 'false', f: 'json' }))
  return count.count
}

async function getLayerMetadata(layerUrl) {
  return fetchJson(getJsonUrl(layerUrl))
}

async function getObjectIds(layerUrl) {
  const ids = await fetchJson(getQueryUrl(layerUrl, {
    returnIdsOnly: 'true',
    returnGeometry: 'false',
    f: 'json',
  }))
  return ids.objectIds ?? []
}

async function fetchAllFeatures(layerUrl, metadata, expectedCount) {
  const objectIdField = metadata.objectIdField ?? 'OBJECTID'
  const objectIds = await getObjectIds(layerUrl)
  const ids = objectIds.length ? objectIds.sort((a, b) => a - b) : Array.from({ length: expectedCount }, (_, i) => i + 1)
  const pageSize = Math.min(metadata.maxRecordCount || 50, 50)
  const features = []

  for (let offset = 0; offset < ids.length; offset += pageSize) {
    const batch = ids.slice(offset, offset + pageSize)
    const page = await fetchJson(getQueryUrl(layerUrl, {
      where: `${objectIdField} IN (${batch.join(',')})`,
    }))
    const pageFeatures = page.features ?? []
    features.push(...pageFeatures)
    if (features.length >= expectedCount) break
  }

  return features.slice(0, expectedCount)
}

await mkdir(OUTPUT_DIR, { recursive: true })

const manifest = {
  title: 'B.C. Drought Levels Time Lapse',
  source: 'BC Drought Information Portal / ArcGIS Hub',
  catalogUrl: 'https://droughtportal.gov.bc.ca/search',
  sourceGroup: '20aab1139c5d4e38b7cddf16d8a7cd44',
  generatedAt: new Date().toISOString(),
  legend: {
    0: { label: 'Normal or wetter than normal', color: DROUGHT_LEVEL_COLORS[0] },
    1: { label: 'Abnormally dry', color: DROUGHT_LEVEL_COLORS[1] },
    2: { label: 'Level 2', color: DROUGHT_LEVEL_COLORS[2] },
    3: { label: 'Level 3', color: DROUGHT_LEVEL_COLORS[3] },
    4: { label: 'Level 4', color: DROUGHT_LEVEL_COLORS[4] },
    5: { label: 'Level 5', color: DROUGHT_LEVEL_COLORS[5] },
  },
  years: [],
}

for (const service of SERVICES) {
  const layerUrl = await getFirstLayerUrl(service.url)
  const metadata = await getLayerMetadata(layerUrl)
  const expectedCount = await getFeatureCount(layerUrl)
  const features = await fetchAllFeatures(layerUrl, metadata, expectedCount)
  const normalized = features.map((feature, index) => normalizeFeature(feature, service, index))
  const dates = normalized
    .flatMap((feature) => [feature.properties.startDate, feature.properties.endDate])
    .filter(Boolean)
    .sort()

  const collection = {
    type: 'FeatureCollection',
    name: `bc_drought_levels_${service.year}`,
    metadata: {
      year: service.year,
      sourceUrl: service.url,
      layerUrl,
      expectedFeatureCount: expectedCount,
      featureCount: normalized.length,
      fields: metadata.fields?.map((field) => ({ name: field.name, type: field.type, alias: field.alias })) ?? [],
      generatedAt: manifest.generatedAt,
    },
    features: normalized,
  }

  const file = `${service.year}.geojson`
  await writeFile(`${OUTPUT_DIR}/${file}`, `${JSON.stringify(collection)}\n`)

  manifest.years.push({
    year: service.year,
    file,
    sourceUrl: service.url,
    layerUrl,
    featureCount: normalized.length,
    expectedFeatureCount: expectedCount,
    startDate: dates[0] ?? null,
    endDate: dates[dates.length - 1] ?? null,
  })

  console.log(`${service.year}: wrote ${normalized.length} features`)
}

await writeFile(`${OUTPUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`manifest: wrote ${manifest.years.length} years`)
