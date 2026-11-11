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

type RoadList = Pick<RoadProject, 'alignments' | 'activeAlignmentId' | 'designPlaceholderId' | 'workspaceMode'>

/**
 * Removes one road and shows its neighbour: the road before it, or the next one when it was first.
 * The last road leaves an empty design: a project file always holds one alignment, so a bare hidden
 * placeholder (`designPlaceholderId`) takes its place, as in a new project, and keeps only its
 * template so the next road starts from the same standards. Nothing of the deleted road's line stays
 * in the file. Returns null for a missing road, an access investigation, or a design already empty.
 */
export function removeRoad<P extends RoadList>(project: P, id: string): { project: P; removed: RemovedRoad } | null {
  const index = project.alignments.findIndex((road) => road.id === id)
  if (index < 0 || project.workspaceMode === 'access-investigation' || project.designPlaceholderId) return null
  const road = project.alignments[index]
  if (project.alignments.length < 2) {
    const placeholder = placeholderFor(road)
    return {
      project: {
        ...project,
        alignments: [placeholder],
        activeAlignmentId: placeholder.id,
        workspaceMode: 'design',
        designPlaceholderId: placeholder.id,
      },
      removed: { road, index, shownId: placeholder.id },
    }
  }
  const alignments = project.alignments.filter((r) => r.id !== id)
  const shownId = project.activeAlignmentId === id ? alignments[Math.max(0, index - 1)].id : project.activeAlignmentId
  return {
    project: { ...project, alignments, activeAlignmentId: shownId },
    removed: { road, index, shownId },
  }
}

/** The hidden stand-in for a design with no road: two points at the deleted road's ends, its template. */
function placeholderFor(road: Alignment): Alignment {
  const id = `placeholder-${road.id}`
  const ends = [road.points[0], road.points[road.points.length - 1]]
  return {
    id,
    name: 'No road yet',
    color: road.color,
    points: ends.map((point, i) => ({ id: `${id}-p${i}`, coordinate: point.coordinate, radiusM: 0 })),
    vertical: [],
    template: road.template,
    overrides: [],
  }
}

/**
 * Puts a removed road back where it was and shows it, dropping the placeholder of a design it left
 * empty. A road already back is only shown.
 */
export function restoreRoad<P extends RoadList>(project: P, removed: RemovedRoad): P {
  if (project.alignments.some((road) => road.id === removed.road.id))
    return { ...project, activeAlignmentId: removed.road.id }
  const { designPlaceholderId, ...rest } = project
  const alignments = designPlaceholderId
    ? project.alignments.filter((road) => road.id !== designPlaceholderId)
    : [...project.alignments]
  alignments.splice(Math.min(removed.index, alignments.length), 0, removed.road)
  return { ...(rest as P), alignments, activeAlignmentId: removed.road.id }
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
