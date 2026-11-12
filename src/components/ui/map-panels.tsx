import type { ComponentProps } from 'react'
import {
  SidebarSection as ToolkitSidebarSection,
  CollapsibleSection as ToolkitCollapsibleSection,
  MapSidebarShell as ToolkitMapSidebarShell,
  type MapSidebarShellProps as ToolkitMapSidebarShellProps,
} from '@pgmaps/geo-toolkit/ui/map-panels'
import { DatasetInfo, type DatasetInfoRecord } from '@/components/DatasetInfo'
export * from '@pgmaps/geo-toolkit/ui/map-panels'
type MapSidebarShellProps = ToolkitMapSidebarShellProps & { dataset?: DatasetInfoRecord }
export function MapSidebarShell({ dataset, metadata, ...props }: MapSidebarShellProps) {
  return (
    <ToolkitMapSidebarShell
      {...props}
      metadata={metadata ?? (dataset ? <DatasetInfo dataset={dataset} /> : undefined)}
    />
  )
}

/** Expose the same section names and disclosure controls to the workspace tool finder. */
export function CollapsibleSection(props: ComponentProps<typeof ToolkitCollapsibleSection>) {
  return (
    <ToolkitCollapsibleSection
      {...props}
      toggleProps={{
        ...props.toggleProps,
        'data-workflow-section': typeof props.label === 'string' ? props.label : undefined,
      }}
    />
  )
}

export function SidebarSection(props: ComponentProps<typeof ToolkitSidebarSection>) {
  return (
    <ToolkitSidebarSection
      tabIndex={-1}
      data-workflow-section={typeof props.title === 'string' ? props.title : undefined}
      {...props}
    />
  )
}
