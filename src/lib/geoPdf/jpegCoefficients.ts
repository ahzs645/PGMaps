/**
 * Reads a baseline JPEG's quantized DCT coefficients and quantization tables: what the file
 * actually stores, before any decoder rounds it into pixels. Baseline (SOF0/SOF1) Huffman only;
 * progressive and arithmetic-coded files are refused. DOM and network free.
 */

export interface JpegComponent {
  id: number
  h: number
  v: number
  /** Quantization table, natural (row-major) order: index = vertical × 8 + horizontal frequency. */
  quant: Uint16Array
  /** Blocks per row and column as stored, padding to whole MCUs included. */
  blocksX: number
  blocksY: number
  /** 64 quantized coefficients per block, natural order, blocks row-major. */
  coefficients: Int16Array
}
export interface JpegCoefficients {
  width: number
  height: number
  maxH: number
  maxV: number
  components: JpegComponent[]
}

/** Zig-zag position k → natural index. */
export const ZIGZAG = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
])
/** Largest image a class tile can be: the PDF raster budget. */
const MAX_PIXELS = 16_777_216

interface Huffman {
  /** maxCode[length] for lengths 1..16, -1 when no code has that length. */
  maxCode: Int32Array
  valPtr: Int32Array
  minCode: Int32Array
  values: Uint8Array
}
function huffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxCode = new Int32Array(18).fill(-1),
    valPtr = new Int32Array(17),
    minCode = new Int32Array(17)
  let code = 0,
    k = 0
  for (let length = 1; length <= 16; length++) {
    valPtr[length] = k
    minCode[length] = code
    code += counts[length - 1]
    k += counts[length - 1]
    if (counts[length - 1]) maxCode[length] = code - 1
    code <<= 1
  }
  maxCode[17] = 0x7fffffff
  return { maxCode, valPtr, minCode, values }
}

export function readJpegCoefficients(bytes: Uint8Array): JpegCoefficients {
  const fail = (message: string): never => {
    throw Error(`JPEG tile: ${message}`)
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('missing start-of-image marker')
  const quant: (Uint16Array | undefined)[] = []
  const dc: (Huffman | undefined)[] = [],
    ac: (Huffman | undefined)[] = []
  let frame: { width: number; height: number; components: { id: number; h: number; v: number; tq: number }[] } | null =
    null
  let restart = 0
  let pos = 2
  const u16 = (at: number) => (bytes[at] << 8) | bytes[at + 1]
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) fail('corrupt marker stream')
    const marker = bytes[pos + 1]
    if (marker === 0xff) {
      pos++
      continue
    }
    if (marker === 0xd9) break
    const length = u16(pos + 2),
      start = pos + 4,
      end = pos + 2 + length
    if (end > bytes.length) fail('truncated segment')
    if (marker === 0xdb) {
      for (let p = start; p < end; ) {
        const precision = bytes[p] >> 4,
          id = bytes[p] & 15
        const table = new Uint16Array(64)
        for (let k = 0; k < 64; k++) table[ZIGZAG[k]] = precision ? u16(p + 1 + 2 * k) : bytes[p + 1 + k]
        quant[id] = table
        p += 1 + 64 * (precision ? 2 : 1)
      }
    } else if (marker === 0xc0 || marker === 0xc1) {
      if (bytes[start] !== 8) fail('only 8-bit samples are supported')
      const height = u16(start + 1),
        width = u16(start + 3),
        count = bytes[start + 5]
      if (!width || !height || width * height > MAX_PIXELS) fail('unsupported dimensions')
      frame = {
        width,
        height,
        components: Array.from({ length: count }, (_, i) => ({
          id: bytes[start + 6 + 3 * i],
          h: bytes[start + 7 + 3 * i] >> 4,
          v: bytes[start + 7 + 3 * i] & 15,
          tq: bytes[start + 8 + 3 * i],
        })),
      }
    } else if (
      (marker >= 0xc2 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xcf && marker !== 0xc8 && marker !== 0xcc)
    )
      fail('progressive, lossless or arithmetic-coded JPEG is not supported')
    else if (marker === 0xc4) {
      for (let p = start; p < end; ) {
        const kind = bytes[p] >> 4,
          id = bytes[p] & 15
        const counts = bytes.subarray(p + 1, p + 17)
        const total = counts.reduce((s, n) => s + n, 0)
        const table = huffman(counts, bytes.slice(p + 17, p + 17 + total))
        if (kind) ac[id] = table
        else dc[id] = table
        p += 17 + total
      }
    } else if (marker === 0xdd) restart = u16(start)
    else if (marker === 0xda) {
      if (!frame) fail('scan before frame header')
      const f = frame!
      const count = bytes[start]
      if (count !== f.components.length) fail('only single-scan interleaved JPEG is supported')
      const scan = Array.from({ length: count }, (_, i) => {
        const id = bytes[start + 1 + 2 * i],
          tables = bytes[start + 2 + 2 * i]
        const index = f.components.findIndex((c) => c.id === id)
        if (index < 0) fail('scan names an unknown component')
        return {
          index,
          dc: dc[tables >> 4] ?? fail('missing DC table'),
          ac: ac[tables & 15] ?? fail('missing AC table'),
        }
      })
      const maxH = Math.max(...f.components.map((c) => c.h)),
        maxV = Math.max(...f.components.map((c) => c.v))
      const mcusX = Math.ceil(f.width / (8 * maxH)),
        mcusY = Math.ceil(f.height / (8 * maxV))
      const components: JpegComponent[] = f.components.map((c) => {
        const blocksX = mcusX * c.h,
          blocksY = mcusY * c.v
        return {
          id: c.id,
          h: c.h,
          v: c.v,
          quant: quant[c.tq] ?? fail('missing quantization table'),
          blocksX,
          blocksY,
          coefficients: new Int16Array(blocksX * blocksY * 64),
        }
      })
      // Entropy-coded data: bit reader over unstuffed bytes, stopping at a marker.
      let p = end,
        bits = 0,
        held = 0
      const readBit = () => {
        if (!held) {
          if (p >= bytes.length) fail('truncated scan')
          let byte = bytes[p++]
          if (byte === 0xff) {
            const next = bytes[p]
            if (next === 0) p++
            else if (next >= 0xd0 && next <= 0xd7) fail('unexpected restart marker')
            else byte = 0xff
          }
          bits = byte
          held = 8
        }
        held--
        return (bits >> held) & 1
      }
      const decode = (t: Huffman) => {
        let code = 0
        for (let length = 1; length <= 16; length++) {
          code = (code << 1) | readBit()
          if (code <= t.maxCode[length] && t.maxCode[length] >= 0)
            return t.values[t.valPtr[length] + code - t.minCode[length]]
        }
        return fail('bad Huffman code')
      }
      const receive = (size: number) => {
        let v = 0
        for (let i = 0; i < size; i++) v = (v << 1) | readBit()
        return v < 1 << (size - 1) ? v - (1 << size) + 1 : v
      }
      const predictors = new Int32Array(count)
      const total = mcusX * mcusY
      for (let m = 0; m < total; m++) {
        if (restart && m && m % restart === 0) {
          held = 0
          while (p < bytes.length - 1 && !(bytes[p] === 0xff && bytes[p + 1] >= 0xd0 && bytes[p + 1] <= 0xd7)) p++
          if (p >= bytes.length - 1) fail('missing restart marker')
          p += 2
          predictors.fill(0)
        }
        const mx = m % mcusX,
          my = Math.floor(m / mcusX)
        scan.forEach(({ index, dc, ac }, s) => {
          const c = components[index]
          for (let by = 0; by < c.v; by++)
            for (let bx = 0; bx < c.h; bx++) {
              const block = ((my * c.v + by) * c.blocksX + mx * c.h + bx) * 64
              const t = decode(dc)
              predictors[s] += t ? receive(t) : 0
              c.coefficients[block] = predictors[s]
              for (let k = 1; k < 64; ) {
                const rs = decode(ac),
                  run = rs >> 4,
                  size = rs & 15
                if (!size) {
                  if (run !== 15) break
                  k += 16
                  continue
                }
                k += run
                if (k > 63) fail('coefficient index out of range')
                c.coefficients[block + ZIGZAG[k]] = receive(size)
                k++
              }
            }
        })
      }
      return { width: f.width, height: f.height, maxH, maxV, components }
    }
    pos = end
  }
  return fail('no image scan')
}
