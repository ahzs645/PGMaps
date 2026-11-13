import type { ReactNode } from 'react'
import {
  TiledWorkspace,
  tilePaneKey,
  tilePanelsEdited,
  tilePanelsKey,
  useTilePanels,
  type TileColumnSpec,
  type TiledWorkspaceConfig,
} from '@/components/ui/tiled-workspace'

export type RoadLayout = 'linked' | 'engineering' | 'pegging' | 'split' | 'plan'
export type RoadPaneId = 'plan' | 'profile' | 'detail' | 'data'

const FOUR_PANES: RoadPaneId[] = ['plan', 'profile', 'detail', 'data']
const THREE_PANES: RoadPaneId[] = ['plan', 'profile', 'detail']

/** The road designer's tiled workspace: its panes, presets and storage names. */
export const ROAD_WORKSPACE: TiledWorkspaceConfig<RoadPaneId, RoadLayout> = {
  namespace: 'road',
  defaultPreset: 'linked',
  panes: [
    { id: 'plan', label: 'Plan' },
    { id: 'profile', label: 'Profile' },
    { id: 'detail', label: 'Detail view' },
    { id: 'data', label: 'Data' },
  ],
  // Each thumbnail draws its preset's real arrangement on a two-by-two grid.
  presets: [
    { id: 'linked', label: 'Linked overview', panes: THREE_PANES, hidden: [], thumbnail: ['row-span-2', '', ''] },
    {
      id: 'split',
      label: 'Two panes · plan & profile',
      panes: THREE_PANES,
      hidden: ['detail'],
      thumbnail: ['row-span-2', 'row-span-2'],
    },
    {
      id: 'plan',
      label: 'Map only',
      panes: THREE_PANES,
      hidden: ['profile', 'detail'],
      thumbnail: ['col-span-2 row-span-2'],
    },
    {
      id: 'engineering',
      label: 'Plan · profile · section · data',
      panes: FOUR_PANES,
      hidden: [],
      thumbnail: ['', '', '', ''],
    },
    {
      id: 'pegging',
      label: 'Plan · profile · section · pegging',
      panes: FOUR_PANES,
      hidden: [],
      thumbnail: ['', '', '', ''],
    },
  ],
}

export const ROAD_LAYOUT_OPTIONS: { value: RoadLayout; label: string }[] = ROAD_WORKSPACE.presets.map((preset) => ({
  value: preset.id,
  label: preset.label,
}))
export const ROAD_PANEL_OPTIONS = ROAD_WORKSPACE.panes

/** A saved layout copies its split sizes and panel corner sizes under its own id. */
export const roadPaneKey = (storageId: string, split: string) => tilePaneKey('road', storageId, split)
export const roadPanelsKey = (storageId: string) => tilePanelsKey('road', storageId)

const hasData = (layout: RoadLayout) => layout === 'engineering' || layout === 'pegging'

/** (plan / data) | (profile / detail), with no data pane in the three-pane layouts. */
function roadColumns(layout: RoadLayout, data: boolean): TileColumnSpec<RoadPaneId>[] {
  const linked = !hasData(layout) || !data
  return [
    {
      id: 'plan-column',
      label: linked ? 'plan' : 'plan column',
      storageName: 'plan-data',
      size: linked ? 1.05 : 1,
      min: 300,
      panes: [
        { id: 'plan', label: 'plan', size: 1.1, min: 200, stackedHeight: 440 },
        ...(linked ? [] : [{ id: 'data' as const, label: 'data', size: 0.9, min: 160, stackedHeight: 360 }]),
      ],
    },
    {
      id: 'views',
      label: 'view column',
      size: 1,
      min: 320,
      panes: [
        { id: 'profile', label: 'profile', size: 0.9, min: 170, stackedHeight: 430 },
        { id: 'detail', label: 'detail view', size: 1, min: 200, stackedHeight: 520 },
      ],
    },
  ]
}

/**
 * The connected views on the shared `TiledWorkspace`. Every boundary drags and each layout remembers
 * its own sizes. The tree has the same shape in every layout, so switching layouts keeps the plan's
 * map mounted.
 */
export function RoadPaneLayout({
  layout,
  plan,
  profile,
  detail,
  data,
  storageId = layout,
  hidden = [],
  focusedPane,
  onFocusedPaneChange,
  windowControls,
}: {
  layout: RoadLayout
  hidden?: RoadPaneId[]
  /** Small workspaces show one view at a time without unmounting the others. */
  focusedPane?: RoadPaneId
  onFocusedPaneChange?: (pane: RoadPaneId) => void
  windowControls?: 'inline' | 'external'
  /** Where pane sizes are remembered: the preset id, or a saved layout's own id. */
  storageId?: string
  plan: ReactNode
  profile: ReactNode
  detail: ReactNode
  data: ReactNode
}) {
  return (
    <TiledWorkspace
      columns={roadColumns(layout, !!data)}
      contents={{ plan, profile, detail, data }}
      hidden={hidden}
      focusedPane={focusedPane}
      onFocusedPaneChange={onFocusedPaneChange}
      windowControls={windowControls}
      storageKey={(split) => roadPaneKey(storageId, split)}
      data-testid="road-connected-layout"
      data-layout={layout}
    />
  )
}

/** The panels a preset hides. Picking the preset always restores exactly this. */
export const presetHiddenPanels = (layout: RoadLayout): RoadPaneId[] => [
  ...(ROAD_WORKSPACE.presets.find((preset) => preset.id === layout)?.hidden ?? []),
]
/** Whether the visible panels no longer match the preset; `data` only exists in the four-pane layouts. */
export const panelsEdited = (layout: RoadLayout, hidden: readonly RoadPaneId[]) =>
  tilePanelsEdited(ROAD_WORKSPACE, layout, hidden)
export const useRoadPanels = (storageId: string, layout: RoadLayout) => useTilePanels(ROAD_WORKSPACE, storageId, layout)
