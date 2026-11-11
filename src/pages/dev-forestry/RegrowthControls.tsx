import type { DriveState } from './Sidebar'
import type { ForestHistoryData } from './bcForestHistory'
import type { RegrowthStand } from './regrowth'
import { DEFAULT_LOCALE, formatMeasure } from '@/lib/format'
import { ToolSection } from '@/components/ui/tool-section'
import { Button } from '@/components/ui/button'
import { CheckboxField, NumberField } from '@/components/ui/form-field'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'

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
const metres = (value: number | null | undefined) =>
  formatMeasure(value, 'm', { minimumFractionDigits: 1, maximumFractionDigits: 1, fallback: 'unknown' })

export function RegrowthControls({ drive, update, year, loading, data, stands, unknown, retry }: Props) {
  const count = (basis: RegrowthStand['basis']) => stands.filter((s) => s.basis === basis).length
  return (
    <ToolSection
      title="Existing forest and regrowth"
      aria-label="Existing forest and regrowth"
      className="space-y-2 text-xs"
      actions={
        <CheckboxField
          label="Load"
          aria-label="Load existing forest for this route"
          labelClassName="items-center text-xs text-muted-foreground"
          checked={drive.existingForest}
          onCheckedChange={(existingForest) => update({ existingForest, playing: false })}
        />
      }
      help={
        <>
          Harvest, planting and forest-cover records from DataBC set the drawn trees&rsquo; heights for {year}.
          Projections add the assumed growth since the recorded year; turn them off to use the recorded height. Planting
          and harvest estimates start at 0.3 m and assume regeneration after the delay, which does not confirm planting.
          Growth stops at the regional stand height without shrinking a taller recorded tree, and a partial harvest
          keeps an illustrative share of mature trees. Counts are source polygons, not coverage; newer overlapping
          records win. Spacing, survival and growth are illustrative, and the assessment numbers never use them.
        </>
      }
    >
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
      {!!data?.issues.length && (
        <InlineAlert tone="warning">
          <div role="alert" className="space-y-1">
            {data.issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 touch:h-10"
            onClick={() => {
              update({ playing: false })
              retry()
            }}
          >
            Retry forest data
          </Button>
        </InlineAlert>
      )}
      <CheckboxField
        label={`Project older heights to ${year}`}
        aria-label="Project older heights to visual year"
        checked={drive.projectRecordedHeights}
        onCheckedChange={(projectRecordedHeights) => update({ projectRecordedHeights, playing: false })}
      />
      {/* Numbers hold a partial or out-of-range draft and settle on blur, so a value can be cleared and retyped. */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Growth"
          aria-label="Assumed height growth"
          suffix="m/yr"
          min={0.1}
          max={1}
          step={0.05}
          value={drive.growthMetersPerYear}
          onValueChange={(growthMetersPerYear) => update({ growthMetersPerYear, playing: false })}
        />
        <NumberField
          label="Regrowth delay"
          aria-label="Regeneration delay"
          suffix="yr"
          min={0}
          max={10}
          step={1}
          value={drive.regenerationLagYears}
          onValueChange={(regenerationLagYears) => update({ regenerationLagYears, playing: false })}
        />
      </div>
      {!!stands.length && (
        <CollapsibleSection
          label="Height sources and dates"
          className="-mx-3 border-b-0 border-t border-border/60 bg-transparent text-2xs"
          contentClassName="px-3 pb-1"
        >
          <ul className="max-h-40 overflow-y-auto">
            {stands.slice(0, 30).map((s) => (
              <li key={s.recordId} className="break-words py-0.5">
                {s.basis} · {metres(s.heightMeters)} · {s.referenceYear ?? 'date unknown'} · {s.recordId}
                {s.basis === 'height projection' && ` (recorded ${metres(s.recordedHeightMeters)})`}
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
        </CollapsibleSection>
      )}
    </ToolSection>
  )
}
