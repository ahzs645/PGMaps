/**
 * Removing and restoring a road, and naming a project opened from a file. Pure, so the choices a
 * person is offered (undo a delete, replace or keep both) can be checked outside a browser.
 */
import type { Alignment, RoadProject } from './types'

export interface RemovedRoad {
  road: Alignment
  /** Where it sat in the list, so an undo puts it back in place. */
  index: number
  /** The road shown after the removal. */
  shownId: string
}

/**
 * Removes one road and shows its neighbour: the road before it, or the next one when it was first.
 * Returns null when it is the only road, since a project always holds one.
 */
export function removeRoad<P extends Pick<RoadProject, 'alignments' | 'activeAlignmentId'>>(
  project: P,
  id: string,
): { project: P; removed: RemovedRoad } | null {
  const index = project.alignments.findIndex((road) => road.id === id)
  if (index < 0 || project.alignments.length < 2) return null
  const alignments = project.alignments.filter((road) => road.id !== id)
  const shownId = project.activeAlignmentId === id ? alignments[Math.max(0, index - 1)].id : project.activeAlignmentId
  return {
    project: { ...project, alignments, activeAlignmentId: shownId },
    removed: { road: project.alignments[index], index, shownId },
  }
}

/** Puts a removed road back where it was and shows it. A road already back is only shown. */
export function restoreRoad<P extends Pick<RoadProject, 'alignments' | 'activeAlignmentId'>>(
  project: P,
  removed: RemovedRoad,
): P {
  if (project.alignments.some((road) => road.id === removed.road.id))
    return { ...project, activeAlignmentId: removed.road.id }
  const alignments = [...project.alignments]
  alignments.splice(Math.min(removed.index, alignments.length), 0, removed.road)
  return { ...project, alignments, activeAlignmentId: removed.road.id }
}

/** "Block 12 spur (2)": the first numbered name no saved project already has. */
export function distinctProjectName(name: string, taken: readonly string[]): string {
  const used = new Set(taken)
  if (!used.has(name)) return name
  const base = name.replace(/ \(\d+\)$/, '')
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 200 - ` (${n})`.length)} (${n})`
    if (!used.has(candidate)) return candidate
  }
}
