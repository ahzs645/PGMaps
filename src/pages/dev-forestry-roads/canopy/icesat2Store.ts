/**
 * ICESat-2 terrain checks made this session, by terrain and road. Never in the project file: the
 * photons are re-read from SlideRule on demand, and a check belongs to the terrain it was made on.
 */
import { useSyncExternalStore } from 'react'
import type { TerrainMetadata } from '../types'
import type { Icesat2CheckResult } from './icesat2Check'

export type Icesat2Run =
  | { status: 'running'; startedAt: number; bytes: number; stage: string }
  | { status: 'done'; result: Icesat2CheckResult }
  | { status: 'error'; message: string }

const runs = new Map<string, Icesat2Run>()
const listeners = new Set<() => void>()

export const icesat2Key = (
  terrain: Pick<TerrainMetadata, 'kind' | 'name' | 'resolutionM' | 'sha256'>,
  alignmentId: string,
) => `${terrain.kind}:${terrain.sha256 ?? terrain.name}:${terrain.resolutionM}|${alignmentId}`

export function setIcesat2Run(key: string, run: Icesat2Run | null) {
  if (run) runs.set(key, run)
  else runs.delete(key)
  for (const l of listeners) l()
}

export function getIcesat2Run(key: string) {
  return runs.get(key) ?? null
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useIcesat2Run(key: string) {
  return useSyncExternalStore(subscribe, () => runs.get(key) ?? null)
}
