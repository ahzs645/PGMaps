import { RankedBarList } from '@/components/ui/ranked-bar-list'
import { SidebarSection } from '@/components/ui/map-panels'

import type { ResearchRecordsAdapterData } from '../adapters/useResearchRecordsAdapter'
import type { ExplorerFeature } from './featureTypes'

export function RankedListFeature({
  feature,
  locations,
  locationPlural,
  onSelect,
}: {
  feature: ExplorerFeature<'ranked-list'>
  locations: ResearchRecordsAdapterData['filteredLocations']
  locationPlural: string
  onSelect: (locationId: string) => void
}) {
  return (
    <SidebarSection title={feature.title} className="border-b-0 p-3">
      <RankedBarList
        items={locations.map((location) => ({
          id: location.id,
          label: location.name,
          value: location.filteredCount,
        }))}
        limit={feature.limit}
        emptyMessage={`No ${locationPlural} match filters`}
        onSelect={(item) => onSelect(item.id)}
      />
    </SidebarSection>
  )
}
