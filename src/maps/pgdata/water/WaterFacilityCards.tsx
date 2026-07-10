import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { formatDate } from '../shared'
import type { WaterFacility } from './types'

export function WaterFacilityPopupCard({ facility, onOpenReport }: { facility: WaterFacility; onOpenReport: () => void }) {
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults
  return (
    <div className="w-72 text-xs">
      <div className="pr-6">
        <div className="font-semibold leading-snug text-foreground">{facility.name}</div>
        <div className="mt-1 text-muted-foreground">{facility.community || facility.address || 'No locality provided'}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{sampleRows.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">samples</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{facility.activeNotices.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">notices</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{formatDate(facility.lastSampleDate?.toISOString())}</div>
          <div className="text-xs text-muted-foreground">latest</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenReport}
        className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
      >
        {facility.noticeOnly ? 'Open notice details' : 'Open sampling report'}
      </button>
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
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults

  return (
    <MobileFeatureCard
      title={facility.name}
      subtitle={facility.community || facility.address || 'No locality provided'}
      onClose={onClose}
    >
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{sampleRows.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">samples</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{facility.activeNotices.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">notices</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{formatDate(facility.lastSampleDate?.toISOString())}</div>
          <div className="text-xs text-muted-foreground">latest</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenReport}
        className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
      >
        {facility.noticeOnly ? 'Open notice details' : 'Open sampling report'}
      </button>
    </MobileFeatureCard>
  )
}
