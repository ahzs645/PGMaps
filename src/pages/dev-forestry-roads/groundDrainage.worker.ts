/// <reference lib="webworker" />
/**
 * Routes an existing-ground drainage area off the page's thread and keeps the routed grid, so
 * picking an outlet is answered from it without routing again. The page samples the terrain
 * (`sampleAreaGridSteps`, which needs the terrain's `elevationAt`) and posts the grid; results come
 * back in the grid's projected metres, and the page projects them to lon/lat.
 */
import {
  areaOutlet,
  routeAreaGrid,
  type AreaGrid,
  type AreaOutletResult,
  type AreaRouting,
  type GroundDrainageSettings,
} from './groundDrainage'

export type GroundDrainageWorkerRequest =
  | {
      type: 'route'
      id: number
      grid: AreaGrid['grid']
      zone: Uint8Array
      settings: Pick<GroundDrainageSettings, 'streamThresholdHa' | 'depressionPolicy' | 'watershedMinAreaHa'>
    }
  | {
      type: 'outlet'
      id: number
      requested: [number, number]
      settings: Pick<GroundDrainageSettings, 'snapRadiusM' | 'snapPolicy'>
    }

export type RoutedArea = Pick<AreaRouting, 'streams' | 'watersheds' | 'conditioning'>
export type GroundDrainageWorkerResponse =
  | ({ type: 'routed'; id: number } & RoutedArea)
  | { type: 'outlet'; id: number; result: AreaOutletResult }
  | { type: 'error'; id: number; message: string }

/** One router, in a worker or (where there is none) on the page: it keeps the last routed grid. */
export function createAreaRouterCore() {
  let routing: AreaRouting | null = null
  const identity = (xy: [number, number]) => xy
  return (request: GroundDrainageWorkerRequest): GroundDrainageWorkerResponse => {
    try {
      if (request.type === 'route') {
        routing = null
        routing = routeAreaGrid({ grid: request.grid, zone: request.zone }, request.settings, identity)
        return {
          type: 'routed',
          id: request.id,
          streams: routing.streams,
          watersheds: routing.watersheds,
          conditioning: routing.conditioning,
        }
      }
      if (!routing) throw Error('Route the area before choosing an outlet.')
      return {
        type: 'outlet',
        id: request.id,
        result: areaOutlet(routing, request.requested, request.settings, identity),
      }
    } catch (error) {
      return { type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) }
    }
  }
}

// Only inside a worker: the page imports `createAreaRouterCore` for its no-worker fallback.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const handle = createAreaRouterCore()
  self.onmessage = (event: MessageEvent<GroundDrainageWorkerRequest>) => {
    self.postMessage(handle(event.data))
  }
}
