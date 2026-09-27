import { describe, expect, it } from 'vitest'
import { migrateEconomicRegionShareState } from './economicRegionShareState'

describe('economic region boundary share migration', () => {
  it('keeps old census economic region links, opacity and focus on the economic region source', () => {
    const state = migrateEconomicRegionShareState({
      activeSources: ['census' as const], sourceLevels: { census: 'economicRegion' as const },
      sourceOpacities: { census: 0.3 },
      selectedId: 'census:economicRegion:5950',
      selectedPolygonFocuses: [{ id: 'census:economicRegion:5950', scope: 'census:economicRegion' }],
      searchLayers: [{ source: 'census' as const, level: 'economicRegion' as const }],
    })
    expect(state).toMatchObject({
      activeSources: ['economicRegion'], sourceLevels: { economicRegion: 'economicRegion' }, sourceOpacities: { economicRegion: 0.3 },
      selectedId: 'economicRegion:economicRegion:5950',
      selectedPolygonFocuses: [{ id: 'economicRegion:economicRegion:5950', scope: 'economicRegion:economicRegion' }],
      searchLayers: [{ source: 'economicRegion', level: 'economicRegion' }],
    })
    expect(state.sourceLevels).not.toHaveProperty('census')
  })
  it('preserves real census layers alongside economic region search results', () => {
    const state = migrateEconomicRegionShareState({
      activeSources: ['census' as const, 'economicRegion' as const],
      sourceLevels: { census: 'da' as const, economicRegion: 'economicRegion' as const },
      selectedId: 'census:da:59510158',
      searchLayers: [{ source: 'census' as const, level: 'economicRegion' as const }],
    })
    expect(state.activeSources).toEqual(['census', 'economicRegion'])
    expect(state.sourceLevels).toEqual({ census: 'da', economicRegion: 'economicRegion' })
    expect(state.selectedId).toBe('census:da:59510158')
    expect(state.searchLayers).toEqual([{ source: 'economicRegion', level: 'economicRegion' }])
  })
})
