/** Presentation of saved assertions; a coloured line never establishes historical use. */
import { assessHistoricalPath, assessHistoricalStructures } from './accessHistory'
import type { HistoricalAccessState, HistoricalRelationship } from './accessHistoryTypes'
import type { PlanLegendSection } from './planLegendModel'
import type { ContextFeature } from './types'

export const HISTORY_RELATIONSHIP_STYLES: Record<HistoricalRelationship, { label: string; color: string }> = {
  proximity: { label: 'Nearby only', color: '#b45309' },
  'inferred-access': { label: 'Inferred access', color: '#7c3aed' },
  'planned-access': { label: 'Documented plan', color: '#2563eb' },
  'documented-use': { label: 'Documented use', color: '#15803d' },
  rejected: { label: 'Rejected association', color: '#71717a' },
}
export const HISTORY_UNRESOLVED_COLOR = '#b45309'
export const HISTORY_CONFLICT_COLOR = '#be123c'
const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })

export function historicalMapFeatures(context: readonly ContextFeature[], state?: HistoricalAccessState) {
  const selected = state?.paths.find((path) => path.id === state.selectedPathId)
  // A saved 2010 path and its assets stay at 2010 when the next trace date is edited to 2022.
  const asOf = selected?.settings.asOf ?? state?.settings.asOf ?? ''
  const assessment = selected && state ? assessHistoricalPath(selected, state, context) : null
  const style = selected ? HISTORY_RELATIONSHIP_STYLES[selected.relationship] : null
  const status = assessment?.stale
    ? 'stale'
    : assessment?.connectivity === 'unresolved'
      ? 'unresolved'
      : (assessment?.temporalStatus ?? 'unknown')
  const color =
    status === 'stale' || status === 'unresolved' || status === 'unknown'
      ? HISTORY_UNRESOLVED_COLOR
      : status === 'conflict' || status === 'contradicted'
        ? HISTORY_CONFLICT_COLOR
        : (style?.color ?? '#7c3aed')
  const structureAssessments = new Map(
    (state ? assessHistoricalStructures(state, context, asOf) : []).map((item) => [item.structureId, item]),
  )
  const route = collection(
    selected
      ? [
          {
            type: 'Feature',
            id: selected.id,
            geometry: { type: 'LineString', coordinates: selected.coordinates },
            properties: {
              id: selected.id,
              name: context.find((feature) => feature.id === selected.blockId)?.name ?? selected.blockId,
              relationship: style!.label,
              date: asOf,
              status,
              color,
              lengthM: selected.lengthM,
              roadCount: selected.roadIds.length,
              structureCount: selected.structureIds.length,
              explanation:
                assessment?.reasons.join(' ') || 'Date-compatible route candidate. Use requires separate evidence.',
            },
          },
        ]
      : [],
  )
  const structures = collection(
    (state?.structures ?? []).map((structure) => {
      const assessment = structureAssessments.get(structure.id)!
      const status = assessment.binding === 'unresolved' ? 'unresolved' : assessment.status
      return {
        type: 'Feature',
        id: structure.id,
        geometry: { type: 'Point', coordinates: structure.coordinate },
        properties: {
          id: structure.id,
          name: structure.name,
          kind: structure.kind,
          crossingSiteId: structure.crossingSiteId ?? 'Unknown',
          structureId: structure.structureId ?? 'Unknown',
          sourceRowId: structure.sourceRowId ?? 'Unknown',
          date: asOf,
          onSelectedRoute: !!selected?.structureIds.includes(structure.id),
          status,
          color:
            status === 'conflict' || status === 'contradicted'
              ? HISTORY_CONFLICT_COLOR
              : status === 'unknown' || status === 'unresolved'
                ? HISTORY_UNRESOLVED_COLOR
                : '#0f766e',
          attachment: structure.attachment,
          explanation: assessment.reasons.join(' '),
        },
      }
    }),
  )
  const legend: PlanLegendSection[] =
    !state || (!selected && !state.structures.length)
      ? []
      : [
          {
            id: 'historical-access',
            title: `Historical access · ${asOf}`,
            entries: [
              ...(selected
                ? [
                    {
                      id: 'history-selected-route',
                      label: `${style!.label}${status === 'compatible' ? '' : ` · ${status}`} · ${asOf}`,
                      color,
                      shape: 'dashed-line' as const,
                      dash: [2, 1] as [number, number],
                    },
                  ]
                : []),
              ...(structures.features.length
                ? [
                    {
                      id: 'history-structures',
                      label:
                        'Mapped structures · teal: date compatible, amber: unresolved, red: conflict or unavailable',
                      color: '#0f766e',
                      shape: 'circle' as const,
                    },
                  ]
                : []),
            ],
          },
        ]
  return { route, structures, legend, asOf, status }
}
