import { useWorkspace, WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
// Application adapter keeps the existing next-themes behavior.
import { forwardRef } from 'react'
import { useTheme } from 'next-themes'
import { Map as ToolkitMap, type MapProps, type MapRef } from '@pgmaps/geo-toolkit/map/map'
export * from '@pgmaps/geo-toolkit/map/map'
export const Map = forwardRef<MapRef, MapProps>(function Map(props, ref) {
  const { resolvedTheme, forcedTheme } = useTheme()
  const theme = props.theme ?? ((forcedTheme ?? resolvedTheme) === 'dark' ? 'dark' : 'light')
  const workspace = useWorkspace()
  const content = <ToolkitMap {...props} theme={theme} ref={ref} />
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
