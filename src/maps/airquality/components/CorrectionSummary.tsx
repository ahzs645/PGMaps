import { KeyValueRows } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { formatMeasurement, formatPm25, formatPm25Uncertainty, type CorrectedPm25Result } from '../lib/corrections'

/**
 * Raw and corrected PM2.5 for one monitor under the active correction model.
 * Shared by the sidebar's selected-monitor card and the map popup.
 */
export function CorrectionSummary({
  correction,
  showNote = false,
  className,
  titleClassName,
}: {
  correction: CorrectedPm25Result
  showNote?: boolean
  className?: string
  titleClassName?: string
}) {
  return (
    <div className={cn('rounded-md border p-2 text-xs', className)}>
      <div className={cn('mb-1 font-semibold text-foreground', titleClassName)}>{correction.label}</div>
      <KeyValueRows
        rows={[
          { key: 'raw', label: 'Raw PM2.5', value: formatPm25(correction.rawPm25) },
          { key: 'corrected', label: 'Corrected', value: formatPm25(correction.correctedPm25) },
          { key: 'rh', label: 'RH', value: formatMeasurement(correction.humidity, '%') },
          { key: 'uncertainty', label: 'Uncertainty', value: formatPm25Uncertainty(correction.uncertainty) },
        ]}
      />
      {showNote && <p className="mt-2 text-xs leading-snug text-muted-foreground">{correction.note}</p>}
    </div>
  )
}
