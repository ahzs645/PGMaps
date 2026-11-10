/**
 * Point-cloud vegetation evidence for this browser session, by the terrain it was imported with
 * (the terrain's checksum). The grids are several megabytes per square kilometre, so they are not
 * written into the project: after a reload, or on another machine, road finding runs on the terrain
 * alone and says so until the point cloud is imported again.
 */
import { useSyncExternalStore } from 'react'
import type { VegetationEvidenceOutcome } from './vegetationEvidence'

/** Terrains whose evidence is kept at once; the oldest is dropped first. */
export const MAX_KEPT_VEGETATION_EVIDENCE = 3

const kept = new Map<string, VegetationEvidenceOutcome>()
const listeners = new Set<() => void>()

export function keepVegetationEvidence(terrainKey: string, outcome: VegetationEvidenceOutcome) {
  kept.delete(terrainKey)
  kept.set(terrainKey, outcome)
  while (kept.size > MAX_KEPT_VEGETATION_EVIDENCE) kept.delete(kept.keys().next().value!)
  for (const listener of listeners) listener()
}

export function keptVegetationEvidence(terrainKey: string | undefined): VegetationEvidenceOutcome | null {
  return terrainKey ? (kept.get(terrainKey) ?? null) : null
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The kept evidence (or refusal) for a terrain, updating when an import adds it. */
export function useVegetationEvidence(terrainKey: string | undefined): VegetationEvidenceOutcome | null {
  return useSyncExternalStore(
    subscribe,
    () => keptVegetationEvidence(terrainKey),
    () => null,
  )
}
