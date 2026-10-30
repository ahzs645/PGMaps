import { useWorkspace, WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
// Geographic and theme defaults are application configuration.
import { useTheme } from 'next-themes'
import {
  PersistentMapProvider as ToolkitPersistentMapProvider,
  type PersistentMapProviderProps,
} from '@pgmaps/geo-toolkit/map/persistent-map'
import { PG_CENTER, PG_DEFAULT_ZOOM } from './map-styles'
export * from '@pgmaps/geo-toolkit/map/persistent-map'
export function PersistentMapProvider(props: PersistentMapProviderProps) {
  const { resolvedTheme } = useTheme()
  const workspace = useWorkspace()
  // Defaults go after the spread: callers such as SharedMapLayout forward `center`/`zoom`
  // as explicit undefined, which would otherwise override them and open on the world view.
  const content = (
    <ToolkitPersistentMapProvider
      {...props}
      center={props.center ?? PG_CENTER}
      zoom={props.zoom ?? PG_DEFAULT_ZOOM}
      theme={props.theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')}
    />
  )
  return workspace ? (
    content
  ) : (
    <WorkspaceProvider
      eventTarget={typeof window === 'undefined' ? undefined : window}
      placement="viewport"
      responsive="viewport"
      theme={props.theme ?? (resolvedTheme === 'dark' ? 'dark' : 'light')}
    >
      {content}
    </WorkspaceProvider>
  )
}
