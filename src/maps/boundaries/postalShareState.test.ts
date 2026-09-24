import { describe, expect, it } from 'vitest'
import { migratePostalShareState } from './postalShareState'

describe('postal boundary share migration', () => {
  it('keeps old census FSA links, opacity and focus on the postal source', () => {
    const state = migratePostalShareState({
      activeSources: ['census' as const], sourceLevels: { census: 'fsa' as const },
      sourceOpacities: { census: 0.3 },
      selectedId: 'census:fsa:V2L',
      selectedPolygonFocuses: [{ id: 'census:fsa:V2L', scope: 'census:fsa' }],
      searchLayers: [{ source: 'census' as const, level: 'fsa' as const }],
    })
    expect(state).toMatchObject({
      activeSources: ['postal'], sourceLevels: { postal: 'fsa' }, sourceOpacities: { postal: 0.3 },
      selectedId: 'postal:fsa:V2L',
      selectedPolygonFocuses: [{ id: 'postal:fsa:V2L', scope: 'postal:fsa' }],
      searchLayers: [{ source: 'postal', level: 'fsa' }],
    })
    expect(state.sourceLevels).not.toHaveProperty('census')
  })
  it('preserves real census layers alongside postal search results', () => {
    const state = migratePostalShareState({
      activeSources: ['census' as const, 'postal' as const],
      sourceLevels: { census: 'da' as const, postal: 'postalRegion' as const },
      selectedId: 'census:da:59510158',
      searchLayers: [{ source: 'census' as const, level: 'fsa' as const }],
    })
    expect(state.activeSources).toEqual(['census', 'postal'])
    expect(state.sourceLevels).toEqual({ census: 'da', postal: 'postalRegion' })
    expect(state.selectedId).toBe('census:da:59510158')
    expect(state.searchLayers).toEqual([{ source: 'postal', level: 'fsa' }])
  })
})
