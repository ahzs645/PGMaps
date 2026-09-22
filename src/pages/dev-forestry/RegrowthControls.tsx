import type { DriveState } from './Sidebar'
import type { ForestHistoryData } from './bcForestHistory'
import type { RegrowthStand } from './regrowth'

type Props = {
  drive: DriveState
  update: (patch: Partial<DriveState>) => void
  year: number
  loading: boolean
  data: ForestHistoryData | null
  stands: RegrowthStand[]
  unknown: number
  retry: () => void
}
export function RegrowthControls({ drive, update, year, loading, data, stands, unknown, retry }: Props) {
  return (
    <div className="rounded border p-2 text-xs space-y-2" aria-label="Existing forest and regrowth">
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={drive.existingForest}
          onChange={(e) => update({ existingForest: e.target.checked, playing: false })}
        />
        Load existing forest for this route
      </label>
      <p role="status">
        {loading
          ? 'Loading harvest, planting and forest-cover records…'
          : `${stands.filter((s) => s.basis === 'recorded').length} recorded heights · ${stands.filter((s) => s.basis === 'height projection').length} projected heights · ${stands.filter((s) => s.basis === 'planting estimate').length} planting estimates · ${stands.filter((s) => s.basis === 'harvest estimate').length} harvest-age estimates`}
      </p>
      {unknown > 0 && (
        <p>{unknown} records lack a usable height/date/clearcut share; other available forest context is retained.</p>
      )}
      {data?.issues.map((issue) => (
        <p role="alert" key={issue}>
          {issue}
        </p>
      ))}
      {!!data?.issues.length && (
        <button
          className="rounded border px-2 py-1"
          onClick={() => {
            update({ playing: false })
            retry()
          }}
        >
          Retry forest data
        </button>
      )}
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={drive.projectRecordedHeights}
          onChange={(e) => update({ projectRecordedHeights: e.target.checked, playing: false })}
        />
        Project older heights to visual year
      </label>
      <label className="block">
        Assumed height growth (m/year)
        <input
          aria-label="Assumed height growth"
          type="number"
          min="0.1"
          max="1"
          step="0.05"
          className="ml-2 w-16 rounded border bg-background px-1"
          value={drive.growthMetersPerYear}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 0.1 && n <= 1) update({ growthMetersPerYear: n, playing: false })
          }}
        />
      </label>
      <label className="block">
        Regeneration delay after harvest (years)
        <input
          aria-label="Regeneration delay"
          type="number"
          min="0"
          max="10"
          step="1"
          className="ml-2 w-12 rounded border bg-background px-1"
          value={drive.regenerationLagYears}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 0 && n <= 10) update({ regenerationLagYears: n, playing: false })
          }}
        />
      </label>
      <p>
        Visual year {year}. Projections add assumed growth since the recorded year; turn them off to use the original
        height. Planting/harvest estimates start at 0.3 m. Growth is capped at the regional stand height, without
        reducing a taller recorded tree. Harvest estimates assume regeneration after the delay; they do not confirm
        planting. Partial harvest retains an illustrative mature-tree share.
      </p>
      <p>
        Counts are source polygons, not coverage percentages. Newer overlapping records take priority. Outside the
        lookup, other inventory or regional assumptions apply. Tree spacing, survival and growth are illustrative;
        assessment numbers do not use these estimates.
      </p>
      {!!stands.length && (
        <details>
          <summary className="cursor-pointer">Height sources and dates</summary>
          <ul className="max-h-40 overflow-y-auto">
            {stands.slice(0, 30).map((s) => (
              <li key={s.recordId} className="py-1 break-words">
                {s.basis} · {s.heightMeters?.toFixed(1)} m · {s.referenceYear ?? 'date unknown'} · {s.recordId}
                {s.basis === 'height projection' && ` (recorded ${s.recordedHeightMeters?.toFixed(1)} m)`}
              </li>
            ))}
          </ul>
          {stands.length > 30 && <p>Showing 30 of {stands.length} records.</p>}
        </details>
      )}
      {data && (
        <p>DataBC harvest + RESULTS planting/forest cover · loaded {new Date(data.retrievedAt).toLocaleString()}</p>
      )}
    </div>
  )
}
