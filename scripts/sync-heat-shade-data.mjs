import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUTPUT_DIR = 'public/data/heat-shade'
const PAGE_SIZE = 2000
const DEFAULT_BBOX = [-123.7, 53.75, -122.45, 54.25]

const CITYPG_LAYERS = [
  {
    id: 'citypg-trees',
    name: 'CityPG trees',
    kind: 'shadeVector',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_ParkData/FeatureServer/0',
    output: `${OUTPUT_DIR}/citypg_trees.geojson`,
    source: 'City of Prince George Open Data, OpenData_ParkData/FeatureServer/0',
  },
  {
    id: 'citypg-park-open-spaces',
    name: 'CityPG park and open spaces',
    kind: 'shadeVector',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_ParkData/FeatureServer/12',
    output: `${OUTPUT_DIR}/citypg_park_open_spaces.geojson`,
    source: 'City of Prince George Open Data, OpenData_ParkData/FeatureServer/12',
  },
  {
    id: 'citypg-intact-forest',
    name: 'CityPG intact forest',
    kind: 'shadeVector',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_Ecology/FeatureServer/2',
    output: `${OUTPUT_DIR}/citypg_intact_forest.geojson`,
    source: 'City of Prince George Open Data, OpenData_Ecology/FeatureServer/2',
  },
  {
    id: 'citypg-community-forests',
    name: 'CityPG community forests',
    kind: 'shadeVector',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_OCPLanduse/FeatureServer/37',
    output: `${OUTPUT_DIR}/citypg_community_forests.geojson`,
    source: 'City of Prince George Open Data, OpenData_OCPLanduse/FeatureServer/37',
  },
  {
    id: 'citypg-community-facility',
    name: 'CityPG OCP community facility',
    kind: 'coolingProxy',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_OCPLanduse/FeatureServer/4',
    output: `${OUTPUT_DIR}/citypg_community_facility.geojson`,
    source: 'City of Prince George Open Data, OpenData_OCPLanduse/FeatureServer/4',
  },
  {
    id: 'citypg-response-facilities',
    name: 'CityPG response facilities',
    kind: 'coolingProxy',
    url: 'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/ResponseFacilities/FeatureServer/0',
    output: `${OUTPUT_DIR}/citypg_response_facilities.geojson`,
    source: 'City of Prince George ArcGIS, ResponseFacilities/FeatureServer/0',
  },
]

function getArg(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

function parseYearList(value) {
  return String(value)
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((year) => Number.isInteger(year) && year >= 1982)
}

function parseBbox(value) {
  const parsed = String(value)
    .split(',')
    .map((entry) => Number(entry.trim()))
  return parsed.length === 4 && parsed.every(Number.isFinite) ? parsed : DEFAULT_BBOX
}

function queryUrl(layerUrl, offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  })
  return `${layerUrl}/query?${params.toString()}`
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Failed to fetch ${url}: ${response.status} ${body.slice(0, 200)}`)
  }
  return response.json()
}

async function fetchJsonWithRetry(url, options, attempts = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchJson(url, options)
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      const waitMs = 1000 * attempt
      console.warn(`Fetch failed (${attempt}/${attempts}); retrying in ${waitMs}ms: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  throw lastError
}

async function fetchLayer(dataset) {
  const features = []
  let offset = 0
  let template = null

  while (true) {
    const geojson = await fetchJson(queryUrl(dataset.url, offset))
    if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`${dataset.name} did not return a GeoJSON FeatureCollection`)
    }

    if (!template) template = { ...geojson, features }
    features.push(...geojson.features)
    if (geojson.features.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return template ?? { type: 'FeatureCollection', features }
}

async function fetchCityPgLayers() {
  const results = []
  for (const dataset of CITYPG_LAYERS) {
    const geojson = await fetchLayer(dataset)
    await mkdir(path.dirname(dataset.output), { recursive: true })
    await writeFile(dataset.output, `${JSON.stringify(geojson)}\n`)
    results.push({
      id: dataset.id,
      name: dataset.name,
      kind: dataset.kind,
      source: dataset.source,
      url: dataset.url,
      output: dataset.output,
      featureCount: geojson.features.length,
    })
    console.log(`${dataset.name}: wrote ${geojson.features.length} features to ${dataset.output}`)
  }
  return results
}

async function fetchLandsatScenes({ years, bbox, maxCloud }) {
  const scenes = []

  for (const year of years) {
    const body = {
      collections: ['landsat-c2-l2'],
      bbox,
      datetime: `${year}-06-01/${year}-09-30`,
      limit: 100,
      query: {
        'eo:cloud_cover': { lt: maxCloud },
        platform: { in: ['landsat-8', 'landsat-9'] },
      },
    }

    const response = await fetchJsonWithRetry('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    for (const item of response.features ?? []) {
      scenes.push({
        id: item.id,
        year,
        datetime: item.properties?.datetime,
        platform: item.properties?.platform,
        cloudCover: item.properties?.['eo:cloud_cover'],
        bbox: item.bbox,
        assets: {
          red: item.assets?.red?.href,
          nir08: item.assets?.nir08?.href,
          surfaceTemperature: item.assets?.lwir11?.href,
          qaPixel: item.assets?.qa_pixel?.href,
          metadata: item.assets?.['mtl.json']?.href,
          preview: item.assets?.rendered_preview?.href,
        },
      })
    }

    console.log(`Landsat ${year}: found ${response.features?.length ?? 0} warm-season scenes`)
  }

  scenes.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))
  const output = `${OUTPUT_DIR}/landsat_warm_season_scenes.json`
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'Microsoft Planetary Computer STAC API, landsat-c2-l2',
        bbox,
        years,
        maxCloud,
        note: 'Scene catalog only. NDVI can be computed from red and nir08 assets; LST can be computed from surfaceTemperature with Landsat Collection 2 scale factors and QA masking.',
        scenes,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`Landsat scene catalog: wrote ${scenes.length} scenes to ${output}`)

  return {
    id: 'landsat-c2-l2-warm-season',
    name: 'Landsat Collection 2 Level-2 warm-season scenes',
    kind: 'historicalNdviLst',
    source: 'Microsoft Planetary Computer STAC API, landsat-c2-l2',
    url: 'https://planetarycomputer.microsoft.com/api/stac/v1',
    output,
    sceneCount: scenes.length,
    years,
    maxCloud,
    bbox,
  }
}

async function main() {
  const endYear = Number(getArg('end-year', new Date().getFullYear()))
  const startYear = Number(getArg('start-year', Math.max(2013, endYear - 4)))
  const years = parseYearList(getArg('years', '')).length
    ? parseYearList(getArg('years', ''))
    : Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index)
  const maxCloud = Number(getArg('max-cloud', 30))
  const bbox = parseBbox(getArg('bbox', DEFAULT_BBOX.join(',')))

  const vectorSources = await fetchCityPgLayers()
  const landsatSource = await fetchLandsatScenes({ years, bbox, maxCloud })
  const manifest = {
    generatedAt: new Date().toISOString(),
    bbox,
    sources: [...vectorSources, landsatSource],
    caveats: [
      'CityPG tree points are not a full tree-canopy raster; use them as a shade/tree presence proxy until canopy polygons or LiDAR-derived canopy are available.',
      'Community facility and response-facility layers are cooling-access proxies; they are not a confirmed list of active cooling centres during heat events.',
      'Landsat scene metadata is pulled here, but zonal NDVI/LST processing requires raster reading, cloud masking, scale factors, and aggregation by boundary.',
    ],
  }

  const manifestPath = `${OUTPUT_DIR}/manifest.json`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Manifest: wrote ${manifestPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
