import { usePagination } from '@/hooks/usePagination'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { useRef } from 'react'
import { RankedBarList } from '@/components/ui/ranked-bar-list'
import { SidebarSection } from '@/components/ui/map-panels'

import type { ResearchRecordsAdapterData } from '../adapters/useResearchRecordsAdapter'
import type { ExplorerFeature } from './featureTypes'

export function RankedListFeature({
  feature,
  locations,
  locationPlural,
  onSelect,
  selectedId,
  excludedIds,
  onExclude,
}: {
  feature: ExplorerFeature<'ranked-list'>
  locations: ResearchRecordsAdapterData['availableLocations']
  locationPlural: string
  onSelect: (locationId: string) => void
  selectedId: string | null
  excludedIds: ReadonlySet<string>
  onExclude: (locationId: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const pagination = usePagination(locations, feature.limit, locations.map((location) => location.id).join(','))
  return (
    <SidebarSection title={feature.title} className="border-b-0 p-3">
      <div ref={root} className="scroll-mt-3" />
      <p className="mb-2 px-2 text-xs text-muted-foreground">
        Click to filter and focus. Right-click or use − to exclude; ↶ restores.
      </p>
      {selectedId && (
        <button type="button" className="mb-2 px-2 text-xs text-primary underline" onClick={() => onSelect(selectedId)}>
          Clear location filter
        </button>
      )}
      <RankedBarList
        items={pagination.items.map((location) => ({
          id: location.id,
          label: location.name,
          value: location.filteredCount,
        }))}
        limit={feature.limit}
        emptyMessage={`No ${locationPlural} match filters`}
        onSelect={(item) => onSelect(item.id)}
        selectedId={selectedId}
        excludedIds={excludedIds}
        onExclude={(item) => onExclude(item.id)}
      />
      {pagination.pageCount > 1 && (
        <PaginationControls
          label="Location pages"
          page={pagination.page}
          pageCount={pagination.pageCount}
          onPageChange={(page) => {
            pagination.setPage(page)
            root.current?.scrollIntoView({ block: 'nearest' })
          }}
        />
      )}
    </SidebarSection>
  )
}
