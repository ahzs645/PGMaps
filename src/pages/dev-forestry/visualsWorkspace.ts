import type { TileColumnSpec, TiledWorkspaceConfig } from '@/components/ui/tiled-workspace'

/** The plan map, the eye-level road view and the viewpoint summary. */
export type VisualsPane = 'map' | 'road' | 'summary'
export type VisualsLayout = 'map-road' | 'map-road-summary' | 'map' | 'road'

/**
 * The visual-quality tool's tiled workspace. Presets describe the screen while the road view is open;
 * until it opens the road pane is withheld and its space goes to the map, and the summary waits for a
 * run (`visibleVisualsPanes`).
 */
export const VISUALS_WORKSPACE: TiledWorkspaceConfig<VisualsPane, VisualsLayout> = {
  namespace: 'visuals',
  defaultPreset: 'map-road-summary',
  panes: [
    { id: 'map', label: 'Map' },
    { id: 'road', label: 'Road view' },
    { id: 'summary', label: 'Viewpoint summary' },
  ],
  presets: [
    { id: 'map-road', label: 'Map · road view', hidden: ['summary'], thumbnail: ['row-span-2', 'row-span-2'] },
    { id: 'map-road-summary', label: 'Map · road view · summary', hidden: [], thumbnail: ['row-span-2', '', ''] },
    { id: 'map', label: 'Map only', hidden: ['road', 'summary'], thumbnail: ['col-span-2 row-span-2'] },
    { id: 'road', label: 'Road view only', hidden: ['map', 'summary'], thumbnail: ['col-span-2 row-span-2'] },
  ],
}

/** The map | (road view / summary): the same tree in every preset, so the plan map stays mounted. */
export const VISUALS_COLUMNS: TileColumnSpec<VisualsPane>[] = [
  { id: 'map-column', label: 'map', size: 1, min: 280, panes: [{ id: 'map', label: 'map', min: 200 }] },
  {
    id: 'view-column',
    label: 'view column',
    size: 1.15,
    min: 300,
    panes: [
      { id: 'road', label: 'road view', size: 1.7, min: 200 },
      { id: 'summary', label: 'viewpoint summary', size: 0.6, min: 96 },
    ],
  },
]

/**
 * The panes hidden now: those the layout hides, the road view while it is closed, and the summary
 * until a run gives it something to say. The map is the fallback when nothing else is left.
 */
export function visibleVisualsPanes(
  storedHidden: readonly VisualsPane[],
  available: { road: boolean; summary: boolean },
): VisualsPane[] {
  const hidden = VISUALS_WORKSPACE.panes
    .map((pane) => pane.id)
    .filter((id) => storedHidden.includes(id) || (id !== 'map' && !available[id]))
  return hidden.length === VISUALS_WORKSPACE.panes.length ? hidden.filter((id) => id !== 'map') : hidden
}

/** The layout picked last on this device: a preset id or `saved:<id>`. */
export const VISUALS_LAYOUT_KEY = 'pgmaps-visuals-layout'
export function readVisualsLayoutSelection(): string {
  try {
    return localStorage.getItem(VISUALS_LAYOUT_KEY) ?? VISUALS_WORKSPACE.defaultPreset
  } catch {
    return VISUALS_WORKSPACE.defaultPreset
  }
}
