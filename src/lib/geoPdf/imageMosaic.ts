/**
 * Image layers at their own pixels: a sheet's hillshade or ortho imagery as the tiles the PDF
 * stores, placed by their common pixel grid. A JPEG tile is kept as its stored file, so nothing is
 * decoded and compressed again; lossless pixels are written as PNG. These are pictures: no value is
 * read from them. No DOM or network access (the PNG encoder uses the platform's `CompressionStream`).
 */
import proj4 from 'proj4'
import type { Converter } from 'proj4'
import type { PDFOperatorList, PDFPageProxy } from 'pdfjs-dist/types/src/display/api'
import { encodePng } from '../mapSheet/png'
import { applyMatrix, invertMatrix } from './classGrid'
import type { MapFrame } from './georeference'
import { multiply } from './paths'
import type { ImageLayerProfile, PdfTemplateProfile } from './profiles'
import { mosaicPlacement, scanRasterContent, type DecodedPdfImage } from './rasterRead'
import { PDF_LIMITS, type PdfImageMosaic, type PdfLayer, type PdfMosaicTile, type PdfSource, type XY } from './types'

const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

/**
 * Colour components of a JPEG file, from its frame header; 0 when none is found. One (grey) and
 * three (colour) are what every browser shows as the PDF does; four is CMYK and is not passed through.
 */
export function jpegComponents(bytes: Uint8Array): number {
  let at = 2
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 0
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return 0
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++
      continue
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return bytes[at + 9]
    if (marker === 0xda || length < 2) return 0
    at += 2 + length
  }
  return 0
}

interface Content {
  getGroup(id: string): { name: string } | null
  isVisible(group: unknown): boolean
}

/** Reads each image layer the template names. A layer that cannot be placed is named in `notices`. */
export async function extractImageMosaics({
  page,
  list,
  ops,
  content,
  frame,
  source,
  lossyImages,
  maskedImages,
  jpegBytes,
  imagePixels,
  keepPixels,
  template,
}: {
  page: PDFPageProxy
  list: PDFOperatorList
  ops: Record<string, number>
  content: Content
  frame: MapFrame
  source: Omit<PdfSource, 'layer'>
  lossyImages: Set<string>
  maskedImages: Set<string>
  jpegBytes?: (reference: string) => Uint8Array | undefined
  imagePixels?: (image: DecodedPdfImage) => Uint8Array | Uint8ClampedArray
  /** Also decode every tile to grey bytes (`PdfLayer.mosaicPixels`), for scripts and tests. */
  keepPixels?: boolean
  template: PdfTemplateProfile
}): Promise<{ layers: PdfLayer[]; notices: string[] }> {
  const layers: PdfLayer[] = [],
    notices: string[] = []
  if (!template.images?.length) return { layers, notices }
  const { images } = scanRasterContent(list, ops, content, frame, template.legend)
  for (const profile of template.images) {
    const placed = images.filter((image) => image.layers.includes(profile.layer))
    if (!placed.length) continue
    try {
      layers.push(await readMosaic(profile, placed))
    } catch (error) {
      notices.push(
        `Page ${frame.page} · ${profile.name}: not read at its own pixels (${error instanceof Error ? error.message : String(error)}). The sheet preview still shows it.`,
      )
    }
  }
  return { layers, notices }

  async function readMosaic(
    profile: ImageLayerProfile,
    placed: Parameters<typeof mosaicPlacement>[0],
  ): Promise<PdfLayer> {
    const mosaic = mosaicPlacement(placed)
    const tiles: PdfMosaicTile[] = []
    const greys: Uint8Array[] = []
    let stored = 0
    for (const tile of mosaic.offsets) {
      const image = await new Promise<DecodedPdfImage>((resolve) => page.objs.get(tile.image.id, resolve))
      if (image.width !== tile.image.width || image.height !== tile.image.height)
        throw Error('an image tile is not the size it is placed at')
      const reference = image.ref ?? 'unknown'
      const file = lossyImages.has(reference) && !maskedImages.has(reference) ? jpegBytes?.(reference) : undefined
      let bytes: Uint8Array, type: 'jpeg' | 'png'
      if (file && [1, 3].includes(jpegComponents(file))) {
        bytes = file
        type = 'jpeg'
      } else {
        const pixels = image.data ?? imagePixels?.(image)
        const stride = pixels ? pixels.length / (image.width * image.height) : 0
        if (!pixels || ![3, 4].includes(stride)) throw Error('an image tile has no readable pixels')
        const rgba = new Uint8ClampedArray(image.width * image.height * 4)
        if (stride === 4) rgba.set(pixels)
        else
          for (let i = 0, o = 0; i < pixels.length; i += 3, o += 4) {
            rgba[o] = pixels[i]
            rgba[o + 1] = pixels[i + 1]
            rgba[o + 2] = pixels[i + 2]
            rgba[o + 3] = 255
          }
        bytes = await encodePng(rgba, image.width, image.height)
        type = 'png'
      }
      if (keepPixels) {
        const pixels = image.data ?? imagePixels?.(image)
        const stride = pixels ? pixels.length / (image.width * image.height) : 0
        if (!pixels || ![1, 3, 4].includes(stride)) throw Error('an image tile has no readable pixels')
        const grey = new Uint8Array(image.width * image.height)
        for (let i = 0; i < grey.length; i++)
          grey[i] =
            stride === 1
              ? pixels[i]
              : Math.round(0.299 * pixels[i * stride] + 0.587 * pixels[i * stride + 1] + 0.114 * pixels[i * stride + 2])
        greys.push(grey)
      }
      stored += bytes.length
      if (stored > PDF_LIMITS.mosaicBytes)
        throw Error(`its tiles hold more than ${PDF_LIMITS.mosaicBytes / 1_000_000} MB`)
      tiles.push({
        image: `data:image/${type};base64,${base64(bytes)}`,
        col: tile.col,
        row: tile.row,
        width: image.width,
        height: image.height,
        reference,
        // A JPEG tile decoded and written as PNG is still a JPEG's picture.
        lossy: lossyImages.has(reference),
      })
    }
    const result: PdfImageMosaic = {
      version: 1,
      kind: profile.kind,
      width: mosaic.width,
      height: mosaic.height,
      transform: multiply(frame.pageToProjected, mosaic.pageTransform),
      wkt: frame.wkt,
      tiles,
    }
    const corners = mosaicCorners(result)
    const pixelM = mosaicPixelM(result)
    return {
      name: profile.name,
      source: { ...source, layer: profile.layer },
      imageMosaic: result,
      ...(keepPixels ? { mosaicPixels: greys } : {}),
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
          properties: { name: profile.name },
        },
      ],
      suggestedRole: 'reference',
      selected: profile.selected,
      note: `${profile.name} at the sheet's own pixels: ${mosaic.width.toLocaleString('en-CA')} × ${mosaic.height.toLocaleString('en-CA')}, about ${pixelM.toFixed(2)} m each, in ${tiles.length} tile${tiles.length === 1 ? '' : 's'} as the PDF stores them. A picture of the map export, without its roads, contours or labels; no height or slope is read from it.`,
    }
  }
}

/** Ground size of a native pixel, metres. */
export const mosaicPixelM = (mosaic: Pick<PdfImageMosaic, 'transform'>) =>
  Math.sqrt(Math.abs(mosaic.transform[0] * mosaic.transform[3] - mosaic.transform[1] * mosaic.transform[2]))

const projections = new WeakMap<PdfImageMosaic, Converter>()
function projection(mosaic: PdfImageMosaic) {
  let p = projections.get(mosaic)
  if (!p) {
    p = proj4('EPSG:4326', mosaic.wkt)
    projections.set(mosaic, p)
  }
  return p
}
/** WGS84 corners of a pixel box, clockwise from the top left as a map image source takes them. */
function boxCorners(mosaic: PdfImageMosaic, col: number, row: number, width: number, height: number) {
  const p = projection(mosaic)
  return (
    [
      [col, row],
      [col + width, row],
      [col + width, row + height],
      [col, row + height],
    ] as XY[]
  ).map((xy) => p.inverse(applyMatrix(mosaic.transform, xy)) as XY) as [XY, XY, XY, XY]
}
export const mosaicCorners = (mosaic: PdfImageMosaic) => boxCorners(mosaic, 0, 0, mosaic.width, mosaic.height)
export const mosaicTileCorners = (mosaic: PdfImageMosaic, tile: PdfMosaicTile) =>
  boxCorners(mosaic, tile.col, tile.row, tile.width, tile.height)

/**
 * Reads the mosaic's colour at a WGS84 point from its decoded tiles: one array per tile in
 * `mosaic.tiles` order, four straight RGBA bytes a pixel or one grey byte a pixel, null for a tile
 * that did not decode. Writes four bytes at `offset` and returns true where a tile covers the
 * point, false elsewhere. The nearest pixel, never a blend.
 */
export function mosaicSampler(mosaic: PdfImageMosaic, pixels: readonly (ArrayLike<number> | null)[]) {
  const inverse = invertMatrix(mosaic.transform),
    p = projection(mosaic)
  return (lng: number, lat: number, out: Uint8ClampedArray, offset: number): boolean => {
    const xy = applyMatrix(inverse, p.forward([lng, lat]) as XY)
    const col = Math.floor(xy[0]),
      row = Math.floor(xy[1])
    if (!(col >= 0 && row >= 0 && col < mosaic.width && row < mosaic.height)) return false
    for (let t = 0; t < mosaic.tiles.length; t++) {
      const tile = mosaic.tiles[t],
        data = pixels[t]
      if (!data || col < tile.col || row < tile.row || col >= tile.col + tile.width || row >= tile.row + tile.height)
        continue
      const at = (row - tile.row) * tile.width + col - tile.col
      if (data.length === tile.width * tile.height) {
        out[offset] = out[offset + 1] = out[offset + 2] = data[at]
        out[offset + 3] = 255
      } else {
        out[offset] = data[at * 4]
        out[offset + 1] = data[at * 4 + 1]
        out[offset + 2] = data[at * 4 + 2]
        out[offset + 3] = data[at * 4 + 3]
      }
      return true
    }
    return false
  }
}

const checked = new WeakSet<object>()
/** Validates a mosaic read back from a project or GeoJSON file; anything malformed is refused. */
export function parseImageMosaic(raw: unknown): PdfImageMosaic | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') throw Error('Invalid image layer.')
  if (checked.has(raw)) return raw as PdfImageMosaic
  const r = raw as PdfImageMosaic
  if (
    r.version !== 1 ||
    !['hillshade', 'imagery'].includes(r.kind) ||
    !Number.isInteger(r.width) ||
    !Number.isInteger(r.height) ||
    r.width < 1 ||
    r.height < 1 ||
    r.width * r.height > PDF_LIMITS.rasterCells
  )
    throw Error('Invalid image layer dimensions.')
  if (
    !Array.isArray(r.transform) ||
    r.transform.length !== 6 ||
    !r.transform.every(Number.isFinite) ||
    typeof r.wkt !== 'string' ||
    r.wkt.length > 5000 ||
    !/^PROJCS\[/i.test(r.wkt)
  )
    throw Error('Invalid image layer registration.')
  invertMatrix(r.transform)
  if (mosaicCorners(r).some((p) => !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) >= 85))
    throw Error('The image layer lies outside the supported map extent.')
  if (!Array.isArray(r.tiles) || !r.tiles.length || r.tiles.length > PDF_LIMITS.rasterImages)
    throw Error('Invalid image layer tiles.')
  let characters = 0
  for (const tile of r.tiles) {
    if (
      !tile ||
      typeof tile.image !== 'string' ||
      !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(tile.image) ||
      ![tile.col, tile.row, tile.width, tile.height].every(Number.isInteger) ||
      tile.width < 1 ||
      tile.height < 1 ||
      tile.col < 0 ||
      tile.row < 0 ||
      tile.col + tile.width > r.width ||
      tile.row + tile.height > r.height ||
      typeof tile.reference !== 'string' ||
      tile.reference.length > 100 ||
      typeof tile.lossy !== 'boolean'
    )
      throw Error('Invalid image layer tile.')
    characters += tile.image.length
  }
  if (characters > (PDF_LIMITS.mosaicBytes * 4) / 3 + 64 * r.tiles.length)
    throw Error('The image layer is larger than a project keeps.')
  checked.add(r)
  return r
}
