import type { DriveState } from './Sidebar'
import type { ForestHistoryData } from './bcForestHistory'
import type { RegrowthStand } from './regrowth'
import { DEFAULT_LOCALE } from '@/lib/format'
import { InfoTip } from '@/components/ui/info-tip'

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
  const count = (basis: RegrowthStand['basis']) => stands.filter((s) => s.basis === basis).length
  return (
    <div className="space-y-2 rounded-md border border-border p-2 text-xs" aria-label="Existing forest and regrowth">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          Existing forest
          <InfoTip label="About existing forest and regrowth">
            Harvest, planting and forest-cover records from DataBC set the drawn trees&rsquo; heights for {year}.
            Projections add the assumed growth since the recorded year; turn them off to use the recorded height.
            Planting and harvest estimates start at 0.3 m and assume regeneration after the delay, which does not
            confirm planting. Growth stops at the regional stand height without shrinking a taller recorded tree, and a
            partial harvest keeps an illustrative share of mature trees. Counts are source polygons, not coverage; newer
            overlapping records win. Spacing, survival and growth are illustrative, and the assessment numbers never use
            them.
          </InfoTip>
        </span>
        <label className="flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Load existing forest for this route"
            checked={drive.existingForest}
            onChange={(e) => update({ existingForest: e.target.checked, playing: false })}
          />
          Load
        </label>
      </div>
      <p role="status" className="text-2xs text-muted-foreground">
        {loading
          ? 'Loading harvest, planting and forest-cover records…'
          : `${count('recorded')} recorded heights · ${count('height projection')} projected heights · ${count('planting estimate')} planting estimates · ${count('harvest estimate')} harvest-age estimates`}
      </p>
      {unknown > 0 && (
        <p className="text-2xs text-muted-foreground">
          {unknown} records lack a usable height, date or clearcut share.
        </p>
      )}
      {data?.issues.map((issue) => (
        <p role="alert" key={issue} className="text-2xs text-amber-800 dark:text-amber-200">
          {issue}
        </p>
      ))}
      {!!data?.issues.length && (
        <button
          type="button"
          className="rounded border px-2 py-1"
          onClick={() => {
            update({ playing: false })
            retry()
          }}
        >
          Retry forest data
        </button>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Project older heights to visual year"
          checked={drive.projectRecordedHeights}
          onChange={(e) => update({ projectRecordedHeights: e.target.checked, playing: false })}
        />
        Project older heights to {year}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-2xs text-muted-foreground">
          Growth, m/yr
          <input
            aria-label="Assumed height growth"
            type="number"
            min="0.1"
            max="1"
            step="0.05"
            className="mt-0.5 block h-7 w-full rounded border bg-background px-1 text-xs text-foreground"
            value={drive.growthMetersPerYear}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 0.1 && n <= 1) update({ growthMetersPerYear: n, playing: false })
            }}
          />
        </label>
        <label className="block text-2xs text-muted-foreground">
          Regrowth delay, yr
          <input
            aria-label="Regeneration delay"
            type="number"
            min="0"
            max="10"
            step="1"
            className="mt-0.5 block h-7 w-full rounded border bg-background px-1 text-xs text-foreground"
            value={drive.regenerationLagYears}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 0 && n <= 10) update({ regenerationLagYears: n, playing: false })
            }}
          />
        </label>
      </div>
      {!!stands.length && (
        <details className="text-2xs">
          <summary className="cursor-pointer text-muted-foreground">Height sources and dates</summary>
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {stands.slice(0, 30).map((s) => (
              <li key={s.recordId} className="break-words py-0.5">
                {s.basis} · {s.heightMeters?.toFixed(1)} m · {s.referenceYear ?? 'date unknown'} · {s.recordId}
                {s.basis === 'height projection' && ` (recorded ${s.recordedHeightMeters?.toFixed(1)} m)`}
              </li>
            ))}
          </ul>
          {stands.length > 30 && <p>Showing 30 of {stands.length} records.</p>}
          {data && (
            <p className="mt-1 text-muted-foreground">
              DataBC harvest, RESULTS planting and forest cover · loaded{' '}
              {new Date(data.retrievedAt).toLocaleString(DEFAULT_LOCALE)}
            </p>
          )}
        </details>
      )}
    </div>
  )
}
