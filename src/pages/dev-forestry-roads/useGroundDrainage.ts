/**
 * Runs existing-ground drainage for the page: samples the analysis area in slices on the page's
 * thread (the terrain is a function), routes it in `groundDrainage.worker.ts`, and keeps that
 * worker alive holding the routed grid so a new outlet is answered without routing again.
 *
 * The result is keyed to the terrain, the area and the routing settings (`groundDrainageKey`):
 * pegging or moving a road leaves it current; a new terrain, area or setting makes it stale, and a
 * stale result is never drawn on the plan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runCooperatively } from './cooperative'
import {
  areaSquareMetres,
  groundDrainageKey,
  groundDrainagePlan,
  mapGeometry,
  sampleAreaGridSteps,
  type AreaGridSummary,
  type AreaOutletResult,
  type GroundDrainageState,
} from './groundDrainage'
import {
  createAreaRouterCore,
  type GroundDrainageWorkerRequest,
  type GroundDrainageWorkerResponse,
  type RoutedArea,
} from './groundDrainage.worker'
import { localMetricGrid } from './terrain'
import type { Coordinate, TerrainSource } from './types'

type Request = GroundDrainageWorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never

/** A worker that keeps the last routed grid; on a page without workers, the same core in-thread. */
class AreaRouter {
  private worker: Worker | null = null
  private inline: ReturnType<typeof createAreaRouterCore> | null = null
  private pending = new Map<number, (response: GroundDrainageWorkerResponse) => void>()
  private next = 1

  private start() {
    if (this.worker || this.inline) return
    if (typeof Worker === 'undefined') {
      this.inline = createAreaRouterCore()
      return
    }
    this.worker = new Worker(new URL('./groundDrainage.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<GroundDrainageWorkerResponse>) => {
      this.pending.get(event.data.id)?.(event.data)
      this.pending.delete(event.data.id)
    }
    this.worker.onerror = (event) => {
      const message = event.message || 'The drainage worker failed.'
      for (const resolve of this.pending.values()) resolve({ type: 'error', id: 0, message })
      this.pending.clear()
      this.dispose()
    }
  }

  send(request: Request, transfer: Transferable[] = [], signal?: AbortSignal): Promise<GroundDrainageWorkerResponse> {
    this.start()
    const id = this.next++
    const message = { ...request, id } as GroundDrainageWorkerRequest
    if (this.inline) return Promise.resolve(this.inline(message))
    return new Promise((resolve, reject) => {
      const abort = () => {
        // A routing in progress cannot be interrupted: drop the worker and its grid.
        this.pending.delete(id)
        this.dispose()
        reject(signal?.reason ?? new DOMException('Cancelled.', 'AbortError'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, (response) => {
        signal?.removeEventListener('abort', abort)
        resolve(response)
      })
      this.worker!.postMessage(message, transfer)
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.inline = null
  }
}

export interface GroundDrainageResult {
  key: string
  summary: AreaGridSummary
  /** Streams and watersheds, lon/lat. */
  routed: RoutedArea
  terrainName: string
  /** Planar size of the analysis area, ha. */
  areaHa: number
  /** The projection the grid was routed in, kept to project outlet requests. */
  anchor: Coordinate
}
export interface GroundDrainageOutlet {
  requested: Coordinate
  snapped: Coordinate
  /** The catchment in lon/lat. */
  result: AreaOutletResult
}
export interface GroundDrainageProgress {
  stage: 'sampling' | 'routing'
  done: number
  total: number
}

export function useGroundDrainage({
  state,
  source,
  terrainName,
  terrainFingerprint,
  sourceM,
}: {
  state: GroundDrainageState | undefined
  source: TerrainSource
  terrainName: string
  terrainFingerprint: string
  /** The terrain's own spacing, m. */
  sourceM: number
}) {
  const router = useRef<AreaRouter | null>(null)
  const controller = useRef<AbortController | null>(null)
  const [result, setResult] = useState<GroundDrainageResult | null>(null)
  const [progress, setProgress] = useState<GroundDrainageProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outlet, setOutlet] = useState<GroundDrainageOutlet | null>(null)
  const [outletError, setOutletError] = useState<string | null>(null)
  useEffect(
    () => () => {
      controller.current?.abort()
      router.current?.dispose()
    },
    [],
  )
  const area = state?.area
  const settings = state?.settings
  const key = useMemo(
    () => (area && settings ? groundDrainageKey({ terrainFingerprint, area, settings }) : null),
    [area, settings, terrainFingerprint],
  )
  const current = !!result && result.key === key
  const stale = !!result && !current

  const run = useCallback(async () => {
    if (!area || !settings || !key) return
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setError(null)
    setOutlet(null)
    setProgress({ stage: 'sampling', done: 0, total: 1 })
    try {
      const outer = area.geometry.type === 'Polygon' ? area.geometry.coordinates[0] : area.geometry.coordinates[0][0]
      const anchor = outer[0] as Coordinate
      const projection = localMetricGrid(anchor)
      const sampled = await runCooperatively(
        sampleAreaGridSteps(source, area.geometry, projection.toGrid, {
          sourceM,
          marginM: settings.marginM,
          workingResolutionM: settings.workingResolutionM,
          toLonLat: projection.toLonLat,
        }),
        {
          signal: abort.signal,
          onProgress: ({ done, total }) => setProgress({ stage: 'sampling', done, total }),
        },
        'Drainage cancelled.',
      )
      setProgress({ stage: 'routing', done: 0, total: 1 })
      router.current ??= new AreaRouter()
      // From here the worker's grid is replaced, or dropped on Cancel: the last result goes with it.
      setResult(null)
      const response = await router.current.send(
        {
          type: 'route',
          grid: sampled.grid,
          zone: sampled.zone,
          settings: {
            streamThresholdHa: settings.streamThresholdHa,
            depressionPolicy: settings.depressionPolicy,
            watershedMinAreaHa: settings.watershedMinAreaHa,
          },
        },
        // The grid is the worker's from here: the page keeps only the summary.
        [sampled.grid.values.buffer, sampled.zone.buffer],
        abort.signal,
      )
      if (response.type === 'error') throw Error(response.message)
      if (response.type !== 'routed') throw Error('The drainage worker answered out of turn.')
      const toLonLat = (xy: [number, number]) => projection.toLonLat(xy)
      setResult({
        key,
        summary: sampled.summary,
        routed: {
          conditioning: response.conditioning,
          streams: {
            ...response.streams,
            features: response.streams.features.map((f) => ({ ...f, geometry: mapGeometry(f.geometry, toLonLat) })),
          },
          ...(response.watersheds
            ? {
                watersheds: {
                  ...response.watersheds,
                  features: response.watersheds.features.map((f) => ({
                    ...f,
                    geometry: mapGeometry(f.geometry, toLonLat),
                    properties: { ...f.properties, outlet: toLonLat(f.properties.outlet as [number, number]) },
                  })),
                },
              }
            : {}),
        },
        terrainName,
        areaHa: areaSquareMetres(area.geometry, projection.toGrid) / 10_000,
        anchor,
      })
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not route the area.')
    } finally {
      if (controller.current === abort) {
        controller.current = null
        setProgress(null)
      }
    }
  }, [area, settings, key, source, sourceM, terrainName])

  const cancel = useCallback(() => controller.current?.abort(), [])

  // An outlet is answered from the grid the worker holds: no routing, so it follows each pick.
  const requested = state?.outlet
  const snapRadiusM = settings?.snapRadiusM
  const snapPolicy = settings?.snapPolicy
  useEffect(() => {
    setOutletError(null)
    if (!current || !result || !requested || snapRadiusM === undefined || !router.current) {
      setOutlet(null)
      return
    }
    let live = true
    const projection = localMetricGrid(result.anchor)
    router.current
      .send({ type: 'outlet', requested: projection.toGrid(requested), settings: { snapRadiusM, snapPolicy } })
      .then((response) => {
        if (!live) return
        if (response.type === 'error') {
          setOutlet(null)
          setOutletError(response.message)
          return
        }
        if (response.type !== 'outlet') return
        const toLonLat = (xy: [number, number]) => projection.toLonLat(xy)
        const catchment = response.result.catchment
        setOutlet({
          requested,
          snapped: toLonLat(response.result.snapped),
          result: {
            ...response.result,
            catchment: {
              ...catchment,
              geometry: mapGeometry(catchment.geometry, toLonLat),
              properties: {
                ...catchment.properties,
                outlet: toLonLat(catchment.properties.outlet as [number, number]),
              },
            },
          },
        })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [current, result, requested, snapRadiusM, snapPolicy])

  const plan = useMemo(
    () =>
      groundDrainagePlan(
        area,
        current && result
          ? { streams: result.routed.streams, watersheds: result.routed.watersheds, outlet }
          : undefined,
      ),
    [area, current, result, outlet],
  )

  return { result, current, stale, progress, error, outlet, outletError, run, cancel, plan }
}
