import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { ToggleRow } from '@/components/ui/toggle-row'
import { InlineAlert } from '@/components/ui/map-panels'
import { NumericRangeField, type NumericRangeControlProps } from '@/components/ui/numeric-range-field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatMeasure } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatKm, formatPct } from './measureFormat'
import type { RouteViewshed } from './useRouteViewshed'

/**
 * A road position is continuous: `NumericRangeField` takes a numeric step, and any
 * fixed step would stop End short of the road's exact end, so these ranges render
 * their own native input with `step="any"` behind the shared label and readout.
 */
function continuousRange(accentClassName: string) {
  return function ContinuousRange(control: NumericRangeControlProps) {
    return (
      <input
        {...control}
        type="range"
        step="any"
        className={cn('h-2 w-full', accentClassName)}
        onChange={(event) => control.onChange(Number(event.target.value))}
      />
    )
  }
}

const kmNumber = (metres: number) =>
  formatMeasure(metres / 1000, null, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function RouteViewshedPanel({
  preview,
  driving,
  position,
  onSeek,
  onDrive,
  onRetryTerrain,
}: {
  preview: RouteViewshed
  driving: boolean
  position: number
  onSeek: (distance: number) => void
  onDrive: () => void
  onRetryTerrain?: () => void
}) {
  const { analysis } = preview
  return (
    <section aria-label="Preliminary terrain preview" className="space-y-2 rounded-lg border p-3 text-xs">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        Route preview
        <InfoTip label="About the route preview">
          Terrain visibility along the road before any cutblock is assessed: red is ground in view, purple is terrain
          that did not load. It reads AWS overview terrain only — no trees, buildings, cutblock percentages or VQO
          ratings. Current view follows one road position (pause for a detailed view); Whole stretch joins the views
          from every sample on the blue stretch; As you move keeps adding views as you scrub or drive, through the
          furthest point reached, and starts again when the stretch, radius or eye height changes. Between samples a
          view is not guaranteed.
        </InfoTip>
      </h4>
      <ToggleRow label="Road viewshed" active={preview.enabled} onClick={() => preview.setEnabled(!preview.enabled)} />
      {!preview.valid && <p>Draw or import a road with at least two distinct points.</p>}
      {preview.enabled && preview.valid && (
        <>
          <SegmentedControl
            label="Road visibility coverage"
            size="sm"
            value={preview.mode}
            onChange={preview.setMode}
            options={[
              { value: 'point', label: 'Current view' },
              { value: 'stretch', label: 'Whole stretch' },
              { value: 'travel', label: 'As you move' },
            ]}
          />
          {preview.mode !== 'point' && (
            <>
              <NumericRangeField
                label="Stretch start"
                aria-label="Road stretch start"
                layout="inline"
                valueSeparator=" · "
                display={formatKm(preview.selected.from)}
                min={0}
                max={preview.length}
                value={preview.selected.from}
                renderControl={continuousRange('accent-blue-600')}
                onChange={(value) =>
                  preview.setSelection([
                    Math.max(0, Math.min(value, preview.selected.to - 1)) / preview.length,
                    preview.selection[1],
                  ])
                }
              />
              <NumericRangeField
                label="Stretch end"
                aria-label="Road stretch end"
                layout="inline"
                valueSeparator=" · "
                display={formatKm(preview.selected.to)}
                min={0}
                max={preview.length}
                value={preview.selected.to}
                renderControl={continuousRange('accent-blue-600')}
                onChange={(value) =>
                  preview.setSelection([
                    preview.selection[0],
                    Math.min(preview.length, Math.max(value, preview.selected.from + 1)) / preview.length,
                  ])
                }
              />
              <p data-route-viewshed-samples className="text-2xs text-muted-foreground">
                {preview.sampleCount} {preview.sampleCount === 1 ? 'viewpoint' : 'viewpoints'} · samples up to{' '}
                {Math.ceil(preview.selected.spacing)} m apart ·{' '}
                {preview.analysis.overlayResult?.sourceResolutionMeters
                  ? `${Math.ceil(preview.analysis.overlayResult.sourceResolutionMeters)} m terrain source`
                  : 'overview terrain'}
              </p>
              {preview.mode === 'travel' && (
                <>
                  <Button size="sm" variant="outline" onClick={preview.resetTravel}>
                    Reset accumulated views
                  </Button>
                </>
              )}
            </>
          )}
          <NumericRangeField
            label="Preview radius"
            aria-label="Road viewshed radius"
            layout="inline"
            valueSeparator=" · "
            display={formatKm(preview.radius, 1)}
            min={500}
            max={5000}
            step={500}
            value={preview.radius}
            inputClassName="accent-rose-600"
            onChange={preview.setRadius}
          />
          {!driving && (
            <>
              <NumericRangeField
                label="Road sample"
                aria-label="Road viewshed position"
                layout="inline"
                valueSeparator=" · "
                display={`${kmNumber(position)} / ${formatKm(preview.length)}`}
                min={0}
                max={preview.length}
                value={Math.min(position, preview.length)}
                renderControl={continuousRange('accent-rose-600')}
                onChange={onSeek}
              />
              <Button size="sm" variant="outline" className="w-full touch:h-10" onClick={onDrive}>
                Open route overview
              </Button>
            </>
          )}
          <div data-route-viewshed-status>
            <InlineAlert loading={!analysis.result && !analysis.error} tone={analysis.error ? 'warning' : 'info'}>
              {analysis.message}
              {analysis.cacheHit && analysis.result ? ' · cached view' : ''}
            </InlineAlert>
          </div>
          {analysis.result && (
            <p>
              {formatPct((100 * analysis.result.counts.visibleB) / Math.max(1, analysis.result.counts.total))} of
              sampled terrain visible ·{' '}
              {formatPct((100 * analysis.result.counts.unknown) / Math.max(1, analysis.result.counts.total))} unknown
            </p>
          )}
          {(analysis.error || !!analysis.result?.counts.unknown) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                preview.retry()
                onRetryTerrain?.()
              }}
            >
              Retry road terrain
            </Button>
          )}
        </>
      )}
    </section>
  )
}
