import type { Family, Trip } from './routing'
import type { CityId } from './cities'

export type RoutingRequest =
  | { type: 'route'; id: number; trip: Trip; preview: boolean; city: CityId }
  | { type: 'cancel'; id: number }
export type RoutingResponse =
  | { type: 'partial' | 'result'; id: number; family: Family }
  | { type: 'error'; id: number; message: string }

/** One cached graph, one active request; superseded replies never reach React. */
export class RoutingWorker {
  private worker: Worker
  private nextId = 0
  private active: { id: number; partial: (family: Family) => void; resolve: (family: Family) => void; reject: (error: Error) => void; cleanup: () => void } | null = null

  constructor(private city: CityId = 'sf') {
    this.worker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = ({ data }: MessageEvent<RoutingResponse>) => {
      const active = this.active
      if (!active || data.id !== active.id) return
      if (data.type === 'partial') active.partial(data.family)
      else {
        this.active = null
        active.cleanup()
        if (data.type === 'error') active.reject(new Error(data.message))
        else active.resolve(data.family)
      }
    }
    this.worker.onerror = (event) => {
      const active = this.active
      if (!active) return
      this.active = null
      active.cleanup()
      active.reject(new Error(event.message || 'Could not calculate a route.'))
    }
  }

  route(trip: Trip, preview: boolean, signal: AbortSignal, partial: (family: Family) => void): Promise<Family> {
    if (this.active) this.cancel(this.active.id)
    if (signal.aborted) return Promise.reject(new DOMException('Route search cancelled.', 'AbortError'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(id)
      this.active = { id, partial, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      this.worker.postMessage({ type: 'route', id, trip, preview, city: this.city } satisfies RoutingRequest)
    })
  }

  private cancel(id: number) {
    const active = this.active
    if (!active || active.id !== id) return
    this.active = null
    active.cleanup()
    this.worker.postMessage({ type: 'cancel', id } satisfies RoutingRequest)
    active.reject(new DOMException('Route search cancelled.', 'AbortError'))
  }

  dispose() {
    if (this.active) this.cancel(this.active.id)
    this.worker.terminate()
  }
}
