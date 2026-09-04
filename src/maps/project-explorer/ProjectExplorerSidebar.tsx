import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'

import type { ResearchRecordsAdapterData } from './adapters/useResearchRecordsAdapter'
import { AggregateRecordsDialog, AggregateRecordsFeature } from './features/AggregateRecordsFeature'
import { CategoryFilterFeature } from './features/CategoryFilterFeature'
import { RankedListFeature } from './features/RankedListFeature'
import { SearchFeature } from './features/SearchFeature'
import { SummaryStatsFeature } from './features/SummaryStatsFeature'
import { TimelineFeature } from './features/TimelineFeature'

export function ProjectExplorerSidebar({
  title,
  onBack,
  config,
  data,
  timelineMode,
  onToggleTimeline,
}: {
  title: string
  onBack: () => void
  config: ProjectMapExplorerWorkspaceDef
  data: ResearchRecordsAdapterData
  timelineMode: boolean
  onToggleTimeline: () => void
}) {
  const {
    overview,
    decades,
    filteredStats,
    allResourceTypes,
    regionalOnlySubmissions,
    selectedDecade,
    setSelectedDecade,
    selectedTypes,
    toggleResourceType,
    searchQuery,
    setSearchQuery,
    filteredLocations,
    setSelectedLocationId,
    clearFilters,
  } = data
  const [showRegionalDialog, setShowRegionalDialog] = useState(false)
  const hasFilters = selectedDecade !== null || selectedTypes.size > 0 || searchQuery !== ''
  const summaryFeature = config.features.find((feature) => feature.type === 'summary-stats')
  const aggregateFeature = config.features.find((feature) => feature.type === 'aggregate-records')

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <Button type="button" variant="outline" size="sm" className="h-8 px-2.5" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Projects
        </Button>
        <div className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground" title={title}>
          {title}
        </div>
      </div>

      {summaryFeature?.type === 'summary-stats' ? (
        <SummaryStatsFeature
          feature={summaryFeature}
          overview={overview}
          filteredStats={filteredStats}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {config.features.map((feature, index) => {
          const key = `${feature.type}-${index}`
          switch (feature.type) {
            case 'summary-stats':
            case 'map-legend':
            case 'location-popup':
              return null
            case 'timeline':
              return (
                <TimelineFeature
                  key={key}
                  feature={feature}
                  decades={decades}
                  selectedDecade={selectedDecade}
                  onSelectDecade={setSelectedDecade}
                  timelineMode={timelineMode}
                  onToggleTimeline={onToggleTimeline}
                />
              )
            case 'category-filter':
              return (
                <CategoryFilterFeature
                  key={key}
                  feature={feature}
                  categories={allResourceTypes}
                  selectedCategories={selectedTypes}
                  colors={data.resourceTypeColors}
                  labels={data.resourceTypeLabels}
                  onToggle={toggleResourceType}
                />
              )
            case 'aggregate-records':
              if (regionalOnlySubmissions.length === 0) return null
              return (
                <AggregateRecordsFeature
                  key={key}
                  feature={feature}
                  count={regionalOnlySubmissions.length}
                  onOpen={() => setShowRegionalDialog(true)}
                />
              )
            case 'search':
              return <SearchFeature key={key} feature={feature} query={searchQuery} onQueryChange={setSearchQuery} />
            case 'ranked-list':
              return (
                <RankedListFeature
                  key={key}
                  feature={feature}
                  locations={filteredLocations}
                  locationPlural={config.labels.locationPlural}
                  onSelect={setSelectedLocationId}
                />
              )
          }
        })}
      </div>

      {aggregateFeature?.type === 'aggregate-records' ? (
        <AggregateRecordsDialog
          open={showRegionalDialog}
          feature={aggregateFeature}
          submissions={regionalOnlySubmissions}
          resourceTypeLabels={data.resourceTypeLabels}
          recordSingular={config.labels.recordSingular}
          onOpenChange={setShowRegionalDialog}
        />
      ) : null}
    </div>
  )
}
