/**
 * A small PNG encoder over the platform's `CompressionStream`, so classed rasters reach the PDF
 * compressed (jsPDF writes raw RGBA uncompressed: about 9 MB for one tabloid frame at 150 dpi).
 * Opaque images are written as RGB, so the PDF needs no soft mask for them. No DOM access.
 */
import type { DrawOp, RasterImage } from './drawOps'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** PNG bytes for straight RGBA pixels. Each row uses the Sub filter. */
export async function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Uint8Array> {
  if (rgba.length !== width * height * 4) throw Error('The image size does not match its pixels.')
  let opaque = true
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] !== 255) {
      opaque = false
      break
    }
  const channels = opaque ? 3 : 4
  const stride = width * channels
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = 1
    for (let x = 0; x < width; x++)
      for (let c = 0; c < channels; c++) {
        const value = rgba[(y * width + x) * 4 + c]
        const left = x > 0 ? rgba[(y * width + x - 1) * 4 + c] : 0
        raw[row + 1 + x * channels + c] = (value - left) & 0xff
      }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8
  header[9] = opaque ? 2 : 6
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', await deflate(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** An RGBA image as a PNG data URL; encoded images pass through. */
export async function encodedImage(image: RasterImage): Promise<RasterImage> {
  if (image.kind !== 'rgba') return image
  const png = await encodePng(image.data, image.width, image.height)
  return {
    kind: 'url',
    url: `data:image/png;base64,${base64(png)}`,
    format: 'PNG',
    width: image.width,
    height: image.height,
  }
}

/** The same operations with every raw raster encoded as PNG, ready for the PDF and the preview. */
export async function encodeSheetImages(ops: readonly DrawOp[]): Promise<DrawOp[]> {
  return Promise.all(ops.map(async (op) => (op.op === 'image' ? { ...op, image: await encodedImage(op.image) } : op)))
}
