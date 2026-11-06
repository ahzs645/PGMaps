import {
  MapSectionLayout as ToolkitMapSectionLayout,
  type MapSectionLayoutProps,
} from '@pgmaps/geo-toolkit/workspace/MapSectionLayout'
import { useTheme } from 'next-themes'
import { WorkspaceProvider } from '@pgmaps/geo-toolkit/workspace/workspace-context'
import type { MapTableController } from '@/components/map/useMapTable'
export * from '@pgmaps/geo-toolkit/workspace/MapSectionLayout'
/** PG Maps keeps its existing Navbar/table event bridge at the application boundary. */
const onDialogOpenChange = (hidden: boolean) =>
  window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
export function MapSectionLayout({
  table,
  children,
  ...props
}: MapSectionLayoutProps & {
  /** From `useMapTable`: docks the table pane and puts the Table button in its standard place. */
  table?: MapTableController
}) {
  const { resolvedTheme } = useTheme()
  return (
    <WorkspaceProvider
      eventTarget={typeof window === 'undefined' ? undefined : window}
      placement="viewport"
      responsive="viewport"
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      onDialogOpenChange={onDialogOpenChange}
      toolbar={
        typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')
      }
    >
      <ToolkitMapSectionLayout {...props} {...table?.layout}>
        {children}
        {table?.button && !table.inlineButton && (
          <div className="absolute left-2 top-16 z-20 md:top-2">{table.button}</div>
        )}
      </ToolkitMapSectionLayout>
    </WorkspaceProvider>
  )
}
