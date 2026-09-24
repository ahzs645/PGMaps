import { KeyValueRows } from '@/components/ui/map-panels'
import type { DroughtFeature } from '../types'

/** Level and date range of the selected basin, for the sidebar card and the phone card. */
export function DroughtBasinDetails({ feature, className }: { feature: DroughtFeature; className?: string }) {
  return (
    <KeyValueRows
      className={className}
      rows={[
        { label: 'Level', value: feature.properties.droughtLevelRaw ?? 'Not updated' },
        { label: 'Start', value: feature.properties.startDate ?? 'Unknown' },
        { label: 'End', value: feature.properties.endDate ?? 'Unknown' },
      ]}
    />
  )
}
