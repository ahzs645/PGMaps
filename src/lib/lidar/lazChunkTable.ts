/**
 * LAZ chunk table reader. No DOM or network access.
 *
 * A LAZ file stores its points in independently compressed chunks (50,000 points by default) and lists each
 * chunk's byte size, and for variable-size chunks its point count, in a table at the end of the file. That
 * table is itself arithmetic coded. Reading it lets a caller decode one chunk at a time from a `File.slice`,
 * so a cloud far larger than browser memory can be scanned. laz-perf decodes the chunks but does not expose
 * the table, so this ports LASzip's reader: `read_chunk_table` (lasreadpoint.cpp), `IntegerCompressor`
 * (integercompressor.cpp, decompression only) and the arithmetic decoder and models (arithmeticdecoder.cpp,
 * arithmeticmodel.cpp). LASzip is © rapidlasso GmbH, Apache-2.0; see NOTICE-LASZIP.md.
 */

export interface LaszipVlr {
  /** 0 none, 1 pointwise, 2 pointwise chunked, 3 layered chunked (LAS 1.4 point formats 6–10). */
  compressor: number
  /** Points per chunk, or `VARIABLE_CHUNK_SIZE` when each chunk records its own count. */
  chunkSize: number
}

export const VARIABLE_CHUNK_SIZE = 0xffffffff
export const LASZIP_USER = 'laszip encoded'
export const LASZIP_RECORD = 22204

export function parseLaszipVlr(data: Uint8Array): LaszipVlr {
  if (data.byteLength < 34) throw Error('The LASzip record is truncated.')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { compressor: view.getUint16(0, true), chunkSize: view.getUint32(12, true) }
}

export interface LazChunk {
  /** Byte offset of the chunk in the file. */
  start: number
  /** Compressed size in bytes. */
  bytes: number
  /** Points in the chunk. */
  points: number
  /** Index of the chunk's first point in the file. */
  firstPoint: number
}

/**
 * Where the chunk table lives. The 8 bytes at the start of the point data hold its offset; a writer that could
 * not seek back leaves -1 there and puts the offset in the file's last 8 bytes instead.
 */
export function chunkTableOffset(pointerBytes: Uint8Array, tailBytes?: Uint8Array): number | null {
  const read = (b: Uint8Array) => Number(new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true))
  const offset = read(pointerBytes)
  if (offset !== -1) return offset
  return tailBytes && tailBytes.byteLength >= 8 ? read(tailBytes.subarray(tailBytes.byteLength - 8)) : null
}

/**
 * Decode the chunk table that starts at `tableOffset`. `table` holds the bytes from there to the end of the
 * file (or at least the whole table). Every chunk's offset is checked against the file, and the point counts
 * against the header, so a table this reader got wrong fails here instead of feeding garbage to the decoder.
 */
export function readChunkTable(
  table: Uint8Array,
  {
    pointOffset,
    tableOffset,
    chunkSize,
    totalPoints,
  }: {
    pointOffset: number
    tableOffset: number
    chunkSize: number
    totalPoints: number
  },
): LazChunk[] {
  if (table.byteLength < 8) throw Error('The LAZ chunk table is truncated.')
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const version = view.getUint32(0, true)
  const count = view.getUint32(4, true)
  if (version !== 0) throw Error(`Unsupported LAZ chunk table version ${version}.`)
  if (count === 0 || count > 10_000_000) throw Error('The LAZ chunk table lists no chunks.')
  const variable = chunkSize === VARIABLE_CHUNK_SIZE
  if (!variable && (!chunkSize || count !== Math.ceil(totalPoints / chunkSize)))
    throw Error('The LAZ chunk table does not match the point count. The file may be truncated or damaged.')
  const sizes = new Array<number>(count)
  const counts = variable ? new Array<number>(count) : null
  const decoder = new ArithmeticDecoder(table.subarray(8))
  const ic = new IntegerDecompressor(decoder, 32, 2)
  for (let i = 0; i < count; i++) {
    if (counts) counts[i] = ic.decompress(i ? counts[i - 1] : 0, 0)
    sizes[i] = ic.decompress(i ? sizes[i - 1] : 0, 1)
  }
  const chunks: LazChunk[] = []
  // The chunks start after the 8-byte table pointer and run back to back.
  let start = pointOffset + 8,
    firstPoint = 0
  for (let i = 0; i < count; i++) {
    const bytes = sizes[i] >>> 0
    const points = counts ? counts[i] >>> 0 : Math.min(chunkSize, totalPoints - firstPoint)
    if (bytes <= 0 || points <= 0 || start + bytes > tableOffset)
      throw Error('The LAZ chunk table does not match the file. The file may be truncated or damaged.')
    chunks.push({ start, bytes, points, firstPoint })
    start += bytes
    firstPoint += points
  }
  if (start !== tableOffset || firstPoint !== totalPoints)
    throw Error('The LAZ chunk table does not add up to the file. The file may be truncated or damaged.')
  return chunks
}

// ---- LASzip arithmetic decoding (decompression side only) ----

const AC_MIN_LENGTH = 0x01000000
const BM_LENGTH_SHIFT = 13
const BM_MAX_COUNT = 1 << BM_LENGTH_SHIFT
const DM_LENGTH_SHIFT = 15
const DM_MAX_COUNT = 1 << DM_LENGTH_SHIFT

class BitModel {
  bit0Count = 1
  bitCount = 2
  bit0Prob = 1 << (BM_LENGTH_SHIFT - 1)
  updateCycle = 4
  bitsUntilUpdate = 4
  update() {
    if ((this.bitCount += this.updateCycle) > BM_MAX_COUNT) {
      this.bitCount = (this.bitCount + 1) >>> 1
      this.bit0Count = (this.bit0Count + 1) >>> 1
      if (this.bit0Count === this.bitCount) ++this.bitCount
    }
    const scale = Math.floor(0x80000000 / this.bitCount)
    this.bit0Prob = Math.floor((this.bit0Count * scale) / 2 ** (31 - BM_LENGTH_SHIFT))
    this.updateCycle = (5 * this.updateCycle) >>> 2
    if (this.updateCycle > 64) this.updateCycle = 64
    this.bitsUntilUpdate = this.updateCycle
  }
}

class SymbolModel {
  readonly symbols: number
  readonly lastSymbol: number
  readonly distribution: Uint32Array
  readonly symbolCount: Uint32Array
  readonly decoderTable: Uint32Array | null
  readonly tableSize: number
  readonly tableShift: number
  totalCount = 0
  updateCycle: number
  symbolsUntilUpdate = 0
  constructor(symbols: number) {
    if (symbols < 2 || symbols > 1 << 11) throw Error('Invalid LAZ symbol model.')
    this.symbols = symbols
    this.lastSymbol = symbols - 1
    if (symbols > 16) {
      let tableBits = 3
      while (symbols > 1 << (tableBits + 2)) ++tableBits
      this.tableSize = 1 << tableBits
      this.tableShift = DM_LENGTH_SHIFT - tableBits
      this.decoderTable = new Uint32Array(this.tableSize + 2)
    } else {
      this.tableSize = this.tableShift = 0
      this.decoderTable = null
    }
    this.distribution = new Uint32Array(symbols)
    this.symbolCount = new Uint32Array(symbols).fill(1)
    this.updateCycle = symbols
    this.update()
    this.symbolsUntilUpdate = this.updateCycle = (symbols + 6) >>> 1
  }
  update() {
    const { symbols, symbolCount, distribution, decoderTable } = this
    if ((this.totalCount += this.updateCycle) > DM_MAX_COUNT) {
      this.totalCount = 0
      for (let n = 0; n < symbols; n++) this.totalCount += symbolCount[n] = (symbolCount[n] + 1) >>> 1
    }
    const scale = Math.floor(0x80000000 / this.totalCount)
    const shift = 2 ** (31 - DM_LENGTH_SHIFT)
    let sum = 0
    if (!decoderTable) {
      for (let k = 0; k < symbols; k++) {
        distribution[k] = Math.floor((scale * sum) / shift)
        sum += symbolCount[k]
      }
    } else {
      let s = 0
      for (let k = 0; k < symbols; k++) {
        distribution[k] = Math.floor((scale * sum) / shift)
        sum += symbolCount[k]
        const w = distribution[k] >>> this.tableShift
        while (s < w) decoderTable[++s] = k - 1
      }
      decoderTable[0] = 0
      while (s <= this.tableSize) decoderTable[++s] = symbols - 1
    }
    this.updateCycle = (5 * this.updateCycle) >>> 2
    const maxCycle = (symbols + 6) << 3
    if (this.updateCycle > maxCycle) this.updateCycle = maxCycle
    this.symbolsUntilUpdate = this.updateCycle
  }
}

export class ArithmeticDecoder {
  private at = 0
  private value = 0
  private length = 0xffffffff
  constructor(private readonly bytes: Uint8Array) {
    for (let i = 0; i < 4; i++) this.value = ((this.value << 8) | this.byte()) >>> 0
  }
  private byte() {
    if (this.at >= this.bytes.byteLength) throw Error('The LAZ chunk table ended early.')
    return this.bytes[this.at++]
  }
  private renorm() {
    do {
      this.value = ((this.value << 8) | this.byte()) >>> 0
      this.length = (this.length << 8) >>> 0
    } while (this.length < AC_MIN_LENGTH)
  }
  decodeBit(m: BitModel) {
    const x = m.bit0Prob * (this.length >>> BM_LENGTH_SHIFT)
    const sym = this.value >= x ? 1 : 0
    if (sym === 0) {
      this.length = x
      ++m.bit0Count
    } else {
      this.value -= x
      this.length -= x
    }
    if (this.length < AC_MIN_LENGTH) this.renorm()
    if (--m.bitsUntilUpdate === 0) m.update()
    return sym
  }
  decodeSymbol(m: SymbolModel) {
    let n: number, sym: number, x: number
    let y = this.length
    if (m.decoderTable) {
      this.length = this.length >>> DM_LENGTH_SHIFT
      const dv = Math.floor(this.value / this.length)
      const t = dv >>> m.tableShift
      sym = m.decoderTable[t]
      n = m.decoderTable[t + 1] + 1
      while (n > sym + 1) {
        const k = (sym + n) >>> 1
        if (m.distribution[k] > dv) n = k
        else sym = k
      }
      x = m.distribution[sym] * this.length
      if (sym !== m.lastSymbol) y = m.distribution[sym + 1] * this.length
    } else {
      x = sym = 0
      this.length = this.length >>> DM_LENGTH_SHIFT
      n = m.symbols
      let k = n >>> 1
      do {
        const z = this.length * m.distribution[k]
        if (z > this.value) {
          n = k
          y = z
        } else {
          sym = k
          x = z
        }
      } while ((k = (sym + n) >>> 1) !== sym)
    }
    this.value -= x
    this.length = y - x
    if (this.length < AC_MIN_LENGTH) this.renorm()
    ++m.symbolCount[sym]
    if (--m.symbolsUntilUpdate === 0) m.update()
    return sym
  }
  readBits(bits: number): number {
    if (bits > 19) {
      const low = this.readShort()
      const high = this.readBits(bits - 16)
      return ((high << 16) | low) >>> 0
    }
    this.length = this.length >>> bits
    const sym = Math.floor(this.value / this.length)
    this.value -= this.length * sym
    if (this.length < AC_MIN_LENGTH) this.renorm()
    return sym
  }
  private readShort() {
    this.length = this.length >>> 16
    const sym = Math.floor(this.value / this.length)
    this.value -= this.length * sym
    if (this.length < AC_MIN_LENGTH) this.renorm()
    return sym
  }
}

/** LASzip's IntegerCompressor, decompression only, with its default 8 high bits and no range. */
class IntegerDecompressor {
  private readonly corrBits: number
  private readonly corrRange: number
  private readonly corrMin: number
  private readonly bitsHigh = 8
  private readonly mBits: SymbolModel[]
  private readonly mCorrector0: BitModel
  private readonly mCorrector: SymbolModel[]
  constructor(
    private readonly dec: ArithmeticDecoder,
    bits: number,
    contexts: number,
  ) {
    if (bits && bits < 32) {
      this.corrBits = bits
      this.corrRange = 2 ** bits
      this.corrMin = -(this.corrRange / 2)
    } else {
      this.corrBits = 32
      this.corrRange = 0
      this.corrMin = -0x80000000
    }
    this.mBits = Array.from({ length: contexts }, () => new SymbolModel(this.corrBits + 1))
    this.mCorrector0 = new BitModel()
    this.mCorrector = []
    for (let i = 1; i <= this.corrBits; i++)
      this.mCorrector[i] = new SymbolModel(i <= this.bitsHigh ? 1 << i : 1 << this.bitsHigh)
  }
  decompress(pred: number, context: number) {
    let real = (pred + this.readCorrector(this.mBits[context])) | 0
    if (this.corrRange) {
      if (real < 0) real += this.corrRange
      else if (real >= this.corrRange) real -= this.corrRange
    }
    return real
  }
  private readCorrector(model: SymbolModel) {
    const k = this.dec.decodeSymbol(model)
    if (!k) return this.dec.decodeBit(this.mCorrector0)
    if (k >= 32) return this.corrMin
    let c: number
    if (k <= this.bitsHigh) c = this.dec.decodeSymbol(this.mCorrector[k])
    else {
      const k1 = k - this.bitsHigh
      c = this.dec.decodeSymbol(this.mCorrector[k])
      c = (c * 2 ** k1 + this.dec.readBits(k1)) >>> 0
    }
    // Translate c back into its interval: [2^(k-1), 2^k - 1] maps to [2^(k-1) + 1, 2^k], the rest is negative.
    if (c >= 2 ** (k - 1)) c += 1
    else c -= 2 ** k - 1
    return c | 0
  }
}
