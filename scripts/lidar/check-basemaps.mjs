// Live, bounded provider checks for this study tile. No bulk/offline tile export.
// Usage: node scripts/lidar/check-basemaps.mjs <summary.json> <report.json>
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'

const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const output = process.argv[3]
assert(output, 'Provide a report output path')
const temporary = mkdtempSync(path.join(tmpdir(), 'pgmaps-basemap-check-'))
const requests = []
const service = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
function get(url, purpose) {
  const index = requests.length
  const bodyPath = path.join(temporary, `${index}.body`)
  const headerPath = path.join(temporary, `${index}.headers`)
  execFileSync('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--max-time',
    '30',
    '--dump-header',
    headerPath,
    '--output',
    bodyPath,
    url,
  ])
  const body = readFileSync(bodyPath)
  const headers = readFileSync(headerPath, 'utf8').toLowerCase()
  assert.match(headers, /access-control-allow-origin:\s*\*/, `Missing browser CORS for ${purpose}`)
  requests.push({ purpose, url, bytes: body.length, sha256: sha256(body), cors: '*' })
  return body
}
function tile(longitude, latitude, zoom) {
  const radians = (latitude * Math.PI) / 180
  return {
    z: zoom,
    x: Math.floor(((longitude + 180) / 360) * 2 ** zoom),
    y: Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom),
  }
}
const [west, south, east, north] = summary.bounds_wgs84
const points = [{ label: 'Tile centre', center: [(west + east) / 2, (south + north) / 2] }, ...summary.highlights]
try {
  const styleUrl = 'https://tiles.openfreemap.org/styles/positron'
  const style = JSON.parse(get(styleUrl, 'Vector style'))
  assert.equal(style.version, 8)
  const vectorSources = Object.values(style.sources).filter((source) => source.type === 'vector')
  assert.equal(vectorSources.length, 1)
  const metadata = JSON.parse(get(vectorSources[0].url, 'Vector TileJSON'))
  const northwest = tile(west, north, metadata.maxzoom)
  const southeast = tile(east, south, metadata.maxzoom)
  const vectorTiles = []
  for (let x = northwest.x; x <= southeast.x; x++) {
    for (let y = northwest.y; y <= southeast.y; y++) {
      const z = metadata.maxzoom
      const url = metadata.tiles[0].replace('{z}', z).replace('{x}', x).replace('{y}', y)
      const bytes = get(url, `Study-area vector tile ${z}/${x}/${y}`)
      const decoded = new VectorTile(new Pbf(bytes))
      const counts = Object.fromEntries(Object.entries(decoded.layers).map(([name, layer]) => [name, layer.length]))
      assert(Object.keys(counts).length, 'Empty vector tile')
      vectorTiles.push({ z, x, y, layer_feature_counts: counts })
    }
  }
  const symbols = style.layers.filter((layer) => layer.type === 'symbol')
  const fontStacks = [
    ...new Set(
      symbols
        .map((layer) => layer.layout?.['text-font'])
        .filter((fonts) => Array.isArray(fonts) && fonts.every((font) => typeof font === 'string'))
        .map((fonts) => fonts.join(',')),
    ),
  ]
  for (const fonts of fontStacks) {
    const bytes = get(
      style.glyphs.replace('{fontstack}', encodeURIComponent(fonts)).replace('{range}', '0-255'),
      `Font ${fonts}`,
    )
    assert(bytes.length > 500, 'Empty glyph range')
  }
  JSON.parse(get(`${style.sprite}.json`, 'Sprite index'))
  const sprite = get(`${style.sprite}.png`, 'Sprite image')
  assert.equal(sprite.subarray(1, 4).toString(), 'PNG')

  const satelliteTiles = []
  const citations = []
  const seen = new Set()
  for (const place of points) {
    const [longitude, latitude] = place.center
    const coordinate = tile(longitude, latitude, 18)
    const key = `${coordinate.z}/${coordinate.y}/${coordinate.x}`
    if (!seen.has(key)) {
      const bytes = get(`${service}/tile/${key}`, `Imagery tile · ${place.label}`)
      assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff', 'Imagery is not JPEG')
      assert(bytes.length > 5000, 'Imagery may be a placeholder')
      satelliteTiles.push({ ...coordinate, bytes: bytes.length, sha256: sha256(bytes) })
      seen.add(key)
    }
    const params = new URLSearchParams({
      f: 'json',
      where: '1=1',
      geometry: `${longitude},${latitude}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'SRC_DATE,SRC_RES,SRC_ACC,NICE_DESC,NICE_NAME,MinMapLevel,MaxMapLevel',
      returnGeometry: 'false',
    })
    const data = JSON.parse(get(`${service}/4/query?${params}`, `Imagery metadata · ${place.label}`))
    assert(!data.error && Array.isArray(data.features), 'Imagery metadata query failed')
    const matches = data.features
      .map((feature) => feature.attributes)
      .filter((row) => row.MinMapLevel <= 18 && row.MaxMapLevel >= 18)
    assert(matches.length, 'No source citation covers the checked imagery level')
    citations.push({ label: place.label, longitude, latitude, cache_level: 18, sources: matches })
  }
  assert.equal(
    new Set(satelliteTiles.map((entry) => entry.sha256)).size,
    satelliteTiles.length,
    'Imagery returned repeated placeholder tiles',
  )
  const report = {
    checked_at_utc: new Date().toISOString(),
    study_bounds_wgs84: summary.bounds_wgs84,
    vector_style: styleUrl,
    vector_source_maxzoom: metadata.maxzoom,
    vector_tiles: vectorTiles,
    imagery_service: service,
    imagery_tiles: satelliteTiles,
    imagery_citations: citations,
    requests,
    interpretation:
      'HTTP/CORS, source-schema and data-coverage checks only. Tile feature counts cover containing vector tiles and may include buffers/areas outside the LiDAR footprint. These checks do not verify WebGL rendering, registration accuracy or tree/building detection accuracy. Imagery source resolution is not positional accuracy.',
  }
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      report: output,
      vector_tiles: vectorTiles.length,
      imagery_tiles: satelliteTiles.length,
      locations_with_imagery_metadata: citations.length,
      checked_font_stacks: fontStacks.length,
      requests: requests.length,
    }),
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
