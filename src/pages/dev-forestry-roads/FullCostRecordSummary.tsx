import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { isFullCostRecordCurrent, type FullCostReviewRecord } from './fullCostRecord'
import type { Alignment, RoadProject } from './types'

const money = (value: number) =>
  value.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })
const components = [
  ['newConstruction', 'New construction'],
  ['internalMaterialHaul', 'Internal material haul'],
  ['newConstructionFixed', 'New construction setup'],
  ['sourceMaterials', 'Supply and disposal materials'],
  ['sourcePreparation', 'Supply site preparation'],
  ['supplyNetworkHaul', 'Network haul and return'],
  ['supplyConnectorHaul', 'Connector haul and return'],
  ['networkRehabilitation', 'Existing-road rehabilitation'],
  ['networkAccess', 'Network access'],
  ['networkStructures', 'Network structures'],
  ['networkFixed', 'Network setup'],
  ['contingency', 'Contingency'],
] as const

/** A saved comparison has its own total; the active road's construction estimate stays separately labelled. */
export function FullCostRecordSummary({
  alignment,
  project,
  onOpenComparison,
}: {
  alignment: Alignment
  project: RoadProject
  onOpenComparison?: () => void
}) {
  const record = (alignment as Alignment & { fullCostRecord?: FullCostReviewRecord }).fullCostRecord
  const current = useMemo(() => isFullCostRecordCurrent(alignment, project), [alignment, project])
  if (!record) return null
  return (
    <section
      className="min-w-0 space-y-2 break-words rounded-lg border bg-card p-3 text-xs"
      data-testid="full-cost-record-summary"
      data-current={String(current)}
      aria-label="Saved complete access cost"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">Complete access cost</p>
          <p className="text-lg font-semibold tabular-nums">{money(record.totalCost)}</p>
          <p className="text-muted-foreground">
            As of {record.asOf} · {record.candidateName}
          </p>
        </div>
        {onOpenComparison && (
          <Button size="sm" variant="outline" onClick={onOpenComparison}>
            Open route cost comparison
          </Button>
        )}
      </div>
      <p role="status" className={current ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'}>
        {current
          ? 'Inputs match this saved comparison. Cost and condition assumptions still require review.'
          : 'Saved comparison is stale. Inputs changed; recalculate before relying on this total.'}
      </p>
      <details>
        <summary className="cursor-pointer font-medium">Cost breakdown and source paths</summary>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
          {components.map(([key, label]) => (
            <div key={key} className="contents">
              <dt>{label}</dt>
              <dd className="text-right tabular-nums">{money(record.ledger[key])}</dd>
            </div>
          ))}
          <dt className="border-t pt-1 font-semibold">Recorded total</dt>
          <dd className="border-t pt-1 text-right font-semibold tabular-nums">{money(record.totalCost)}</dd>
        </dl>
        <p className="mt-2 text-muted-foreground">
          Access: {record.accessPath.lengthM.toFixed(0)} m outward · {record.accessReturnPath.lengthM.toFixed(0)} m
          return.
        </p>
        <ul className="mt-2 space-y-1">
          {record.allocations.map((allocation, index) => (
            <li key={`${allocation.sourceId}:${allocation.use}:${index}`}>
              {allocation.sourceName}: {allocation.volumeM3.toFixed(1)} {allocation.volumeBasis} m³ {allocation.use} ·{' '}
              {(allocation.networkDistanceM / 1000).toFixed(2)} km loaded network haul ·{' '}
              {(allocation.returnNetworkDistanceM / 1000).toFixed(2)} km return.
            </li>
          ))}
        </ul>
        {record.warnings.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
            {record.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        )}
      </details>
    </section>
  )
}
