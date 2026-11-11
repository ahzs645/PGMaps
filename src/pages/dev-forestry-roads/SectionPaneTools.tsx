import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { formatRoadStation } from './Charts'
import { pinnedSectionOutline, pinnedShiftLabel, pinnedShiftText } from './sectionFrame'
import {
  batterMisses,
  planSectionRange,
  rangeStillHolds,
  sectionSourceAt,
  type SectionRangePlan,
} from './sectionRangeApply'
import type { Alignment, RoadAnalysis, RoadStation } from './types'

/** Batter misses listed by station before the rest are counted. */
export const MAX_LISTED_BATTER_MISSES = 12

const uid = () => crypto.randomUUID()
const round = (value: number) => Math.round(value * 10) / 10

/**
 * State the section pane shares with the profile: Hold scale, the pinned section, and the range a
 * section is given to, which a drag on the profile can mark. The pin belongs to one road and is
 * dropped when the views show another.
 */
export function useSectionTools({
  alignment,
  displayedAlignment,
  analysis,
}: {
  /** The road being edited. */
  alignment: Alignment
  /** The road the views show: a preview, a terrain profile, or `alignment` itself. */
  displayedAlignment: Alignment
  analysis: RoadAnalysis
}) {
  const [holdScale, setHoldScale] = useState(false)
  const [pin, setPin] = useState<{ alignmentId: string; station: RoadStation } | null>(null)
  if (pin && pin.alignmentId !== displayedAlignment.id) setPin(null)
  const [range, setRange] = useState<RangeState | null>(null)
  if (range && range.alignmentId !== alignment.id) setRange(null)
  const picked: [number, number] | null =
    range && range.from.trim() && range.to.trim() && Number.isFinite(Number(range.from) + Number(range.to))
      ? [Math.min(Number(range.from), Number(range.to)), Math.max(Number(range.from), Number(range.to))]
      : null
  // Escape ends a profile pick first, then closes the panel.
  const picking = !!range?.open && range.picking
  useEffect(() => {
    if (!picking) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setRange((r) => (r ? { ...r, picking: false } : r))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [picking])
  return {
    holdScale,
    setHoldScale,
    pinnedStation: pin?.alignmentId === displayedAlignment.id ? pin.station : undefined,
    pin: (station: RoadStation | undefined) => setPin(station ? { alignmentId: displayedAlignment.id, station } : null),
    range,
    setRange,
    alignment,
    analysis,
    /** For `ProfileChart`: set while the panel is waiting for a drag on the profile. */
    rangePick: picking
      ? {
          range: picked,
          onRange: ([from, to]: [number, number]) =>
            setRange((r) => (r ? { ...r, from: String(round(from)), to: String(round(to)), confirm: null } : r)),
        }
      : undefined,
    picked,
  }
}

interface RangeState {
  alignmentId: string
  open: boolean
  picking: boolean
  from: string
  to: string
  error: string
  /** A plan waiting for the reader's yes because it changes existing ranges. */
  confirm: SectionRangePlan | null
  /** The last range given a section, whose stations are checked against the results. */
  applied: { from: number; to: number; name: string } | null
}

export type SectionTools = ReturnType<typeof useSectionTools>

/**
 * Under the cross-section: Hold scale, Pin this section, and **Use this section for…**, which gives
 * the section at the selected station to a station range through the template station assignments.
 */
export function SectionPaneTools({
  tools,
  station,
  terrainOnly,
  editable,
  updateAlignment,
  onStation,
  onNotice,
}: {
  tools: SectionTools
  /** The selected station's section, as the chart shows it. */
  station: RoadStation | undefined
  terrainOnly: boolean
  /** False while a preview, a terrain profile or a busy task holds the road. */
  editable: boolean
  updateAlignment: (change: (alignment: Alignment) => Alignment) => void
  onStation: (chainage: number) => void
  onNotice: (text: string) => void
}) {
  const { range, setRange, alignment, analysis } = tools
  const pinned = tools.pinnedStation
  const source = station && !terrainOnly ? sectionSourceAt(alignment, station.chainage, formatRoadStation) : null
  // The check is about the section given: hidden while a new range waits for Replace, and once an undo
  // takes the range back (a redo shows it again).
  const applied =
    range?.applied && !terrainOnly && !range.confirm && rangeStillHolds(alignment, range.applied, formatRoadStation)
      ? range.applied
      : null
  const misses = applied ? batterMisses(analysis.stations, applied.from, applied.to) : []
  const missStations = [...new Set(misses.map((m) => m.chainage))]
  const patch = (changes: Partial<RangeState>) => setRange((r) => (r ? { ...r, ...changes } : r))
  const commit = (plan: SectionRangePlan) => {
    updateAlignment((a) => ({ ...a, engineering: plan.engineering }))
    const span = `${formatRoadStation(plan.from)}–${formatRoadStation(plan.to)}`
    patch({
      confirm: null,
      error: '',
      picking: false,
      applied: { from: plan.from, to: plan.to, name: plan.source.name },
    })
    onNotice(
      plan.source.kind === 'base'
        ? `${span} is back on the base section. Undo restores the ranges it replaced.`
        : `${plan.source.name} now runs ${span}. Undo takes it back.`,
    )
  }
  const apply = () => {
    if (!range || !station) return
    const result = planSectionRange(
      alignment,
      station.chainage,
      [Number(range.from.trim() || NaN), Number(range.to.trim() || NaN)],
      analysis.length,
      { id: uid, stationLabel: formatRoadStation },
    )
    if ('error' in result) return patch({ error: result.error, confirm: null })
    const { plan } = result
    if (!plan.changed) {
      patch({ error: '', confirm: null, applied: { from: plan.from, to: plan.to, name: plan.source.name } })
      onNotice(`${formatRoadStation(plan.from)}–${formatRoadStation(plan.to)} already has this section.`)
      return
    }
    if (plan.affected.length) return patch({ error: '', confirm: plan })
    commit(plan)
  }
  const small = 'h-6 px-2 text-3xs'
  const field = 'w-20 rounded border bg-background px-1 py-0.5 font-mono text-3xs'
  const pinnedOutline = pinned && station ? pinnedSectionOutline(pinned, station, terrainOnly) : null
  const formOpen = !!range?.open && !!source
  return (
    // The pane gives the chart what the form and the list leave; past `max-h` they scroll instead,
    // so the section a listed station jumps to stays in view.
    <div
      className="flex max-h-[45%] min-h-6 shrink flex-col gap-1 text-3xs text-muted-foreground"
      data-testid="road-section-tools"
    >
      <div role="group" aria-label="Section view" className="flex shrink-0 flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant={tools.holdScale ? 'secondary' : 'outline'}
          className={small}
          aria-pressed={tools.holdScale}
          title="Keep the offset and elevation spans while stepping; the frame follows the formation."
          onClick={() => tools.setHoldScale(!tools.holdScale)}
        >
          Hold scale
        </Button>
        {pinned ? (
          <Button
            size="sm"
            variant="secondary"
            className={small}
            aria-label={`Unpin section ${formatRoadStation(pinned.chainage)}`}
            onClick={() => tools.pin(undefined)}
          >
            Unpin {formatRoadStation(pinned.chainage)}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className={small}
            disabled={!station}
            title="Draw this station's outline faintly behind every other station of this road"
            onClick={() => tools.pin(station)}
          >
            Pin this section
          </Button>
        )}
        {!terrainOnly && (
          <Button
            size="sm"
            variant={range?.open ? 'secondary' : 'outline'}
            className={small}
            aria-expanded={!!range?.open}
            disabled={!editable || !station}
            onClick={() =>
              setRange((r) =>
                r?.open
                  ? { ...r, open: false, picking: false, confirm: null }
                  : {
                      alignmentId: alignment.id,
                      open: true,
                      picking: true,
                      from: station ? String(round(station.chainage)) : '',
                      to: '',
                      error: '',
                      confirm: null,
                      applied: r?.applied ?? null,
                    },
              )
            }
          >
            Use this section for…
          </Button>
        )}
        {pinnedOutline && (
          // The chart's legend is not shown in the compact pane, so the shift is stated here too.
          <span className="tabular-nums" title={pinnedShiftText(pinnedOutline)} data-testid="road-section-pinned-shift">
            <span aria-hidden className="mr-1 inline-block w-3 border-t border-dashed border-current align-middle" />
            {pinnedShiftLabel(pinnedOutline)}
          </span>
        )}
        <InfoTip label="About the section tools">
          Hold scale keeps the frame's spans and follows the formation, so the ground moves under a still road. A pinned
          section is drawn dashed, moved to share this station's formation level; it is dropped when another road is
          shown. Use this section for… gives the section shown here to a range of stations through the template station
          assignments: a named template by name, the base section by clearing the range, and a mixed or transition
          section as a new template named after its station.
        </InfoTip>
      </div>
      {(formOpen || applied) && (
        <div className="min-h-0 space-y-1 overflow-y-auto overscroll-none" data-testid="road-section-tools-body">
          {range?.open && source && (
            <div
              role="group"
              aria-label="Use this section for a station range"
              className="space-y-1 rounded border p-1.5"
              data-testid="road-section-range"
            >
              <div className="flex flex-wrap items-center gap-1">
                <span>
                  Give <span className="font-medium text-foreground">{source.name}</span>
                  {source.kind === 'snapshot' ? ' (saved as a new template)' : ''} to
                </span>
                <input
                  aria-label="Range from station metres"
                  type="number"
                  min={0}
                  step="any"
                  className={field}
                  value={range.from}
                  onChange={(e) => patch({ from: e.target.value, confirm: null, error: '' })}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                />
                <span>–</span>
                <input
                  aria-label="Range to station metres"
                  type="number"
                  min={0}
                  step="any"
                  className={field}
                  value={range.to}
                  onChange={(e) => patch({ to: e.target.value, confirm: null, error: '' })}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                />
                <span>m</span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className={small}
                  disabled={!station}
                  onClick={() => station && patch({ from: String(round(station.chainage)), confirm: null, error: '' })}
                >
                  From here
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={small}
                  disabled={!station}
                  onClick={() => station && patch({ to: String(round(station.chainage)), confirm: null, error: '' })}
                >
                  To here
                </Button>
                <Button
                  size="sm"
                  variant={range.picking ? 'secondary' : 'outline'}
                  className={small}
                  aria-pressed={range.picking}
                  title="Drag along the profile to mark the range. Escape stops."
                  onClick={() => patch({ picking: !range.picking })}
                >
                  Drag on profile
                </Button>
                <Button size="sm" className={small} disabled={!editable} onClick={apply}>
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={small}
                  onClick={() => patch({ open: false, picking: false, confirm: null, error: '' })}
                >
                  Close
                </Button>
              </div>
              {range.error && <InlineAlert tone="error">{range.error}</InlineAlert>}
              {range.confirm && (
                <InlineAlert tone="warning" title="This changes existing template ranges">
                  <ul className="list-disc pl-4">
                    {range.confirm.affected.map((a) => (
                      <li key={a.assignment.id}>
                        Range {a.number} ({a.templateName}, {formatRoadStation(a.assignment.start)}–
                        {formatRoadStation(a.assignment.end)}){' '}
                        {a.outcome === 'replaced'
                          ? 'is replaced'
                          : a.outcome === 'split'
                            ? 'is split around it'
                            : 'is trimmed'}
                        {a.transitionNote ? `; ${a.transitionNote}` : ''}.
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1 flex gap-1">
                    <Button
                      size="sm"
                      className={small}
                      disabled={!editable}
                      onClick={() => range.confirm && commit(range.confirm)}
                    >
                      Replace
                    </Button>
                    <Button size="sm" variant="ghost" className={small} onClick={() => patch({ confirm: null })}>
                      Cancel
                    </Button>
                  </div>
                </InlineAlert>
              )}
            </div>
          )}
          {applied && (
            <div role="status" data-testid="road-section-batter-misses" className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                {missStations.length === 0 ? (
                  <p>
                    {applied.name}, {formatRoadStation(applied.from)}–{formatRoadStation(applied.to)}: the batter meets
                    the ground at every station.
                  </p>
                ) : (
                  <InlineAlert
                    tone="warning"
                    title={`Batter never met the ground at ${missStations.length} station${missStations.length === 1 ? '' : 's'} of ${formatRoadStation(applied.from)}–${formatRoadStation(applied.to)}`}
                  >
                    <div className="flex flex-wrap gap-1">
                      {missStations.slice(0, MAX_LISTED_BATTER_MISSES).map((chainage) => {
                        const here = misses.filter((m) => m.chainage === chainage)
                        const text = here
                          .map(
                            (m) =>
                              `${m.side} ${m.batter === 'unknown' ? 'batter' : m.batter}, ${m.cause === 'reach' ? 'past the section reach' : 'terrain ran out'}`,
                          )
                          .join('; ')
                        return (
                          <button
                            key={chainage}
                            type="button"
                            className="rounded border px-1 font-mono underline-offset-2 hover:underline"
                            title={text}
                            aria-label={`Go to ${formatRoadStation(chainage)}: ${text}`}
                            onClick={() => onStation(chainage)}
                          >
                            {formatRoadStation(chainage)}
                          </button>
                        )
                      })}
                      {missStations.length > MAX_LISTED_BATTER_MISSES && (
                        <span>and {missStations.length - MAX_LISTED_BATTER_MISSES} more</span>
                      )}
                    </div>
                  </InlineAlert>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className={small}
                aria-label="Clear the batter check"
                onClick={() => patch({ applied: null })}
              >
                ×
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
