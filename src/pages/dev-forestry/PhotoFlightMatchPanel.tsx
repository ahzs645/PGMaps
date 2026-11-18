import { Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisclosureCard } from '@/components/ui/disclosure'
import { SelectField } from '@/components/ui/form-field'
import { planFlightMatches } from './photoFlightMatching'
import { PHOTO_MATCHERS, isPhotoMatcher, type PhotoMatcher } from './photoMatchers'
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
    <DisclosureCard
      title="Match flight photos"
      summary={`${anchors.length} accepted · ${targets.length} to review${options.length ? ` · ${options.length} suggested` : ''}`}
      contentClassName="space-y-2 leading-5"
    >
      <>
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
        <SelectField
          label="Matcher"
          value={photo.flightMatcher}
          disabled={running}
          onChange={(event) => {
            const matcher = event.currentTarget.value
            if (isPhotoMatcher(matcher)) photo.setFlightMatcher(matcher)
          }}
        >
          {(Object.keys(PHOTO_MATCHERS) as PhotoMatcher[]).map((matcher) => (
            <option key={matcher} value={matcher}>
              {PHOTO_MATCHERS[matcher].label}
              {PHOTO_MATCHERS[matcher].megabytes === null
                ? ' · built in'
                : ` · ${PHOTO_MATCHERS[matcher].megabytes} MB, trial`}
            </option>
          ))}
        </SelectField>
        {photo.flightMatcher === 'aliked-lightglue' && (
          <p className="text-muted-foreground">
            A learned matcher for pairs XFeat leaves unmatched: a change of lens between the two photos, or a wider gap.
            The first run loads its models from this site; the photos stay on this device. It is slower.
          </p>
        )}
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
                  {PHOTO_MATCHERS[sameFlight.matcher ?? 'xfeat'].label}: {sameFlight.attempted}{' '}
                  {sameFlight.attempted === 1 ? 'pair' : 'pairs'} tried · {sameFlight.overlapping} with overlap ·{' '}
                  {options.length} {options.length === 1 ? 'photo' : 'photos'} with a camera suggestion
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
      </>
    </DisclosureCard>
  )
}
