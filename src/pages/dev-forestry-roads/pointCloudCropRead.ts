/**
 * Reading only what a crop needs from each point-cloud tile, in the browser. Headers come from
 * slices of the file; a tile the crop does not reach is never read; a tile it reaches is read
 * chunk by chunk (`@/lib/lidar/largeLaz*.ts`), and only points within the crop's reach in the
 * tile's own CRS are kept, so the rest never reach thinning or the point-cloud worker. A LAZ
 * compressed without chunks cannot be read that way and is read whole, as before, when it fits.
 * Never `arrayBuffer()` on a file the chunked reader can take.
 */
import { readPointCloudHeader, type PointCloudHeader } from '@/lib/lidar/lasHeader'
import { cropReachM, cropReadBox, type CropTile, type PointCloudCrop } from './pointCloudCrop'

const MAX_METADATA = 16 * 1024 * 1024
/** What the worker is handed in all, as the whole-file import allows. */
export const MAX_CROPPED_BYTES = 1_000_000_000
/** Bytes of point records one tile's read may hold before it is refused (twice the reader's limit). */
const MAX_TILE_RECORD_BYTES = 800_000_000

/** A file's header and VLRs, read from its first bytes only. */
export async function readHeaderSlice(file: Blob & { name: string }): Promise<PointCloudHeader> {
  const prefix = new Uint8Array(await file.slice(0, 375).arrayBuffer())
  if (prefix.length < 227 || new TextDecoder().decode(prefix.subarray(0, 4)) !== 'LASF')
    throw Error(`${file.name} is not a LAS or LAZ file.`)
  const pointOffset = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(96, true)
  if (pointOffset > MAX_METADATA || pointOffset > file.size) throw Error(`${file.name} has an invalid LAS header.`)
  return readPointCloudHeader(new Uint8Array(await file.slice(0, pointOffset).arrayBuffer()), { headerOnly: true })
}

export interface CroppedRead {
  /** One LAS (or the whole file) per tile that kept a point, in tile order. */
  buffers: ArrayBuffer[]
  /** The index in `files` of each buffer's tile. */
  sourceFiles: number[]
  tiles: Array<{ name: string; method: 'chunked' | 'whole' | 'skipped'; points: number; why?: string }>
}

export async function readCroppedTiles(
  files: File[],
  tiles: CropTile[],
  crop: PointCloudCrop,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (message: string) => void } = {},
): Promise<CroppedRead> {
  const { planLargeLaz, writeLas } = await import('@/lib/lidar/largeLaz')
  const { readLargeLaz } = await import('@/lib/lidar/largeLazRead')
  const reachM = cropReachM(crop)
  const out: CroppedRead = { buffers: [], sourceFiles: [], tiles: [] }
  let total = 0
  for (const [i, file] of files.entries()) {
    signal?.throwIfAborted()
    const tile = tiles[i]
    if (!tile.touches) {
      out.tiles.push({ name: file.name, method: 'skipped', points: 0, why: 'outside the crop' })
      continue
    }
    let plan: Awaited<ReturnType<typeof planLargeLaz>> | null = null
    let why = ''
    try {
      plan = await planLargeLaz(file, { epsg: null, crsRecords: [] }, signal)
    } catch (error) {
      why = error instanceof Error ? error.message : String(error)
    }
    if (!plan) {
      // Not readable in chunks (a LAZ compressed without them): read whole, as an uncropped import would.
      if (total + file.size > MAX_CROPPED_BYTES)
        throw Error(`${file.name} cannot be read a piece at a time (${why}) and is too large to read whole.`)
      out.buffers.push(await file.arrayBuffer())
      out.sourceFiles.push(i)
      out.tiles.push({ name: file.name, method: 'whole', points: tile.points, why })
      total += file.size
      continue
    }
    const limit = Math.floor(MAX_TILE_RECORD_BYTES / 2 / plan.header.pointLength)
    const { records, count } = await readLargeLaz(
      file,
      plan,
      { kind: 'area', box: cropReadBox(tile, crop), limit, region: crop, reachM },
      {
        signal,
        onProgress: (p) =>
          onProgress?.(
            `Reading ${file.name} in chunks: ${Math.round((100 * p.read) / Math.max(1, p.total))}% · ${p.kept.toLocaleString('en-CA')} points in the crop's reach`,
          ),
        tooMany: (ceiling) =>
          `The crop's reach holds more than ${ceiling.toLocaleString('en-CA')} points of ${file.name}. Narrow the area, the corridor or the upslope margin.`,
      },
    )
    out.tiles.push({ name: file.name, method: 'chunked', points: count })
    if (!count) continue
    const las = writeLas(plan, records, count)
    total += las.byteLength
    if (total > MAX_CROPPED_BYTES)
      throw Error('The crop keeps more than 1 GB of points across these tiles. Narrow the area or the margin.')
    out.buffers.push(las.buffer as ArrayBuffer)
    out.sourceFiles.push(i)
  }
  return out
}
