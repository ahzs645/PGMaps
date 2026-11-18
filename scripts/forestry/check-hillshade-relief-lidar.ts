/**
 * A truth test of reading ground between contours from a hillshade (`src/lib/geoPdf/hillshadeRelief.ts`)
 * on airborne LiDAR that is public: a 1 m bare-earth DTM is reduced to what a company map sheet
 * set gives (contour lines at an interval, and a plain 8-bit hillshade), the ground is rebuilt from
 * those with and without the hillshade, and both are scored against the DTM they came from.
 * Writes only to `output`.
 *
 *   npm run lidar:fetch-analysis
 *   node --import tsx scripts/forestry/check-hillshade-relief-lidar.ts public/data/lidar-analysis/bc-093g086/dtm-1m.tif /tmp/relief-lidar.json [interval=10]
 *
 * What it does not test: JPEG noise in a sheet's hillshade, a mislabelled contour, and a sheet's
 * registration. Those are in `check-pdf-contour-slope.ts`, on real sheets.
 */
import { readFile, writeFile } from 'node:fs/promises'
import Delaunator from 'delaunator'
import { fromArrayBuffer } from 'geotiff'
import { rasterizeTriangles } from '../../src/lib/geoPdf/contours'
import { refineWithHillshadeNow } from '../../src/lib/geoPdf/hillshadeRelief'

const [dtmPath, output, intervalArg] = process.argv.slice(2)
if (!dtmPath || !output) throw Error('Usage: check-hillshade-relief-lidar.ts dtm-1m.tif /tmp/out.json [interval]')
const INTERVAL = Number(intervalArg ?? 10)
const CELL = 2
const bytes = await readFile(dtmPath)
const image = await (
  await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
).getImage()
const [res] = image.getResolution()
const nodata = image.getGDALNoData()
const fineWidth = image.getWidth(),
  fineHeight = image.getHeight()
const fine = (await image.readRasters())[0] as Float32Array
const known = (v: number) => Number.isFinite(v) && v !== nodata && v > -1000
// The truth on 2 m cells: the mean of each block of the file's cells.
const factor = Math.max(1, Math.round(CELL / Math.abs(res)))
const width = Math.floor(fineWidth / factor),
  height = Math.floor(fineHeight / factor)
const truth = new Float32Array(width * height).fill(NaN)
// The hillshade as a map sheet has it: from the file's own cells, a north-west sun 45° up, to a byte.
const shade = new Float32Array(width * height).fill(NaN)
const zenith = Math.PI / 4,
  azimuth = (315 * Math.PI) / 180
for (let row = 0; row < height; row++)
  for (let col = 0; col < width; col++) {
    let sum = 0,
      count = 0,
      light = 0,
      lit = 0
    for (let y = row * factor; y < (row + 1) * factor; y++)
      for (let x = col * factor; x < (col + 1) * factor; x++) {
        const i = y * fineWidth + x,
          v = fine[i]
        if (!known(v)) continue
        sum += v
        count++
        if (x < 1 || y < 1 || x >= fineWidth - 1 || y >= fineHeight - 1) continue
        const e = fine[i + 1],
          w = fine[i - 1],
          n = fine[i - fineWidth],
          s = fine[i + fineWidth]
        if (![e, w, n, s].every(known)) continue
        const p = (e - w) / (2 * Math.abs(res)),
          q = (n - s) / (2 * Math.abs(res))
        light += Math.max(
          0,
          (Math.cos(zenith) - Math.sin(zenith) * (p * Math.sin(azimuth) + q * Math.cos(azimuth))) /
            Math.sqrt(1 + p * p + q * q),
        )
        lit++
      }
    if (count === factor * factor) truth[row * width + col] = sum / count
    if (lit === factor * factor) shade[row * width + col] = Math.round((255 * light) / lit) / 255
  }
// Contour lines as the points where the ground crosses each level between neighbouring cells.
function contourPoints(interval: number) {
  const points: number[] = []
  const cross = (a: number, b: number, add: (t: number, level: number) => void) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return
    for (let level = Math.ceil(Math.min(a, b) / interval) * interval; level <= Math.max(a, b); level += interval)
      add((level - a) / (b - a), level)
  }
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (col < width - 1) cross(truth[i], truth[i + 1], (t, level) => points.push(col + t, row, level))
      if (row < height - 1) cross(truth[i], truth[i + width], (t, level) => points.push(col, row + t, level))
    }
  return Float32Array.from(points)
}
/** The contour surface a sheet gives: a triangulated surface through the contour points. */
function contourSurface(anchors: Float32Array, interval: number) {
  const coords = new Float64Array((anchors.length / 3) * 2),
    z = new Float64Array(anchors.length / 3)
  for (let k = 0, n = 0; k < anchors.length; k += 3, n++) {
    coords[n * 2] = anchors[k] * CELL
    coords[n * 2 + 1] = -anchors[k + 1] * CELL
    z[n] = anchors[k + 2]
  }
  const values = new Float32Array(width * height).fill(NaN)
  rasterizeTriangles(coords, z, new Delaunator(coords).triangles, {
    ox: 0,
    oy: 0,
    cell: CELL,
    width,
    height,
    ascending: false,
    values,
    maxEdge: 200,
    maxRise: interval + 1e-6,
  })
  return values
}
const slopeAt = (z: Float32Array, i: number) =>
  Math.hypot((z[i + 1] - z[i - 1]) / (2 * CELL), (z[i - width] - z[i + width]) / (2 * CELL)) * 100
const CLASSES = [20, 30, 35, 40, 50, 60, 85, 95]
const classOf = (slope: number) => CLASSES.reduce((n, b) => n + (slope >= b ? 1 : 0), 0)
/** Height, slope and along-line grade of a surface against the truth, on the cells both it and `among` have. */
function score(values: Float32Array, among: Float32Array) {
  const errors: number[] = []
  let same = 0,
    within = 0,
    scored = 0,
    steepTruth = 0,
    steepBoth = 0
  for (let row = 2; row < height - 2; row++)
    for (let col = 2; col < width - 2; col++) {
      const i = row * width + col
      if (!Number.isFinite(values[i]) || !Number.isFinite(among[i]) || !Number.isFinite(truth[i])) continue
      if ((row * 7 + col) % 5 === 0) errors.push(Math.abs(values[i] - truth[i]))
      const a = slopeAt(truth, i),
        b = slopeAt(values, i)
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(slopeAt(among, i))) continue
      const ka = classOf(a),
        kb = classOf(b)
      scored++
      if (ka === kb) same++
      if (Math.abs(ka - kb) <= 1) within++
      if (ka >= 6) {
        steepTruth++
        if (kb >= 6) steepBoth++
      }
    }
  errors.sort((a, b) => a - b)
  const q = (f: number) => Math.round(errors[Math.floor(f * (errors.length - 1))] * 100) / 100
  // Grade over 10 m steps along every 25th row and column, as a road's stations read it.
  const step = Math.round(10 / CELL)
  let gradeMiss = 0,
    changeTruth = 0,
    changeSurface = 0,
    grades = 0,
    changes = 0
  const along = (start: number, stride: number, length: number) => {
    let previousTruth = NaN,
      previousSurface = NaN
    for (let k = 0; k + step < length; k += step) {
      const a = start + k * stride,
        b = start + (k + step) * stride
      const ok = [values[a], values[b], truth[a], truth[b], among[a], among[b]].every(Number.isFinite)
      const gt = ok ? ((truth[b] - truth[a]) / 10) * 100 : NaN,
        gs = ok ? ((values[b] - values[a]) / 10) * 100 : NaN
      if (ok) {
        gradeMiss += Math.abs(gs - gt)
        grades++
        if (Number.isFinite(previousTruth)) {
          changeTruth += Math.abs(gt - previousTruth)
          changeSurface += Math.abs(gs - previousSurface)
          changes++
        }
      }
      previousTruth = gt
      previousSurface = gs
    }
  }
  for (let row = 10; row < height - 10; row += 25) along(row * width, 1, width)
  for (let col = 10; col < width - 10; col += 25) along(col, width, height)
  const round = (v: number) => Math.round(v * 10) / 10
  return {
    cells: scored,
    heightMedianErrorM: q(0.5),
    height90M: q(0.9),
    height99M: q(0.99),
    slopeSameClassPercent: round((100 * same) / scored),
    slopeWithinOnePercent: round((100 * within) / scored),
    steepFoundPercent: round((100 * steepBoth) / Math.max(1, steepTruth)),
    // Mean miss of the 10 m grade, and the mean change of grade from one 10 m step to the next.
    gradeMeanErrorPoints: round(gradeMiss / grades),
    gradeChangePerStepPoints: round(changeSurface / changes),
    gradeChangePerStepTruthPoints: round(changeTruth / changes),
  }
}
const anchors = contourPoints(INTERVAL)
const prior = contourSurface(anchors, INTERVAL)
const started = Date.now()
const refined = refineWithHillshadeNow({ width, height, cellM: CELL, prior, shade, anchors, intervalM: INTERVAL })
const result = {
  method: `A ${Math.abs(res)} m LiDAR DTM reduced to ${INTERVAL} m contours and an 8-bit hillshade (315°, 45°), rebuilt on ${CELL} m cells with and without the hillshade, and scored against the DTM.`,
  grid: { width, height, cellM: CELL, cellsWithGround: truth.reduce((n, v) => n + (Number.isFinite(v) ? 1 : 0), 0) },
  contourPoints: anchors.length / 3,
  seconds: (Date.now() - started) / 1000,
  lighting: refined.lighting,
  refinedShare: refined.refinedCells / refined.cells,
  medianChangeM: refined.medianChangeM,
  boundedShare: refined.boundedShare,
  contoursAlone: score(prior, refined.values),
  contoursAndHillshade: score(refined.values, prior),
}
await writeFile(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
