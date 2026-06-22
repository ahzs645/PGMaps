import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dbPath = path.join(root, 'vendor/bcdatamapper/data-sources/healthdata/bc_msp_blue_book/bc_msp_blue_book.db')
const outputDir = path.join(root, 'public/data/health')
const outputPath = path.join(outputDir, 'msp-facilities.geojson')
const cachePath = path.join(outputDir, 'msp-facility-geocode-cache.json')

const FACILITY_TYPES = new Set(['clinic', 'diagnostic_facility', 'hospital'])
const GEOCODE_CACHE_VERSION = 2
const MIN_GEOCODER_SCORE = 72
const MIN_PROVIDER_MATCH_SCORE = {
  clinic: 0.72,
  diagnostic_facility: 0.72,
  hospital: 0.52,
}
const PROVIDER_LAYERS = {
  clinic: 'https://services1.arcgis.com/B6yKvIZqzuOr0jBR/arcgis/rest/services/BC_Walkin_Clinics/FeatureServer/0',
  diagnostic_facility: 'https://services1.arcgis.com/B6yKvIZqzuOr0jBR/arcgis/rest/services/BC_Lab_Service_Locations/FeatureServer/0',
  hospital: 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Hospitals/FeatureServer/0',
}
const BC_BOUNDS = {
  minLng: -139.2,
  maxLng: -113.9,
  minLat: 48.0,
  maxLat: 60.1,
}

const NAME_ALIASES = new Map([
  ['100 mile house general hospital', '100 mile district general hospital'],
  ['abbotsford regional hospital cancer centre', 'abbotsford regional hospital'],
  ['bc womens hospital', "bc women's hospital and health centre"],
  ['british columbia womens hospital', "bc women's hospital and health centre"],
  ['campbell river district general hospital', 'campbell river and district regional hospital'],
  ['cariboo memorial hospital', 'cariboo memorial hospital'],
  ['chetwynd general hospital', 'chetwynd general hospital and health centre'],
  ['chilliwack hospital', 'chilliwack general hospital'],
  ['cowichan district hospital', 'cowichan district hospital'],
  ['g r baker memorial hospital', 'g.r. baker memorial hospital'],
  ['haida gwaii hospital health centre xaayda gwaay ngaaysdll naay', 'haida gwaii hospital and health centre'],
  ['invermere dist hospital', 'invermere and district hospital'],
  ['invermere district hospital', 'invermere and district hospital'],
  ['kitimat general hospital', 'kitimat hospital & health centre'],
  ['lady minto gulf island hospital', 'lady minto gulf islands hospital'],
  ['lillooet hospital health centre', 'lillooet district hospital and health centre'],
  ['mackenzie district hospital', 'mackenzie and district hospital'],
  ['mcbride and district hospital', 'mcbride and district hospital'],
  ['mcbride district hospital', 'mcbride and district hospital'],
  ['mount st joseph hospital', 'mount saint joseph hospital'],
  ['nanaimo regional hospital', 'nanaimo regional general hospital'],
  ['north island hospital', 'north island hospital comox valley'],
  ['north island hospital campbell river district', 'campbell river and district regional hospital'],
  ['powell river general hospital', 'powell river general hospital'],
  ['richmond general hospital', 'richmond hospital'],
  ['ridge meadows hospital association', 'ridge meadows hospital'],
  ['royal columbia hospital', 'royal columbian hospital'],
  ['st marys hospital', "st mary's hospital"],
  ['ubc diagnostic services laboratory', 'ubc hospital'],
  ['university hospital of northern bc', 'prince george regional hospital'],
  ['vancouver hospital ubc pavillions', 'ubc hospital'],
  ['viha cowichan district hospital', 'cowichan district hospital'],
  ['abc medical clinic', 'abc medical clinic'],
])

const STOP_WORDS = new Set([
  'and',
  'bc',
  'british',
  'care',
  'centre',
  'columbia',
  'community',
  'district',
  'end',
  'general',
  'health',
  'hospital',
  'regional',
  'the',
])

function sqlJson(query) {
  const output = execFileSync('sqlite3', ['-json', dbPath, query], { encoding: 'utf8' })
  return output.trim() ? JSON.parse(output) : []
}

function loadCache() {
  if (!existsSync(cachePath)) return {}
  const cache = JSON.parse(readFileSync(cachePath, 'utf8'))
  return cache.__version === GEOCODE_CACHE_VERSION ? cache : {}
}

function saveCache(cache) {
  mkdirSync(outputDir, { recursive: true })
  cache.__version = GEOCODE_CACHE_VERSION
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`)
}

function cleanSearchName(name) {
  return name
    .replace(/\b(FBHS|VIHA)\b/gi, '')
    .replace(/\b(inpatient care network|locums?)\b/gi, '')
    .replace(/\bincorporated|corporation|corp\.?|inc\.?|ltd\.?/gi, '')
    .replace(/\s+-\s+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['.()/-]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function nameTokens(name) {
  return normalizeName(name)
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function similarity(a, b) {
  const aTokens = new Set(nameTokens(a))
  const bTokens = new Set(nameTokens(b))
  if (!aTokens.size || !bTokens.size) return 0
  let intersection = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1
  }
  const containment = intersection / Math.min(aTokens.size, bTokens.size)
  const jaccard = intersection / new Set([...aTokens, ...bTokens]).size
  return (containment * 0.7) + (jaccard * 0.3)
}

async function fetchProviderLayer(payeeType, url) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  })
  const response = await fetch(`${url}/query?${params.toString()}`, {
    headers: {
      'User-Agent': 'PGMaps MSP facility mapper',
      Accept: 'application/geo+json,application/json',
    },
  })
  if (!response.ok) throw new Error(`Failed to fetch ${payeeType} provider layer: HTTP ${response.status}`)
  const data = await response.json()
  const seen = new Set()
  const candidates = []
  for (const feature of data.features ?? []) {
    const properties = feature.properties ?? {}
    const coordinates = feature.geometry?.coordinates
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue
    const longitude = Number(coordinates[0])
    const latitude = Number(coordinates[1])
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !inBc(longitude, latitude)) continue

    const name = payeeType === 'hospital' ? properties.OCCUPANT_NAME : properties.RG_NAME
    if (!name) continue
    const address = payeeType === 'hospital'
      ? properties.PHYSICAL_ADDRESS
      : [properties.STREET_NUMBER, properties.STREET_NAME, properties.STREET_TYPE, properties.STREET_DIRECTION].filter(Boolean).join(' ')
    const city = payeeType === 'hospital' ? properties.LOCALITY : properties.CITY
    const key = `${payeeType}:${normalizeName(name)}:${normalizeName(address ?? '')}:${longitude.toFixed(6)}:${latitude.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      payeeType,
      name,
      city: city ?? null,
      address: address || null,
      postalCode: properties.POSTAL_CODE ?? null,
      phone: properties.CONTACT_PHONE ?? properties.PHONE_NUMBER ?? null,
      website: properties.WEBSITE_URL ?? properties.WEBSITE ?? null,
      healthAuthority: properties.HEALTH_AUTHORITY_NAME ?? null,
      longitude,
      latitude,
      normalizedName: normalizeName(name),
    })
  }
  return candidates
}

async function loadProviderReference() {
  const entries = await Promise.all(Object.entries(PROVIDER_LAYERS).map(async ([payeeType, url]) => [
    payeeType,
    await fetchProviderLayer(payeeType, url),
  ]))
  return Object.fromEntries(entries)
}

function matchProvider(payeeName, payeeType, candidates) {
  const normalizedPayee = normalizeName(payeeName)
  const alias = NAME_ALIASES.get(normalizedPayee)
  if (alias) {
    const aliasedMatch = candidates.find((candidate) => candidate.normalizedName === normalizeName(alias))
    if (aliasedMatch) {
      return { ...aliasedMatch, score: 1, method: 'provider-layer-alias' }
    }
  }

  let best = null
  for (const candidate of candidates) {
    const score = similarity(payeeName, candidate.name)
    if (!best || score > best.score) best = { ...candidate, score, method: 'provider-layer-fuzzy' }
  }
  return best && best.score >= MIN_PROVIDER_MATCH_SCORE[payeeType] ? best : null
}

function inBc(lng, lat) {
  return lng >= BC_BOUNDS.minLng && lng <= BC_BOUNDS.maxLng && lat >= BC_BOUNDS.minLat && lat <= BC_BOUNDS.maxLat
}

async function geocode(name, payeeType, cache) {
  const cacheKey = `${payeeType}:${name}`
  if (cache[cacheKey]) return cache[cacheKey]

  const query = cleanSearchName(name)
  const params = new URLSearchParams({
    addressString: `${query}, BC`,
    maxResults: '1',
    provinceCode: 'BC',
    outputSRS: '4326',
    interpolation: 'adaptive',
    echo: 'true',
    setBack: '0',
  })
  const url = `https://geocoder.api.gov.bc.ca/addresses.json?${params.toString()}`
  const result = {
    query,
    url,
    matched: false,
    score: null,
    fullAddress: null,
    localityName: null,
    siteName: null,
    longitude: null,
    latitude: null,
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PGMaps MSP facility mapper',
        Accept: 'application/json',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const feature = data.features?.[0]
    const coordinates = feature?.geometry?.coordinates
    const properties = feature?.properties ?? {}
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const longitude = Number(coordinates[0])
      const latitude = Number(coordinates[1])
      const score = Number(properties.score ?? 0)
      if (Number.isFinite(longitude) && Number.isFinite(latitude) && inBc(longitude, latitude)) {
        const fullAddress = String(properties.fullAddress ?? '')
        const siteName = String(properties.siteName ?? '')
        const preciseFacilityMatch = /hospital|clinic|medical|diagnostic|imaging|laborator|x-?ray|ultrasound/i.test(`${fullAddress} ${siteName}`)
        Object.assign(result, {
          matched: score >= MIN_GEOCODER_SCORE && preciseFacilityMatch,
          score,
          fullAddress: properties.fullAddress ?? null,
          localityName: properties.localityName ?? null,
          siteName: properties.siteName ?? null,
          longitude,
          latitude,
        })
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }

  cache[cacheKey] = result
  await new Promise((resolve) => setTimeout(resolve, 90))
  return result
}

function facilityRows() {
  const rows = sqlJson(`
    SELECT
      payee_name AS payeeName,
      payee_type AS payeeType,
      COUNT(*) AS fiscalYearCount,
      MIN(fiscal_start_year) AS firstFiscalStartYear,
      MAX(fiscal_start_year) AS latestFiscalStartYear,
      MIN(fiscal_year) AS firstFiscalYear,
      MAX(fiscal_year) AS latestFiscalYear,
      SUM(amount) AS totalAmount,
      MAX(amount) AS maxAnnualAmount,
      AVG(amount) AS averageAnnualAmount
    FROM msp_blue_book_payments
    WHERE payee_name IS NOT NULL
      AND payee_type IN ('clinic', 'diagnostic_facility', 'hospital')
      AND amount IS NOT NULL
    GROUP BY payee_name, payee_type
    ORDER BY totalAmount DESC;
  `)
  return rows.filter((row) => FACILITY_TYPES.has(row.payeeType))
}

function facilityAnnualPayments() {
  const rows = sqlJson(`
    SELECT
      payee_name AS payeeName,
      payee_type AS payeeType,
      fiscal_year AS fiscalYear,
      fiscal_start_year AS fiscalStartYear,
      amount AS amount
    FROM msp_blue_book_payments
    WHERE payee_name IS NOT NULL
      AND payee_type IN ('clinic', 'diagnostic_facility', 'hospital')
      AND amount IS NOT NULL
    ORDER BY payee_name, fiscal_start_year;
  `)
  const byFacility = new Map()
  for (const row of rows) {
    const key = `${row.payeeType}:${row.payeeName}`
    const payments = byFacility.get(key) ?? []
    payments.push({
      fiscalYear: row.fiscalYear,
      fiscalStartYear: Number(row.fiscalStartYear),
      amount: Number(row.amount),
    })
    byFacility.set(key, payments)
  }
  return byFacility
}

function summary(rows, features) {
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0)
  const matchedAmount = features.reduce((sum, feature) => sum + Number(feature.properties.totalAmount ?? 0), 0)
  return {
    generatedAt: new Date().toISOString(),
    source: 'BC MSP Blue Book SQLite export joined to BC Health Service Provider Locations',
    sourceDatabase: 'vendor/bcdatamapper/data-sources/healthdata/bc_msp_blue_book/bc_msp_blue_book.db',
    providerLayers: PROVIDER_LAYERS,
    facilityPayees: rows.length,
    matchedFacilities: features.length,
    unmatchedFacilities: rows.length - features.length,
    totalAmount,
    matchedAmount,
    matchedAmountShare: totalAmount ? matchedAmount / totalAmount : null,
    fiscalStartYearRange: rows.reduce((range, row) => ({
      min: Math.min(range.min, Number(row.firstFiscalStartYear)),
      max: Math.max(range.max, Number(row.latestFiscalStartYear)),
    }), { min: Infinity, max: -Infinity }),
  }
}

async function main() {
  if (!existsSync(dbPath)) {
    throw new Error(`Missing MSP database: ${dbPath}`)
  }

  const rows = facilityRows()
  const annualPayments = facilityAnnualPayments()
  const providerReference = await loadProviderReference()
  const cache = loadCache()
  const features = []

  for (const row of rows) {
    const providerMatch = matchProvider(row.payeeName, row.payeeType, providerReference[row.payeeType] ?? [])
    const geocoderMatch = providerMatch ? null : await geocode(row.payeeName, row.payeeType, cache)
    const match = providerMatch ?? geocoderMatch
    if (!match?.matched && !providerMatch) continue
    if (match.longitude == null || match.latitude == null) continue
    features.push({
      type: 'Feature',
      id: `${row.payeeType}:${row.payeeName}`,
      properties: {
        id: `${row.payeeType}:${row.payeeName}`,
        payeeName: row.payeeName,
        payeeType: row.payeeType,
        fiscalYearCount: Number(row.fiscalYearCount),
        firstFiscalYear: row.firstFiscalYear,
        latestFiscalYear: row.latestFiscalYear,
        firstFiscalStartYear: Number(row.firstFiscalStartYear),
        latestFiscalStartYear: Number(row.latestFiscalStartYear),
        totalAmount: Number(row.totalAmount),
        maxAnnualAmount: Number(row.maxAnnualAmount),
        averageAnnualAmount: Number(row.averageAnnualAmount),
        annualPayments: annualPayments.get(`${row.payeeType}:${row.payeeName}`) ?? [],
        matchMethod: match.method ?? 'bc-address-geocoder',
        matchScore: match.score,
        geocoderQuery: match.query ?? null,
        matchedName: match.name ?? match.siteName ?? null,
        matchedAddress: match.address ?? match.fullAddress ?? null,
        matchedLocality: match.city ?? match.localityName ?? null,
        matchedPostalCode: match.postalCode ?? null,
        matchedPhone: match.phone ?? null,
        matchedWebsite: match.website ?? null,
        matchedHealthAuthority: match.healthAuthority ?? null,
        matchedSiteName: match.siteName ?? null,
      },
      geometry: {
        type: 'Point',
        coordinates: [match.longitude, match.latitude],
      },
    })
  }

  saveCache(cache)
  const collection = {
    type: 'FeatureCollection',
    name: 'msp_facilities',
    metadata: summary(rows, features),
    features,
  }
  writeFileSync(outputPath, `${JSON.stringify(collection)}\n`)
  console.log(`Wrote ${features.length}/${rows.length} matched MSP facilities to ${path.relative(root, outputPath)}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
