import { Button } from '@/components/ui/button'
import { ToggleRow } from '@/components/ui/toggle-row'
import { InlineAlert } from '@/components/ui/map-panels'
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
      <h4 className="font-semibold text-sm">Preliminary terrain preview</h4>
      <p className="text-muted-foreground">
        Explore terrain visibility along the drawn or snapped road before running a cutblock assessment. Red is visible
        ground; purple is unknown terrain.
      </p>
      <ToggleRow label="Road viewshed" active={preview.enabled} onClick={() => preview.setEnabled(!preview.enabled)} />
      {!preview.valid && <p>Draw or import a road with at least two distinct points.</p>}
      {preview.enabled && preview.valid && (
        <>
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
                  step={5}
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
      <p className="text-muted-foreground">
        AWS overview terrain for preliminary screening. Trees, buildings, cutblock percentages and VQO ratings are not
        assessed. Pause for a detailed view at your position.
      </p>
    </section>
  )
}
