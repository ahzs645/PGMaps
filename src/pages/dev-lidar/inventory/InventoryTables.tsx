import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { DEFAULT_LOCALE } from '@/lib/format'
import type { InventoryData, InventoryRules, TreeReview } from './types'
import { standTable, inventoryRows, matchInventories, type EstimatedTree } from './summary'
import type { InventoryPolygon } from './geometry'
import { number } from './InventoryDetail'
import { returnMetrics, type CorePoints } from './useInventoryPoints'
export function StandTable({ rows, area }: { rows: EstimatedTree[]; area: number }) {
  const groups = standTable(rows, area)
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-3xs">
        Detected candidates by species assumption / reviewed assignment and estimated or entered DBH in 5 cm classes.
        This is not a free-growing or well-spaced stocking survey. Known-volume sums omit unavailable estimates.
      </p>
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
      {!groups.length && <p className="p-3 text-xs">No candidates meet this selection.</p>}
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
      <p className="mb-2 text-3xs">
        Greedy nearest canopy-apex matching within 5 m, one-to-one, within each common core. This is cross-method
        agreement, not accuracy. ForestTools uses 16 m CHM buffers; neural results use their inference buffers; FORA
        uses core-only returns. Surface crowns and 3D instances are different objects.
      </p>
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
              <tr key={m.id}>
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
  if (!core) return <p className="text-xs">Open point profiles to load a core’s original returns.</p>
  const metrics = returnMetrics(core, polygon)
  if (!metrics) return <p className="text-xs">No loaded-core returns inside this selection.</p>
  return (
    <div className="grid gap-3 text-xs md:grid-cols-2">
      <div>
        <p className="text-3xs">
          FORA-inspired metrics, restricted to loaded core {core.chunk}:{' '}
          {metrics.returns.toLocaleString(DEFAULT_LOCALE)} original returns inside the selection. Height percentiles
          exclude returns ≤0.5 m. Density ratios use all loaded in-scope returns; they are not foliage or pulse density.
        </p>
        <p>
          Mean {number(metrics.mean)} m · SD {number(metrics.sd)} m · CV {number(metrics.cv)}% · returns above 1.3 m{' '}
          {number(metrics.cover13 * 100)}%
        </p>
        <p>{metrics.percentiles.map((p) => `H${p.percentile}: ${number(p.height)} m`).join(' · ')}</p>
        <p>{metrics.density.map((p) => `D${p.percentile / 10}: ${number(p.fraction * 100)}%`).join(' · ')}</p>
      </div>
      <div aria-label="Observed return height histogram">
        {metrics.histogram.map((b, i) => (
          <div className="flex items-center gap-2" key={b.lower}>
            <span className="w-16">
              {b.lower}–{i === 7 ? '∞' : b.upper} m
            </span>
            <span className="h-2 bg-emerald-600" style={{ width: `${(b.count / metrics.returns) * 65}%` }} />
            <span>{b.count.toLocaleString(DEFAULT_LOCALE)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
