// Executes only the upstream core segmentation functions at the reviewed commit.
// FORA: Copyright (c) 2026 Burhan Gencal, MIT; see the upstream LICENSE.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import proj4 from 'proj4'
const [source, pointsDir, output] = process.argv.slice(2)
const expected = 'e866d5b6a8cf0267515cd0fedef95043f3df3c01'
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expected)
  throw Error('Use the reviewed FORA commit')
const app = readFileSync(`${source}/src/App.jsx`, 'utf8')
if (
  app !==
  execFileSync('git', ['-C', source, 'show', `${expected}:src/App.jsx`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
)
  throw Error('FORA source differs from the reviewed commit')
const piece = (start, end) => app.slice(app.indexOf(start), app.indexOf(end))
const code =
  piece('function gB(', 'function makeNorm(') +
  piece('function runSeg(', 'function makeMet(') +
  piece('const VWS=', '// Convex hull') +
  '\nrunSeg'
const runSeg = vm.runInNewContext(code, {}, { timeout: 1000 })
const crs =
  '+proj=utm +zone=10 +ellps=GRS80 +towgs84=-0.991,1.9072,0.5129,0.0257899075194932,0.0096500989602704,0.0116599432323421,0 +units=m +no_defs'
const runs = []
for (const file of readdirSync(pointsDir).filter((f) => f.endsWith('.json'))) {
  const packed = JSON.parse(readFileSync(`${pointsDir}/${file}`))
  const core = JSON.parse(gunzipSync(Buffer.from(packed.data, 'base64')).toString())
  const xy = core.points.map((p) => proj4('EPSG:4326', crs, p.slice(0, 2))),
    origin = xy[0]
  const pts = {
    x: Float32Array.from(xy, (p) => p[0] - origin[0]),
    y: Float32Array.from(xy, (p) => p[1] - origin[1]),
    z: Float32Array.from(core.points, (p) => p[2]),
  }
  if (!xy.every((p) => p.every(Number.isFinite))) throw Error('Non-finite metric coordinates')
  const height = Float32Array.from(core.points, (p) => p[3])
  for (const [id, variable] of [
    ['fora-fixed', false],
    ['fora-variable', true],
  ]) {
    const start = performance.now(),
      result = runSeg(pts, height, 1, 5, 3, variable, 'combined', null)
    if (result.labels.length !== core.points.length) throw Error('FORA label alignment failed')
    writeFileSync(
      `${output}/${core.chunk}-${id}.json`,
      JSON.stringify({
        source_sha256: core.source_sha256,
        chunk: core.chunk,
        method: id,
        labels: Array.from(result.labels),
        source_rows: core.points.map((p) => p[4]),
      }),
    )
    runs.push({
      chunk: core.chunk,
      method: id,
      count: result.count,
      seconds: (performance.now() - start) / 1000,
      core_returns: core.points.length,
    })
  }
}
writeFileSync(
  `${output}/fora-run.json`,
  JSON.stringify(
    {
      commit: expected,
      source_sha256: createHash('sha256').update(app).digest('hex'),
      license: 'MIT',
      note: 'Upstream runSeg on all cached core returns, existing per-return DTM normalization; core-only, 1 m cell, 5 m minimum, fixed 3 m radius or mixed-forest variable preset. Turkish allometry not used.',
      runs,
    },
    null,
    2,
  ),
)
console.log(JSON.stringify(runs))
