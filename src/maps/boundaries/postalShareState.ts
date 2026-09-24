import type { BoundarySource, RegionLevel } from '@/lib/studyArea/types'

type Focus = { id: string; scope: string }
interface PostalShareFields {
  activeSources: BoundarySource[]
  sourceLevels: Partial<Record<BoundarySource, RegionLevel>>
  sourceOpacities?: Partial<Record<BoundarySource, number>>
  searchLayers?: Array<{ source: BoundarySource; level: RegionLevel }>
  selectedPolygonFocuses?: Focus[]
  isolatedPolygonFocuses?: Focus[]
  hiddenPolygonFocuses?: Focus[]
  selectedId?: string | null
}

/** Preserve URLs saved before FSA moved out of the census source. */
export function migratePostalShareState<T extends PostalShareFields>(state: T): T {
  const legacy = state.sourceLevels?.census === 'fsa'
  const migrateId = (id: string) => id.replace(/^census:fsa(?=:|$)/, 'postal:fsa')
  const migrateFocuses = (focuses: Focus[] | undefined) => Array.isArray(focuses)
    ? focuses.map(focus => focus && typeof focus.id === 'string' && typeof focus.scope === 'string'
      ? { ...focus, id: migrateId(focus.id), scope: migrateId(focus.scope) }
      : focus)
    : focuses
  const levels = { ...state.sourceLevels }
  const opacities = { ...state.sourceOpacities }
  if (legacy) {
    levels.postal ??= 'fsa'
    delete levels.census
    opacities.postal ??= opacities.census
    delete opacities.census
  }
  return {
    ...state,
    activeSources: legacy && Array.isArray(state.activeSources)
      ? [...new Set(state.activeSources.map(source => source === 'census' ? 'postal' as const : source))]
      : state.activeSources,
    sourceLevels: levels,
    sourceOpacities: opacities,
    searchLayers: Array.isArray(state.searchLayers) ? state.searchLayers.map(layer =>
      layer?.source === 'census' && layer.level === 'fsa' ? { ...layer, source: 'postal' as const } : layer,
    ) : state.searchLayers,
    selectedId: typeof state.selectedId === 'string' ? migrateId(state.selectedId) : state.selectedId,
    selectedPolygonFocuses: migrateFocuses(state.selectedPolygonFocuses),
    isolatedPolygonFocuses: migrateFocuses(state.isolatedPolygonFocuses),
    hiddenPolygonFocuses: migrateFocuses(state.hiddenPolygonFocuses),
  }
}
