import fs from 'node:fs'
import path from 'node:path'

const inputPath = path.resolve('public/data/fallout/fallout-reporting-posts-canada.kml')
const outputPath = path.resolve('public/data/fallout/fallout-reporting-posts-canada.geojson')
const summaryPath = path.resolve('public/data/fallout/fallout-reporting-posts-canada-summary.json')

function decodeXml(value = '') {
  return value
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function stripHtml(value = '') {
  return decodeXml(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function tagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

function kmlColorToHex(kmlColor) {
  if (!/^[0-9a-f]{8}$/i.test(kmlColor)) return null
  const bb = kmlColor.slice(2, 4)
  const gg = kmlColor.slice(4, 6)
  const rr = kmlColor.slice(6, 8)
  return `#${rr}${gg}${bb}`.toLowerCase()
}

function parseCoordinates(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((coord) => {
      const [lng, lat] = coord.split(',').map(Number)
      return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
    })
    .filter(Boolean)
}

function parseStyles(kml) {
  const styles = new Map()
  const styleMaps = new Map()

  for (const match of kml.matchAll(/<Style\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/g)) {
    const [, id, body] = match
    const color = tagValue(body, 'color')
    styles.set(id, {
      color: kmlColorToHex(color),
      icon: tagValue(body, 'href'),
      width: Number(tagValue(body, 'width')) || null,
    })
  }

  for (const match of kml.matchAll(/<StyleMap\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/StyleMap>/g)) {
    const [, id, body] = match
    const normalPair = body.match(/<Pair>[\s\S]*?<key>normal<\/key>[\s\S]*?<styleUrl>#?([^<]+)<\/styleUrl>[\s\S]*?<\/Pair>/)
    if (normalPair) styleMaps.set(id, normalPair[1])
  }

  return { styles, styleMaps }
}

function resolveStyle(styleUrl, styles, styleMaps) {
  const id = styleUrl.replace(/^#/, '')
  const normalId = styleMaps.get(id) ?? id
  return styles.get(normalId) ?? {}
}

function featureType(name, styleUrl) {
  const lower = `${name} ${styleUrl}`.toLowerCase()
  if (lower.includes('line-')) return 'Communication line'
  if (lower.includes('bridge')) return 'Bridge'
  if (lower.includes('shelter') || lower.includes('bunker')) return 'Shelter'
  if (lower.includes('detonation') || lower.includes('ndrc')) return 'Detonation centre'
  if (lower.includes('frp')) return 'Fallout reporting post'
  return 'Other'
}

function buildFeature(placemarkXml, province, index, styles, styleMaps) {
  const name = tagValue(placemarkXml, 'name') || `Fallout site ${index + 1}`
  const rawDescription = tagValue(placemarkXml, 'description')
  const styleUrl = tagValue(placemarkXml, 'styleUrl')
  const style = resolveStyle(styleUrl, styles, styleMaps)
  const pointMatch = placemarkXml.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i)
  const lineMatch = placemarkXml.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/i)

  let geometry = null
  if (pointMatch) {
    const coordinates = parseCoordinates(pointMatch[1])
    if (coordinates.length > 0) geometry = { type: 'Point', coordinates: coordinates[0] }
  } else if (lineMatch) {
    const coordinates = parseCoordinates(lineMatch[1])
    if (coordinates.length > 1) geometry = { type: 'LineString', coordinates }
  }

  if (!geometry) return null

  return {
    type: 'Feature',
    id: `fallout-${index + 1}`,
    properties: {
      id: `fallout-${index + 1}`,
      name,
      description: stripHtml(rawDescription),
      rawDescription: decodeXml(rawDescription),
      province,
      sourceStyle: styleUrl,
      sourceColor: style.color,
      sourceIcon: style.icon,
      sourceWidth: style.width,
      featureType: featureType(name, styleUrl),
    },
    geometry,
  }
}

const kml = fs.readFileSync(inputPath, 'utf8')
const { styles, styleMaps } = parseStyles(kml)
const documentName = tagValue(kml.match(/<Document>([\s\S]*?)<\/Document>/)?.[1] ?? kml, 'name')
const documentDescription = stripHtml(tagValue(kml.match(/<Document>([\s\S]*?)<\/Document>/)?.[1] ?? kml, 'description'))
const features = []

for (const folderMatch of kml.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)) {
  const folderXml = folderMatch[1]
  const province = tagValue(folderXml, 'name') || 'Uncategorized'
  for (const placemarkMatch of folderXml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const feature = buildFeature(placemarkMatch[1], province, features.length, styles, styleMaps)
    if (feature) features.push(feature)
  }
}

const summary = {
  title: documentName,
  description: documentDescription,
  source: 'Google My Maps KML export copied to public/data/fallout/fallout-reporting-posts-canada.kml',
  generatedAt: new Date().toISOString(),
  totalFeatures: features.length,
  byGeometry: features.reduce((acc, feature) => {
    acc[feature.geometry.type] = (acc[feature.geometry.type] ?? 0) + 1
    return acc
  }, {}),
  byProvince: features.reduce((acc, feature) => {
    const province = feature.properties.province
    acc[province] = (acc[province] ?? 0) + 1
    return acc
  }, {}),
  byType: features.reduce((acc, feature) => {
    const type = feature.properties.featureType
    acc[type] = (acc[type] ?? 0) + 1
    return acc
  }, {}),
}

fs.writeFileSync(outputPath, `${JSON.stringify({
  type: 'FeatureCollection',
  name: documentName,
  metadata: summary,
  features,
})}\n`)
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)

console.log(`Wrote ${features.length} features to ${outputPath}`)
