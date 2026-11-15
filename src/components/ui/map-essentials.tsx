import { useCallback, useState } from 'react'

import { useIsMobile } from '@/hooks/useIsMobile'
import { MapCameraKeys, MapShortcutsDialog } from '@/components/ui/map-camera-keys'
import { MapContextMenu, type MapMenuPoint } from '@/components/ui/map-context-menu'
import { MapStatusBar } from '@/components/ui/map-status-bar'
import { MapWhatsHere } from '@/components/ui/map-whats-here'

/**
 * What every PGMaps map gets without asking (`docs/shared-ui.md`, **Map essentials**): the
 * right-click menu (coordinates, copy, *What's here?*, colour-vision preview), the status bar
 * (pointer coordinate, terrain elevation, zoom, bearing, pitch) and the camera keys (N, U, R, ?).
 *
 * The application's `Map` and `SharedMap` render it, so a page only meets it to switch a part off:
 * `essentials={false}` on a map that owns its camera or its right-click, or e.g.
 * `essentials={{ statusBar: false }}`. A map with `controls={null}` (an inset, a figure) leaves it
 * out unless the page asks.
 */
export interface MapEssentialsOptions {
  /** The right-click / long-press menu and its *What's here?* card. Default on. */
  contextMenu?: boolean
  /** The bottom-left readout. Default on, except on phones, which have no pointer to follow. */
  statusBar?: boolean
  /** N, U, R and ?. Default on. */
  cameraKeys?: boolean
}

export function MapEssentials({ contextMenu = true, statusBar = true, cameraKeys = true }: MapEssentialsOptions) {
  const isMobile = useIsMobile()
  const [whatsHere, setWhatsHere] = useState<MapMenuPoint | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const showShortcuts = useCallback(() => setShortcutsOpen(true), [])

  return (
    <>
      {statusBar && !isMobile && <MapStatusBar />}
      {cameraKeys && <MapCameraKeys onHelp={showShortcuts} />}
      {contextMenu && <MapContextMenu onWhatsHere={setWhatsHere} onShowShortcuts={showShortcuts} />}
      {whatsHere && (
        <MapWhatsHere key={`${whatsHere.x},${whatsHere.y}`} point={whatsHere} onClose={() => setWhatsHere(null)} />
      )}
      <MapShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  )
}

/**
 * Whether a map renders the essentials: an explicit `essentials` wins; otherwise a map that shows
 * no controls is taken for an inset or a figure and goes without.
 */
export function resolveMapEssentials(
  essentials: MapEssentialsOptions | boolean | undefined,
  controls: unknown,
): MapEssentialsOptions | null {
  if (essentials === false) return null
  if (essentials === undefined && controls === null) return null
  return essentials === true || essentials === undefined ? {} : essentials
}
