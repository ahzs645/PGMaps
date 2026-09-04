import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { Button } from '@/components/ui/button'
import type { ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'
import { useResearchExplorerWebMCP } from '@/lib/projectWebMCP'

import { useResearchRecordsAdapter } from './adapters/useResearchRecordsAdapter'
import { ProjectExplorerMap } from './ProjectExplorerMap'
import { ProjectExplorerSidebar } from './ProjectExplorerSidebar'

export function ProjectMapExplorer({
  title,
  config,
  onBack,
}: {
  title: string
  config: ProjectMapExplorerWorkspaceDef
  onBack: () => void
}) {
  const [timelineMode, setTimelineMode] = useState(false)
  const data = useResearchRecordsAdapter(config)
  useResearchExplorerWebMCP({ title, data })

  if (data.loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-1">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
            <span className="size-2 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
          </div>
          <span className="text-sm text-muted-foreground">{config.labels.loading}</span>
        </div>
      </div>
    )
  }

  if (data.error) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-sm rounded-lg border bg-card p-5 text-center shadow-sm">
          <h2 className="text-base font-semibold text-foreground">{config.labels.unavailable}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{data.error}</p>
          <Button type="button" size="sm" className="mt-4" onClick={data.retry}>
            <RotateCcw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <MapSectionLayout
      sidebar={
        <ProjectExplorerSidebar
          title={title}
          onBack={onBack}
          config={config}
          data={data}
          timelineMode={timelineMode}
          onToggleTimeline={() => {
            data.setSelectedLocationId(null)
            setTimelineMode((current) => !current)
          }}
        />
      }
      desktopSidebarWidth={360}
      mobileInitialSheetState="collapsed"
      mobileCollapsedVisibleHeight={68}
      mobilePeek={
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {data.filteredStats.totalPublications.toLocaleString()} {config.labels.recordPlural}
          </div>
        </div>
      }
      showMobilePeek
    >
      <ProjectExplorerMap
        config={config}
        data={data}
        timelineMode={timelineMode}
        onExitTimeline={() => {
          data.setSelectedLocationId(null)
          setTimelineMode(false)
        }}
      />
    </MapSectionLayout>
  )
}
