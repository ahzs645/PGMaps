import type { ReactNode } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { ratingLabel, type regionalOutlook } from './legacyAnalysis'
import type { LegacyComparison } from './legacyComparison'
import { RATING_COLORS } from './palette'

export const periodLabel = (period: string) => period.replace('_', '–')
const percent = (value: number | null) => (value == null ? '—' : `${(value * 100).toFixed(1)}%`)

/** A rating with its class swatch; a dashed empty swatch means no lookup result, not unsuitable. */
export function Rating({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap px-1 py-1">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 shrink-0 rounded-sm"
        style={{
          background: value == null ? 'transparent' : RATING_COLORS[value],
          border: value == null ? '1px dashed currentColor' : undefined,
        }}
      />
      {ratingLabel(value)}
    </span>
  )
}

/** Model runs down the side, periods across. */
export function ModelPeriodMatrix({
  caption,
  periods,
  rows,
}: {
  caption: string
  periods: string[]
  rows: { label: string; values: ReactNode[] }[]
}) {
  return (
    <div className="overflow-x-auto">
      <EngineeringTable variant="text" className="text-sm [&_td]:py-3">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <ColumnHeader label="Model / run / scenario" />
            {periods.map((p) => (
              <ColumnHeader key={p} label={periodLabel(p)} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {row.values.map((value, i) => (
                <td key={periods[i]}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
    </div>
  )
}

/** Every species at the point: baseline, observed, then each modelled period for one model run. */
export function LegacySpeciesTable({
  comparison,
  member,
  selectedPeriod,
}: {
  comparison: LegacyComparison
  member: string
  selectedPeriod: string
}) {
  return (
    <div className="overflow-x-auto">
      <EngineeringTable variant="text" className="text-sm">
        <caption className="sr-only">Legacy species suitability</caption>
        <thead>
          <tr>
            <ColumnHeader label="Species" />
            <ColumnHeader label={comparison.baseline ? periodLabel(comparison.baseline.period) : 'Baseline'} />
            <ColumnHeader
              label={comparison.observed ? `${periodLabel(comparison.observed.period)} observed` : 'Observed'}
            />
            {comparison.periods.map((p) => (
              <ColumnHeader
                key={p}
                label={`${periodLabel(p)} model`}
                className={p === selectedPeriod ? 'bg-secondary' : ''}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.species.map((s) => (
            <tr key={s.species}>
              <td>
                {s.species} · {s.name}
              </td>
              <td>
                <Rating value={s.baseline} />
              </td>
              <td>
                <Rating value={s.observed} />
              </td>
              {comparison.periods.map((p) => (
                <td key={p} className={p === selectedPeriod ? 'ring-1 ring-inset ring-border' : ''}>
                  <Rating value={s.projections.find((r) => r.member === member && r.period === p)?.rating ?? null} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
    </div>
  )
}

export function RegionalTrendTable({ trends }: { trends: ReturnType<typeof regionalOutlook> }) {
  return (
    <>
      <div className="overflow-x-auto">
        <EngineeringTable className="whitespace-normal text-xs [&_td]:py-2">
          <caption className="sr-only">Regional persistence and expansion</caption>
          <thead>
            <tr>
              <ColumnHeader label="Period / run" className="text-left" />
              <ColumnHeader label="Persistence" />
              <ColumnHeader label="Expansion" />
            </tr>
          </thead>
          <tbody>
            {trends.map((r) => (
              <tr key={`${r.PERIOD}|${r.RUN}`}>
                <td className="text-left">
                  {periodLabel(r.PERIOD)} · {r.RUN}
                </td>
                <td>{percent(r.persistence)}</td>
                <td>{percent(r.expansion)}</td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      </div>
      {!trends.length && <p className="text-sm">No regional rows for this selection.</p>}
    </>
  )
}
