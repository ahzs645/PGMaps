import type { PreparedPolygons } from './categoricalPolygonGeometry'

type WorkerReply = { data: PreparedPolygons; error?: never } | { error: string; data?: never }
type WorkerPort = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}
type Job = {
  url: string
  resolve: (data: PreparedPolygons) => void
  reject: (error: Error) => void
  clean: () => void
}
type Slot = { worker?: WorkerPort; job?: Job }

/** Bounded workers; cancellation terminates CPU work as well as in-flight fetches. */
export class CategoricalPolygonWorkerPool {
  private slots: Slot[] = [{}, {}]
  private queue: Job[] = []
  private disposed = false

  constructor(
    private create: () => WorkerPort = () =>
      new Worker(new URL('./categoricalPolygons.worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  load(url: string, signal: AbortSignal): Promise<PreparedPolygons> {
    if (this.disposed || signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    return new Promise((resolve, reject) => {
      const job: Job = { url, resolve, reject, clean: () => signal.removeEventListener('abort', abort) }
      const abort = () => {
        this.queue = this.queue.filter((queued) => queued !== job)
        const slot = this.slots.find((candidate) => candidate.job === job)
        if (slot) {
          slot.worker?.terminate()
          slot.worker = undefined
          slot.job = undefined
        }
        job.clean()
        reject(new DOMException('Aborted', 'AbortError'))
        this.pump()
      }
      signal.addEventListener('abort', abort, { once: true })
      this.queue.push(job)
      this.pump()
    })
  }

  dispose() {
    this.disposed = true
    for (const job of [...this.queue, ...this.slots.flatMap((slot) => (slot.job ? [slot.job] : []))]) {
      job.clean()
      job.reject(new DOMException('Aborted', 'AbortError'))
    }
    this.queue = []
    for (const slot of this.slots) {
      slot.worker?.terminate()
      slot.worker = undefined
      slot.job = undefined
    }
  }

  private pump() {
    if (this.disposed) return
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue
      const job = this.queue.shift()!
      slot.job = job
      try {
        const worker = slot.worker ?? (slot.worker = this.create())
        const finish = (reply: WorkerReply) => {
          if (slot.job !== job || this.disposed) return
          slot.job = undefined
          job.clean()
          if (reply.data) job.resolve(reply.data)
          else job.reject(new Error(reply.error))
          this.pump()
        }
        worker.onmessage = ({ data }) => finish(data)
        worker.onerror = (event) => {
          if (slot.job !== job || this.disposed) return
          worker.terminate()
          slot.worker = undefined
          finish({ error: event.message || 'Polygon worker failed' })
        }
        worker.postMessage({ url: job.url })
      } catch (cause) {
        slot.worker?.terminate()
        slot.worker = undefined
        slot.job = undefined
        job.clean()
        job.reject(cause instanceof Error ? cause : new Error(String(cause)))
        queueMicrotask(() => this.pump())
      }
    }
  }
}
