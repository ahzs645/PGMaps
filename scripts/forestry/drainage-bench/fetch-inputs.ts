/**
 * Fetch the inputs of the drainage bench for one LiDAR tile: the bare-earth DEM (a LidarBC 1:2,500
 * tile, or a GeoTIFF already on disk) and, over the tile's box, the public road and stream lines the
 * bench reads (FTEN road sections, Digital Road Atlas roads, FWA streams). Everything lands in the
 * output folder, which belongs outside the repository: the roads are licensee tenure records.
 *
 *   node --import tsx scripts/forestry/drainage-bench/fetch-inputs.ts <out dir> \
 *     (--maptile 093g089_3_4_3 | --dem path/to/dem.tif) [--name label]
 *
 * The bounding box goes in `CQL_FILTER` (longitude first), never the WFS `bbox` parameter.
 */
import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { initWhitebox } from './whitebox'

const LIDAR_BC = 'https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/LiDAR_BC_S3_Public/FeatureServer'
const WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
const LAYERS = {
  ften: { typeName: 'WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', properties: 'GEOMETRY,LIFE_CYCLE_STATUS_CODE' },
  dra: { typeName: 'WHSE_BASEMAPPING.DRA_DGTL_ROAD_ATLAS_MPAR_SP', properties: 'GEOMETRY,ROAD_CLASS,ROAD_SURFACE' },
  fwa: { typeName: 'WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP', properties: 'GEOMETRY,STREAM_ORDER,EDGE_TYPE' },
} as const

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const outRoot = argv[0]
const maptile = flag('maptile'),
  demPath = flag('dem')
assert(
  outRoot && !outRoot.startsWith('--') && (maptile || demPath),
  'Usage: fetch-inputs.ts <out> (--maptile id | --dem file)',
)
const name = flag('name') ?? maptile ?? path.basename(demPath!, path.extname(demPath!))
const dir = path.join(outRoot, name)
await mkdir(dir, { recursive: true })

const demOut = path.join(dir, 'dem.tif')
if (maptile) {
  const body = new URLSearchParams({
    where: `maptile = '${maptile.replace(/[^0-9a-z_]/gi, '')}'`,
    outFields: 'maptile,year,s3Url',
    orderByFields: 'year DESC',
    returnGeometry: 'false',
    f: 'json',
  })
  const index = (await (await fetch(`${LIDAR_BC}/5/query`, { method: 'POST', body })).json()) as {
    features?: { attributes: { s3Url: string; year: number } }[]
  }
  const tile = index.features?.[0]?.attributes
  assert(tile && /^https:\/\/nrs\.objectstore\.gov\.bc\.ca\//.test(tile.s3Url), `No LidarBC DEM tile ${maptile}`)
  console.error(`DEM ${maptile} (${tile.year}): ${tile.s3Url}`)
  const response = await fetch(tile.s3Url)
  assert(response.ok, `DEM download failed: ${response.status}`)
  await writeFile(demOut, new Uint8Array(await response.arrayBuffer()))
  await writeFile(path.join(dir, 'source.json'), JSON.stringify({ maptile, year: tile.year, url: tile.s3Url }, null, 1))
} else {
  await copyFile(demPath!, demOut)
  await writeFile(path.join(dir, 'source.json'), JSON.stringify({ file: path.resolve(demPath!) }, null, 1))
}

const wb = await initWhitebox()
const reader = new wb.GeoTiffReader(new Uint8Array(await readFile(demOut)))
const [w, s, e, n] = Array.from(reader.bounds_lonlat() as Float64Array)
const box = [w - 0.001, s - 0.001, e + 0.001, n + 0.001].map((v) => v.toFixed(6)).join(',')
for (const [key, layer] of Object.entries(LAYERS)) {
  const url = new URL(WFS)
  for (const [k, v] of Object.entries({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeName: layer.typeName,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: `BBOX(GEOMETRY,${box},'EPSG:4326')`,
    propertyName: layer.properties,
    count: '20000',
  }))
    url.searchParams.set(k, v)
  const response = await fetch(url)
  assert(response.ok, `${key}: ${response.status}`)
  const json = (await response.json()) as { features: unknown[] }
  await writeFile(path.join(dir, `${key}.geojson`), JSON.stringify(json))
  console.error(`${key}: ${json.features.length} lines`)
}
