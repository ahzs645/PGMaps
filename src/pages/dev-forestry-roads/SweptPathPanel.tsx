import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form-field'
import { Field, NumberField, roadFieldClass } from './Controls'
import { formatRoadStation } from './Charts'
import {
  DEFAULT_VEHICLE_CHECK,
  SWEPT_PATH_BASIS,
  VEHICLE_LIMITS,
  VEHICLE_PRESETS,
  type SweptManeuver,
  type SweptPathResult,
} from './sweptPath'
import type { DesignVehicle, VehicleCheck, VehicleUnit } from './types'

const m = (value: number) =>
  `${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`
const turn = (degrees: number) => `${degrees >= 0 ? 'L' : 'R'} ${Math.abs(degrees).toFixed(0)}°`
const sameVehicle = (a: DesignVehicle, b: DesignVehicle) =>
  a.widthM === b.widthM &&
  a.units.length === b.units.length &&
  a.units.every((u, i) =>
    (['wheelbaseM', 'frontOverhangM', 'rearOverhangM', 'hitchOffsetM'] as const).every((k) => u[k] === b.units[i][k]),
  )
const need = (t: SweptManeuver) => Math.max(t.requiredLeftWideningM, t.requiredRightWideningM)
/** Spare formation beyond the wheels on the tighter side; the smallest is the most critical turn. */
const slack = (t: SweptManeuver) => Math.min(t.formationLeftM - t.wheelLeftM, t.formationRightM - t.wheelRightM)

/** One card per turn; with both directions checked it shows the governing direction. */
function governing(maneuvers: SweptManeuver[]) {
  const byId = new Map<string, SweptManeuver[]>()
  for (const t of maneuvers) byId.set(t.id, [...(byId.get(t.id) ?? []), t])
  return [...byId.values()].map((runs) =>
    runs.reduce((worst, t) =>
      need(t) > need(worst) || (need(t) === need(worst) && t.maxOfftrackingM > worst.maxOfftrackingM) ? t : worst,
    ),
  )
}

function TurnCard({ t, onShow, both }: { t: SweptManeuver; onShow: (t: SweptManeuver) => void; both: boolean }) {
  const inside = t.deflectionDegrees >= 0 ? 'Left' : 'Right'
  const rows: [string, string][] = [
    ['Offtracking', m(t.maxOfftrackingM)],
    ['Articulation', `${t.maxArticulationDegrees.toFixed(0)}°`],
    ['Left wheels / formation', `${m(t.wheelLeftM)} / ${m(t.formationLeftM)}`],
    ['Right wheels / formation', `${m(t.wheelRightM)} / ${m(t.formationRightM)}`],
    ['Widen left · right', `${m(t.requiredLeftWideningM)} · ${m(t.requiredRightWideningM)}`],
    ['Body past formation L · R', `${m(t.bodyBeyondLeftM)} · ${m(t.bodyBeyondRightM)}`],
  ]
  return (
    <li
      className={`rounded-md border p-2 text-xs ${t.fits ? '' : 'border-red-300 dark:border-red-900'}`}
      data-testid="road-swept-turn"
      data-fits={t.fits}
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-medium">
          {t.id} · {turn(t.deflectionDegrees)}
          {Math.abs(Math.abs(t.deflectionDegrees) - 180) < 20 ? ' · switchback' : ''}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${t.fits ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}
        >
          {t.fits ? 'Wheels fit' : `Widen ${m(need(t))}`}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {formatRoadStation(t.start)}–{formatRoadStation(t.end)} · inside {inside.toLowerCase()}
        {both ? ` · governed by ${t.direction === 'up' ? 'up' : 'down'}-station travel` : ''}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] text-muted-foreground">{label}</dt>
            <dd className="break-words font-mono tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 w-full"
        aria-label={`Show ${t.id} ${t.fits ? 'tightest' : 'worst'} station`}
        onClick={() => onShow(t)}
      >
        {t.fits ? 'Tightest clearance' : 'Worst station'} {formatRoadStation(t.worstChainage)}
      </Button>
    </li>
  )
}

function UnitFields({
  unit,
  index,
  last,
  onChange,
}: {
  unit: VehicleUnit
  index: number
  last: boolean
  onChange: (patch: Partial<VehicleUnit>) => void
}) {
  const name = unit.name || `Unit ${index + 1}`
  return (
    <fieldset className="min-w-0 rounded-md border p-2">
      <legend className="px-1 text-[11px] font-medium">{name}</legend>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label={`${name} wheelbase (m)`}
          value={unit.wheelbaseM}
          min={VEHICLE_LIMITS.wheelbaseM[0]}
          max={VEHICLE_LIMITS.wheelbaseM[1]}
          step={0.1}
          onChange={(wheelbaseM) => onChange({ wheelbaseM })}
          hint={
            index === 0
              ? 'Steer axle to the rear axle-group centre.'
              : 'Hitch, kingpin or bunk to this unit’s axle-group centre.'
          }
        />
        <NumberField
          label={`${name} front overhang (m)`}
          value={unit.frontOverhangM}
          min={VEHICLE_LIMITS.overhangM[0]}
          max={VEHICLE_LIMITS.overhangM[1]}
          step={0.1}
          onChange={(frontOverhangM) => onChange({ frontOverhangM })}
        />
        <NumberField
          label={`${name} rear overhang (m)`}
          value={unit.rearOverhangM}
          min={VEHICLE_LIMITS.overhangM[0]}
          max={VEHICLE_LIMITS.overhangM[1]}
          step={0.1}
          onChange={(rearOverhangM) => onChange({ rearOverhangM })}
          hint={index > 0 ? 'Include log or load overhang behind the axles.' : undefined}
        />
        {!last && (
          <NumberField
            label={`${name} hitch offset (m)`}
            value={unit.hitchOffsetM}
            min={VEHICLE_LIMITS.hitchOffsetM[0]}
            max={VEHICLE_LIMITS.hitchOffsetM[1]}
            step={0.1}
            onChange={(hitchOffsetM) => onChange({ hitchOffsetM })}
            hint="From the axle-group centre to the next unit’s hitch; negative is ahead (fifth wheel)."
          />
        )}
      </div>
    </fieldset>
  )
}

/**
 * Design-vehicle swept path for the active road. Results come first and stack in one column so
 * they read on a phone; the vehicle inputs fold below them.
 */
export function SweptPathPanel({
  check,
  result,
  error,
  onChange,
  onStation,
  showOnPlan,
  onShowOnPlan,
  onFocus,
}: {
  check: VehicleCheck | undefined
  result: SweptPathResult | null
  error: string
  /** Absent while a preview or another edit owns the road. */
  onChange?: (check: VehicleCheck | undefined) => void
  onStation: (chainage: number) => void
  showOnPlan: boolean
  onShowOnPlan: (show: boolean) => void
  onFocus?: (turn: SweptManeuver) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const turns = useMemo(() => {
    const list = governing(result?.maneuvers ?? [])
    // Widening first, largest first; then the tightest turns that still fit.
    return [
      ...list.filter((t) => !t.fits).sort((a, b) => need(b) - need(a)),
      ...list.filter((t) => t.fits).sort((a, b) => slack(a) - slack(b)),
    ]
  }, [result])
  if (!check)
    return (
      <div className="space-y-2 p-1 text-xs" data-testid="road-swept-path">
        <p className="text-muted-foreground">
          Track a design vehicle through every curve, including both curves of a switchback as one turn, and compare its
          wheel paths with the formation.
        </p>
        <Button size="sm" className="w-full" disabled={!onChange} onClick={() => onChange?.(DEFAULT_VEHICLE_CHECK)}>
          Check a design vehicle
        </Button>
      </div>
    )
  const set = (patch: Partial<VehicleCheck>) => onChange?.({ ...check, ...patch })
  const setVehicle = (patch: Partial<DesignVehicle>) => set({ vehicle: { ...check.vehicle, ...patch } })
  // Edited dimensions are no longer the example, so stop naming them as one.
  const setDimensions = (patch: Partial<DesignVehicle>) => {
    const example = VEHICLE_PRESETS.find((p) => p.vehicle.name === check.vehicle.name)
    setVehicle(example ? { ...patch, name: example.vehicle.name.replace(' (example)', ' (edited)') } : patch)
  }
  const preset = VEHICLE_PRESETS.find((p) => sameVehicle(p.vehicle, check.vehicle))
  const failing = turns.filter((t) => !t.fits)
  const visible = showAll ? turns : turns.filter((t, i) => !t.fits || i < failing.length + 2)
  return (
    <div className="min-w-0 space-y-3 p-1 text-xs" data-testid="road-swept-path">
      <div
        role="status"
        className={`rounded-md border p-2 ${failing.length ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200' : 'bg-muted/30'}`}
        data-testid="road-swept-summary"
      >
        <p className="font-medium">
          {error
            ? 'Swept path unavailable'
            : !result
              ? 'Calculating swept path…'
              : !turns.length
                ? 'No curves to check'
                : failing.length
                  ? `${failing.length} of ${turns.length} turns need wider formation`
                  : `Wheels stay on the formation in all ${turns.length} turns`}
        </p>
        <p className="mt-0.5 text-[11px] opacity-80">
          {check.vehicle.name} · {check.direction === 'both' ? 'both directions' : `${check.direction}-station`} ·{' '}
          {m(check.clearanceM)} clearance
        </p>
        {error && <p className="mt-1 text-destructive">{error}</p>}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={showOnPlan} onChange={(e) => onShowOnPlan(e.target.checked)} />
        Show swept path on plan
      </label>
      {!!turns.length && (
        <ul className="space-y-2" aria-label="Swept path by turn">
          {visible.map((t) => (
            <TurnCard
              key={t.id}
              t={t}
              onShow={(turn) => (onFocus ? onFocus(turn) : onStation(turn.worstChainage))}
              both={check.direction === 'both'}
            />
          ))}
        </ul>
      )}
      {turns.length > visible.length && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAll(true)}>
          Show all {turns.length} turns
        </Button>
      )}
      {result?.warnings
        .filter((w) => !w.startsWith('No fitted'))
        .map((w) => (
          <p key={w} className="border-l-2 border-amber-500 pl-2 text-[11px] text-amber-800 dark:text-amber-300">
            {w}
          </p>
        ))}
      <details className="rounded-md border">
        <summary className="cursor-pointer p-2 font-medium">Vehicle, direction & clearance</summary>
        <div className="space-y-2 border-t p-2">
          <Field label="Starting configuration">
            <NativeSelect
              className={roadFieldClass}
              aria-label="Design vehicle preset"
              disabled={!onChange}
              value={preset?.id ?? 'custom'}
              onChange={(e) => {
                const next = VEHICLE_PRESETS.find((p) => p.id === e.target.value)
                if (next) set({ vehicle: structuredClone(next.vehicle) })
              }}
            >
              {VEHICLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom" disabled>
                Custom dimensions
              </option>
            </NativeSelect>
          </Field>
          <p className="text-[11px] text-amber-800 dark:text-amber-300">
            Presets are example dimensions. Enter your fleet’s truck, trailer and load before relying on a result.
          </p>
          <Field label="Vehicle name">
            <input
              className={roadFieldClass}
              aria-label="Design vehicle name"
              maxLength={200}
              disabled={!onChange}
              value={check.vehicle.name}
              onChange={(e) => setVehicle({ name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Loaded travel">
              <NativeSelect
                className={roadFieldClass}
                aria-label="Design vehicle travel direction"
                disabled={!onChange}
                value={check.direction}
                onChange={(e) => set({ direction: e.target.value as VehicleCheck['direction'] })}
              >
                <option value="both">Both directions</option>
                <option value="up">Up-station</option>
                <option value="down">Down-station</option>
              </NativeSelect>
            </Field>
            <NumberField
              label="Wheel clearance (m)"
              value={check.clearanceM}
              min={VEHICLE_LIMITS.clearanceM[0]}
              max={VEHICLE_LIMITS.clearanceM[1]}
              step={0.05}
              disabled={!onChange}
              onChange={(clearanceM) => set({ clearanceM })}
              hint="Kept between the outer wheel path and the formation edge. Take it from your road class or criteria."
            />
            <NumberField
              label="Vehicle width (m)"
              value={check.vehicle.widthM}
              min={VEHICLE_LIMITS.widthM[0]}
              max={VEHICLE_LIMITS.widthM[1]}
              step={0.05}
              disabled={!onChange}
              onChange={(widthM) => setDimensions({ widthM })}
            />
          </div>
          {check.vehicle.units.map((u, i) => (
            <UnitFields
              key={i}
              unit={u}
              index={i}
              last={i === check.vehicle.units.length - 1}
              onChange={(patch) =>
                setDimensions({ units: check.vehicle.units.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              }
            />
          ))}
          <Field label="Dimension source">
            <textarea
              className={`${roadFieldClass} min-h-16`}
              aria-label="Design vehicle source"
              maxLength={2000}
              disabled={!onChange}
              value={check.vehicle.source ?? ''}
              onChange={(e) => setVehicle({ source: e.target.value })}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!onChange}
            onClick={() => onChange?.(undefined)}
          >
            Remove vehicle check
          </Button>
        </div>
      </details>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">How the swept path is calculated</summary>
        <p className="mt-1">{SWEPT_PATH_BASIS}</p>
        <p className="mt-1">
          A turn spans each fitted curve plus a vehicle length either side; turns that overlap are judged together, so a
          switchback’s two curves read as one 180° turn.
        </p>
      </details>
    </div>
  )
}
