import { NOVEL_CLIMATE_COLOR, RATING_COLORS } from './palette'
import type { Votes } from './shinyReport'

const VOTE_CLASSES = [
  { name: 'High', color: RATING_COLORS[1] },
  { name: 'Moderate', color: RATING_COLORS[2] },
  { name: 'Low', color: RATING_COLORS[3] },
  { name: 'Unsuitable', color: RATING_COLORS[4] },
  { name: 'Novel climate', color: NOVEL_CLIMATE_COLOR },
]

/** One stacked bar per period: the share of votes in each class, then novel climate when exported. */
export function VoteBars({
  periods,
  votes,
  novelty,
}: {
  periods: readonly string[]
  votes: Record<string, Votes | null | undefined>
  novelty: Record<string, number | null | undefined>
}) {
  const showNovelty = Object.values(novelty).some((value) => value != null)
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-4 text-xs">
        {VOTE_CLASSES.slice(0, showNovelty ? 5 : 4).map((vote) => (
          <span key={vote.name} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: vote.color }} />
            {vote.name}
          </span>
        ))}
      </div>
      {periods.map((period) => {
        const periodVotes = votes[period]
        const values = periodVotes ? (novelty[period] == null ? periodVotes : [...periodVotes, novelty[period]!]) : null
        return (
          <div key={period} className="mb-3">
            <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
              <span>Period {period}</span>
              <span>
                {values
                  ? values.map((v, i) => `${VOTE_CLASSES[i].name} ${(v * 100).toFixed(1)}%`).join(' · ')
                  : 'No complete votes'}
              </span>
            </div>
            {values && (
              <div
                role="img"
                aria-label={`Period ${period} vote proportions`}
                className="flex h-5 overflow-hidden rounded bg-secondary"
              >
                {values.map((v, i) => (
                  <div key={i} style={{ width: `${v * 100}%`, background: VOTE_CLASSES[i].color }} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
