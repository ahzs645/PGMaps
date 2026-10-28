/**
 * The /dev/data workspace as plain data: which layers are on the map, in which
 * groups, how each group shows its layers, and each layer's style, opacity and
 * category filter. `workspaceReducer` is the only way it changes, which keeps
 * the group rules (one at a time, swipe) testable without a map.
 */
import type { AttributeOverride } from '@/lib/featureAttributes'
import type { LayerGeometry, LayerStyle } from '@/lib/layerStyle'
import type { CatalogEntry, StylePreset } from './catalog'

/** How a group shows its layers, after Felt's layer-group `visibilityInteraction`. */
export type GroupMode = 'all' | 'one' | 'swipe'

export const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  all: 'Toggle layers on and off',
  one: 'Show one layer at a time',
  swipe: 'Swipe between two layers',
}

export type LayerSource =
  | { kind: 'catalog'; entry: CatalogEntry }
  | { kind: 'upload'; fileName: string; rowCount: number; skipped: number }

/** Features shown: those whose `column` value is one of `values`. */
export interface CategoryFilter {
  column: string
  values: string[]
}

export interface DataLayer {
  id: string
  label: string
  description?: string
  geometry: LayerGeometry
  group: string
  source: LayerSource
  nameKey?: string
  attributes: AttributeOverride[]
  popupKeys?: string[]
  /** Set once someone edits the style; until then `stylePreset` decides it from the data. */
  style: LayerStyle | null
  stylePreset: StylePreset
  opacity: number
  visible: boolean
  showInLegend: boolean
  filter: CategoryFilter | null
}

export interface LayerGroup {
  id: string
  mode: GroupMode
}

export interface WorkspaceState {
  layers: DataLayer[]
  groups: LayerGroup[]
}

export type WorkspaceAction =
  | { type: 'add'; layer: DataLayer }
  | { type: 'remove'; id: string }
  | { type: 'setVisible'; id: string; visible: boolean }
  | { type: 'setGroupMode'; group: string; mode: GroupMode }
  | { type: 'setStyle'; id: string; style: LayerStyle }
  | { type: 'setOpacity'; id: string; opacity: number }
  | { type: 'setShowInLegend'; id: string; show: boolean }
  | { type: 'setFilter'; id: string; filter: CategoryFilter | null }
  | { type: 'toggleCategory'; id: string; column: string; value: string; allValues: string[] }

function updateLayer(state: WorkspaceState, id: string, update: (layer: DataLayer) => DataLayer): WorkspaceState {
  return { ...state, layers: state.layers.map((layer) => (layer.id === id ? update(layer) : layer)) }
}

export function groupMode(state: WorkspaceState, group: string): GroupMode {
  return state.groups.find((candidate) => candidate.id === group)?.mode ?? 'all'
}

/** Groups in the order their first layer was added. */
export function orderedGroups(state: WorkspaceState): Array<LayerGroup & { layers: DataLayer[] }> {
  const order: string[] = []
  for (const layer of state.layers) if (!order.includes(layer.group)) order.push(layer.group)
  return order.map((id) => ({
    id,
    mode: groupMode(state, id),
    layers: state.layers.filter((layer) => layer.group === id),
  }))
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'add': {
      if (state.layers.some((layer) => layer.id === action.layer.id)) return state
      const next = { ...state, layers: [...state.layers, action.layer] }
      // A layer joining a one-at-a-time group arrives switched on and takes over.
      return action.layer.visible && groupMode(state, action.layer.group) === 'one'
        ? workspaceReducer(next, { type: 'setVisible', id: action.layer.id, visible: true })
        : next
    }
    case 'remove':
      return { ...state, layers: state.layers.filter((layer) => layer.id !== action.id) }
    case 'setVisible': {
      const target = state.layers.find((layer) => layer.id === action.id)
      if (!target) return state
      const exclusive = action.visible && groupMode(state, target.group) === 'one'
      return {
        ...state,
        layers: state.layers.map((layer) => {
          if (layer.id === action.id) return { ...layer, visible: action.visible }
          if (exclusive && layer.group === target.group && layer.visible) return { ...layer, visible: false }
          return layer
        }),
      }
    }
    case 'setGroupMode': {
      const groups = state.groups.some((group) => group.id === action.group)
        ? state.groups.map((group) => (group.id === action.group ? { ...group, mode: action.mode } : group))
        : [...state.groups, { id: action.group, mode: action.mode }]
      let next: WorkspaceState = { ...state, groups }
      if (action.mode === 'one') {
        // Keep the first visible layer; hide the rest.
        const first = state.layers.find((layer) => layer.group === action.group && layer.visible)
        if (first) next = workspaceReducer(next, { type: 'setVisible', id: first.id, visible: true })
      }
      return next
    }
    case 'setStyle':
      return updateLayer(state, action.id, (layer) => ({ ...layer, style: action.style }))
    case 'setOpacity':
      return updateLayer(state, action.id, (layer) => ({ ...layer, opacity: Math.min(1, Math.max(0, action.opacity)) }))
    case 'setShowInLegend':
      return updateLayer(state, action.id, (layer) => ({ ...layer, showInLegend: action.show }))
    case 'setFilter':
      return updateLayer(state, action.id, (layer) => ({ ...layer, filter: action.filter }))
    case 'toggleCategory':
      return updateLayer(state, action.id, (layer) => {
        const current = layer.filter?.column === action.column ? layer.filter.values : action.allValues
        const values = current.includes(action.value)
          ? current.filter((value) => value !== action.value)
          : [...current, action.value]
        const everything = action.allValues.every((value) => values.includes(value))
        return { ...layer, filter: everything ? null : { column: action.column, values } }
      })
  }
}

/**
 * The two layers a swipe compares: the first group in swipe mode with at least
 * two layers switched on. The left map shows everything but `right`; the right
 * map shows everything but `left`.
 */
export function swipePair(state: WorkspaceState): { group: string; left: DataLayer; right: DataLayer } | null {
  for (const group of orderedGroups(state)) {
    if (group.mode !== 'swipe') continue
    const shown = group.layers.filter((layer) => layer.visible)
    if (shown.length >= 2) return { group: group.id, left: shown[0], right: shown[1] }
  }
  return null
}
