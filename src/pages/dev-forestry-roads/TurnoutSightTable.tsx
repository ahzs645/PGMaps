import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { formatRoadStation } from './Charts'
import { TURNOUT_MAX_SPACING_M, type TurnoutLook, type TurnoutSightReview } from './turnoutSight'

const LOOK_TEXT: Record<TurnoutLook, string> = {
  clear: 'sees',
  surface: 'blocked',
  vegetation: 'trees',
  unknown: 'unknown',
  'no-surface': 'unknown',
}

/**
 * Consecutive turnouts on a single-lane road, each pair looked at both ways (`turnoutSight.ts`).
 * The Review list carries the same check.
 */
export function TurnoutSightTable({
  review,
  station,
  onStation,
}: {
  review: TurnoutSightReview
  station: number
  onStation: (chainage: number) => void
}) {
  if (review.status === 'two-lane') return null
  if (review.status !== 'checked')
    return review.status === 'too-few' && review.singleLane ? (
      <p className="text-2xs text-muted-foreground" data-testid="road-turnout-sight">
        Turnouts: {review.turnouts.length === 0 ? 'none entered' : 'one entered'}, so no pair to check for
        intervisibility.
      </p>
    ) : null
  return (
    <div className="max-h-40 overflow-auto overscroll-none" data-testid="road-turnout-sight">
      <EngineeringTable>
        <caption className="text-left text-2xs text-muted-foreground">
          Turnouts intervisible, at most {TURNOUT_MAX_SPACING_M} m apart (BC Engineering Manual §3.5.2.6)
        </caption>
        <thead className="sticky top-0">
          <tr>
            <ColumnHeader label="From" />
            <ColumnHeader label="To" />
            <ColumnHeader label="Apart" unit="m" />
            <ColumnHeader label="Ahead" />
            <ColumnHeader label="Back" />
          </tr>
        </thead>
        <tbody>
          {review.pairs.map((pair) => (
            <tr
              key={`${pair.from.id}-${pair.to.id}`}
              className="cursor-pointer"
              data-testid="road-turnout-pair"
              data-intervisible={String(pair.intervisible)}
              tabIndex={0}
              onClick={() => onStation(pair.from.chainage)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onStation(pair.from.chainage)
              }}
              aria-selected={Math.abs(station - pair.from.chainage) < 1e-6}
              title={
                pair.blocking
                  ? `Highest obstruction ${pair.blocking.aboveLineM.toFixed(2)} m above the line at ${formatRoadStation(pair.blocking.chainage)}, ${Math.abs(pair.blocking.offset).toFixed(1)} m ${pair.blocking.offset < 0 ? 'left' : 'right'} of the centreline`
                  : undefined
              }
            >
              <td>
                {pair.from.name} {formatRoadStation(pair.from.chainage)}
              </td>
              <td>
                {pair.to.name} {formatRoadStation(pair.to.chainage)}
              </td>
              <td className={pair.spacingMet ? undefined : 'font-medium text-destructive'}>
                {Math.round(pair.spacingM).toLocaleString('en-CA')}
              </td>
              {[pair.ahead, pair.back].map((look, i) => (
                <td
                  key={i}
                  className={look === 'surface' || look === 'vegetation' ? 'font-medium text-destructive' : undefined}
                >
                  {LOOK_TEXT[look]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
    </div>
  )
}
