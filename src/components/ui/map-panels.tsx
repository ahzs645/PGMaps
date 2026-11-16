import { useContext, useEffect, useState, type ComponentProps } from 'react'
import { SectionOpenReporterContext } from './section-open-reporter'
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

/**
 * Expose the same section names and disclosure controls to the workspace tool finder. Under a
 * `SectionOpenReporterContext` the section also reports whether it is open; it then holds its own
 * open state (still following `open` when given), which is the toolkit's behaviour made visible.
 */
export function CollapsibleSection(props: ComponentProps<typeof ToolkitCollapsibleSection>) {
  const report = useContext(SectionOpenReporterContext)
  const label = typeof props.label === 'string' ? props.label : undefined
  const [ownOpen, setOwnOpen] = useState(props.defaultOpen ?? false)
  const open = props.open ?? ownOpen
  useEffect(() => {
    if (!report || !label) return
    report(label, open)
    return () => report(label, false)
  }, [report, label, open])
  const followed = report && label
  return (
    <ToolkitCollapsibleSection
      {...props}
      {...(followed
        ? {
            open,
            onOpenChange: (next: boolean) => {
              setOwnOpen(next)
              props.onOpenChange?.(next)
            },
          }
        : {})}
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
