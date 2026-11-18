/**
 * A few decode workers kept between photos. A flight is a dozen or more HEIC photos; decoded one after another, each
 * in a worker of its own that compiled the decoder again, fourteen took 42 s. Here up to `size` decode side by side,
 * each worker compiles the decoder once, and a worker left idle for `idleMs` ends, which is what gives its memory back.
 *
 * A worker answers one request at a time. A request that is aborted ends its worker, since nothing else stops a decode
 * part-way, and the next request starts a new one.
 *
 * Free of DOM and network access: the worker is made by the caller.
 */

export interface PoolWorker<Request, Response> {
  postMessage(message: Request, transfer: Transferable[]): void
  onmessage: ((event: { data: Response }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
  terminate(): void
}

export interface DecodePool<Request, Response> {
  /** Runs one request on a free worker, waiting for one when all are busy. */
  run(request: Request, transfer?: Transferable[], signal?: AbortSignal): Promise<Response>
  /** Workers alive now, busy or idle. */
  workers(): number
  /** Ends every worker; requests still running are rejected. */
  dispose(): void
}

type Slot<Request, Response> = {
  worker: PoolWorker<Request, Response>
  busy: boolean
  idle: ReturnType<typeof setTimeout> | null
  fail: ((error: Error) => void) | null
}

const cancelled = (signal?: AbortSignal) =>
  (signal?.reason as Error | undefined) ?? new DOMException('Opening the photo was cancelled.', 'AbortError')

export function createDecodePool<Request, Response>({
  make,
  size,
  idleMs = 8000,
}: {
  make: () => PoolWorker<Request, Response>
  /** The most workers alive at once, at least one. */
  size: number
  idleMs?: number
}): DecodePool<Request, Response> {
  const limit = Math.max(1, Math.floor(size))
  const slots: Array<Slot<Request, Response>> = []
  const waiting: Array<() => void> = []

  const drop = (slot: Slot<Request, Response>) => {
    if (slot.idle !== null) clearTimeout(slot.idle)
    slot.idle = null
    slot.worker.onmessage = null
    slot.worker.onerror = null
    slot.worker.terminate()
    const at = slots.indexOf(slot)
    if (at >= 0) slots.splice(at, 1)
  }
  /** A free worker now, or none: an idle one, else a new one while there is room. */
  const take = (): Slot<Request, Response> | null => {
    const free = slots.find((slot) => !slot.busy)
    if (free) {
      if (free.idle !== null) clearTimeout(free.idle)
      free.idle = null
      free.busy = true
      return free
    }
    if (slots.length >= limit) return null
    const slot: Slot<Request, Response> = { worker: make(), busy: true, idle: null, fail: null }
    slots.push(slot)
    return slot
  }
  /** Room has come free: the longest waiting request takes it. */
  const next = () => waiting.shift()?.()
  const release = (slot: Slot<Request, Response>) => {
    slot.busy = false
    slot.fail = null
    if (waiting.length) return next()
    slot.idle = setTimeout(() => drop(slot), idleMs)
  }

  const acquire = (signal?: AbortSignal) =>
    new Promise<Slot<Request, Response>>((resolve, reject) => {
      const now = take()
      if (now) return resolve(now)
      const turn = () => {
        const slot = take()
        // Room went to someone else between the release and this turn: wait again, at the front.
        if (!slot) return void waiting.unshift(turn)
        signal?.removeEventListener('abort', abort)
        resolve(slot)
      }
      const abort = () => {
        const at = waiting.indexOf(turn)
        if (at >= 0) waiting.splice(at, 1)
        reject(cancelled(signal))
      }
      signal?.addEventListener('abort', abort, { once: true })
      waiting.push(turn)
    })

  return {
    async run(request, transfer = [], signal) {
      if (signal?.aborted) throw cancelled(signal)
      const slot = await acquire(signal)
      return new Promise<Response>((resolve, reject) => {
        const abort = () => {
          // Nothing stops a decode part-way but ending its worker.
          drop(slot)
          next()
          reject(cancelled(signal))
        }
        const settle = () => signal?.removeEventListener('abort', abort)
        slot.fail = (error) => {
          settle()
          reject(error)
        }
        slot.worker.onmessage = (event) => {
          settle()
          release(slot)
          resolve(event.data)
        }
        slot.worker.onerror = (event) => {
          settle()
          drop(slot)
          next()
          reject(new Error(event.message || 'The decoder failed to start.'))
        }
        signal?.addEventListener('abort', abort, { once: true })
        slot.worker.postMessage(request, transfer)
      })
    },
    workers: () => slots.length,
    dispose() {
      for (const slot of [...slots]) {
        slot.fail?.(new Error('The decoder was shut down.'))
        drop(slot)
      }
      waiting.length = 0
    },
  }
}

/**
 * How many photos to decode side by side: one fewer than the cores, at most four, and at most two where the browser
 * reports under 8 GB (or nothing): a 24-megapixel photo holds about 300 MB while it is decoded and encoded.
 */
export function decodePoolSize(cores: number | undefined, deviceMemoryGb: number | undefined): number {
  const byCores = Math.max(1, Math.min(4, Math.floor((cores ?? 2) - 1)))
  return deviceMemoryGb !== undefined && deviceMemoryGb >= 8 ? byCores : Math.min(2, byCores)
}
