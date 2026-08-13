import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import console from 'node:console'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://www.env.gov.bc.ca/soe/indicators/land/roads_leaflet_map.html'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(
  repoRoot,
  'public/data/projects/roadless-areas-bc-ecoregions.geojson',
)

function roadlessBand(percent) {
  if (percent < 25) return 'Less than 25%'
  if (percent < 50) return '25–49%'
  if (percent < 75) return '50–74%'
  return '75% or more'
}

function polygonCoordinates(rawFeature) {
  return rawFeature.map((polygon) =>
    polygon.map((ring) => {
      if (!Array.isArray(ring?.lng) || !Array.isArray(ring?.lat) || ring.lng.length !== ring.lat.length) {
        throw new Error('Unexpected polygon coordinate structure in the source map')
      }
      const coordinates = ring.lng.map((longitude, index) => [longitude, ring.lat[index]])
      const first = coordinates[0]
      const last = coordinates.at(-1)
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) coordinates.push(first)
      return coordinates
    }),
  )
}

function featureId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function main() {
  const response = await globalThis.fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Failed to fetch source map: ${response.status}`)
  const html = await response.text()
  const widgetMatch = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/)
  if (!widgetMatch) throw new Error('Could not find the Leaflet widget payload in the source map')

  const widget = JSON.parse(widgetMatch[1])
  const polygonCall = widget?.x?.calls?.find((call) => call?.method === 'addPolygons')
  const rawFeatures = polygonCall?.args?.[0]
  const labels = polygonCall?.args?.[6]
  if (!Array.isArray(rawFeatures) || !Array.isArray(labels) || rawFeatures.length !== labels.length) {
    throw new Error('Unexpected polygon payload in the source map')
  }

  const features = rawFeatures.map((rawFeature, index) => {
    const labelMatch = labels[index].match(/^<strong>(.+) \(([0-9.]+)%\)<\/strong>$/)
    if (!labelMatch) throw new Error(`Unexpected ecoregion label: ${labels[index]}`)
    const [, name, rawPercent] = labelMatch
    const percent = Number(rawPercent)
    return {
      type: 'Feature',
      properties: {
        id: featureId(name),
        name,
        roadless_percent: percent,
        roadless_percent_label: `${rawPercent}%`,
        roadless_band: roadlessBand(percent),
        display: `${name} · ${rawPercent}% roadless`,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: polygonCoordinates(rawFeature),
      },
    }
  })

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      title: "Roadless Areas within B.C.'s Ecoregions",
      source: SOURCE_URL,
      sourceUpdated: 'May 2018',
      definition: 'Roadless means more than 500 metres from a road.',
    },
    features,
  }

  await writeFile(outputPath, `${JSON.stringify(geojson)}\n`)
  console.log(`Wrote ${features.length} ecoregions to ${path.relative(repoRoot, outputPath)}.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
