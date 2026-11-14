import {
  TileLayoutPicker,
  readSavedTileLayouts,
  resolveTileLayout,
  type SavedTileLayout,
} from '@/components/ui/tile-layout-picker'
import { ROAD_WORKSPACE, type RoadLayout, type RoadPaneId } from './RoadPaneLayout'
import type { PanelWindowLayout } from '@pgmaps/geo-toolkit/ui/panel-window-layout'

/** A named screen layout: one of the preset arrangements with its own remembered pane sizes. */
export type SavedLayout = SavedTileLayout<RoadLayout>

export const readSavedLayouts = (): SavedLayout[] => readSavedTileLayouts(ROAD_WORKSPACE)

/** A selection is a preset id or `saved:<id>`; sizes live under the preset id or `saved-<id>`. */
export const resolveLayout = (selection: string, saved: SavedLayout[]) =>
  resolveTileLayout(ROAD_WORKSPACE, selection, saved)

/** The shared layout picker over the road designer's presets. */
export function LayoutPicker(props: {
  selection: string
  hiddenPanels: RoadPaneId[]
  compact?: boolean
  showButtonLabel?: boolean
  size?: 'default' | 'ribbon' | 'toolbar'
  onHiddenPanels: (hidden: RoadPaneId[]) => void
  onSelect: (selection: string, saved?: SavedLayout[]) => void
  saved: SavedLayout[]
  onSaved: (layouts: SavedLayout[]) => void
  portalContainer?: HTMLElement | null
  defaultWindows?: readonly PanelWindowLayout[]
}) {
  return (
    <TileLayoutPicker
      {...props}
      config={ROAD_WORKSPACE}
      selectLabel="Road view layout"
      dialogTestId="road-layouts-dialog"
    />
  )
}
