/**
 * Meta CHM v2 as 512 px Web Mercator map tiles, read straight from the Source Cooperative COGs.
 *
 * Each file is one zoom-10 quadkey tile, EPSG:3857, 32,768 px at full resolution with overviews
 * halving down to 512 px, all in 512 × 512 internal blocks (checked on 0212102011.tif, 19 November
 * 2026). A 512 px map tile at zoom z (10–16) is therefore exactly one block of the file's image
 * 512 · 2^(z − 10) px wide: one byte range, no resampling, no reprojection. Deeper zooms overzoom
 * the zoom-16 tiles; shallower ones are not served. The image is found by its width, never by its
 * IFD number, because the files interleave transparency masks with the overviews (`overviewImage`).
 *
 * Heights are drawn as the source gives them, never corrected. DOM and network free: the caller
 * opens the file, fetches the bytes and decodes them (`ChmTileDeps`).
 */
import { CANOPY_HEIGHT_CLASSES, type RasterClass } from '@/lib/forestry/blockSheet/styles'
import { canopyColours } from './chmView'
import {
  mercatorPixel,
  META_CHM_BASE_URL,
  META_CHM_TILE_BITS,
  META_CHM_TILE_ZOOM,
  metaChmTileUrl,
  overviewImage,
  quadkey,
  type ChmTiff,
  type LonLatBounds,
} from './metaChm'

/** Side of a map tile and of the files' internal blocks, px. */
export const CHM_TILE_SIZE = 512
/** The shallowest zoom served: the files' 512 px overview. */
export const CHM_TILE_MIN_ZOOM = META_CHM_TILE_ZOOM
/** The deepest zoom served, the files' full resolution; MapLibre overzooms past it. */
export const CHM_TILE_MAX_ZOOM = META_CHM_TILE_ZOOM + META_CHM_TILE_BITS - Math.log2(CHM_TILE_SIZE)

const EARTH_CIRCUMFERENCE_M = 40_075_016.685_578_49

/** Where a map tile's cells are: the file, the image's width in it, and the block's column and row. */
export interface ChmTileAddress {
  key: string
  url: string
  /** Width of the file's image this tile is a block of (512 at zoom 10 … 32,768 at zoom 16). */
  imageWidth: number
  column: number
  row: number
}

/** The file and block holding map tile z/x/y, or null for a zoom the files do not serve. */
export function chmTileAddress(z: number, x: number, y: number, base = META_CHM_BASE_URL): ChmTileAddress | null {
  if (!Number.isInteger(z) || z < CHM_TILE_MIN_ZOOM || z > CHM_TILE_MAX_ZOOM) return null
  const side = 2 ** z
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= side || y >= side) return null
  const shift = z - META_CHM_TILE_ZOOM
  const fileX = x >> shift,
    fileY = y >> shift
  const key = quadkey(fileX, fileY, META_CHM_TILE_ZOOM)
  return {
    key,
    url: metaChmTileUrl(key, base),
    imageWidth: CHM_TILE_SIZE * 2 ** shift,
    column: x - (fileX << shift),
    row: y - (fileY << shift),
  }
}

/** Ground size of one cell of a zoom-z tile at `lat`, metres (zoom 16 is the source's 0.7 m at 54° N). */
export function chmTileCellM(z: number, lat: number) {
  const zoom = Math.min(Math.max(z, CHM_TILE_MIN_ZOOM), CHM_TILE_MAX_ZOOM)
  return (EARTH_CIRCUMFERENCE_M / (CHM_TILE_SIZE * 2 ** zoom)) * Math.cos((lat * Math.PI) / 180)
}

/** The zoom-z tiles a box covers, as `z/x/y` keys. */
export function chmTilesIn(bounds: LonLatBounds, z: number): string[] {
  const [w, s, e, n] = bounds
  const [x0, y0] = mercatorPixel(w, n, z)
  const [x1, y1] = mercatorPixel(e, s, z)
  const last = 2 ** z - 1
  const keys: string[] = []
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(last, Math.floor(y1 - 1e-12)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(last, Math.floor(x1 - 1e-12)); x++)
      keys.push(`${z}/${x}/${y}`)
  return keys
}

/** A file's image as far as a tile read needs it: geotiff.js's parsed IFD. */
export interface ChmTileImage {
  getWidth(): number
  getTileWidth(): number
  getTileHeight(): number
  fileDirectory: {
    NewSubfileType?: number
    TileOffsets: ArrayLike<number>
    TileByteCounts: ArrayLike<number>
  }
}

/** The byte range of one block, and the IFD its decoder needs. */
export interface ChmBlock {
  url: string
  offset: number
  length: number
  fileDirectory: ChmTileImage['fileDirectory']
}

/** Where a tile's block lies in its file. Refuses a file whose blocks are not the tile size. */
export async function chmBlock(tiff: ChmTiff, address: ChmTileAddress): Promise<ChmBlock> {
  const image = (await overviewImage(tiff, address.imageWidth)) as unknown as ChmTileImage | null
  if (!image) throw Error(`${address.url} has no ${address.imageWidth} px image.`)
  if (image.getTileWidth() !== CHM_TILE_SIZE || image.getTileHeight() !== CHM_TILE_SIZE)
    throw Error(`${address.url} is not in ${CHM_TILE_SIZE} px blocks.`)
  const perRow = Math.ceil(image.getWidth() / CHM_TILE_SIZE)
  const index = address.row * perRow + address.column
  const offset = Number(image.fileDirectory.TileOffsets[index])
  const length = Number(image.fileDirectory.TileByteCounts[index])
  if (!(length > 0)) throw Error(`${address.url} has no block ${address.column}, ${address.row}.`)
  return { url: address.url, offset, length, fileDirectory: image.fileDirectory }
}

/** What a tile read is handed. */
export interface ChmTileDeps {
  /** Opens a file's header, or resolves null when no file exists there (outside coverage). */
  openTiff(url: string, signal?: AbortSignal): Promise<ChmTiff | null>
  /** Fetches exactly `length` bytes from `offset`. */
  readBytes(url: string, offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer>
  /** Inflates one block with the file's own compression. */
  decode(fileDirectory: ChmBlock['fileDirectory'], bytes: ArrayBuffer): Promise<ArrayBuffer>
  signal?: AbortSignal
  base?: string
}

/** One tile's heights, 512 × 512 row by row, or null where no file or no served zoom covers it. */
export async function readChmTile(z: number, x: number, y: number, deps: ChmTileDeps): Promise<Uint8Array | null> {
  const address = chmTileAddress(z, x, y, deps.base)
  if (!address) return null
  const tiff = await deps.openTiff(address.url, deps.signal)
  if (!tiff) return null
  const block = await chmBlock(tiff, address)
  const bytes = await deps.readBytes(block.url, block.offset, block.length, deps.signal)
  const values = new Uint8Array(await deps.decode(block.fileDirectory, bytes))
  if (values.length !== CHM_TILE_SIZE * CHM_TILE_SIZE)
    throw Error(`${address.url} block ${address.column}, ${address.row} decoded to ${values.length} cells.`)
  return values
}

/**
 * RGBA for a tile in the block sheet's canopy classes (`canopyColours`), or null when every cell is
 * clear: under 5 m or no data.
 */
export function chmTileRgba(
  values: ArrayLike<number>,
  classes: readonly RasterClass[] = CANOPY_HEIGHT_CLASSES,
): Uint8ClampedArray | null {
  const lut = canopyColours(classes)
  const rgba = new Uint8ClampedArray(values.length * 4)
  const words = new Uint32Array(rgba.buffer)
  const lutWords = new Uint32Array(lut.buffer)
  let drawn = false
  for (let i = 0; i < values.length; i++) {
    const word = lutWords[values[i]]
    if (word) {
      words[i] = word
      drawn = true
    }
  }
  return drawn ? rgba : null
}
