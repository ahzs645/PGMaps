/**
 * Names an edit by comparing the project before and after it, for the undo history: "Spur A: moved
 * point 3", "Spur A: PVI 2 moved to 0+412", "Deleted road Spur B", "Issue stamp". Projects are
 * updated immutably, so an unchanged part keeps its object and costs one comparison. No DOM or
 * network access.
 */
import type { Alignment, RoadProject } from './types'
import { formatStation } from './verticalStandards'

const ALIGNMENT_FIELDS: Partial<Record<keyof Alignment, string>> = {
  name: 'renamed',
  color: 'colour',
  template: 'section template',
  overrides: 'widenings',
  engineering: 'engineering inputs',
  crossingRecords: 'crossing records',
  verticalStandards: 'vertical standards',
  verticalControls: 'vertical controls',
  verticalAlternatives: 'profile alternatives',
  activeVerticalAlternativeId: 'active profile',
  verticalAlternativeCostMode: 'profile cost mode',
  curveDesign: 'curve design',
  sightDistance: 'sight distance',
  vehicleCheck: 'vehicle check',
  fullCostRecord: 'complete-access record',
  networkEntryRoadId: 'network entry',
  routeSearch: 'route search record',
}

const PROJECT_FIELDS: Partial<Record<keyof RoadProject, string>> = {
  name: 'Renamed project',
  terrain: 'Terrain',
  settings: 'Design settings',
  rateEvidence: 'Rate sources',
  standards: 'Design standards',
  issue: 'Issue stamp',
  vehicleLibrary: 'Vehicle library',
  reportSettings: 'Sheet setup',
  routeSearch: 'Route search settings',
  haulDestination: 'Haul destination',
  networkPlanning: 'Network planning',
  totalCostPlanning: 'Complete-access inputs',
  drainage: 'Drainage inputs',
  provincialStreamData: 'Provincial stream data',
  sharedCrossingCosts: 'Shared crossing costs',
  context: 'Map layers',
  cables: 'D-lines',
  profiles: 'Terrain profiles',
  surveyBooks: 'Survey books',
  notes: 'Map notes',
  reference: 'Reference features',
  cutblockBuffers: 'Cutblock buffers',
  accessHistory: 'Access history',
  harvestHistoryYear: 'Harvest year',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What changed in the road's horizontal points: added, removed, moved or re-curved. */
function pointsChange(before: Alignment['points'], after: Alignment['points']): string {
  if (after.length > before.length) {
    const added = after.length - before.length
    const index = after.findIndex((p) => !before.some((q) => q.id === p.id))
    return added === 1 && index >= 0 ? `added point ${index + 1}` : `added ${plural(added, 'point')}`
  }
  if (after.length < before.length) {
    const removed = before.length - after.length
    const index = before.findIndex((p) => !after.some((q) => q.id === p.id))
    return removed === 1 && index >= 0 ? `removed point ${index + 1}` : `removed ${plural(removed, 'point')}`
  }
  const moved: number[] = [],
    curved: number[] = []
  after.forEach((p, i) => {
    const q = before[i]
    if (p === q) return
    if (p.coordinate[0] !== q.coordinate[0] || p.coordinate[1] !== q.coordinate[1]) moved.push(i)
    else if (p.radiusM !== q.radiusM || (p.spiralM ?? 0) !== (q.spiralM ?? 0)) curved.push(i)
  })
  if (moved.length === 1) return `moved point ${moved[0] + 1}`
  if (moved.length > 1)
    return moved.length === after.length ? 'moved the line' : `moved ${plural(moved.length, 'point')}`
  if (curved.length === 1) return `curve at point ${curved[0] + 1}`
  if (curved.length > 1) return `${plural(curved.length, 'curve')}`
  return 'horizontal points'
}

/** What changed in the profile's PVIs. */
function verticalChange(before: Alignment['vertical'], after: Alignment['vertical']): string {
  if (after.length > before.length) {
    const index = after.findIndex((p) => !before.some((q) => q.id === p.id))
    return after.length - before.length === 1 && index >= 0
      ? `added PVI ${index + 1} at ${formatStation(after[index].chainage)}`
      : `added ${plural(after.length - before.length, 'PVI')}`
  }
  if (after.length < before.length) {
    const index = before.findIndex((p) => !after.some((q) => q.id === p.id))
    return before.length - after.length === 1 && index >= 0
      ? `removed PVI ${index + 1}`
      : `removed ${plural(before.length - after.length, 'PVI')}`
  }
  const changed = after.flatMap((p, i) => (p === before[i] ? [] : [i]))
  if (changed.length === 1) {
    const i = changed[0],
      p = after[i],
      q = before[i]
    if (p.chainage !== q.chainage || p.elevation !== q.elevation)
      return `PVI ${i + 1} moved to ${formatStation(p.chainage)}`
    if (p.curveLength !== q.curveLength) return `PVI ${i + 1} curve length`
    return `PVI ${i + 1}`
  }
  return changed.length ? `profile, ${plural(changed.length, 'PVI')}` : 'profile'
}

/**
 * Whether the saved profile alternatives changed. Every edit re-copies the active one from the road's
 * own profile (`snapshotActiveVerticalAlternative`), so that copy is compared through the road's
 * fields, and only the list and the others by identity.
 */
function alternativesChanged(before: Alignment, after: Alignment): boolean {
  const a = before.verticalAlternatives ?? [],
    b = after.verticalAlternatives ?? []
  if (a.length !== b.length) return true
  return b.some(
    (v, i) => v.id !== a[i].id || v.name !== a[i].name || (v.id !== after.activeVerticalAlternativeId && v !== a[i]),
  )
}

function alignmentChanges(before: Alignment, after: Alignment): string[] {
  const changes: string[] = []
  if (before.points !== after.points) changes.push(pointsChange(before.points, after.points))
  if (before.vertical !== after.vertical) changes.push(verticalChange(before.vertical, after.vertical))
  for (const key of Object.keys(ALIGNMENT_FIELDS) as (keyof Alignment)[])
    if (key === 'verticalAlternatives' ? alternativesChanged(before, after) : before[key] !== after[key])
      changes.push(key === 'name' ? `renamed to ${after.name}` : (ALIGNMENT_FIELDS[key] as string))
  return changes
}

const join = (changes: string[]) =>
  changes.length <= 2 ? changes.join(' and ') : `${changes[0]} and ${plural(changes.length - 1, 'other change')}`

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A short name for the edit that turned `before` into `after`. */
export function describeProjectChange(before: RoadProject, after: RoadProject): string {
  if (before === after) return 'No change'
  const parts: string[] = []
  const beforeIds = new Map(before.alignments.map((a) => [a.id, a]))
  const afterIds = new Map(after.alignments.map((a) => [a.id, a]))
  const added = after.alignments.filter((a) => !beforeIds.has(a.id))
  const removed = before.alignments.filter((a) => !afterIds.has(a.id))
  if (added.length === 1) parts.push(`Added road ${added[0].name}`)
  else if (added.length > 1) parts.push(`Added ${plural(added.length, 'road')}`)
  if (removed.length === 1) parts.push(`Deleted road ${removed[0].name}`)
  else if (removed.length > 1) parts.push(`Deleted ${plural(removed.length, 'road')}`)
  if (before.alignments !== after.alignments) {
    const changed = after.alignments.filter((a) => {
      const old = beforeIds.get(a.id)
      return old && old !== a && alignmentChanges(old, a).length
    })
    if (changed.length === 1) {
      const road = changed[0]
      parts.push(`${road.name}: ${join(alignmentChanges(beforeIds.get(road.id)!, road))}`)
    } else if (changed.length > 1) parts.push(`Edited ${plural(changed.length, 'road')}`)
    const order = (list: Alignment[]) =>
      list
        .filter((a) => beforeIds.has(a.id) && afterIds.has(a.id))
        .map((a) => a.id)
        .join('\n')
    if (!added.length && !removed.length && !changed.length && order(before.alignments) !== order(after.alignments))
      parts.push('Reordered roads')
  }
  if (before.activeAlignmentId !== after.activeAlignmentId && !added.length && !removed.length) {
    const road = afterIds.get(after.activeAlignmentId)
    if (road) parts.push(`Switched to ${road.name}`)
  }
  for (const key of Object.keys(PROJECT_FIELDS) as (keyof RoadProject)[])
    if (before[key] !== after[key]) parts.push(PROJECT_FIELDS[key] as string)
  if (!parts.length) return 'Edited the project'
  return sentence(parts.length <= 2 ? parts.join('; ') : `${parts[0]}; ${plural(parts.length - 1, 'other change')}`)
}
