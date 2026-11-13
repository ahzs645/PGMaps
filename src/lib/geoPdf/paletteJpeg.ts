/**
 * Class labels for a JPEG-compressed class raster, chosen so that encoding the labelled image with
 * the file's own quantization tables reproduces the coefficients the file stores. A plain decoder
 * rounds away which colour each pixel was; this keeps the stored evidence and the known palette.
 *
 * What it can and cannot recover (measured, see `docs/forestry-road-design/source-pdf-import.md`):
 * at the quality these sheets use a single pixel's class stays about a coin toss, but the share of
 * each class over a few tens of metres comes back close to the original. Use the labels for area
 * summaries, never as exact classes. DOM and network free.
 */
import type { JpegCoefficients } from './jpegCoefficients'

export type Rgb = [number, number, number]
export interface PaletteDecodeInput {
  jpeg: JpegCoefficients
  /** Colours as the raster draws each class (aliases resolved), in legend order. */
  palette: Rgb[]
  /** Colour under transparent pixels in the source image; ArcGIS writes black. */
  background: Rgb
  /** Per pixel: 1 drawn, 0 transparent. From the lossless soft mask. */
  drawn: Uint8Array
  /** Starting class per drawn pixel (legend index), e.g. the nearest palette colour of the decoded pixel. */
  initial: Uint8Array
  maxSweeps?: number
}
export interface PaletteDecodeResult {
  /** Legend index per pixel; 255 where transparent. */
  labels: Uint8Array
  sweeps: number
  changed: number
}

const ycc = ([r, g, b]: Rgb): Rgb => [
  0.299 * r + 0.587 * g + 0.114 * b - 128,
  -0.168736 * r - 0.331264 * g + 0.5 * b,
  0.5 * r - 0.418688 * g - 0.081312 * b,
]
/** Orthonormal DCT-II basis: BASIS[(y·8 + x)·64 + v·8 + u], the JPEG coefficient layout. */
const BASIS = (() => {
  const c = (u: number, x: number) =>
    (u ? Math.sqrt(2 / 8) : Math.sqrt(1 / 8)) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  const out = new Float64Array(64 * 64)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) out[(y * 8 + x) * 64 + v * 8 + u] = c(v, y) * c(u, x)
  return out
})()
/**
 * Cost of a coefficient residual r = DCT/Q − stored, in quantization steps. Outside the stored
 * value's rounding bin (|r| > ½) the labels cannot be what was encoded; inside it a small pull to
 * the centre breaks ties. The weights are the ones calibrated in the guide's experiment.
 */
const cost = (r: number) => {
  const a = Math.abs(r) - 0.5
  return (a > 0 ? 4 * a * a : 0) + 0.05 * r * r
}
/** Coefficients at the format's largest step carry almost no information here; skipping them keeps a tile to seconds. */
const MAX_USEFUL_STEP = 254
/**
 * Passes over the tile. The calibration's misallocated share was 9.0% after 3 passes and 8.8% after
 * 12 (slope; canopy 11.8% and 11.4%), at a third of the time, so the importer stops at 4.
 */
export const DECODE_SWEEPS = 4

export function* decodePaletteJpegSteps(input: PaletteDecodeInput): Generator<number, PaletteDecodeResult> {
  const { jpeg, palette, background, drawn, initial, maxSweeps = DECODE_SWEEPS } = input
  if (jpeg.components.length !== 3) throw Error('JPEG class tiles must be YCbCr colour.')
  const [Y, Cb, Cr] = jpeg.components
  if (Y.h !== jpeg.maxH || Y.v !== jpeg.maxV || Cb.h !== Cr.h || Cb.v !== Cr.v)
    throw Error('Unsupported JPEG sampling layout.')
  const sx = jpeg.maxH / Cb.h,
    sy = jpeg.maxV / Cb.v
  if (![1, 2].includes(sx) || ![1, 2].includes(sy)) throw Error('Unsupported JPEG chroma subsampling.')
  const K = palette.length,
    W = jpeg.width,
    H = jpeg.height
  if (drawn.length !== W * H || initial.length !== W * H) throw Error('The mask does not match the JPEG tile.')
  const PW = Y.blocksX * 8,
    PH = Y.blocksY * 8
  const colours = [...palette, background].map(ycc)
  const pY = Float64Array.from(colours, (c) => c[0]),
    pB = Float64Array.from(colours, (c) => c[1]),
    pR = Float64Array.from(colours, (c) => c[2])
  // Labels over the padded image. Encoders pad by repeating the edge pixel; those stay fixed.
  const labels = new Uint8Array(PW * PH),
    free = new Uint8Array(PW * PH)
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      const s = Math.min(y, H - 1) * W + Math.min(x, W - 1)
      labels[y * PW + x] = drawn[s] ? Math.min(initial[s], K - 1) : K
      free[y * PW + x] = x < W && y < H && drawn[s] ? 1 : 0
    }
  const active = (q: Uint16Array) => Int32Array.from([...q.keys()].filter((k) => q[k] <= MAX_USEFUL_STEP))
  const kY = active(Y.quant),
    kC = active(Cb.quant)
  if (Cr.quant.some((q, k) => q !== Cb.quant[k])) throw Error('Unsupported JPEG: the chroma tables differ.')
  // Basis over quantization step, per pixel position, for the active coefficients only.
  const scaled = (keys: Int32Array, q: Uint16Array) => {
    const out = new Float64Array(64 * keys.length)
    for (let p = 0; p < 64; p++) keys.forEach((k, j) => (out[p * keys.length + j] = BASIS[p * 64 + k] / q[k]))
    return out
  }
  const bY = scaled(kY, Y.quant),
    bC = scaled(kC, Cb.quant)
  const nY = kY.length,
    nC = kC.length
  // Residuals in quantization steps: DCT(labels)/Q − stored coefficient.
  const residual = (component: typeof Y, keys: Int32Array, plane: (x: number, y: number) => number) => {
    const n = keys.length,
      out = new Float64Array(component.blocksX * component.blocksY * n)
    const block = new Float64Array(64)
    for (let by = 0; by < component.blocksY; by++)
      for (let bx = 0; bx < component.blocksX; bx++) {
        for (let p = 0; p < 64; p++) block[p] = plane(bx * 8 + (p & 7), by * 8 + (p >> 3))
        const b = by * component.blocksX + bx
        keys.forEach((k, j) => {
          let f = 0
          for (let p = 0; p < 64; p++) f += block[p] * BASIS[p * 64 + k]
          out[b * n + j] = f / component.quant[k] - component.coefficients[b * 64 + k]
        })
      }
    return out
  }
  const chromaPlane = (values: Float64Array) => (cx: number, cy: number) => {
    let sum = 0
    for (let dy = 0; dy < sy; dy++)
      for (let dx = 0; dx < sx; dx++) {
        const x = Math.min(cx * sx + dx, PW - 1),
          y = Math.min(cy * sy + dy, PH - 1)
        sum += values[labels[y * PW + x]]
      }
    return sum / (sx * sy)
  }
  const rY = residual(Y, kY, (x, y) => pY[labels[y * PW + x]])
  const rB = residual(Cb, kC, chromaPlane(pB)),
    rR = residual(Cr, kC, chromaPlane(pR))
  yield 0
  const mcuW = 8 * jpeg.maxH,
    mcuH = 8 * jpeg.maxV,
    mcusX = PW / mcuW,
    mcusY = PH / mcuH
  let dirty = new Uint8Array(mcusX * mcusY).fill(1)
  const share = 1 / (sx * sy)
  let sweeps = 0,
    changedTotal = 0
  for (; sweeps < maxSweeps; ) {
    sweeps++
    const next = new Uint8Array(dirty.length)
    let changed = 0
    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        if (!dirty[my * mcusX + mx]) continue
        for (let y = my * mcuH; y < (my + 1) * mcuH; y++)
          for (let x = mx * mcuW; x < (mx + 1) * mcuW; x++) {
            const i = y * PW + x
            if (!free[i]) continue
            const current = labels[i]
            const yb = ((y >> 3) * Y.blocksX + (x >> 3)) * nY,
              yp = ((y & 7) * 8 + (x & 7)) * nY
            const cx = Math.floor(x / sx),
              cy = Math.floor(y / sy)
            const cb = ((cy >> 3) * Cb.blocksX + (cx >> 3)) * nC,
              cp = ((cy & 7) * 8 + (cx & 7)) * nC
            // Current cost of the residuals this pixel touches, once; each candidate's new cost
            // only grows as terms are added, so a candidate stops as soon as it cannot win.
            let base = 0
            for (let j = 0; j < nY; j++) base += cost(rY[yb + j])
            for (let j = 0; j < nC; j++) base += cost(rB[cb + j]) + cost(rR[cb + j])
            let best = base - 1e-9,
              choice = current
            for (let c = 0; c < K; c++) {
              if (c === current) continue
              const dY = pY[c] - pY[current],
                dB = (pB[c] - pB[current]) * share,
                dR = (pR[c] - pR[current]) * share
              let total = 0
              for (let j = 0; j < nC && total < best; j++) {
                const w = bC[cp + j]
                total += cost(rB[cb + j] + dB * w) + cost(rR[cb + j] + dR * w)
              }
              for (let j = 0; j < nY && total < best; j++) total += cost(rY[yb + j] + dY * bY[yp + j])
              if (total < best) {
                best = total
                choice = c
              }
            }
            if (choice === current) continue
            const dY = pY[choice] - pY[current],
              dB = (pB[choice] - pB[current]) * share,
              dR = (pR[choice] - pR[current]) * share
            for (let j = 0; j < nY; j++) rY[yb + j] += dY * bY[yp + j]
            for (let j = 0; j < nC; j++) {
              rB[cb + j] += dB * bC[cp + j]
              rR[cb + j] += dR * bC[cp + j]
            }
            labels[i] = choice
            changed++
            next[my * mcusX + mx] = 1
          }
      }
      yield sweeps * mcusY + my
    }
    changedTotal += changed
    dirty = next
    if (!changed) break
  }
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const label = labels[y * PW + x]
      out[y * W + x] = label === K ? 255 : label
    }
  return { labels: out, sweeps, changed: changedTotal }
}

/** Runs the decode to completion; workers and scripts that need no cooperative slicing use this. */
export function decodePaletteJpeg(input: PaletteDecodeInput): PaletteDecodeResult {
  const steps = decodePaletteJpegSteps(input)
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

/** The colours a raster actually draws: a class's documented alias where the swatch differs. */
export function rasterPalette(legend: ReadonlyArray<{ color: Rgb; aliases?: Rgb[] }>, excluded = -1): Rgb[] {
  return legend.flatMap((c, i) => (i === excluded ? [] : [c.aliases?.[0] ?? c.color]))
}
export function nearestPaletteIndex(palette: readonly Rgb[], r: number, g: number, b: number) {
  let best = 0,
    distance = Infinity
  palette.forEach(([pr, pg, pb], i) => {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (d < distance) {
      distance = d
      best = i
    }
  })
  return best
}
