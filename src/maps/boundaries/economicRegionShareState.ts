import type { BoundarySource, RegionLevel } from '@/lib/studyArea/types'

type Focus = { id: string; scope: string }
interface EconomicRegionShareFields {
  activeSources: BoundarySource[]
  sourceLevels: Partial<Record<BoundarySource, RegionLevel>>
  sourceOpacities?: Partial<Record<BoundarySource, number>>
  searchLayers?: Array<{ source: BoundarySource; level: RegionLevel }>
  selectedPolygonFocuses?: Focus[]
  isolatedPolygonFocuses?: Focus[]
  hiddenPolygonFocuses?: Focus[]
  selectedId?: string | null
}

/** Preserve URLs saved before economic regions moved out of the census source. */
export function migrateEconomicRegionShareState<T extends EconomicRegionShareFields>(state: T): T {
  const legacy = state.sourceLevels?.census === 'economicRegion'
  const migrateId = (id: string) => id.replace(/^census:economicRegion(?=:|$)/, 'economicRegion:economicRegion')
  const migrateFocuses = (focuses: Focus[] | undefined) => Array.isArray(focuses)
    ? focuses.map(focus => focus && typeof focus.id === 'string' && typeof focus.scope === 'string'
      ? { ...focus, id: migrateId(focus.id), scope: migrateId(focus.scope) }
      : focus)
    : focuses
  const levels = { ...state.sourceLevels }
  const opacities = { ...state.sourceOpacities }
  if (legacy) {
    levels.economicRegion ??= 'economicRegion'
    delete levels.census
    opacities.economicRegion ??= opacities.census
    delete opacities.census
  }
  return {
    ...state,
    activeSources: legacy && Array.isArray(state.activeSources)
      ? [...new Set(state.activeSources.map(source => source === 'census' ? 'economicRegion' as const : source))]
      : state.activeSources,
    sourceLevels: levels,
    sourceOpacities: opacities,
    searchLayers: Array.isArray(state.searchLayers) ? state.searchLayers.map(layer =>
      layer?.source === 'census' && layer.level === 'economicRegion' ? { ...layer, source: 'economicRegion' as const } : layer,
    ) : state.searchLayers,
    selectedId: typeof state.selectedId === 'string' ? migrateId(state.selectedId) : state.selectedId,
    selectedPolygonFocuses: migrateFocuses(state.selectedPolygonFocuses),
    isolatedPolygonFocuses: migrateFocuses(state.isolatedPolygonFocuses),
    hiddenPolygonFocuses: migrateFocuses(state.hiddenPolygonFocuses),
  }
}
