import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'

import type { PhotoLocationCandidate, PhotoLocationSearch, PhotoLocationSpread } from './photoLocationSearch'

/** The headings a tie leaves open, as words: one heading, or the arc clockwise from one to the other. */
function headingSpan({ from, to }: PhotoLocationSpread['headings']) {
  return Math.round(from) === Math.round(to) ? `${Math.round(from)}°` : `${Math.round(from)}° to ${Math.round(to)}°`
}

/**
 * A location search's result (*Search round here*, *Search another area…*, or the background search round the high
 * ground or the fix): the places that fit, and a start to use only when one stands clearly ahead. A near tie is
 * named by how far apart its fits are, and nothing is offered: the top of a tie is not a suggestion.
 */
export function LocationResults({
  search,
  onUse,
  onPair,
  placing,
  onTryTexture,
  quiet = false,
}: {
  search: PhotoLocationSearch
  /** Offered beside each place of a clear result; absent where the best place is already an options row. */
  onUse?: (candidate: PhotoLocationCandidate) => void
  onPair?: () => void
  placing?: boolean
  onTryTexture?: () => void
  /** The background search's result: a clear best place is a row in the options, so only a tie or a miss is said. */
  quiet?: boolean
}) {
  if (search.status === 'searching')
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {search.otherReaders
          ? `Reading the skyline another way at ${search.checked} of ${search.total} places`
          : `Checking the skyline at ${search.checked} of ${search.total} places`}
      </p>
    )
  if (search.status === 'error') return <InlineAlert tone="warning">{search.message}</InlineAlert>
  const pair = onPair && (
    <Button type="button" variant="outline" size="xs" onClick={onPair}>
      {placing ? 'Cancel landmark pick' : 'Pair a landmark'}
    </Button>
  )
  if (!search.candidates.length)
    return (
      <div className="space-y-1">
        {!quiet && search.centre && (
          <p className="text-xs text-muted-foreground">
            Search area: nine trial sites on a 500 m grid centred at {search.centre.lat.toFixed(5)},{' '}
            {search.centre.lng.toFixed(5)}.
          </p>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          {search.noSkyline
            ? 'Too little usable skyline. Set an approximate camera position and pair a landmark.'
            : search.sampled
              ? 'No clear skyline match at these places.'
              : 'Terrain could not be read at these places.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {pair}
          {onTryTexture && (search.sampled > 0 || search.noSkyline) && (
            <Button type="button" variant="outline" size="xs" onClick={onTryTexture}>
              Try texture fallback
            </Button>
          )}
        </div>
      </div>
    )
  if (!search.ambiguous && quiet) return null
  return (
    <div className="space-y-1.5">
      {search.textureFallback && (
        <p className="text-xs text-muted-foreground">
          Experimental texture match. Check a landmark before using it in a report.
        </p>
      )}
      {search.centre && !quiet && (
        <p className="text-xs text-muted-foreground">
          Nine sites on a 500 m grid centred at {search.centre.lat.toFixed(5)}, {search.centre.lng.toFixed(5)}.
        </p>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        {search.ambiguous
          ? `Several places fit about as well${
              search.spread
                ? `, up to ${Math.round(search.spread.metres)} m apart and facing ${headingSpan(search.spread.headings)}`
                : ''
            }: none is offered as a start. Pair a landmark to tell them apart.`
          : `Searched at ${search.basis.hfov.toFixed(0)}° across. Check a start's model view against landmarks before accepting it.`}
      </p>
      <ol className="space-y-1" aria-label={search.ambiguous ? 'Fits about as good as each other' : 'Places that fit'}>
        {search.candidates.map((candidate, index) => (
          <li
            key={`${candidate.lng},${candidate.lat}`}
            className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums"
          >
            <span>
              {candidate.lat.toFixed(5)}, {candidate.lng.toFixed(5)} · {candidate.fit.bearing.toFixed(0)}° ·{' '}
              {candidate.fit.fit.agreeing} skyline samples
            </span>
            {!search.ambiguous && onUse && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="touch:h-10"
                aria-label={`Use place ${index + 1} as a starting camera`}
                onClick={() => onUse(candidate)}
              >
                Use as a start
              </Button>
            )}
          </li>
        ))}
      </ol>
      {search.ambiguous && pair}
    </div>
  )
}
