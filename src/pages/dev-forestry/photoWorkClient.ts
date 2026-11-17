/**
 * The page's side of the own-photo worker (`photoWork.ts`): one worker kept for the page's life, so terrain, pixels
 * and imagery loaded for one job serve the next. Each call returns a promise and takes an AbortSignal; aborting
 * rejects at once and tells the worker to drop the job at its next slice.
 *
 * Pixels and imagery are passed as `{ key, value }`. The value crosses only when the worker may not hold that key (a
 * copy, so the caller keeps its own); if the worker has let it go since, it asks and the job is sent again with it.
 */
import type { HitBuffer } from './photoHitBuffer'
import type { PhotoPose } from './photoPose'
import type {
  ImageryLayer,
  ModelAgreement,
  PhotoTerrainSpec,
  PhotoWorkJob,
  PhotoWorkRequest,
  PhotoWorkResources,
  PhotoWorkResponse,
  PhotoWorkResult,
  PhotoWorkStage,
} from './photoWork'
import type { Drape, DrapeOptions, Rgba } from './photoViews'
import type { ProfilePoint } from './skylineFit'

export type { ImageryLayer, PhotoTerrainSpec, PhotoWorkStage } from './photoWork'

/** A value the worker keeps under its key: the same key must always mean the same value. */
export type PhotoResource<T> = { key: string; value: T }

export type PhotoWorkProgress = (stage: PhotoWorkStage, done: number) => void

/** What the client needs of a worker; a test passes its own. */
export type PhotoWorkerLike = {
  postMessage(message: PhotoWorkRequest, transfer?: Transferable[]): void
  terminate(): void
  onmessage: ((event: { data: PhotoWorkResponse }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

type Pending = {
  job: PhotoWorkJob
  values: PhotoWorkResources
  resolve: (result: PhotoWorkResult) => void
  reject: (error: unknown) => void
  onProgress?: PhotoWorkProgress
}

export type PhotoWorkClient = {
  run(
    job: PhotoWorkJob,
    values: PhotoWorkResources,
    signal?: AbortSignal,
    onProgress?: PhotoWorkProgress,
  ): Promise<PhotoWorkResult>
  /** Stops the worker and everything it holds; the next call starts a new one. */
  dispose(): void
}

export function createPhotoWorkClient(makeWorker: () => PhotoWorkerLike): PhotoWorkClient {
  let worker: PhotoWorkerLike | null = null
  /** Resource keys the worker was last sent ("photo:…", "imagery:…"). */
  const sent = new Set<string>()
  const pending = new Map<number, Pending>()
  let nextId = 1

  const failAll = (error: unknown) => {
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  const dispose = () => {
    worker?.terminate()
    worker = null
    sent.clear()
  }
  const keysOf = (job: PhotoWorkJob) => ({
    photo: job.kind === 'drape' || job.kind === 'modelView' ? (job.photo ?? null) : null,
    imagery: job.kind === 'modelView' ? job.imagery : null,
  })
  const send = (id: number, entry: Pending, force: ReadonlyArray<keyof PhotoWorkResources> = []) => {
    const keys = keysOf(entry.job)
    const resources: PhotoWorkResources = {}
    if (keys.photo && entry.values.photo && (force.includes('photo') || !sent.has(`photo:${keys.photo}`))) {
      resources.photo = entry.values.photo
      sent.add(`photo:${keys.photo}`)
    }
    if (keys.imagery && entry.values.imagery && (force.includes('imagery') || !sent.has(`imagery:${keys.imagery}`))) {
      resources.imagery = entry.values.imagery
      sent.add(`imagery:${keys.imagery}`)
    }
    ensure().postMessage({ type: 'job', id, job: entry.job, resources })
  }
  const ensure = () => {
    if (worker) return worker
    const created = makeWorker()
    created.onmessage = ({ data }) => {
      const entry = pending.get(data.id)
      if (!entry) return
      if (data.type === 'progress') entry.onProgress?.(data.stage, data.done)
      else if (data.type === 'need') {
        const keys = keysOf(entry.job)
        for (const key of data.keys) sent.delete(`${key}:${keys[key]}`)
        if (data.keys.some((key) => !entry.values[key])) {
          pending.delete(data.id)
          entry.reject(Error(`The photo worker needs the ${data.keys.join(' and ')}, which were not given.`))
        } else send(data.id, entry, data.keys)
      } else {
        pending.delete(data.id)
        if (data.type === 'done') entry.resolve(data.result)
        else if (data.type === 'error') entry.reject(Error(data.message))
        else entry.reject(new DOMException('Cancelled', 'AbortError'))
      }
    }
    created.onerror = (event) => {
      dispose()
      failAll(Error(event.message || 'The photo worker stopped.'))
    }
    worker = created
    return created
  }

  const run: PhotoWorkClient['run'] = (job, values, signal, onProgress) => {
    signal?.throwIfAborted()
    const id = nextId++
    return new Promise<PhotoWorkResult>((resolve, reject) => {
      const abort = () => {
        if (!pending.delete(id)) return
        worker?.postMessage({ type: 'cancel', id })
        reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
      }
      const entry: Pending = {
        job,
        values,
        resolve: (result) => {
          signal?.removeEventListener('abort', abort)
          resolve(result)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort)
          reject(error)
        },
        onProgress,
      }
      pending.set(id, entry)
      signal?.addEventListener('abort', abort, { once: true })
      send(id, entry)
    })
  }

  return { run, dispose }
}

let shared: PhotoWorkClient | null = null
const client = () =>
  (shared ??= createPhotoWorkClient(
    () =>
      new Worker(new URL('./photoWork.worker.ts', import.meta.url), { type: 'module' }) as unknown as PhotoWorkerLike,
  ))

const expect = <K extends PhotoWorkResult['kind']>(result: PhotoWorkResult, kind: K) => {
  if (result.kind !== kind) throw Error(`The photo worker answered a ${result.kind} job for a ${kind} one.`)
  return result as Extract<PhotoWorkResult, { kind: K }>
}

/** Every working pixel's ground for a camera (`buildHitBuffer`), about 0.2 s for 525 px at the worker. */
export async function castPhotoHits(
  input: { pose: PhotoPose; terrain: PhotoTerrainSpec; width?: number; maxMeters?: number },
  signal?: AbortSignal,
  onProgress?: PhotoWorkProgress,
): Promise<HitBuffer> {
  return expect(await client().run({ kind: 'hitBuffer', ...input }, {}, signal, onProgress), 'hitBuffer').buffer
}

/** Imagery seen from the camera (`renderModelView`), scored against the photo when one is given (`modelAgreement`). */
export async function renderPhotoModelView(
  input: {
    pose: PhotoPose
    terrain: PhotoTerrainSpec
    imagery: PhotoResource<ImageryLayer[]>
    photo?: PhotoResource<Rgba> | null
    width?: number
    maxMeters?: number
  },
  signal?: AbortSignal,
  onProgress?: PhotoWorkProgress,
): Promise<{ image: Rgba; agreement: ModelAgreement | null }> {
  const { imagery, photo, ...rest } = input
  const result = expect(
    await client().run(
      { kind: 'modelView', ...rest, imagery: imagery.key, photo: photo?.key ?? null },
      { imagery: imagery.value, photo: photo?.value },
      signal,
      onProgress,
    ),
    'modelView',
  )
  return { image: result.image, agreement: result.agreement }
}

/** The photo laid on the plan for a camera (`drapePhoto`), its range from the frame. */
export async function drapePhotoOffThread(
  input: { pose: PhotoPose; terrain: PhotoTerrainSpec; photo: PhotoResource<Rgba>; options?: DrapeOptions },
  signal?: AbortSignal,
  onProgress?: PhotoWorkProgress,
): Promise<Drape | null> {
  const { photo, ...rest } = input
  return expect(
    await client().run({ kind: 'drape', ...rest, photo: photo.key }, { photo: photo.value }, signal, onProgress),
    'drape',
  ).drape
}

/** The terrain horizon round an eye (`terrainProfile`), by default every 0.1° of the full circle. */
export async function photoHorizon(
  input: {
    eye: { lng: number; lat: number; altitudeMeters: number }
    terrain: PhotoTerrainSpec
    from?: number
    to?: number
    step?: number
    maxDistanceMeters?: number
  },
  signal?: AbortSignal,
  onProgress?: PhotoWorkProgress,
): Promise<ProfilePoint[]> {
  return expect(await client().run({ kind: 'horizon', ...input }, {}, signal, onProgress), 'horizon').profile
}

/** Stops the shared worker, dropping its terrain, pixels and imagery. */
export function disposePhotoWork(): void {
  shared?.dispose()
  shared = null
}
