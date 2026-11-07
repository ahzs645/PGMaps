import { describe, expect, it, vi } from 'vitest'
import { nativeOrientationBlob } from './orientation'

// Actual 3 × 2 RGB JPEG and PNG fixtures, encoded once with Pillow; no test re-encoding.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDvPh14b0LVfh5oV7qOi6deXctqpknuLVJHfGQMswJPAA/CiiivrsB/utL/AAx/JHPL4mf/2Q==',
  'base64',
)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAGklEQVR4nAXBgQEAIAjAIOxyvXyBEHrD3pYPOYQGgMCnEHEAAAAASUVORK5CYII=',
  'base64',
)
// Actual lossless 3 × 2 WebP files containing orientation 6: still and animated.
const WEBP = Buffer.from(
  'UklGRm4AAABXRUJQVlA4WAoAAAAIAAAAAgAAAQAAVlA4TC0AAAAvAkAAAC8gECBIV25DQFB03XICAYJ05eY/QGxybBUoZBsBTu0ekxO6iP7H9AIARVhJRhoAAABNTQAqAAAACAABARIAAwAAAAEABgAAAAAAAA==',
  'base64',
)
const ANIMATED_WEBP = Buffer.from(
  'UklGRs4AAABXRUJQVlA4WAoAAAAaAAAAAgAAAQAAQU5JTQYAAAAAAAAAAABBTk1GRAAAAAAAAAAAAAIAAAEAAGQAAAJWUDhMLAAAAC8CQAAALyAQIKRTbkNAUPSc6QIBgnPn5j9AbOpYNihkGwEO3WtyABfR/xhfQU5NRi4AAAAAAAAAAAACAAABAABkAAAAVlA4TBYAAAAvAkAAEA8QMf/zHwwFaRuwaH8R/Q8fRVhJRiAAAABFeGlmAABNTQAqAAAACAABARIAAwAAAAEABgAAAAAAAA==',
  'base64',
)

function concatenate(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function exif(little: boolean, orientation = 6, directoryOffset = 8) {
  const payload = new Uint8Array(6 + directoryOffset + 2 + 3 * 12 + 4)
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0])
  payload.set(little ? [0x49, 0x49] : [0x4d, 0x4d], 6)
  const view = new DataView(payload.buffer)
  view.setUint16(8, 42, little)
  view.setUint32(10, directoryOffset, little)
  const directory = 6 + directoryOffset
  view.setUint16(directory, 3, little)
  // Put orientation in the second entry, with unrelated metadata before/after it.
  const first = directory + 2
  view.setUint16(first, 0x0100, little)
  view.setUint16(first + 2, 4, little)
  view.setUint32(first + 4, 1, little)
  view.setUint32(first + 8, 3, little)
  const entry = first + 12
  view.setUint16(entry, 0x0112, little)
  view.setUint16(entry + 2, 3, little)
  view.setUint32(entry + 4, 1, little)
  view.setUint16(entry + 8, orientation, little)
  view.setUint16(entry + 12, 0x0101, little)
  view.setUint16(entry + 14, 4, little)
  view.setUint32(entry + 16, 1, little)
  view.setUint32(entry + 20, 2, little)
  const length = payload.length + 2
  return {
    segment: concatenate(new Uint8Array([0xff, 0xe1, length >> 8, length & 255]), payload),
    valueOffset: 4 + entry + 8,
  }
}

async function read(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function pngChunk(type: string, data: Uint8Array) {
  const result = new Uint8Array(data.length + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length, false)
  result.set(
    Array.from(type, (letter) => letter.charCodeAt(0)),
    4,
  )
  result.set(data, 8)
  let crc = 0xffffffff
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0, false)
  return result
}

function riffChunks(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const chunks: { type: string; start: number; end: number; bytes: Uint8Array }[] = []
  for (let position = 12; position < data.length; ) {
    const length = view.getUint32(position + 4, true)
    const end = position + 8 + length + (length % 2)
    chunks.push({
      type: String.fromCharCode(...data.subarray(position, position + 4)),
      start: position,
      end,
      bytes: data.slice(position, end),
    })
    position = end
  }
  return chunks
}

function riffChunk(type: string, data: Uint8Array) {
  const result = new Uint8Array(8 + data.length + (data.length % 2))
  result.set(Array.from(type, (letter) => letter.charCodeAt(0)))
  new DataView(result.buffer).setUint32(4, data.length, true)
  result.set(data, 8)
  return result
}

describe('native image orientation decoding copy', () => {
  it.each([true, false])(
    'patches primary JPEG Exif orientation 6 in %s-endian TIFF without changing any other bytes',
    async (little) => {
      const metadata = exif(little)
      const original = concatenate(JPEG.subarray(0, 2), metadata.segment, JPEG.subarray(2))
      const file = new Blob([original], { type: 'image/jpeg' })
      const preview = await nativeOrientationBlob(file)
      expect(preview).not.toBe(file)
      expect(preview.type).toBe('image/jpeg')
      expect(preview.size).toBe(file.size)
      const expected = original.slice()
      expected.set(little ? [1, 0] : [0, 1], 2 + metadata.valueOffset)
      expect(await read(preview)).toEqual(expected)
      expect(await read(file)).toEqual(original)
      expect((await read(preview)).subarray(2 + metadata.segment.length)).toEqual(new Uint8Array(JPEG.subarray(2)))
    },
  )

  it('follows a bounded nondefault IFD offset and patches every valid primary Exif APP1 block', async () => {
    const a = exif(true, 8, 16)
    const b = exif(false, 3)
    const original = concatenate(JPEG.subarray(0, 2), a.segment, b.segment, JPEG.subarray(2))
    const expected = original.slice()
    expected.set([1, 0], 2 + a.valueOffset)
    expected.set([0, 1], 2 + a.segment.length + b.valueOffset)
    expect(await read(await nativeOrientationBlob(new Blob([original])))).toEqual(expected)
  })

  it('keeps already-normal, absent and invalid orientation metadata untouched', async () => {
    for (const orientation of [1, 0, 9]) {
      const metadata = exif(true, orientation)
      const file = new Blob([JPEG.subarray(0, 2), metadata.segment, JPEG.subarray(2)])
      expect(await nativeOrientationBlob(file)).toBe(file)
    }
    const file = new Blob([JPEG], { type: 'image/jpeg' })
    expect(await nativeOrientationBlob(file)).toBe(file)
  })

  it('ignores malformed TIFF offsets, unsupported value types and truncated JPEG segments', async () => {
    const offset = exif(true)
    new DataView(offset.segment.buffer).setUint32(14, 0xfffffff0, true)
    const type = exif(false)
    const orientationEntry = type.valueOffset - 8
    new DataView(type.segment.buffer).setUint16(orientationEntry + 2, 4, false)
    const truncated = exif(true)
    new DataView(truncated.segment.buffer).setUint16(2, 65535, false)
    for (const metadata of [offset, type, truncated]) {
      const file = new Blob([JPEG.subarray(0, 2), metadata.segment, JPEG.subarray(2)])
      expect(await nativeOrientationBlob(file)).toBe(file)
    }
  })

  it('skips marker padding, unrelated APP1 content and stops before compressed scan bytes', async () => {
    const metadata = exif(true)
    const xmp = new Uint8Array([0xff, 0xe1, 0, 8, 1, 2, 3, 4, 5, 6])
    const original = concatenate(JPEG.subarray(0, 2), new Uint8Array([0xff]), xmp, metadata.segment, JPEG.subarray(2))
    const expected = original.slice()
    expected.set([1, 0], 2 + 1 + xmp.length + metadata.valueOffset)
    expect(await read(await nativeOrientationBlob(new Blob([original])))).toEqual(expected)
  })

  it('strips PNG eXIf chunks before and after IDAT while preserving all image bytes and other CRCs', async () => {
    const metadata = pngChunk('eXIf', exif(true).segment.subarray(10))
    const beforeIdat = 8 + 12 + 13
    const beforeIend = PNG.length - 12
    const file = new Blob(
      [PNG.subarray(0, beforeIdat), metadata, PNG.subarray(beforeIdat, beforeIend), metadata, PNG.subarray(beforeIend)],
      { type: 'image/png' },
    )
    const preview = await nativeOrientationBlob(file)
    expect(preview.type).toBe('image/png')
    expect(await read(preview)).toEqual(new Uint8Array(PNG))
    expect(file.size).toBe(PNG.length + metadata.length * 2)
  })

  it('does not alter plain PNGs, malformed chunk lengths or unrelated formats', async () => {
    const plain = new Blob([PNG])
    expect(await nativeOrientationBlob(plain)).toBe(plain)
    const badChunk = pngChunk('eXIf', new Uint8Array([1, 2, 3]))
    new DataView(badChunk.buffer).setUint32(0, 0xffffffff, false)
    const malformed = new Blob([PNG.subarray(0, 33), badChunk, PNG.subarray(33)])
    expect(await nativeOrientationBlob(malformed)).toBe(malformed)
    for (const content of [new Uint8Array(), new Uint8Array([0xff]), new Uint8Array([71, 73, 70, 56, 57, 97])]) {
      const file = new Blob([content])
      expect(await nativeOrientationBlob(file)).toBe(file)
    }
  })

  it.each([WEBP, ANIMATED_WEBP])(
    'removes WebP EXIF and fixes RIFF/VP8X metadata while preserving compressed image and animation chunks',
    async (encoded) => {
      const original = new Uint8Array(encoded)
      const file = new Blob([original], { type: 'image/webp' })
      const preview = await nativeOrientationBlob(file)
      const output = await read(preview)
      expect(preview.type).toBe('image/webp')
      expect(await read(file)).toEqual(original)
      const expectedChunks = riffChunks(original).filter((chunk) => chunk.type !== 'EXIF')
      const outputChunks = riffChunks(output)
      expect(outputChunks.map((chunk) => chunk.type)).toEqual(expectedChunks.map((chunk) => chunk.type))
      for (let index = 0; index < expectedChunks.length; index += 1) {
        const expected = expectedChunks[index].bytes.slice()
        if (expectedChunks[index].type === 'VP8X') expected[8] &= ~0x08
        expect(outputChunks[index].bytes).toEqual(expected)
      }
      expect(new DataView(output.buffer).getUint32(4, true)).toBe(output.length - 8)
      expect(output[20]).toBe(original[20] & ~0x08)
    },
  )

  it('removes multiple WebP EXIF chunks with odd-byte padding and preserves unknown chunks', async () => {
    const extra = riffChunk('EXIF', new Uint8Array([1, 2, 3]))
    const unknown = riffChunk('JUNK', new Uint8Array([4, 5, 6]))
    const input = concatenate(WEBP, unknown, extra)
    new DataView(input.buffer).setUint32(4, input.length - 8, true)
    const output = await read(await nativeOrientationBlob(new Blob([input])))
    expect(riffChunks(output).map((chunk) => chunk.type)).toEqual(['VP8X', 'VP8L', 'JUNK'])
    const chunks = riffChunks(output)
    expect(chunks[chunks.length - 1].bytes).toEqual(unknown)
    expect(new DataView(output.buffer).getUint32(4, true)).toBe(output.length - 8)
    const normalized = new Blob([output.slice()])
    expect(await nativeOrientationBlob(normalized)).toBe(normalized)
  })

  it('leaves malformed RIFF lengths, incomplete chunks and other RIFF formats untouched', async () => {
    const oversized = new Uint8Array(WEBP)
    new DataView(oversized.buffer).setUint32(4, 0xfffffffe, true)
    const incomplete = new Uint8Array(WEBP)
    const exifChunk = riffChunks(incomplete).find((chunk) => chunk.type === 'EXIF')!
    new DataView(incomplete.buffer).setUint32(exifChunk.start + 4, 0xffffffff, true)
    const wave = new Uint8Array(WEBP)
    wave.set([87, 65, 86, 69], 8)
    for (const data of [oversized, incomplete, wave]) {
      const file = new Blob([data])
      expect(await nativeOrientationBlob(file)).toBe(file)
    }
  })

  it('never reads the complete original Blob into an ArrayBuffer', async () => {
    const metadata = exif(true)
    const file = new Blob([JPEG.subarray(0, 2), metadata.segment, JPEG.subarray(2)])
    const readWhole = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Full-buffer read forbidden'))
    const preview = await nativeOrientationBlob(file)
    expect(preview).not.toBe(file)
    expect(readWhole).not.toHaveBeenCalled()
    const webp = new Blob([WEBP])
    const readWholeWebp = vi.spyOn(webp, 'arrayBuffer').mockRejectedValue(new Error('Full-buffer read forbidden'))
    expect(await nativeOrientationBlob(webp)).not.toBe(webp)
    expect(readWholeWebp).not.toHaveBeenCalled()
  })
})
