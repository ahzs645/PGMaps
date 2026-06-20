import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { formatDate } from '../shared'
import { firstDate, firstString, formatUnknown, getNoticeDetailsUrl } from './utils'
import { EmptyWaterDetail, WaterNoticeCard } from './WaterDetails'
import type { WaterSampleRow } from './types'
import type { WaterState } from './useWaterData'

export function WaterSamplingReportModal({ water, onClose }: { water: WaterState; onClose: () => void }) {
  const facility = water.selectedFacility

  if (!facility) return null

  const detailsUrl = getNoticeDetailsUrl(facility.source) || firstString(facility.source, ['details_url'])
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent variant="sheet" elevated showClose={false} className="sm:max-w-5xl sm:max-h-[92dvh]">
        <div className="shrink-0 border-b border-border bg-background/90 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl font-bold text-foreground">{facility.name}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">{facility.community || facility.address || facility.geocodedAddress || 'No locality provided'}</DialogDescription>
              {facility.geocodedAddress && (
                <p className="mt-1 text-xs text-muted-foreground">{facility.geocodedAddress}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sampling report"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{sampleRows.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Samples</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{facility.bacteriologicalSamples.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Bacteriological</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{facility.chemicalResults.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Chemical</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{facility.activeNotices.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Notices</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-lg font-bold text-foreground">{formatDate(facility.lastSampleDate?.toISOString())}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Sampling</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{water.selectedFacilitySamples.length.toLocaleString()}</span>
              </div>
              <WaterSamplingGrid samples={water.selectedFacilitySamples} />
            </section>

            <aside className="space-y-6">
              <section>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Active notices</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{water.selectedFacilityNotices.length.toLocaleString()}</span>
                </div>
                <div className="space-y-3">
                  {water.selectedFacilityNotices.length === 0 ? (
                    <EmptyWaterDetail label="No active notices for this facility." />
                  ) : water.selectedFacilityNotices.map((notice) => (
                    <WaterNoticeCard key={notice.id} notice={notice} />
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Facility history</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{water.selectedFacilityInspections.length.toLocaleString()}</span>
                </div>
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
            </aside>
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background/90 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Data from {facility.primarySource || (facility.noticeOnly ? 'WaterToday / HealthSpace combined notices' : 'Northern Health Authority HealthSpace')}
            </div>
            <div className="flex flex-wrap gap-2">
              {detailsUrl && (
                <a
                  href={detailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  View source
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg border border-input bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
          <thead className="sticky top-0 z-10 bg-muted/90 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
            <tr>
              <th className="border-b border-border px-3 py-2 font-semibold">Date</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Type</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Parameter</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Result</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Sample details</th>
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
  const details = isBacteriological
    ? [
      ['Location', formatUnknown(sample.source.location)],
      ['Total coliform', formatUnknown(sample.source.total_coliform)],
      ['E. coli', formatUnknown(sample.source.e_coli)],
    ].filter(([, value]) => value && value !== 'None listed')
    : []

  return (
    <tr className="align-top odd:bg-muted/20">
      <td className="border-b border-border/70 px-3 py-2 whitespace-nowrap text-muted-foreground">
        {formatDate(sample.date?.toISOString())}
      </td>
      <td className="border-b border-border/70 px-3 py-2">
        <span className={cn(
          'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
          sample.kind === 'chemical'
            ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200'
            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
        )}>
          {sample.kind}
        </span>
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
