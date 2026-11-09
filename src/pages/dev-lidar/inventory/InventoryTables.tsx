import type { ReactNode } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { EmptyHint } from '@/components/ui/result-list'
import { RankedBarList } from '@/components/ui/ranked-bar-list'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { DEFAULT_LOCALE } from '@/lib/format'
import type { InventoryData, InventoryRules, TreeReview } from './types'
import { standTable, inventoryRows, matchInventories, type EstimatedTree } from './summary'
import type { InventoryPolygon } from './geometry'
import { number } from './InventoryDetail'
import { returnMetrics, type CorePoints } from './useInventoryPoints'

/** One line naming what a schedule shows and what it is not, with the full method behind an (i). */
function TableCaption({ children, about, label }: { children: ReactNode; about: ReactNode; label: string }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="min-w-0">{children}</span>
      <InfoTip label={label}>{about}</InfoTip>
    </p>
  )
}

export function StandTable({ rows, area }: { rows: EstimatedTree[]; area: number }) {
  const groups = standTable(rows, area)
  return (
    <div className="overflow-x-auto">
      <TableCaption
        label="About the stand table"
        about="Detected candidates by species assumption / reviewed assignment and estimated or entered DBH in 5 cm classes. This is not a free-growing or well-spaced stocking survey. Known-volume sums omit unavailable estimates."
      >
        Candidates by species and 5 cm DBH class · not a stocking survey
      </TableCaption>
      <EngineeringTable>
        <thead>
          <tr>
            <ColumnHeader label="Species" className="text-left" />
            <ColumnHeader label="DBH" unit="cm" />
            <ColumnHeader label="Count" />
            <ColumnHeader label="Candidates/ha" />
            <ColumnHeader label="Known BA" unit="m²/ha" />
            <ColumnHeader label="Total" unit="m³" />
            <ColumnHeader label="Merchant" unit="m³/ha" />
            <ColumnHeader label="Volume known" />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.species + g.diameter}>
              <td className="text-left">{g.species}</td>
              <td>{g.diameter}</td>
              <td>{g.n}</td>
              <td>{number(g.n_ha)}</td>
              <td>{number(g.basal_ha, 2)}</td>
              <td>{g.known ? number(g.total, 2) : 'Unavailable'}</td>
              <td>{number(g.merchant_ha, 2)}</td>
              <td>
                {g.known}/{g.n}
              </td>
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
      {!groups.length && <EmptyHint className="mt-2">No candidates meet this selection.</EmptyHint>}
    </div>
  )
}
export function MethodTable({
  data,
  method,
  rules,
  reviews,
  polygon,
}: {
  data: InventoryData
  method: string
  rules: InventoryRules
  reviews: Record<string, TreeReview>
  polygon: InventoryPolygon | null
}) {
  const left = inventoryRows(data, method, rules, reviews, polygon).filter((r) => r.review.status !== 'excluded')
  return (
    <div className="overflow-x-auto">
      <TableCaption
        label="About the method comparison"
        about="Greedy nearest canopy-apex matching within 5 m, one-to-one, within each common core. This is cross-method agreement, not accuracy. ForestTools uses 16 m CHM buffers; neural results use their inference buffers; FORA uses core-only returns. Surface crowns and 3D instances are different objects."
      >
        Nearest-apex matches within 5 m · agreement, not accuracy
      </TableCaption>
      <EngineeringTable>
        <thead>
          <tr>
            <ColumnHeader label="Method" className="text-left" />
            <ColumnHeader label="Candidates" />
            <ColumnHeader label="Matched to selected" />
            <ColumnHeader label="Unmatched selected / other" />
            <ColumnHeader label="Mean distance" unit="m" />
            <ColumnHeader label="Other − selected height" unit="m" />
          </tr>
        </thead>
        <tbody>
          {data.methods.map((m) => {
            const right = inventoryRows(data, m.id, rules, reviews, polygon).filter(
                (r) => r.review.status !== 'excluded',
              ),
              match = matchInventories(left, right)
            return (
              <tr key={m.id} aria-selected={method === m.id}>
                <td className="text-left">
                  {m.name}
                  {method === m.id ? ' (selected)' : ''}
                </td>
                <td>{right.length}</td>
                <td>{match.matches.length}</td>
                <td>
                  {match.unmatched_left} / {match.unmatched_right}
                </td>
                <td>{number(match.mean_distance, 2)}</td>
                <td>{number(match.height_difference, 2)}</td>
              </tr>
            )
          })}
        </tbody>
      </EngineeringTable>
    </div>
  )
}
export function ReturnTable({ core, polygon }: { core: CorePoints | null; polygon: InventoryPolygon | null }) {
  if (!core) return <EmptyHint>Open point profiles to load a core’s original returns.</EmptyHint>
  const metrics = returnMetrics(core, polygon)
  if (!metrics) return <EmptyHint>No loaded-core returns inside this selection.</EmptyHint>
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="min-w-0">
        <TableCaption
          label="About the return metrics"
          about="FORA-inspired metrics, restricted to the loaded core. Height percentiles exclude returns ≤0.5 m. Density ratios use all loaded in-scope returns; they are not foliage or pulse density."
        >
          Core {core.chunk} · {metrics.returns.toLocaleString(DEFAULT_LOCALE)} original returns in the selection
        </TableCaption>
        <ReadoutGrid
          minColumnWidth="7rem"
          items={[
            { label: 'Mean', title: 'Mean return height', value: `${number(metrics.mean)} m` },
            { label: 'SD', title: 'Standard deviation of return height', value: `${number(metrics.sd)} m` },
            { label: 'CV', title: 'Coefficient of variation', value: `${number(metrics.cv)}%` },
            { label: '>1.3 m', title: 'Returns above 1.3 m', value: `${number(metrics.cover13 * 100)}%` },
            ...metrics.percentiles.map((p) => ({
              label: `H${p.percentile}`,
              title: `${p.percentile}th height percentile`,
              value: `${number(p.height)} m`,
            })),
            ...metrics.density.map((p) => ({
              label: `D${p.percentile / 10}`,
              title: `Share of in-scope returns above the H${p.percentile} height`,
              value: `${number(p.fraction * 100)}%`,
            })),
          ]}
        />
      </div>
      <div aria-label="Observed return height histogram">
        <RankedBarList
          items={metrics.histogram.map((b, i) => ({
            id: String(b.lower),
            label: `${b.lower}–${i === 7 ? '∞' : b.upper} m`,
            value: b.count,
          }))}
        />
      </div>
    </div>
  )
}
