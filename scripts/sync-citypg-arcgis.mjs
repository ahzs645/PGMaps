import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DATASETS = [
  {
    name: 'Secondary school catchments',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/MapServer/4',
    output: 'public/data/boundaries/CityPG/secondary_school_catchments.geojson',
  },
  {
    name: 'Elementary school catchments',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Community_Information/MapServer/5',
    output: 'public/data/boundaries/CityPG/elementary_school_catchments.geojson',
  },
  {
    name: 'Transit bus stops',
    url: 'https://gishub.princegeorge.ca/server/rest/services/GroupMapServices/Transit_Features/MapServer/0',
    output: 'public/data/citypg/transit_bus_stops.geojson',
  },
]

const PAGE_SIZE = 2000

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

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return response.json()
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

    if (!template) {
      template = {
        ...geojson,
        features,
      }
    }

    features.push(...geojson.features)
    if (!geojson.exceededTransferLimit || geojson.features.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return template ?? { type: 'FeatureCollection', features }
}

async function main() {
  for (const dataset of DATASETS) {
    const geojson = await fetchLayer(dataset)
    await mkdir(path.dirname(dataset.output), { recursive: true })
    await writeFile(dataset.output, `${JSON.stringify(geojson)}\n`)
    console.log(`${dataset.name}: wrote ${geojson.features.length} features to ${dataset.output}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
