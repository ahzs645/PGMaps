import { SidebarSection, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'

import type { ResearchRecordsAdapterData } from '../adapters/useResearchRecordsAdapter'
import type { ExplorerFeature } from './featureTypes'

export function TimelineFeature({
  feature,
  decades,
  selectedDecade,
  onSelectDecade,
  timelineMode,
  onToggleTimeline,
}: {
  feature: ExplorerFeature<'timeline'>
  decades: ResearchRecordsAdapterData['decades']
  selectedDecade: number | null
  onSelectDecade: (decade: number | null) => void
  timelineMode: boolean
  onToggleTimeline: () => void
}) {
  return (
    <SidebarSection
      title="Decade"
      className="p-3"
      actions={
        <ToggleChip active={timelineMode} onClick={onToggleTimeline}>
          {feature.title}
        </ToggleChip>
      }
    >
      <AppSelect
        value={selectedDecade === null ? 'all' : String(selectedDecade)}
        onValueChange={(value) => onSelectDecade(value === 'all' ? null : Number(value))}
        options={[
          ...(!timelineMode ? [{ value: 'all', label: 'All decades' }] : []),
          ...decades.map((item) => ({
            value: String(item.decade),
            label: `${item.decade}s (${item.total.toLocaleString()})`,
          })),
        ]}
        triggerAriaLabel="Filter by decade"
        triggerClassName="h-8 rounded-md text-xs"
      />
    </SidebarSection>
  )
}
