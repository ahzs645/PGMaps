/**
 * Decodes an image layer's stored tiles to pixels, for a block sheet drawn from an imported
 * hillshade. Browser only: the platform decodes the JPEG or PNG. A grey hillshade is kept as one
 * byte a pixel (11 MB for a 3,637 × 3,004 sheet, against 44 MB of RGBA) and remembered for as long
 * as its mosaic object lives, so a sheet preview does not decode it again on every setting change.
 */
import type { PdfImageMosaic } from '@/lib/geoPdf/types'

/** Channel difference, of 255, within which a JPEG pixel still counts as grey. */
const GREY_TOLERANCE = 12

const decoded = new WeakMap<PdfImageMosaic, Promise<(Uint8Array | Uint8ClampedArray | null)[]>>()

async function decodeTile(image: string, width: number, height: number, grey: boolean) {
  try {
    const bitmap = await createImageBitmap(await (await fetch(image)).blob())
    if (bitmap.width !== width || bitmap.height !== height) {
      bitmap.close()
      return null
    }
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const rgba = context.getImageData(0, 0, width, height).data
    if (!grey) return rgba
    // A tinted relief keeps its colours; only a picture that is grey already is stored as grey.
    for (let i = 0; i < rgba.length; i += 4 * 97)
      if (Math.abs(rgba[i] - rgba[i + 1]) > GREY_TOLERANCE || Math.abs(rgba[i + 1] - rgba[i + 2]) > GREY_TOLERANCE)
        return rgba
    const out = new Uint8Array(width * height)
    // Rec. 601 luma; a grey tile gives its own value back.
    for (let i = 0; i < out.length; i++)
      out[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2])
    return out
  } catch {
    return null
  }
}

/** One array per tile, in `mosaic.tiles` order; null for a tile the browser could not decode. */
export function decodeMosaicTiles(mosaic: PdfImageMosaic) {
  let pending = decoded.get(mosaic)
  if (!pending) {
    pending = Promise.all(
      mosaic.tiles.map((tile) => decodeTile(tile.image, tile.width, tile.height, mosaic.kind === 'hillshade')),
    )
    decoded.set(mosaic, pending)
  }
  return pending
}
