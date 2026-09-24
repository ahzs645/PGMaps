import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { StatGroup } from '@/components/ui/stat-group'
import { formatNumber } from '@/lib/format'
import { formatDate } from '../shared'
import type { WaterFacility } from './types'

function WaterFacilityStats({ facility, className }: { facility: WaterFacility; className?: string }) {
  return (
    <StatGroup
      variant="tiles"
      size="sm"
      columns={3}
      className={className}
      items={[
        { label: 'samples', value: formatNumber(facility.bacteriologicalSamples + facility.chemicalResults) },
        { label: 'notices', value: formatNumber(facility.activeNotices) },
        { label: 'latest', value: formatDate(facility.lastSampleDate?.toISOString()), compact: true },
      ]}
    />
  )
}

function OpenReportButton({ facility, onOpenReport }: { facility: WaterFacility; onOpenReport: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenReport}
      className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700 touch:min-h-10"
    >
      {facility.noticeOnly ? 'Open notice details' : 'Open sampling report'}
    </button>
  )
}

export function WaterFacilityPopupCard({ facility, onOpenReport }: { facility: WaterFacility; onOpenReport: () => void }) {
  return (
    <div className="w-72 text-xs">
      <div className="pr-6">
        <div className="font-semibold leading-snug text-foreground">{facility.name}</div>
        <div className="mt-1 text-muted-foreground">{facility.community || facility.address || 'No locality provided'}</div>
      </div>
      <WaterFacilityStats facility={facility} className="mt-3" />
      <OpenReportButton facility={facility} onOpenReport={onOpenReport} />
    </div>
  )
}

export function MobileWaterFacilityFeatureCard({
  facility,
  onClose,
  onOpenReport,
}: {
  facility: WaterFacility
  onClose: () => void
  onOpenReport: () => void
}) {
  return (
    <MobileFeatureCard
      title={facility.name}
      subtitle={facility.community || facility.address || 'No locality provided'}
      onClose={onClose}
    >
      <WaterFacilityStats facility={facility} />
      <OpenReportButton facility={facility} onOpenReport={onOpenReport} />
    </MobileFeatureCard>
  )
}
