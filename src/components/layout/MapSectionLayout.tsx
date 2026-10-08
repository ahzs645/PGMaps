import { MapSectionLayout as ToolkitMapSectionLayout, type MapSectionLayoutProps } from '@pgmaps/geo-toolkit/workspace/MapSectionLayout'
import { useTheme } from 'next-themes'
import { WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
export * from '@pgmaps/geo-toolkit/workspace/MapSectionLayout'
/** PG Maps keeps its existing Navbar/table event bridge at the application boundary. */
const onDialogOpenChange = (hidden: boolean) => window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
export function MapSectionLayout(props: MapSectionLayoutProps) {
  const { resolvedTheme } = useTheme()
  return <WorkspaceProvider eventTarget={typeof window === 'undefined' ? undefined : window} placement="viewport" responsive="viewport" theme={resolvedTheme === 'dark' ? 'dark' : 'light'} onDialogOpenChange={onDialogOpenChange}
    toolbar={typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')}>
    <ToolkitMapSectionLayout {...props} />
  </WorkspaceProvider>
}
