import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import { formatRoadStation } from './Charts'
import { NumberField } from './Controls'
import {
  alignmentJunctionRoad,
  analyzeJunctionTurn,
  contextJunctionRoad,
  findRoadJunctions,
  isJunctionError,
  JUNCTION_LIMITS,
  JUNCTION_TURN_BASIS,
  junctionTurnOverlay,
  turnSeverity,
  type JunctionRoad,
  type JunctionTurnOutcome,
  type RoadJunction,
} from './junctionTurn'
import type { Alignment, ContextFeature, DesignVehicle } from './types'
import { minimumSteerRadius } from './vehicleKinematics'

/** Where the junction check finds the other roads, and how it reports its plan lines. */
export interface JunctionTurnProps {
  alignments: Alignment[]
  context: ContextFeature[]
  /** The selected turn's wheel and body envelopes for the plan, or null for none. */
  onOverlay: (overlay: GeoJSON.FeatureCollection | null) => void
}

type Row = { junction: RoadJunction; kind: 'in' | 'out'; outcome: JunctionTurnOutcome; key: string }

const m = (value: number) => `${value.toFixed(2)} m`
const armLabel = (junction: RoadJunction, id: string) => junction.arms.find((a) => a.id === id)?.label ?? id
/** Failing turns first: errors, then wheels off the formation, then beyond the lock; sharpest first. */
const rank = (row: Row) =>
  isJunctionError(row.outcome)
    ? 3
    : (row.outcome.fits ? 0 : 2) + (row.outcome.lockExceeded ? 1 : 0) + Math.abs(row.outcome.deflectionDegrees) / 1000

function TurnRow({ row, selected, onSelect }: { row: Row; selected: boolean; onSelect: () => void }) {
  const { junction, outcome, kind } = row
  const route = `${armLabel(junction, outcome.from)} → ${armLabel(junction, outcome.to)}`
  if (isJunctionError(outcome))
    return (
      <li className="rounded-md border p-2 text-xs" data-testid="road-junction-turn" data-state="error">
        <p className="font-medium">
          {kind === 'in' ? 'In' : 'Out'} · {route}
        </p>
        <p className="mt-0.5 text-2xs text-amber-800 dark:text-amber-300">{outcome.error}</p>
      </li>
    )
  const bad = !outcome.fits || outcome.lockExceeded
  const badge = outcome.lockExceeded
    ? 'Beyond steering lock'
    : outcome.fits
      ? 'Wheels fit'
      : outcome.requiredFlareRadiusM === null
        ? `Off by ${m(outcome.wheelShortfallM)}`
        : `Flare R ${outcome.requiredFlareRadiusM} m${outcome.requiredFlareSetbackM === null ? '' : ` · cut back ${outcome.requiredFlareSetbackM.toFixed(1)} m`}`
  return (
    <li data-testid="road-junction-turn" data-state={bad ? 'attention' : 'fits'}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={`w-full rounded-md border p-2 text-left text-xs ${bad ? 'border-red-300 dark:border-red-900' : ''} ${selected ? 'ring-2 ring-primary' : ''}`}
      >
        <span className="flex flex-wrap items-center justify-between gap-1">
          <span className="font-medium">
            {kind === 'in' ? 'In' : 'Out'} · {outcome.side === 'straight' ? 'straight' : outcome.side}{' '}
            {Math.abs(outcome.deflectionDegrees).toFixed(0)}° · {turnSeverity(outcome.deflectionDegrees)}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-3xs font-medium ${bad ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}`}
          >
            {badge}
          </span>
        </span>
        <span className="mt-0.5 block text-2xs text-muted-foreground">{route}</span>
        <span className="mt-1 block font-mono text-2xs tabular-nums">
          Offtracking {m(outcome.maxOfftrackingM)} · steer {outcome.maxSteerDegrees.toFixed(1)}°
          {outcome.fits ? '' : ` · wheels ${m(outcome.wheelShortfallM)} out`}
          {outcome.bodyBeyondM > 0 ? ` · body ${m(outcome.bodyBeyondM)} past edge` : ''}
        </span>
      </button>
    </li>
  )
}

/**
 * Turns into and out of each road that meets the active road, for the design vehicle. Lists every
 * turn with its severity and draws the selected one's envelope on the plan.
 */
export function JunctionTurnPanel({
  alignment,
  vehicle,
  clearanceM,
  junctions: { alignments, context, onOverlay },
  onStation,
  showOnPlan,
}: {
  alignment: Alignment
  vehicle: DesignVehicle
  clearanceM: number
  junctions: JunctionTurnProps
  onStation: (chainage: number) => void
  showOnPlan: boolean
}) {
  const minimum = useMemo(() => minimumSteerRadius(vehicle), [vehicle])
  const [steerRadiusM, setSteerRadiusM] = useState<number | null>(null)
  const [flareRadiusM, setFlareRadiusM] = useState(0)
  const [assumedHalfWidthM, setAssumedHalfWidthM] = useState(4)
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // Until one is entered, the turn is steered at the vehicle's own minimum, rounded up to 0.5 m.
  const radius = steerRadiusM ?? Math.max(JUNCTION_LIMITS.steerRadiusM[0], minimum ? Math.ceil(minimum * 2) / 2 : 15)
  const roads = useDeferredValue(alignments)
  const features = useDeferredValue(context)
  const road = useDeferredValue(alignment)
  const found = useMemo(() => {
    try {
      const others: JunctionRoad[] = [
        ...roads.filter((a) => a.id !== road.id).map(alignmentJunctionRoad),
        ...features.flatMap((f) => contextJunctionRoad(f) ?? []),
      ]
      return { ...findRoadJunctions(alignmentJunctionRoad(road), others, assumedHalfWidthM), error: '' }
    } catch (cause) {
      return { junctions: [], leftOut: 0, error: cause instanceof Error ? cause.message : 'Junctions not found.' }
    }
  }, [roads, features, road, assumedHalfWidthM])
  const rows = useMemo(() => {
    const list: Row[] = []
    for (const junction of found.junctions)
      for (const movement of junction.movements) {
        let outcome: JunctionTurnOutcome
        try {
          outcome = analyzeJunctionTurn({ arms: junction.arms, flareRadiusM }, movement.from, movement.to, {
            vehicle,
            steerRadiusM: radius,
            clearanceM,
          })
        } catch (cause) {
          outcome = {
            from: movement.from,
            to: movement.to,
            error: cause instanceof Error ? cause.message : 'This turn could not be checked.',
          }
        }
        list.push({ junction, kind: movement.kind, outcome, key: `${junction.id}|${movement.from}|${movement.to}` })
      }
    return list
  }, [found, flareRadiusM, vehicle, radius, clearanceM])
  const worst = useMemo(() => [...rows].sort((a, b) => rank(b) - rank(a))[0] ?? null, [rows])
  const shown = rows.find((r) => r.key === selected) ?? worst
  useEffect(() => {
    const outcome = shown?.outcome
    onOverlay(
      open && showOnPlan && shown && outcome && !isJunctionError(outcome)
        ? junctionTurnOverlay(shown.junction, outcome)
        : null,
    )
  }, [open, shown, showOnPlan, onOverlay])
  useEffect(() => () => onOverlay(null), [onOverlay])
  const attention = rows.filter((r) => isJunctionError(r.outcome) || !r.outcome.fits || r.outcome.lockExceeded).length
  return (
    <details
      className="rounded-md border"
      data-testid="road-junction-turns"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer p-2 font-medium">
        Junction turns{' '}
        <span className="font-normal text-muted-foreground">
          ·{' '}
          {found.junctions.length
            ? `${found.junctions.length} junction${found.junctions.length === 1 ? '' : 's'} · ${attention ? `${attention} of ${rows.length} turns need attention` : `all ${rows.length} turns fit`}`
            : 'none found'}
        </span>
      </summary>
      <div className="space-y-2 border-t p-2">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Turn radius (m)"
            value={radius}
            min={JUNCTION_LIMITS.steerRadiusM[0]}
            max={JUNCTION_LIMITS.steerRadiusM[1]}
            step={0.5}
            onChange={setSteerRadiusM}
            hint={`Radius of the steer-axle path through the turn.${minimum ? ` The vehicle’s steady minimum at its lock is ${m(minimum)}.` : ''}`}
          />
          <NumberField
            label="Corner flare radius (m)"
            value={flareRadiusM}
            min={JUNCTION_LIMITS.flareRadiusM[0]}
            max={JUNCTION_LIMITS.flareRadiusM[1]}
            step={0.5}
            onChange={setFlareRadiusM}
            hint="Radius rounding each corner between the two roads’ formation edges. 0 is a sharp corner."
          />
          <NumberField
            label="Mapped road half-width (m)"
            value={assumedHalfWidthM}
            min={JUNCTION_LIMITS.halfWidthM[0]}
            max={JUNCTION_LIMITS.halfWidthM[1]}
            step={0.5}
            onChange={setAssumedHalfWidthM}
            hint="Used each side of a mapped road whose formation width is not known. Design roads use their own widths."
          />
        </div>
        <p className="text-2xs text-muted-foreground">
          Loaded trucks usually come out of the branch road toward the mill. Turns in both directions are listed; Review
          → Haul gives the loaded turn toward a destination.{' '}
          <InfoTip label="How junction turns are checked" bubbleClassName="w-96 space-y-1.5">
            <span className="block">{JUNCTION_TURN_BASIS}</span>
            <span className="block">
              A junction is where this road’s end meets another road, or another road’s end meets this one, within 5 m.
              The road that ends there is the branch: “in” turns into it, “out” turns out of it. The flare shown is the
              smallest corner radius, in 0.5 m steps, that keeps the wheels on the formation with the clearance, and how
              far it cuts back the inside corner. Compare cut-backs, not radii: an obtuse corner needs a large radius to
              gain a little.
            </span>
          </InfoTip>
        </p>
        {found.error && <p className="text-destructive">{found.error}</p>}
        {!found.junctions.length && !found.error && (
          <p className="text-muted-foreground">
            No other road meets this road’s ends, and no road ends on it. Load or draw the road it joins.
          </p>
        )}
        {found.junctions.map((junction) => (
          <section key={junction.id} className="space-y-1.5" aria-label={`Junction with ${junction.otherRoadName}`}>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <h4 className="text-xs font-medium">
                {junction.otherRoadName} at {formatRoadStation(junction.chainage)}
              </h4>
              <button
                type="button"
                className="text-2xs underline underline-offset-2"
                onClick={() => onStation(junction.chainage)}
              >
                Go to station
              </button>
            </div>
            {junction.widthAssumed && (
              <p className="text-2xs text-amber-800 dark:text-amber-300">
                {junction.otherRoadName}’s width is not known: {m(assumedHalfWidthM)} each side is assumed.
              </p>
            )}
            <ul className="space-y-1.5">
              {rows
                .filter((r) => r.junction === junction)
                .map((row) => (
                  <TurnRow key={row.key} row={row} selected={row === shown} onSelect={() => setSelected(row.key)} />
                ))}
            </ul>
          </section>
        ))}
        {found.leftOut > 0 && (
          <p className="text-2xs text-muted-foreground">{found.leftOut} more junctions are not listed.</p>
        )}
        <p className="text-2xs text-muted-foreground">
          {vehicle.name} · {m(clearanceM)} wheel clearance.
          {showOnPlan ? ' The selected turn’s wheel paths are drawn on the plan while this list is open.' : ''}
        </p>
      </div>
    </details>
  )
}
