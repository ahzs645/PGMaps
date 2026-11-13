import { describe, expect, it } from 'vitest'
import { readJpegCoefficients, type JpegCoefficients } from './jpegCoefficients'
import { decodePaletteJpeg, nearestPaletteIndex, rasterPalette } from './paletteJpeg'
import {
  SYNTHETIC_JPEGS,
  SYNTHETIC_PALETTE,
  SYNTHETIC_SIZE,
  syntheticClassLabels,
} from '../../../tests/fixtures/syntheticClassJpeg'

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const block = (jpeg: JpegCoefficients, component: number, by: number, bx: number) => {
  const c = jpeg.components[component],
    at = (by * c.blocksX + bx) * 64
  return Array.from(c.coefficients.subarray(at, at + 10))
}

/** A plain decode for the test's starting labels: dequantize, inverse DCT, repeat chroma, to RGB. */
function decodeRgb(jpeg: JpegCoefficients) {
  const C = (u: number, x: number) =>
    (u ? Math.sqrt(2 / 8) : Math.sqrt(1 / 8)) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  const planes = jpeg.components.map((c) => {
    const w = c.blocksX * 8,
      out = new Float64Array(w * c.blocksY * 8)
    for (let by = 0; by < c.blocksY; by++)
      for (let bx = 0; bx < c.blocksX; bx++)
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            let v = 0
            for (let k = 0; k < 64; k++)
              v += c.coefficients[(by * c.blocksX + bx) * 64 + k] * c.quant[k] * C(k >> 3, y) * C(k & 7, x)
            out[(by * 8 + y) * w + bx * 8 + x] = v
          }
    return { out, w, sx: jpeg.maxH / c.h, sy: jpeg.maxV / c.v }
  })
  const rgb = new Uint8Array(jpeg.width * jpeg.height * 3)
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  for (let y = 0; y < jpeg.height; y++)
    for (let x = 0; x < jpeg.width; x++) {
      const [Y, Cb, Cr] = planes.map((p) => p.out[Math.floor(y / p.sy) * p.w + Math.floor(x / p.sx)])
      const i = (y * jpeg.width + x) * 3
      rgb[i] = clamp(Y + 128 + 1.402 * Cr)
      rgb[i + 1] = clamp(Y + 128 - 0.344136 * Cb - 0.714136 * Cr)
      rgb[i + 2] = clamp(Y + 128 + 1.772 * Cb)
    }
  return rgb
}
/** Share of the drawn area in the wrong class, averaged over full windows. */
function misallocated(truth: Uint8Array, guess: Uint8Array, drawn: Uint8Array, size: number) {
  const { width, height } = SYNTHETIC_SIZE,
    K = SYNTHETIC_PALETTE.length
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
          if (!drawn[i]) continue
          n++
          a[truth[i]]++
          b[guess[i]]++
        }
      sum += a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) / n / 2
      windows++
    }
  return sum / windows
}

describe('JPEG coefficients', () => {
  it('reads the stored quantized coefficients and tables, with and without restart markers', () => {
    for (const fixture of [SYNTHETIC_JPEGS.plain, SYNTHETIC_JPEGS.restart]) {
      const jpeg = readJpegCoefficients(bytes(fixture.b64))
      expect(jpeg).toMatchObject({ width: 120, height: 88, maxH: 2, maxV: 2 })
      expect(jpeg.components.map((c) => [c.h, c.v])).toEqual([
        [2, 2],
        [1, 1],
        [1, 1],
      ])
      // Stored blocks include the padding to whole 16 × 16 MCUs.
      expect([jpeg.components[0].blocksY, jpeg.components[0].blocksX]).toEqual([12, 16])
      expect(Array.from(jpeg.components[0].quant.subarray(0, 8))).toEqual(fixture.qy)
      expect(block(jpeg, 0, 0, 0)).toEqual(fixture.y_0_0)
      expect(block(jpeg, 0, 5, 7)).toEqual(fixture.y_5_7)
      expect(block(jpeg, 1, 3, 4)).toEqual(fixture.cb_3_4)
      expect(block(jpeg, 2, 5, 7)).toEqual(fixture.cr_5_7)
    }
  })

  it('refuses progressive JPEG rather than misreading it', () => {
    const progressive = Uint8Array.from([0xff, 0xd8, 0xff, 0xc2, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0, 0xff, 0xd9])
    expect(() => readJpegCoefficients(progressive)).toThrow(/progressive/)
  })
})

describe('palette-constrained JPEG decode', () => {
  it('recovers class shares much closer than the nearest colour, and never decodes transparency', () => {
    const jpeg = readJpegCoefficients(bytes(SYNTHETIC_JPEGS.plain.b64))
    const { labels: truth, drawn } = syntheticClassLabels()
    const rgb = decodeRgb(jpeg)
    const initial = Uint8Array.from({ length: truth.length }, (_, i) =>
      nearestPaletteIndex(SYNTHETIC_PALETTE, rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]),
    )
    const result = decodePaletteJpeg({ jpeg, palette: SYNTHETIC_PALETTE, background: [0, 0, 0], drawn, initial })
    expect(result.labels.every((v, i) => (drawn[i] ? v < SYNTHETIC_PALETTE.length : v === 255))).toBe(true)
    const decoder = misallocated(truth, result.labels, drawn, 24),
      nearest = misallocated(truth, initial, drawn, 24)
    expect(decoder).toBeLessThan(nearest * 0.75)
    expect(decoder).toBeLessThan(0.2)
  })

  it('takes the colour each class is drawn in, not its printed swatch', () => {
    expect(
      rasterPalette(
        [{ color: [255, 127, 127] }, { color: [232, 21, 21], aliases: [[255, 0, 0]] }, { color: [0, 0, 0] }],
        2,
      ),
    ).toEqual([
      [255, 127, 127],
      [255, 0, 0],
    ])
  })
})
