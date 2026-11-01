import type { Alignment } from './types'

export type RoadFeatureSelection =
  | {
      alignmentId: string
      kind: 'widening' | 'site' | 'assignment' | 'stratum'
      id: string
    }
  /** A station range to frame on the plan, such as a vehicle turn; drawn without a highlight. */
  | { alignmentId: string; kind: 'range'; id: string; start: number; end: number; label: string }
export type RoadSelectionRange = {
  start: number
  end: number
  label: string
  /** False frames the range without drawing over the road's detail. */
  highlight?: boolean
  maxZoom?: number
}

export function roadSelectionRange(
  alignment: Alignment,
  selection: RoadFeatureSelection | null,
): RoadSelectionRange | undefined {
  if (!selection || selection.alignmentId !== alignment.id) return
  const engineering = alignment.engineering
  if (selection.kind === 'range')
    return { start: selection.start, end: selection.end, label: selection.label, highlight: false, maxZoom: 19 }
  if (selection.kind === 'widening') {
    const item = alignment.overrides.find((x) => x.id === selection.id)
    if (item) return { start: item.start, end: item.end, label: item.name }
  } else if (selection.kind === 'site') {
    const item = engineering?.sites.find((x) => x.id === selection.id)
    if (item) return { start: item.chainage, end: item.chainage, label: item.name }
  } else if (selection.kind === 'assignment') {
    const item = engineering?.assignments.find((x) => x.id === selection.id)
    if (item)
      return {
        start: item.start,
        end: item.end,
        label: engineering?.templates.find((t) => t.id === item.templateId)?.name ?? 'Template assignment',
      }
  } else {
    const item = engineering?.strata.find((x) => x.id === selection.id)
    if (item)
      return {
        start: item.start,
        end: item.end,
        label: engineering?.materials.find((m) => m.id === item.materialId)?.name ?? 'Ground horizon',
      }
  }
}
