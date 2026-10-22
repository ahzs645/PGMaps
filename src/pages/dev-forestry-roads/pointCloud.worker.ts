/// <reference lib="webworker" />
/**
 * Reads a LAS/LAZ point cloud, optionally classifies its ground and grids it, off the main thread.
 * One job per worker: the wasm heaps only grow, so `pointCloudClient.ts` terminates the worker
 * afterwards.
 *
 * With `askBreaklines`, the worker posts the CRS it read (`crs`) as soon as the cloud is decoded and
 * waits for the page's `breaklines` reply before going on. The CRS of a LAZ without header keys is
 * only known once whitebox has read the file here, and breaklines are projected with it; the page
 * keeps the projection code, and can refuse a cloud without a CRS before the ground filter runs.
 */
import type { GroundGrid } from './lasSurface'
import type { Breakline } from './tinSurface'
import {
  classifyGround,
  groundSummary,
  readPointCloud,
  type ClassifyGroundOptions,
  type GroundMethod,
  type GroundSummary,
  type PointCloud,
} from './pointCloud'

export interface PointCloudWorkerRequest {
  bytes: ArrayBuffer
  /**
   * Run the ground filter (replacing any existing classes except noise); 'auto' runs it only
   * when the cloud has no ground-classified points.
   */
  classify: boolean | 'auto'
  maxPoints?: number
  /** Grid the ground points here too, so only the grid crosses back to the page. */
  surface?: SurfaceRequest
  /** Post `crs` once the cloud is read and wait for a `breaklines` reply (see above). */
  askBreaklines?: boolean
  method?: GroundMethod
  params?: ClassifyGroundOptions['params']
}

export interface SurfaceRequest {
  /** Cell mean of ground points with short gaps filled, or a TIN of them with breaklines. */
  method: 'mean' | 'tin'
  cellM: number
  maxCells: number
  gapCells?: number
  /** In the cloud's projected CRS; an `askBreaklines` reply replaces them. */
  breaklines?: Breakline[]
}

/** The page's answer to a `crs` message: breaklines in that CRS. */
export interface PointCloudBreaklinesReply {
  type: 'breaklines'
  breaklines: Breakline[]
}
export interface SurfaceResult {
  grid: GroundGrid
  /** Breakline report for a TIN surface. */
  tin?: { constrained: number; split: number; skipped: Array<{ id?: string; reason: string }> }
}

export type PointCloudWorkerStage = 'reading' | 'classifying' | 'gridding'

export type PointCloudWorkerResponse =
  | { type: 'progress'; stage: PointCloudWorkerStage; done: number; total: number }
  /** The cloud's CRS: the header's, or for a LAZ without header keys, whitebox's `lidar_info`. */
  | { type: 'crs'; epsg: number | null; verticalEpsg: number | null }
  | {
      type: 'done'
      /** Without its point arrays when a surface was requested. */
      cloud: PointCloud
      surface?: SurfaceResult
      summary: GroundSummary
      classifiedBy: GroundMethod | null
      timings: { readMs: number; classifyMs: number; gridMs: number }
    }
  | { type: 'error'; message: string }

// `globalThis` rather than `self`, so a test can import `gridSurface` outside a worker.
const scope = globalThis as unknown as DedicatedWorkerGlobalScope
let answerBreaklines: ((breaklines: Breakline[]) => void) | null = null

scope.onmessage = (event: MessageEvent<PointCloudWorkerRequest | PointCloudBreaklinesReply>) => {
  const data = event.data
  if ('type' in data) answerBreaklines?.(data.breaklines)
  else void run(data)
}

async function run({
  bytes,
  classify,
  maxPoints,
  method = 'ground_point_filter',
  params,
  surface: requested,
  askBreaklines,
}: PointCloudWorkerRequest) {
  const post = (message: PointCloudWorkerResponse, transfer: Transferable[] = []) =>
    scope.postMessage(message, transfer)
  try {
    post({ type: 'progress', stage: 'reading', done: 0, total: 1 })
    let started = performance.now()
    const cloud = await readPointCloud(new Uint8Array(bytes), { maxPoints })
    const readMs = performance.now() - started
    let request = requested
    if (askBreaklines) {
      const replied = new Promise<Breakline[]>((resolve) => (answerBreaklines = resolve))
      post({ type: 'crs', epsg: cloud.epsg, verticalEpsg: cloud.verticalEpsg })
      const breaklines = await replied
      if (request) request = { ...request, breaklines }
    }
    let classifyMs = 0
    const classifying = classify === 'auto' ? !cloud.classification.includes(2) : classify
    if (classifying) {
      started = performance.now()
      cloud.classification = await classifyGround(cloud, {
        method,
        params,
        onProgress: (done, total) => post({ type: 'progress', stage: 'classifying', done, total }),
      })
      classifyMs = performance.now() - started
    }
    let surface: SurfaceResult | undefined,
      gridMs = 0
    if (request) {
      post({ type: 'progress', stage: 'gridding', done: 0, total: 1 })
      started = performance.now()
      surface = await gridSurface(cloud, request)
      gridMs = performance.now() - started
    }
    const summary = groundSummary(cloud)
    const empty = {
      x: new Float64Array(),
      y: new Float64Array(),
      z: new Float64Array(),
      classification: new Uint8Array(),
    }
    const result = surface ? { ...cloud, ...empty } : cloud
    post(
      {
        type: 'done',
        cloud: result,
        surface,
        summary,
        classifiedBy: classifying ? method : null,
        timings: { readMs, classifyMs, gridMs },
      },
      [result.x.buffer, result.y.buffer, result.z.buffer, result.classification.buffer],
    )
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Grid the ground (class 2) points. The grid covers those points only, so a stray non-ground
 * return far outside the corridor neither enlarges the grid nor coarsens its cell.
 */
export async function gridSurface(cloud: PointCloud, request: SurfaceRequest): Promise<SurfaceResult> {
  let n = 0
  for (let i = 0; i < cloud.count; i++) if (cloud.classification[i] === 2) n++
  const x = new Float64Array(n),
    y = new Float64Array(n),
    z = new Float64Array(n)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0, j = 0; i < cloud.count; i++)
    if (cloud.classification[i] === 2) {
      x[j] = cloud.x[i]
      y[j] = cloud.y[i]
      z[j++] = cloud.z[i]
      minX = Math.min(minX, cloud.x[i])
      maxX = Math.max(maxX, cloud.x[i])
      minY = Math.min(minY, cloud.y[i])
      maxY = Math.max(maxY, cloud.y[i])
    }
  // With no ground points, the cloud's extent lets `gridGroundPoints` say so rather than
  // report a grid with no extent.
  if (!n) [minX, minY, , maxX, maxY] = cloud.bounds
  if (request.method === 'mean') {
    const { gridGroundPoints } = await import('./lasSurface')
    const grid = gridGroundPoints({ x, y, z }, [minX, minY, maxX, maxY], request)
    return { grid: { ...grid, epsg: cloud.epsg, totalPoints: cloud.sourceCount } }
  }
  if (n < 3)
    throw Error('Fewer than three ground points. Classify the cloud first, or tick "Classify ground" and import again.')
  const { gridFromPoints } = await import('./tinSurface')
  const { grid, tin } = gridFromPoints({ x, y, z }, request.breaklines ?? [], {
    cellM: request.cellM,
    maxCells: request.maxCells,
    bounds: [minX, minY, maxX, maxY],
  })
  return {
    grid: { ...grid, epsg: cloud.epsg, totalPoints: cloud.sourceCount },
    tin: { constrained: tin.constrained, split: tin.split, skipped: tin.skipped },
  }
}
