/**
 * Scores JPEG class recovery against the classes of the original lossless tile, not a screenshot:
 * the colour classifier at several radii, and the coefficient decoder (`paletteJpeg.ts`) the
 * importer uses. Reports single-pixel accuracy and how much class area lands in the wrong range
 * over square windows, which is what an area summary depends on.
 *
 * npx tsx scripts/forestry/check-pdf-jpeg-calibration.ts /tmp/pdf-class-report.json /tmp/pdf-calibration
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { colorClassifier } from '../../src/lib/geoPdf/classGrid'
import { PDF_PROFILES } from '../../src/lib/geoPdf/profiles'
import { readJpegCoefficients } from '../../src/lib/geoPdf/jpegCoefficients'
import { decodePaletteJpeg, nearestPaletteIndex, rasterPalette } from '../../src/lib/geoPdf/paletteJpeg'
import type { PdfRasterClass } from '../../src/lib/geoPdf/types'

const [reportPath, directory] = process.argv.slice(2)
if (!reportPath || !directory)
  throw Error(
    'Usage: npx tsx scripts/forestry/check-pdf-jpeg-calibration.ts /tmp/pdf-class-report.json /tmp/pdf-calibration',
  )
const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
  results: { kind: string; legend: PdfRasterClass[]; profile?: string }[]
}
const sources = JSON.parse(await readFile(path.join(directory, 'source.json'), 'utf8')) as {
  kind: string
  width: number
  height: number
}[]
const PIXEL_M = 0.847
/** Share of the drawn area put in the wrong range, averaged over full windows of `size` pixels. */
function misallocated(truth: Uint8Array, guess: Uint8Array, width: number, height: number, K: number, size: number) {
  let sum = 0,
    windows = 0
  for (let y0 = 0; y0 + size <= height; y0 += size)
    for (let x0 = 0; x0 + size <= width; x0 += size) {
      const a = new Float64Array(K),
        b = new Float64Array(K)
      let n = 0
      for (let y = y0; y < y0 + size; y++)
        for (let x = x0; x < x0 + size; x++) {
          const i = y * width + x
          if (truth[i] >= K) continue
          n++
          a[truth[i]]++
          if (guess[i] < K) b[guess[i]]++
        }
      if (n < (size * size) / 2) continue
      let d = 0
      for (let k = 0; k < K; k++) d += Math.abs(a[k] - b[k])
      sum += d / n / 2
      windows++
    }
  return windows ? sum / windows : NaN
}
const results = []
for (const source of sources) {
  const read = report.results.find((r) => r.kind === source.kind)
  if (!read) throw Error(`The class report has no ${source.kind} raster.`)
  // The raster definition of the profile that read the sheet (Canfor for reports made before profiles were named).
  const template = PDF_PROFILES.find((p) => p.label === read.profile) ?? PDF_PROFILES[0]
  const profile = template.rasters.find((p) => p.kind === source.kind)
  if (!profile) throw Error(`${template.label} has no ${source.kind} raster.`)
  const legend = read.legend
  const original = await readFile(path.join(directory, `${source.kind}-original.rgb`))
  const lossy = await readFile(path.join(directory, `${source.kind}-lossy.rgb`))
  const alpha = await readFile(path.join(directory, `${source.kind}.alpha`))
  const jpeg = readJpegCoefficients(new Uint8Array(await readFile(path.join(directory, `${source.kind}-lossy.jpg`))))
  const size = source.width * source.height
  if (original.length !== size * 3 || lossy.length !== size * 3 || alpha.length !== size)
    throw Error('Invalid calibration data.')
  const excluded = profile.overlay ? legend.length - 1 : -1
  const palette = rasterPalette(legend, excluded)
  const K = palette.length
  const groundTruth = colorClassifier(legend, false, profile.alpha, excluded)
  // Legend index per pixel; K for transparent or not a base class.
  const truth = Uint8Array.from({ length: size }, (_, i) => {
    const code = groundTruth(original[i * 3], original[i * 3 + 1], original[i * 3 + 2], alpha[i])
    return code > 0 && code <= K ? code - 1 : K
  })
  const scored = (guess: Uint8Array, method: string) => {
    let total = 0,
      accepted = 0,
      correct = 0
    for (let i = 0; i < size; i++) {
      if (truth[i] >= K) continue
      total++
      if (guess[i] < K) {
        accepted++
        if (guess[i] === truth[i]) correct++
      }
    }
    results.push({
      kind: source.kind,
      method,
      coverage: accepted / total,
      precision: correct / accepted,
      misallocated: Object.fromEntries(
        [32, 64, 128].map((w) => [
          `${Math.round(w * PIXEL_M)} m`,
          misallocated(truth, guess, source.width, source.height, K, w),
        ]),
      ),
    })
  }
  for (const tolerance of [24, 48, 80]) {
    const classify = colorClassifier(legend, true, profile.alpha, excluded, tolerance)
    scored(
      Uint8Array.from({ length: size }, (_, i) => {
        const code = classify(lossy[i * 3], lossy[i * 3 + 1], lossy[i * 3 + 2], alpha[i])
        return code > 0 && code <= K ? code - 1 : K
      }),
      `colour radius ${tolerance}`,
    )
  }
  const drawn = Uint8Array.from(alpha, (a) => (a ? 1 : 0))
  const initial = Uint8Array.from({ length: size }, (_, i) =>
    nearestPaletteIndex(palette, lossy[i * 3], lossy[i * 3 + 1], lossy[i * 3 + 2]),
  )
  scored(
    Uint8Array.from(initial, (v, i) => (drawn[i] ? v : K)),
    'nearest colour, no radius',
  )
  const started = Date.now()
  const decoded = decodePaletteJpeg({
    jpeg,
    palette,
    background: [0, 0, 0],
    drawn,
    initial,
    maxSweeps: process.env.SWEEPS ? Number(process.env.SWEEPS) : undefined,
  })
  scored(
    Uint8Array.from(decoded.labels, (v) => (v === 255 ? K : v)),
    'coefficient decoder',
  )
  console.log(`${source.kind}: decoder ${Date.now() - started} ms, ${decoded.sweeps} sweeps`)
}
await writeFile(path.join(directory, 'results.json'), JSON.stringify({ sources, results }, null, 2))
console.table(
  results.map((r) => ({
    kind: r.kind,
    method: r.method,
    coverage: r.coverage.toFixed(3),
    precision: r.precision.toFixed(3),
    ...Object.fromEntries(Object.entries(r.misallocated).map(([k, v]) => [k, (v as number).toFixed(3)])),
  })),
)
console.log(`Wrote ${path.join(directory, 'results.json')}`)
