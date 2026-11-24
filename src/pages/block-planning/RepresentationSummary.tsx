import { useState } from 'react'
import { CalculationTable } from '@/components/ui/calculation-results'
import { SelectField } from '@/components/ui/form-field'
import {
  BREAKDOWN_LABELS,
  pineSplit,
  REPRESENTATION_BREAKDOWNS,
  REPRESENTATION_SOURCES,
  rowLabel,
  shares,
  type OldForestRepresentation,
  type RepresentationBreakdown,
} from './oldForest/representation'
import type { OldForestRecord } from './records'

const ha = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const pct = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const share = (v: number | null) => (v === null ? '—' : pct.format(v))

/**
 * D.3's summary: old forest beside the CFLB proxy it is measured on, by leading species, BEC
 * variant, age class and site index, for one unit and the year on the map. Figures to help the
 * reviewer judge representativeness, never a pass or fail.
 */
export function RepresentationSummary({
  record,
  year,
  scheduleNames,
}: {
  record: OldForestRecord
  year: number
  scheduleNames: Record<string, string>
}) {
  const units: { label: string; representation: OldForestRepresentation | undefined }[] = record.pool
    ? record.pool.map((u) => ({ label: u.unit, representation: u.representation }))
    : [{ label: record.unit, representation: record.representation }]
  const [unitIndex, setUnitIndex] = useState(0)
  const [breakdown, setBreakdown] = useState<RepresentationBreakdown>('species')
  const chosen = units[Math.min(unitIndex, units.length - 1)]
  const rep = chosen.representation
  const at = rep?.years.find((y) => y.year === year) ?? rep?.years[0]
  const split = at ? pineSplit(at) : null
  return (
    <div className="space-y-2" data-testid="block-planning-old-d3">
      {REPRESENTATION_SOURCES.map((s) => (
        <blockquote key={s.cite} className="border-l-2 border-border pl-2 text-2xs text-muted-foreground">
          “{s.text}” <span className="whitespace-nowrap">({s.cite})</span>
        </blockquote>
      ))}
      <p className="text-2xs text-muted-foreground">
        The texts measure representation by affected (pine-leading) and unaffected (non-pine) stands. The breakdowns by
        BEC variant, age class and site index are context for your judgement; neither the order nor the policy sets
        them. Nothing here says the old forest is or is not representative.
      </p>
      {!rep || !at ? (
        <p className="text-xs text-muted-foreground">
          This record was made before the D.3 summary. Calculate again to see it.
        </p>
      ) : (
        <>
          {units.length > 1 && (
            <SelectField label="Pooled unit" value={String(unitIndex)} onValueChange={(v) => setUnitIndex(Number(v))}>
              {units.map((u, i) => (
                <option key={u.label} value={String(i)}>
                  {u.label}
                </option>
              ))}
            </SelectField>
          )}
          <p className="text-xs" data-testid="block-planning-old-d3-split">
            {chosen.label}, {at.year}, {scheduleNames[rep.schedule] ?? rep.schedule}: non-pine-leading stands are{' '}
            {share(split!.nonPineCflbShare)} of the CFLB; old non-pine forest is {share(split!.nonPineOldShare)} of old
            forest
            {split!.nonPineInteriorShare !== null
              ? `, and interior on non-pine old ground ${share(split!.nonPineInteriorShare)} of old interior`
              : ''}
            . Policy option (a) sets the first two side by side.
          </p>
          <SelectField
            label="Break down by"
            value={breakdown}
            onValueChange={(v) => setBreakdown(v as RepresentationBreakdown)}
          >
            {REPRESENTATION_BREAKDOWNS.map((b) => (
              <option key={b} value={b}>
                {BREAKDOWN_LABELS[b]}
              </option>
            ))}
          </SelectField>
          <CalculationTable
            caption={`${BREAKDOWN_LABELS[breakdown]}, ${at.year}: hectares (share of the column)`}
            rows={shares(at.by[breakdown])}
            rowKey={(r) => r.key}
            columns={[
              { label: BREAKDOWN_LABELS[breakdown], render: (r) => rowLabel(breakdown, r.key) },
              { label: 'CFLB', render: (r) => `${ha.format(r.cflbHa)} (${share(r.cflbShare)})` },
              { label: 'Old', render: (r) => `${ha.format(r.oldHa)} (${share(r.oldShare)})` },
              { label: 'Old non-pine', render: (r) => `${ha.format(r.nonPineOldHa)} (${share(r.nonPineShare)})` },
              { label: 'Old of own CFLB', render: (r) => share(r.oldOfCflb) },
            ]}
          />
          <p className="text-2xs text-muted-foreground">
            The schedule under review, the year on the map, from the same stands as the figures above. Old forest
            includes ground counted whole under D.1 (in its stand’s own age class) and never D.4’s younger stands; old
            non-pine counts as the non-pine figure does. Age classes are the provincial inventory’s; site index classes
            are PGMaps’ own 5 m steps of the VRI’s site index.
            {breakdown === 'age' ? ' Ground a harvest or disturbance after the inventory reset is its own row.' : ''}
          </p>
        </>
      )}
    </div>
  )
}
