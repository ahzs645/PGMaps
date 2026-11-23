import type { TileColumnSpec, TiledWorkspaceConfig } from '@/components/ui/tiled-workspace'

/** The plan map, the patch classes over time, and the period table. */
export type PlanningPane = 'map' | 'trend' | 'table'
export type PlanningPreset = 'map-trend' | 'map' | 'all' | 'results'

export const PLANNING_WORKSPACE: TiledWorkspaceConfig<PlanningPane, PlanningPreset> = {
  namespace: 'block-planning',
  defaultPreset: 'map-trend',
  panes: [
    { id: 'map', label: 'Map' },
    { id: 'trend', label: 'Patch classes over time' },
    { id: 'table', label: 'Periods and schedules' },
  ],
  presets: [
    { id: 'map-trend', label: 'Map · classes over time', hidden: ['table'], thumbnail: ['row-span-2', 'row-span-2'] },
    { id: 'all', label: 'Map · classes · table', hidden: [], thumbnail: ['row-span-2', '', ''] },
    { id: 'map', label: 'Map only', hidden: ['trend', 'table'], thumbnail: ['col-span-2 row-span-2'] },
    { id: 'results', label: 'Classes · table', hidden: ['map'], thumbnail: ['row-span-2', 'row-span-2'] },
  ],
}

/** Map | (classes over time / table): one tree in every preset, so the map stays mounted. */
export const PLANNING_COLUMNS: TileColumnSpec<PlanningPane>[] = [
  { id: 'map-column', label: 'map', size: 1.2, min: 280, panes: [{ id: 'map', label: 'map', min: 220 }] },
  {
    id: 'results-column',
    label: 'results column',
    size: 1,
    min: 320,
    panes: [
      { id: 'trend', label: 'patch classes over time', size: 1.4, min: 220 },
      { id: 'table', label: 'periods and schedules', size: 1, min: 140 },
    ],
  },
]
