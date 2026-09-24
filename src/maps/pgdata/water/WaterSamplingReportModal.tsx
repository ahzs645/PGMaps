import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RecordDialog } from '@/components/ui/record-dialog'
import { StatGroup, type StatItem } from '@/components/ui/stat-group'
import { formatDate } from '../shared'
import { firstDate, firstString, formatUnknown, getNoticeDetailsUrl, parseSampleLocation } from './utils'
import { EmptyWaterDetail, WaterNoticeCard } from './WaterDetails'
import type { WaterSampleRow } from './types'
import type { WaterState } from './useWaterData'

export function WaterSamplingReportModal({ water, onClose }: { water: WaterState; onClose: () => void }) {
  const facility = water.selectedFacility

  if (!facility) return null

  const detailsUrl = getNoticeDetailsUrl(facility.source) || firstString(facility.source, ['details_url'])
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults
  const sourceRecordCount = water.selectedFacilityNotices.reduce((sum, notice) => sum + Math.max(1, notice.sourceCount), 0)
  const healthSpaceNoticeCount = water.selectedFacilityNotices.filter((notice) => notice.primarySource === 'HealthSpace').length
  const waterTodayNoticeCount = water.selectedFacilityNotices.filter((notice) => notice.primarySource === 'WaterToday').length
  const earliestNoticeDate = water.selectedFacilityNotices.reduce<Date | null>((earliest, notice) => {
    if (!notice.date) return earliest
    return !earliest || notice.date < earliest ? notice.date : earliest
  }, null)
  const reportLabel = water.layerMode === 'notices'
    ? 'Notice report'
    : water.layerMode === 'samples'
      ? 'Sampling report'
      : 'Facility report'
  const modalStats: StatItem[] = water.layerMode === 'notices'
    ? [
        { label: 'Active notices', value: formatNumber(water.selectedFacilityNotices.length) },
        { label: 'Source records', value: formatNumber(sourceRecordCount) },
        { label: 'HealthSpace', value: formatNumber(healthSpaceNoticeCount) },
        { label: 'WaterToday', value: formatNumber(waterTodayNoticeCount) },
        { label: 'Earliest', value: formatDate(earliestNoticeDate?.toISOString()), compact: true },
      ]
    : water.layerMode === 'samples'
      ? [
          { label: 'Samples', value: formatNumber(sampleRows) },
          { label: 'Bacteriological', value: formatNumber(facility.bacteriologicalSamples) },
          { label: 'Chemical', value: formatNumber(facility.chemicalResults) },
          { label: 'Notices', value: formatNumber(facility.activeNotices) },
          { label: 'Latest', value: formatDate(facility.lastSampleDate?.toISOString()), compact: true },
        ]
      : [
          { label: 'Samples', value: formatNumber(sampleRows) },
          { label: 'Notices', value: formatNumber(facility.activeNotices) },
          { label: 'History rows', value: formatNumber(water.selectedFacilityInspections.length) },
          { label: 'Hazard', value: facility.hazardRating || 'Unknown', compact: true },
          { label: 'Connection size', value: facility.type || 'Unknown', compact: true },
        ]

  return (
    <RecordDialog
      size="xl"
      eyebrow={reportLabel}
      title={facility.name}
      subtitle={
        <>
          {facility.community || facility.address || facility.geocodedAddress || 'No locality provided'}
          {facility.geocodedAddress && <span className="mt-1 block text-xs">{facility.geocodedAddress}</span>}
        </>
      }
      closeLabel="Close sampling report"
      source={facility.primarySource || (facility.noticeOnly ? 'WaterToday / HealthSpace combined notices' : 'Northern Health Authority HealthSpace')}
      sourceHref={detailsUrl || undefined}
      onClose={onClose}
      summary={<StatGroup variant="tiles" items={modalStats} />}
    >
      {water.layerMode === 'notices' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
          <NoticeSection water={water} />
          <aside className="space-y-6">
            <FacilityContextSection water={water} />
            <FacilityHistorySection water={water} />
          </aside>
        </div>
      ) : water.layerMode === 'samples' ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
          <SamplingSection water={water} />
          <aside className="space-y-6">
            <NoticeSection water={water} />
            <FacilityHistorySection water={water} />
          </aside>
        </div>
      ) : (
        <div className="space-y-6">
          <FacilityContextSection water={water} />
          <FacilityHistorySection water={water} />
        </div>
      )}
    </RecordDialog>
  )
}

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {count != null && <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(count)}</span>}
    </div>
  )
}

function SamplingSection({ water }: { water: WaterState }) {
  return (
    <section>
      <SectionHeading title="Sampling" count={water.selectedFacilitySamples.length} />
      <WaterSamplingGrid samples={water.selectedFacilitySamples} />
    </section>
  )
}

function NoticeSection({ water, compact = false }: { water: WaterState; compact?: boolean }) {
  return (
    <section>
      <SectionHeading title="Active notices" count={water.selectedFacilityNotices.length} />
      <div className={cn('space-y-3', compact && 'max-h-96 overflow-y-auto pr-1')}>
        {water.selectedFacilityNotices.length === 0 ? (
          <EmptyWaterDetail label="No active notices for this facility." />
        ) : water.selectedFacilityNotices.map((notice) => (
          <WaterNoticeCard key={notice.id} notice={notice} compact={compact} />
        ))}
      </div>
    </section>
  )
}

function FacilityContextSection({ water }: { water: WaterState }) {
  const facility = water.selectedFacility
  if (!facility) return null

  return (
    <section>
      <SectionHeading title="Facility context" />
      <div className="rounded-lg border border-border bg-background p-3 text-sm">
        <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-x-3 gap-y-2 text-xs">
          <span className="text-muted-foreground">Connection size</span>
          <span className="text-right font-medium text-foreground">{facility.type || 'Unknown'}</span>
          <span className="text-muted-foreground">Hazard rating</span>
          <span className="text-right font-medium text-foreground">{facility.hazardRating || 'Unknown'}</span>
          <span className="text-muted-foreground">Community</span>
          <span className="text-right font-medium text-foreground">{facility.community || 'Unknown'}</span>
          <span className="text-muted-foreground">Address</span>
          <span className="text-right font-medium text-foreground">{facility.address || facility.geocodedAddress || 'Unknown'}</span>
        </div>
      </div>
    </section>
  )
}

function FacilityHistorySection({ water }: { water: WaterState }) {
  const facility = water.selectedFacility
  if (!facility) return null

  return (
    <section>
      <SectionHeading title="Facility history" count={water.selectedFacilityInspections.length} />
      <div className="space-y-3">
        {water.selectedFacilityInspections.length === 0 ? (
          <EmptyWaterDetail label="No inspection history included in the copied facility record." />
        ) : water.selectedFacilityInspections.map((inspection, index) => (
          <div key={`${facility.id}-modal-inspection-${index}`} className="rounded-lg border border-border bg-background p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-foreground">{firstString(inspection, ['document_type', 'type', 'inspectionType', 'description'], `History ${index + 1}`)}</div>
              <div className="text-xs text-muted-foreground">{formatDate(firstDate(inspection, ['date', 'inspectionDate', 'inspection_date'])?.toISOString())}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{firstString(inspection, ['hazard_rating', 'result', 'status', 'summary', 'comments'], 'No summary listed')}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function WaterSamplingGrid({ samples }: { samples: WaterSampleRow[] }) {
  if (samples.length === 0) {
    return <EmptyWaterDetail label="No sample rows for this facility." />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="max-h-[58vh] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/90 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
            <tr>
              <th className="border-b border-border px-3 py-2 font-semibold">Date</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Type</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Parameter</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Result</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Location / results</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, index) => (
              <WaterSamplingGridRow key={`${sample.id}-${index}`} sample={sample} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WaterSamplingGridRow({ sample }: { sample: WaterSampleRow }) {
  const isBacteriological = sample.kind === 'bacteriological'
  const result = sample.result || formatUnknown(sample.source.value)
  const parsedLocation = isBacteriological ? parseSampleLocation(sample.source.location) : null
  const details = isBacteriological
    ? [
        parsedLocation
          ? ['Sample point', parsedLocation.samplePoint]
          : ['Location', formatUnknown(sample.source.location)],
        parsedLocation?.context ? ['Location context', parsedLocation.context] : null,
        ['Total coliform', formatUnknown(sample.source.total_coliform)],
        ['E. coli', formatUnknown(sample.source.e_coli)],
      ].filter((entry): entry is [string, string] => Boolean(entry && entry[1] && entry[1] !== 'None listed'))
    : []

  return (
    <tr className="align-top odd:bg-muted/20">
      <td className="border-b border-border/70 px-3 py-2 whitespace-nowrap text-muted-foreground">
        {formatDate(sample.date?.toISOString())}
      </td>
      <td className="border-b border-border/70 px-3 py-2">
        <Badge tone={sample.kind === 'chemical' ? 'cyan' : 'info'} size="sm" pill className="capitalize">
          {sample.kind}
        </Badge>
      </td>
      <td className="border-b border-border/70 px-3 py-2 font-medium text-foreground">
        {sample.parameter || 'Unknown parameter'}
      </td>
      <td className="border-b border-border/70 px-3 py-2 font-mono text-foreground">
        {result}
      </td>
      <td className="border-b border-border/70 px-3 py-2 text-muted-foreground">
        {details.length === 0 ? (
          <span className="text-muted-foreground/70">-</span>
        ) : (
          <div className="space-y-1">
            {details.map(([label, value]) => (
              <div key={label}>
                <span className="font-medium text-foreground">{label}: </span>
                {value}
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}
