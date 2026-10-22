/// <reference lib="webworker" />
/**
 * Reads a LAS/LAZ point cloud, optionally classifies its ground and grids it, off the main thread.
 * One job per worker: the wasm heaps only grow, so `pointCloudClient.ts` terminates the worker
 * afterwards.
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
  method?: GroundMethod
  params?: ClassifyGroundOptions['params']
}

export interface SurfaceRequest {
  /** Cell mean of ground points with short gaps filled, or a TIN of them with breaklines. */
  method: 'mean' | 'tin'
  cellM: number
  maxCells: number
  gapCells?: number
  /** In the cloud's projected CRS. */
  breaklines?: Breakline[]
}
export interface SurfaceResult {
  grid: GroundGrid
  /** Breakline report for a TIN surface. */
  tin?: { constrained: number; split: number; skipped: Array<{ id?: string; reason: string }> }
}

export type PointCloudWorkerStage = 'reading' | 'classifying' | 'gridding'

export type PointCloudWorkerResponse =
  | { type: 'progress'; stage: PointCloudWorkerStage; done: number; total: number }
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

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (event: MessageEvent<PointCloudWorkerRequest>) => {
  const { bytes, classify, maxPoints, method = 'ground_point_filter', params, surface: request } = event.data
  const post = (message: PointCloudWorkerResponse, transfer: Transferable[] = []) =>
    scope.postMessage(message, transfer)
  try {
    post({ type: 'progress', stage: 'reading', done: 0, total: 1 })
    let started = performance.now()
    const cloud = await readPointCloud(new Uint8Array(bytes), { maxPoints })
    const readMs = performance.now() - started
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

async function gridSurface(cloud: PointCloud, request: SurfaceRequest): Promise<SurfaceResult> {
  let n = 0
  for (let i = 0; i < cloud.count; i++) if (cloud.classification[i] === 2) n++
  const x = new Float64Array(n),
    y = new Float64Array(n),
    z = new Float64Array(n)
  for (let i = 0, j = 0; i < cloud.count; i++)
    if (cloud.classification[i] === 2) {
      x[j] = cloud.x[i]
      y[j] = cloud.y[i]
      z[j++] = cloud.z[i]
    }
  const [minX, minY, , maxX, maxY] = cloud.bounds
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
