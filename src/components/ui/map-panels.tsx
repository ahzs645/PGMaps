import { MapSidebarShell as ToolkitMapSidebarShell, type MapSidebarShellProps as ToolkitMapSidebarShellProps } from '@pgmaps/geo-toolkit/ui/map-panels'
import { DatasetInfo, type DatasetInfoRecord } from '@/components/DatasetInfo'
export * from '@pgmaps/geo-toolkit/ui/map-panels'
type MapSidebarShellProps = ToolkitMapSidebarShellProps & { dataset?: DatasetInfoRecord }
export function MapSidebarShell({ dataset, metadata, ...props }: MapSidebarShellProps) {
  return <ToolkitMapSidebarShell {...props} metadata={metadata ?? (dataset ? <DatasetInfo dataset={dataset} /> : undefined)} />
}
