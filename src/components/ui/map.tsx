import { useWorkspace, WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
// Application adapter keeps the existing next-themes behavior.
import { forwardRef } from 'react'
import { useTheme } from 'next-themes'
import { usePaneResizing } from './pane-resize'
import { MapEssentials, resolveMapEssentials, type MapEssentialsOptions } from './map-essentials'
import { Map as ToolkitMap, type MapProps as ToolkitMapProps, type MapRef } from '@pgmaps/geo-toolkit/map/map'
export * from '@pgmaps/geo-toolkit/map/map'

export type MapProps = ToolkitMapProps & {
  /**
   * The right-click menu, status bar and camera keys every map gets (`map-essentials.tsx`).
   * `false` leaves them all out; an object switches single parts off. A map with
   * `controls={null}` goes without unless this is given.
   */
  essentials?: MapEssentialsOptions | boolean
}

export const Map = forwardRef<MapRef, MapProps>(function Map({ essentials, ...props }, ref) {
  const { resolvedTheme, forcedTheme } = useTheme()
  const theme = props.theme ?? ((forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light')
  const workspace = useWorkspace()
  const resizing = usePaneResizing()
  const parts = resolveMapEssentials(essentials, props.controls)
  const content = (
    <ToolkitMap {...props} deferResize={props.deferResize ?? resizing} theme={theme} ref={ref}>
      {props.children}
      {parts && <MapEssentials {...parts} />}
    </ToolkitMap>
  )
  return workspace ? (
    content
  ) : (
    <WorkspaceProvider
      eventTarget={typeof window === 'undefined' ? undefined : window}
      placement="viewport"
      responsive="viewport"
      theme={theme}
    >
      {content}
    </WorkspaceProvider>
  )
})
