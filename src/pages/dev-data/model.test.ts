import { describe, expect, it } from 'vitest'
import { orderedGroups, swipePair, workspaceReducer, type DataLayer, type WorkspaceState } from './model'

function layer(id: string, group: string, visible = true): DataLayer {
  return {
    id,
    label: id,
    geometry: 'fill',
    group,
    source: { kind: 'upload', fileName: `${id}.geojson`, rowCount: 1, skipped: 0 },
    attributes: [],
    style: null,
    stylePreset: { type: 'simple', color: '#000000' },
    opacity: 0.5,
    visible,
    showInLegend: true,
    filter: null,
  }
}

const base: WorkspaceState = {
  layers: [layer('a', 'Boundaries'), layer('b', 'Boundaries', false), layer('c', 'Parks')],
  groups: [{ id: 'Boundaries', mode: 'one' }],
}

const visibleIds = (state: WorkspaceState) => state.layers.filter((item) => item.visible).map((item) => item.id)

describe('workspaceReducer', () => {
  it('shows one layer at a time in a one-at-a-time group', () => {
    const next = workspaceReducer(base, { type: 'setVisible', id: 'b', visible: true })
    expect(visibleIds(next)).toEqual(['b', 'c'])
  })

  it('lets a toggle group show several layers', () => {
    const state = workspaceReducer(base, { type: 'setGroupMode', group: 'Boundaries', mode: 'all' })
    expect(visibleIds(workspaceReducer(state, { type: 'setVisible', id: 'b', visible: true }))).toEqual(['a', 'b', 'c'])
  })

  it('keeps only the first visible layer when a group switches to one at a time', () => {
    const state: WorkspaceState = { layers: [layer('a', 'G'), layer('b', 'G'), layer('c', 'G', false)], groups: [] }
    expect(visibleIds(workspaceReducer(state, { type: 'setGroupMode', group: 'G', mode: 'one' }))).toEqual(['a'])
  })

  it('switches an added layer on in place of its one-at-a-time siblings', () => {
    const next = workspaceReducer(base, { type: 'add', layer: layer('d', 'Boundaries') })
    expect(visibleIds(next)).toEqual(['c', 'd'])
    expect(workspaceReducer(next, { type: 'add', layer: layer('d', 'Boundaries') })).toBe(next)
  })

  it('toggles legend categories into a filter and clears it when all are back', () => {
    const all = ['x', 'y', 'z']
    let state = workspaceReducer(base, { type: 'toggleCategory', id: 'a', column: 'Kind', value: 'y', allValues: all })
    expect(state.layers[0].filter).toEqual({ column: 'Kind', values: ['x', 'z'] })
    state = workspaceReducer(state, { type: 'toggleCategory', id: 'a', column: 'Kind', value: 'y', allValues: all })
    expect(state.layers[0].filter).toBeNull()
  })

  it('clamps opacity', () => {
    expect(workspaceReducer(base, { type: 'setOpacity', id: 'a', opacity: 3 }).layers[0].opacity).toBe(1)
  })
})

describe('groups and swipe', () => {
  it('orders groups by their first layer', () => {
    expect(orderedGroups(base).map((group) => [group.id, group.mode])).toEqual([
      ['Boundaries', 'one'],
      ['Parks', 'all'],
    ])
  })

  it('pairs the first two visible layers of a swipe group', () => {
    expect(swipePair(base)).toBeNull()
    const state = workspaceReducer(
      workspaceReducer(base, { type: 'setGroupMode', group: 'Boundaries', mode: 'swipe' }),
      { type: 'setVisible', id: 'b', visible: true },
    )
    const pair = swipePair(state)
    expect(pair?.left.id).toBe('a')
    expect(pair?.right.id).toBe('b')
  })
})
