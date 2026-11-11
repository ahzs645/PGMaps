import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { ToggleRow } from '@/components/ui/toggle-row'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { RouteViewshed } from './useRouteViewshed'

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
              <label className="block">
                Stretch start · {(preview.selected.from / 1000).toFixed(2)} km
                <input
                  type="range"
                  aria-label="Road stretch start"
                  min={0}
                  max={preview.length}
                  step="any"
                  value={preview.selected.from}
                  className="mt-1 w-full accent-blue-600"
                  onChange={(event) =>
                    preview.setSelection([
                      Math.max(0, Math.min(Number(event.target.value), preview.selected.to - 1)) / preview.length,
                      preview.selection[1],
                    ])
                  }
                />
              </label>
              <label className="block">
                Stretch end · {(preview.selected.to / 1000).toFixed(2)} km
                <input
                  type="range"
                  aria-label="Road stretch end"
                  min={0}
                  max={preview.length}
                  step="any"
                  value={preview.selected.to}
                  className="mt-1 w-full accent-blue-600"
                  onChange={(event) =>
                    preview.setSelection([
                      preview.selection[0],
                      Math.min(preview.length, Math.max(Number(event.target.value), preview.selected.from + 1)) /
                        preview.length,
                    ])
                  }
                />
              </label>
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
          <label className="block">
            Preview radius · {(preview.radius / 1000).toFixed(1)} km
            <input
              type="range"
              aria-label="Road viewshed radius"
              min={500}
              max={5000}
              step={500}
              value={preview.radius}
              onChange={(event) => preview.setRadius(Number(event.target.value))}
              className="mt-1 w-full accent-rose-600"
            />
          </label>
          {!driving && (
            <>
              <label className="block">
                Road sample · {(position / 1000).toFixed(2)} / {(preview.length / 1000).toFixed(2)} km
                <input
                  type="range"
                  aria-label="Road viewshed position"
                  min={0}
                  max={preview.length}
                  step="any"
                  value={Math.min(position, preview.length)}
                  onChange={(event) => onSeek(Number(event.target.value))}
                  className="mt-1 w-full accent-rose-600"
                />
              </label>
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
              {((100 * analysis.result.counts.visibleB) / Math.max(1, analysis.result.counts.total)).toFixed(1)}% of
              sampled terrain visible ·{' '}
              {((100 * analysis.result.counts.unknown) / Math.max(1, analysis.result.counts.total)).toFixed(1)}% unknown
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
