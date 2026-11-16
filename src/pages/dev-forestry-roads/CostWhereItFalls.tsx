/**
 * "Where it falls" in the cost dialog: one cost row (or the whole estimate) spread along the road
 * (`costAttribution.ts`), as its costliest fixed-length stretches and the part with no place on the
 * road. A stretch's click hands the page its station range and governing station; the page frames
 * it on the plan and opens its section. Nothing here re-prices: the stretches and the part off the
 * road add up to the row's amount.
 */
import { useMemo, useState } from 'react'
import { Palette } from 'lucide-react'
import { ResultRow } from '@/components/ui/result-list'
import { TextButton } from '@/components/ui/text-button'
import { costStretches, rankStretches, type CostAttribution, type CostSeriesId } from './costAttribution'
import { formatStationLabel, type RoadStationing } from './roadStationing'

/** The stretch lengths offered, in metres. */
export const COST_STRETCH_LENGTHS_M = [20, 50, 100, 200, 500] as const
/** Stretches listed before "Show all". */
export const COST_STRETCHES_SHOWN = 5

/** The offered stretch length nearest a tenth of the road (by ratio, so 70 m reads as 50, not 100). */
export function defaultStretchLength(roadLengthM: number): number {
  const target = roadLengthM / 10
  if (!(target > 0)) return COST_STRETCH_LENGTHS_M[0]
  return COST_STRETCH_LENGTHS_M.reduce((best, length) =>
    Math.abs(Math.log(length / target)) < Math.abs(Math.log(best / target)) ? length : best,
  )
}

/** A stretch picked in the dialog, for the plan to frame and the section to open. */
export interface CostStretchFocus {
  rowId: CostSeriesId
  /** The row and the station range, for the selection chip. */
  label: string
  start: number
  end: number
  /** The interval end with the highest cost per metre in the stretch; null when nothing there costs. */
  peakChainage: number | null
}

const MONEY = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const QUANTITY = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 })
const WHOLE = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const SHARE = new Intl.NumberFormat('en-CA', { style: 'percent', maximumFractionDigits: 1 })
const money = (value: number) => `${value < 0 ? '−' : ''}$${MONEY.format(Math.abs(value))}`

export function CostWhereItFalls({
  attribution,
  id,
  stretchLengthM,
  stationing,
  onFocusStretch,
  colouring,
  onColourBy,
}: {
  attribution: CostAttribution
  /** A row id, or the whole estimate. */
  id: CostSeriesId
  stretchLengthM: number
  /** The road's own stationing, so ranges read as the road is stationed. */
  stationing?: RoadStationing | null
  onFocusStretch?: (focus: CostStretchFocus) => void
  /** The plan is coloured by this row now. */
  colouring?: boolean
  onColourBy?: (id: CostSeriesId) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const row = id === 'total' ? undefined : attribution.rows.find((r) => r.rowId === id)
  const ranked = useMemo(
    () => rankStretches(costStretches(attribution, id, stretchLengthM)),
    [attribution, id, stretchLengthM],
  )
  if (id !== 'total' && !row) return null
  const label = row?.label ?? 'Whole estimate'
  const shown = showAll ? ranked : ranked.slice(0, COST_STRETCHES_SHOWN)
  const station = (chainage: number) => formatStationLabel(chainage, stationing)
  const range = (start: number, end: number) => `${station(start)}–${station(end)}`
  // What has no place on the road: one row's own part, or every row's for the whole estimate.
  const unplaced = (row ? [row] : attribution.rows).filter((r) => r.unplacedReason && r.unplaced !== 0)
  const unplacedTotal = row ? row.unplaced : attribution.unplacedTotal
  return (
    <div className="space-y-1.5 text-xs" data-testid="road-cost-where-it-falls" data-cost-series={id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">
          {row
            ? row.driverLabel
              ? `Spread by ${row.driverLabel}, ${stretchLengthM} m stretches`
              : `Each item where it is, ${stretchLengthM} m stretches`
            : `Every row, ${stretchLengthM} m stretches`}
        </span>
        {onColourBy && (
          <TextButton aria-pressed={!!colouring} onClick={() => onColourBy(id)} disabled={colouring}>
            <Palette className="size-3.5" aria-hidden />
            {colouring ? 'Road coloured by this' : 'Colour road by this'}
          </TextButton>
        )}
      </div>
      {ranked.length > 0 ? (
        <ol className="divide-y overflow-hidden rounded-md border" aria-label={`Costliest stretches · ${label}`}>
          {shown.map((stretch) => {
            const where = range(stretch.start, stretch.end)
            const details = [
              stretch.quantity !== null && row?.driverLabel
                ? `${QUANTITY.format(stretch.quantity)} ${row.driverLabel}`
                : null,
              stretch.unknownM > 0 ? `${WHOLE.format(stretch.unknownM)} m unknown` : null,
            ].filter(Boolean)
            return (
              <li key={stretch.start} data-cost-stretch={`${stretch.start}-${stretch.end}`}>
                <ResultRow
                  className="px-2 py-1.5"
                  title={where}
                  subtitle={details.length ? details.join(' · ') : undefined}
                  aria-label={`${where}, ${money(stretch.amount)}: show on the plan`}
                  disabled={!onFocusStretch}
                  onClick={() =>
                    onFocusStretch?.({
                      rowId: id,
                      label,
                      start: stretch.start,
                      end: stretch.end,
                      peakChainage: stretch.peakChainage,
                    })
                  }
                  trailing={
                    <>
                      {money(stretch.amount)}
                      <span className="block text-2xs font-normal text-muted-foreground">
                        {SHARE.format(stretch.share)} of {row ? 'the row' : 'the placed total'}
                      </span>
                    </>
                  }
                />
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground">Nothing of this is placed on the road.</p>
      )}
      {ranked.length > COST_STRETCHES_SHOWN && (
        <TextButton tone="muted" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll ? `Show the costliest ${COST_STRETCHES_SHOWN}` : `Show all ${ranked.length} stretches`}
        </TextButton>
      )}
      {unplaced.length > 0 && (
        <div data-testid="road-cost-unplaced">
          <p>
            <span className="font-medium">Not on the road: {money(unplacedTotal)}</span>
            {row && <span className="text-muted-foreground"> · {row.unplacedReason}</span>}
          </p>
          {!row && (
            <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
              {unplaced.map((r) => (
                <li key={r.rowId}>
                  {r.label} {money(r.unplaced)} · {r.unplacedReason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
