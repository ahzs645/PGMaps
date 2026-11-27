/**
 * The page's one old forest worker, shared by the panel's calculation and the map's drawing so both
 * run on the same session reads and prepared units. Browser-only.
 */
import type { OldForestDrawing } from './drawing'
import type { OldForestAsk, OldForestReply } from './oldForest.worker'
import type { OldForestRecord } from '../records'
import type { MackenzieOldForestRecord } from './mackenzieRecord'

type Ask<T = OldForestAsk> = T extends unknown ? Omit<T, 'id'> : never

interface Waiting {
  resolve: (reply: OldForestReply) => void
  reject: (error: Error) => void
  onProgress?: (message: string) => void
}

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, Waiting>()

/** Thrown to every waiting ask when the worker is stopped (Cancel) or fails to start. */
export class OldForestStopped extends Error {}

function connect(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./oldForest.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<OldForestReply>) => {
    const ask = waiting.get(data.id)
    if (!ask) return
    if (data.progress) return ask.onProgress?.(data.progress)
    waiting.delete(data.id)
    if (data.error) ask.reject(Error(data.error))
    else ask.resolve(data)
  }
  w.onerror = (e) => stopOldForest(e.message || 'The calculation could not start.')
  worker = w
  return w
}

function post(message: Ask, onProgress?: (message: string) => void): Promise<OldForestReply> {
  const w = connect()
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress })
    w.postMessage({ ...message, id } as OldForestAsk)
  })
}

export async function calculateOldForest(
  ask: Omit<Extract<OldForestAsk, { kind: 'calculate' }>, 'id' | 'kind'>,
  onProgress: (message: string) => void,
): Promise<OldForestRecord> {
  const reply = await post({ kind: 'calculate', ...ask }, onProgress)
  if (!reply.record) throw Error('Nothing came back.')
  return reply.record
}

/** The Mackenzie order's old and old interior forest (`mackenzie.ts`), on the same worker and session. */
export async function calculateMackenzieOldForest(
  ask: Omit<Extract<OldForestAsk, { kind: 'mackenzie' }>, 'id' | 'kind'>,
  onProgress: (message: string) => void,
): Promise<MackenzieOldForestRecord> {
  const reply = await post({ kind: 'mackenzie', ...ask }, onProgress)
  if (!reply.mackenzie) throw Error('Nothing came back.')
  return reply.mackenzie
}

/** The map's shapes for one schedule and year; null when a newer draw replaced this one first. */
export async function drawOldForest(
  ask: Omit<Extract<OldForestAsk, { kind: 'draw' }>, 'id' | 'kind'>,
  onProgress?: (message: string) => void,
): Promise<OldForestDrawing | null> {
  const reply = await post({ kind: 'draw', ...ask }, onProgress)
  return reply.drawing ?? null
}

/** Stops whatever is running. The session's reads go with the worker. */
export function stopOldForest(reason = 'Stopped.') {
  worker?.terminate()
  worker = null
  for (const ask of waiting.values()) ask.reject(new OldForestStopped(reason))
  waiting.clear()
}
