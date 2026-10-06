import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url),
  { VectorTile } = require('@mapbox/vector-tile'),
  { default: Pbf } = require('pbf')
const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--output'))
  throw Error('Usage: node scripts/audit-network-vectors.mjs --output FILE [--cache-root DIR]')
const root = path.resolve(
    args.includes('--cache-root') ? value('--cache-root') : 'vendor/bcdatamapper/datascrapers/network',
  ),
  report = { telus: [], crtc: [], references: null, failures: [] },
  groups = new Map(),
  sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
async function files(dir) {
  let a = []
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    a.push(...(d.isDirectory() ? await files(p) : [p]))
  }
  return a
}
for (const filename of await files(root + '/telus/output/tiles')) {
  if (!filename.endsWith('.mvt')) continue
  const bits = filename.split('/tiles/')[1].split('/'),
    key = bits[0] + '/' + bits[1],
    row = groups.get(key) ?? {
      layer: bits[0],
      zoom: Number(bits[1]),
      tiles: 0,
      features: 0,
      points: 0,
      geometryTypes: {},
      badCoordinates: 0,
    }
  groups.set(key, row)
  try {
    const bytes = await fs.readFile(filename),
      tile = new VectorTile(new Pbf(bytes))
    for (const layer of Object.values(tile.layers))
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        row.features++
        row.geometryTypes[f.type] = (row.geometryTypes[f.type] ?? 0) + 1
        for (const ring of f.loadGeometry())
          for (const p of ring) {
            row.points++
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) row.badCoordinates++
          }
      }
    row.tiles++
  } catch (error) {
    report.failures.push({ filename, error: String(error) })
  }
}
report.telus = [...groups.values()].sort((a, b) => a.layer.localeCompare(b.layer) || a.zoom - b.zoom)
for (const filename of await files(root + '/crtc-network-availability/output')) {
  if (!filename.endsWith('.geojson.gz')) continue
  try {
    const bytes = await fs.readFile(filename),
      data = JSON.parse(gunzipSync(bytes)),
      r = {
        file: path.basename(filename),
        sha256: sha(bytes),
        features: 0,
        coordinates: 0,
        geometryTypes: {},
        badCoordinates: 0,
        nullGeometries: 0,
      }
    if (data.type !== 'FeatureCollection') throw Error('Expected FeatureCollection')
    function check(c) {
      if (!Array.isArray(c)) throw Error('Expected coordinate array')
      if (typeof c[0] === 'number') {
        r.coordinates++
        if (c.length < 2 || !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) r.badCoordinates++
      } else for (const child of c) check(child)
    }
    function geom(g) {
      if (g.type === 'GeometryCollection') for (const child of g.geometries) geom(child)
      else check(g.coordinates)
    }
    for (const f of data.features) {
      r.features++
      if (f.type !== 'Feature') throw Error('Expected Feature')
      if (!f.geometry) {
        r.nullGeometries++
        continue
      }
      r.geometryTypes[f.geometry.type] = (r.geometryTypes[f.geometry.type] ?? 0) + 1
      geom(f.geometry)
    }
    report.crtc.push(r)
  } catch (error) {
    report.failures.push({ filename, error: String(error) })
  }
}
report.references = JSON.parse(await fs.readFile(root + '/cell-coverage/output/manifest.json', 'utf8'))
await fs.writeFile(value('--output'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      telusLevels: report.telus.length,
      telusTiles: report.telus.reduce((n, r) => n + r.tiles, 0),
      telusFeatures: report.telus.reduce((n, r) => n + r.features, 0),
      telusPoints: report.telus.reduce((n, r) => n + r.points, 0),
      crtcLayers: report.crtc.length,
      crtcFeatures: report.crtc.reduce((n, r) => n + r.features, 0),
      crtcCoordinates: report.crtc.reduce((n, r) => n + r.coordinates, 0),
      badCoordinates: [...report.telus, ...report.crtc].reduce((n, r) => n + r.badCoordinates, 0),
      failures: report.failures,
    },
    null,
    2,
  ),
)
