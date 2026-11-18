import { Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { planFlightMatches } from './photoFlightMatching'
import type { FieldPhotoState } from './useFieldPhoto'

export function PhotoFlightMatchPanel({ photo }: { photo: FieldPhotoState }) {
  const selected = photo.own
  const flightId = selected?.flightId
  if (!flightId) return null
  const { anchors, targets, pairs } = planFlightMatches(photo.flightMatchFrames, flightId)
  if (anchors.length + targets.length < 2) return null

  const progress = photo.flightMatchProgress
  const sameFlight = progress?.flightId === flightId ? progress : null
  const running = progress?.phase === 'matching'
  const options = targets.flatMap((target) => {
    const candidate = photo.optionsFor(target.id).find((option) => option.overlap)
    return candidate?.overlap ? [{ target, overlap: candidate.overlap }] : []
  })

  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Match flight photos</summary>
      <div className="mt-2 space-y-2 text-xs leading-5">
        <p className="text-muted-foreground">
          Match shared features against accepted photos from this flight. Open a result to adjust it in Camera options.
          Accept a checked result and rerun to use it as another reference.
        </p>
        <p className="text-muted-foreground tabular-nums">
          {anchors.length} accepted {anchors.length === 1 ? 'reference' : 'references'} · {targets.length} to review
        </p>
        {!anchors.length && <p>Check and accept one camera in the Use tab to start this flight.</p>}
        {!!anchors.length && !!targets.length && !pairs.length && (
          <p>No targets with a position close to an accepted reference.</p>
        )}
        {!targets.length && <p>Every camera in this flight is accepted.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="touch:h-10"
            disabled={running || !pairs.length}
            onClick={() => void photo.runFlightMatch(flightId)}
          >
            {running && sameFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Find shared features
          </Button>
          {running && (
            <Button type="button" variant="ghost" size="sm" className="touch:h-10" onClick={photo.cancelFlightMatch}>
              Cancel match
            </Button>
          )}
        </div>
        {sameFlight && (
          <div role="status" className="text-muted-foreground">
            {sameFlight.phase === 'matching' &&
              `Comparing ${Math.min(sameFlight.attempted + 1, sameFlight.total)} of ${sameFlight.total} pairs${sameFlight.targetName ? ` · ${sameFlight.targetName}` : '…'}`}
            {sameFlight.phase === 'cancelled' && 'Flight match cancelled.'}
            {sameFlight.phase === 'failed' && `Flight match could not finish. ${sameFlight.message ?? 'Try again.'}`}
            {sameFlight.phase === 'done' && (
              <>
                <p className="tabular-nums">
                  {sameFlight.attempted} {sameFlight.attempted === 1 ? 'pair' : 'pairs'} tried ·{' '}
                  {sameFlight.overlapping} with overlap · {options.length} {options.length === 1 ? 'photo' : 'photos'}{' '}
                  with a camera suggestion
                </p>
                {!!sameFlight.failed && <p>{sameFlight.failed} pairs could not be processed.</p>}
                {!options.length && <p>Try another accepted reference from the flight, or pair landmarks by hand.</p>}
              </>
            )}
          </div>
        )}
        {!!options.length && (
          <ul aria-label="Flight camera suggestions" className="space-y-1">
            {options.map(({ target, overlap }) => (
              <li key={target.id} className="flex flex-wrap items-center justify-between gap-x-2">
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto p-0 text-xs touch:min-h-10"
                  disabled={target.id === selected.id}
                  onClick={() => photo.selectOwnPhoto(target.id)}
                >
                  {target.name}
                </Button>
                <span className="text-muted-foreground tabular-nums">
                  {overlap.basis === 'terrain' ? 'Terrain' : 'Image geometry'} · {overlap.p90Px.toFixed(1)} px at the
                  90th percentile
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
