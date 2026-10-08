import { decode } from 'fast-png'

/** Decode the saved 8-bit RGBA tiles without canvas premultiplication or colour conversion. */
export function decodePngPixels(bytes: ArrayBuffer | Uint8Array) {
  const png = decode(bytes, { checkCrc: true })
  if (png.depth !== 8 || png.channels !== 4 || png.palette) {
    throw new Error('Source pixel preservation requires an 8-bit RGBA PNG')
  }
  return { width: png.width, height: png.height, rgba: new Uint8ClampedArray(png.data) }
}
