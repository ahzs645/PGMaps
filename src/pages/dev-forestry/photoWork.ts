/**
 * The own-photo tools' heavy work, run off the page's thread (`photoWork.worker.ts`, driven by `photoWorkClient.ts`):
 * the hit buffer, the model view and its score, the photo on the plan, and the 360° horizon the camera search reads.
 * Each takes seconds at most, but the page re-renders several times a second in the road view, and a drape that
 * follows a nudge must not freeze the map.
 *
 * What crosses to the worker. Terrain goes as tile ranges (`PhotoTerrainSpec`), finest first, and the worker loads the
 * tiles itself from the same Cache Storage the page fills, as the analysis and viewshed workers do: a mosaic is tens
 * of megabytes and `ElevationGrid` keeps its samples to itself. The photo's pixels and the imagery mosaics go once
 * under a key and are kept there, so the frames of a burst and every nudge of one camera reuse them.
 *
 * This file is the worker's logic, free of DOM and network access (the terrain loader and `postMessage` are passed
 * in), so the protocol is tested in Node.
 */
import { demTileRange, type DemTileRange, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import { PhotoCache } from './photoCache'
import { buildHitBuffer, type HitBuffer } from './photoHitBuffer'
import type { PhotoPose } from './photoPose'
import {
  drapePhoto,
  modelAgreement,
  modelViewHeight,
  mosaicSampler,
  renderModelView,
  type Drape,
  type DrapeOptions,
  type ImagerySampler,
  type Rgba,
} from './photoViews'
import { terrainProfile, type ProfilePoint } from './skylineFit'

/** Terrain as tile ranges, finest first: a spot reads the first layer that has ground there. */
export type PhotoTerrainSpec = { layers: DemTileRange[] }

/** One imagery mosaic of 256-px tiles, its top-left tile (minX, minY) at `zoom`, as `mosaicSampler` reads it. */
export type ImageryLayer = {
  zoom: number
  minX: number
  minY: number
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Tile ranges round a spot, one per ring, each at the finest zoom up to its own that stays within its tile budget:
 * the rule `useFieldPhoto`'s `loadOwnTerrain` uses (zoom 11 to 25 km over zoom 9 to 90 km).
 */
export function photoTerrainSpec(
  lng: number,
  lat: number,
  rings: ReadonlyArray<{ radiusMeters: number; maxZoom: number; maxTiles: number }>,
): PhotoTerrainSpec {
  return {
    layers: rings.map(({ radiusMeters, maxZoom, maxTiles }) => {
      const degLat = radiusMeters / 110574
      const degLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180))
      const bounds: [number, number, number, number] = [lng - degLng, lat - degLat, lng + degLng, lat + degLat]
      let zoom = maxZoom
      let range = demTileRange(bounds, zoom)
      while (range.tileCount > maxTiles && zoom > 4) range = demTileRange(bounds, --zoom)
      return range
    }),
  }
}

const rangeKey = (r: DemTileRange) => `${r.zoom}/${r.minX}-${r.maxX}/${r.minY}-${r.maxY}`
/** Names a terrain spec: the same tiles, the same key. */
export const terrainSpecKey = (spec: PhotoTerrainSpec) => spec.layers.map(rangeKey).join('|')

/** The first source with ground at a spot. */
export function layeredElevation(sources: readonly ElevationSource[]): ElevationSource {
  if (sources.length === 1) return sources[0]
  return {
    elevationAt(lng, lat) {
      for (const source of sources) {
        const z = source.elevationAt(lng, lat)
        if (Number.isFinite(z)) return z
      }
      return Number.NaN
    },
  }
}

/** Near imagery first, then coarser rings. */
export function imagerySampler(layers: readonly ImageryLayer[]): ImagerySampler {
  const samplers = layers.map((layer) => mosaicSampler(layer, layer.zoom, layer.minX, layer.minY))
  return (lng, lat) => {
    for (const sample of samplers) {
      const colour = sample(lng, lat)
      if (colour) return colour
    }
    return null
  }
}

export type ModelAgreement = ReturnType<typeof modelAgreement>

export type PhotoWorkJob =
  | { kind: 'hitBuffer'; pose: PhotoPose; terrain: PhotoTerrainSpec; width?: number; maxMeters?: number }
  | {
      kind: 'modelView'
      pose: PhotoPose
      terrain: PhotoTerrainSpec
      /** Key of the imagery layers. */
      imagery: string
      /** Key of the photo's pixels to score against; none draws the view unscored. */
      photo?: string | null
      width?: number
      maxMeters?: number
    }
  | { kind: 'drape'; pose: PhotoPose; terrain: PhotoTerrainSpec; photo: string; options?: DrapeOptions }
  | {
      kind: 'horizon'
      eye: { lng: number; lat: number; altitudeMeters: number }
      terrain: PhotoTerrainSpec
      from?: number
      to?: number
      step?: number
      maxDistanceMeters?: number
    }

export type PhotoWorkResult =
  | { kind: 'hitBuffer'; buffer: HitBuffer }
  | { kind: 'modelView'; image: Rgba; agreement: ModelAgreement | null }
  | { kind: 'drape'; drape: Drape | null }
  | { kind: 'horizon'; profile: ProfilePoint[] }

/** The values behind a job's keys, sent with it when the worker may not hold them. */
export type PhotoWorkResources = { photo?: Rgba; imagery?: ImageryLayer[] }

export type PhotoWorkRequest =
  | { type: 'job'; id: number; job: PhotoWorkJob; resources?: PhotoWorkResources }
  | { type: 'cancel'; id: number }

export type PhotoWorkStage = 'terrain' | 'work'

export type PhotoWorkResponse =
  | { type: 'progress'; id: number; stage: PhotoWorkStage; done: number }
  /** The worker no longer holds these keys' values: send the job again with them. */
  | { type: 'need'; id: number; keys: Array<keyof PhotoWorkResources> }
  | { type: 'done'; id: number; result: PhotoWorkResult }
  | { type: 'error'; id: number; message: string }
  | { type: 'cancelled'; id: number }

/** How long a job runs before it lets the worker read its messages (a cancel, a newer job). */
const SLICE_MS = 30
/** Model-view rows drawn between checks of the clock. */
const MODEL_ROWS = 4
/** Horizon azimuths read between checks of the clock. */
const HORIZON_AZIMUTHS = 60

export type PhotoWorkHostOptions = {
  /** Loads one tile range's terrain; the worker passes `loadElevationGrid`'s grid. */
  loadTerrain: (range: DemTileRange, onProgress: (completed: number, total: number) => void) => Promise<ElevationSource>
  post: (message: PhotoWorkResponse, transfer?: Transferable[]) => void
  /** Lets queued messages in; default a zero timeout. */
  yieldNow?: () => Promise<void>
  now?: () => number
}

class Cancelled extends Error {}

/** The worker's message handler. Jobs run side by side, each giving way every `SLICE_MS` so a cancel lands. */
export function createPhotoWorkHost({
  loadTerrain,
  post,
  yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0)),
  now = () => performance.now(),
}: PhotoWorkHostOptions): (request: PhotoWorkRequest) => void {
  // A zoom-11 mosaic to 25 km is about 40 MB; the zoom-9 ring to 90 km about 10 MB. A flight's few spots fit.
  const grids = new PhotoCache<{ source: ElevationSource; bytes: number }>({
    maxEntries: 8,
    maxBytes: 320e6,
    sizeOf: (grid) => grid.bytes,
  })
  const photos = new PhotoCache<Rgba>({ maxEntries: 8, maxBytes: 64e6 })
  const imagery = new PhotoCache<ImageryLayer[]>({ maxEntries: 3, maxBytes: 240e6 })
  const active = new Set<number>(),
    cancelled = new Set<number>()

  const terrainFor = async (spec: PhotoTerrainSpec, id: number) => {
    const loaded = new Array<number>(spec.layers.length).fill(0)
    const total = spec.layers.reduce((sum, range) => sum + range.tileCount, 0)
    const sources = await Promise.all(
      spec.layers.map((range, k) =>
        grids
          .getOrCreate(rangeKey(range), async () => ({
            source: await loadTerrain(range, (completed) => {
              loaded[k] = completed
              post({ type: 'progress', id, stage: 'terrain', done: loaded.reduce((s, n) => s + n, 0) / total })
            }),
            bytes: range.tileCount * 256 * 256 * 4,
          }))
          .then((grid) => grid.source),
      ),
    )
    return layeredElevation(sources)
  }

  const run = async (id: number, job: PhotoWorkJob, resources: PhotoWorkResources = {}) => {
    // Values sent with the job are used for it even when the cache declines to keep them.
    if (resources.photo && 'photo' in job && job.photo) photos.set(job.photo, resources.photo)
    if (resources.imagery && job.kind === 'modelView') imagery.set(job.imagery, resources.imagery)
    const photoKey = job.kind === 'drape' || job.kind === 'modelView' ? job.photo : null
    const photo = photoKey ? (resources.photo ?? photos.get(photoKey)) : undefined
    const layers = job.kind === 'modelView' ? (resources.imagery ?? imagery.get(job.imagery)) : undefined
    const missing: Array<keyof PhotoWorkResources> = []
    if (photoKey && !photo) missing.push('photo')
    if (job.kind === 'modelView' && !layers) missing.push('imagery')
    if (missing.length) {
      post({ type: 'need', id, keys: missing })
      return
    }

    let sliceStart = now()
    const checkpoint = async () => {
      if (now() - sliceStart < SLICE_MS) return
      await yieldNow()
      sliceStart = now()
      if (cancelled.has(id)) throw new Cancelled()
    }

    const terrain = await terrainFor(job.terrain, id)
    if (cancelled.has(id)) throw new Cancelled()
    sliceStart = now()

    if (job.kind === 'hitBuffer') {
      const buffer = buildHitBuffer(job.pose, terrain, { width: job.width, maxMeters: job.maxMeters })
      post(
        { type: 'done', id, result: { kind: 'hitBuffer', buffer } },
        [buffer.lng, buffer.lat, buffer.distance, buffer.elevation].map((array) => array.buffer as ArrayBuffer),
      )
      return
    }
    if (job.kind === 'drape') {
      const drape = drapePhoto(job.pose, terrain, photo!, job.options)
      post(
        { type: 'done', id, result: { kind: 'drape', drape } },
        drape ? [drape.data.buffer as ArrayBuffer, drape.hiddenMask.buffer as ArrayBuffer] : [],
      )
      return
    }
    if (job.kind === 'modelView') {
      const width = job.width ?? 320
      const height = modelViewHeight(job.pose, width)
      const into: Rgba = { width, height, data: new Uint8ClampedArray(width * height * 4) }
      const sampler = imagerySampler(layers!)
      for (let from = 0; from < height; from += MODEL_ROWS) {
        renderModelView(job.pose, terrain, sampler, width, job.maxMeters ?? 60000, {
          from,
          to: from + MODEL_ROWS,
          into,
        })
        post({ type: 'progress', id, stage: 'work', done: Math.min(1, (from + MODEL_ROWS) / height) })
        await checkpoint()
      }
      const agreement = photo ? modelAgreement(photo, into) : null
      post({ type: 'done', id, result: { kind: 'modelView', image: into, agreement } }, [
        into.data.buffer as ArrayBuffer,
      ])
      return
    }
    // The horizon, a run of azimuths at a time: the azimuths one whole call reads, from + k × step.
    const from = job.from ?? 0,
      to = job.to ?? 359.9,
      step = job.step ?? 0.1
    const count = Math.floor((to - from) / step + 1e-9) + 1
    const profile: ProfilePoint[] = []
    for (let first = 0; first < count; first += HORIZON_AZIMUTHS) {
      const last = Math.min(count, first + HORIZON_AZIMUTHS) - 1
      profile.push(
        ...terrainProfile(job.eye, terrain, {
          from: from + first * step,
          to: from + last * step,
          step,
          maxDistanceMeters: job.maxDistanceMeters,
        }),
      )
      post({ type: 'progress', id, stage: 'work', done: (last + 1) / count })
      await checkpoint()
    }
    post({ type: 'done', id, result: { kind: 'horizon', profile } })
  }

  return (request) => {
    if (request.type === 'cancel') {
      if (active.has(request.id)) cancelled.add(request.id)
      return
    }
    const { id, job, resources } = request
    active.add(id)
    run(id, job, resources)
      .catch((error: unknown) => {
        if (error instanceof Cancelled || cancelled.has(id)) post({ type: 'cancelled', id })
        else post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        active.delete(id)
        cancelled.delete(id)
      })
  }
}
