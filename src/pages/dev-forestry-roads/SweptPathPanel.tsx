import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { formatRoadStation } from './Charts'
import {
  DEFAULT_VEHICLE_CHECK,
  SWEPT_PATH_BASIS,
  VEHICLE_LIMITS,
  VEHICLE_PRESETS,
  type SweptManeuver,
  type SweptPathResult,
} from './sweptPath'
import type { Alignment, DesignVehicle, LoadSpan, VehicleCheck, VehicleUnit } from './types'
import { InfoTip } from '@/components/ui/info-tip'
import { JunctionTurnPanel, type JunctionTurnProps } from './JunctionTurnPanel'
import { steeringGeometry, type SteeringGiven } from './vehicleKinematics'

const m = (value: number) =>
  `${value.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`
const turn = (degrees: number) => `${degrees >= 0 ? 'L' : 'R'} ${Math.abs(degrees).toFixed(0)}°`
const sameVehicle = (a: DesignVehicle, b: DesignVehicle) =>
  a.widthM === b.widthM &&
  a.steeringLockDeg === b.steeringLockDeg &&
  JSON.stringify(a.loads ?? []) === JSON.stringify(b.loads ?? []) &&
  a.units.length === b.units.length &&
  a.units.every((u, i) =>
    (['wheelbaseM', 'frontOverhangM', 'rearOverhangM', 'hitchOffsetM'] as const).every((k) => u[k] === b.units[i][k]),
  )
const need = (t: SweptManeuver) => Math.max(t.requiredLeftWideningM, t.requiredRightWideningM)
/** A turn needs attention when the wheels leave the formation or the vehicle cannot steer it. */
const failingTurn = (t: SweptManeuver) => !t.fits || t.lockExceeded === true
/** Spare formation beyond the wheels on the tighter side; the smallest is the most critical turn. */
const slack = (t: SweptManeuver) => Math.min(t.formationLeftM - t.wheelLeftM, t.formationRightM - t.wheelRightM)

/** One card per turn; with both directions checked it shows the governing direction. */
function governing(maneuvers: SweptManeuver[]) {
  const byId = new Map<string, SweptManeuver[]>()
  for (const t of maneuvers) byId.set(t.id, [...(byId.get(t.id) ?? []), t])
  return [...byId.values()].map((runs) =>
    runs.reduce((worst, t) =>
      need(t) > need(worst) ||
      (need(t) === need(worst) &&
        (Number(!!t.lockExceeded) > Number(!!worst.lockExceeded) ||
          (!!t.lockExceeded === !!worst.lockExceeded && t.maxOfftrackingM > worst.maxOfftrackingM)))
        ? t
        : worst,
    ),
  )
}

function TurnCard({
  t,
  onShow,
  both,
  lockDeg,
}: {
  t: SweptManeuver
  onShow: (t: SweptManeuver) => void
  both: boolean
  lockDeg: number | undefined
}) {
  const inside = t.deflectionDegrees >= 0 ? 'Left' : 'Right'
  const bad = failingTurn(t)
  const rows: [string, string][] = [
    ['Offtracking', m(t.maxOfftrackingM)],
    ['Articulation', `${t.maxArticulationDegrees.toFixed(0)}°`],
    ['Steering / lock', `${t.maxSteerDegrees.toFixed(1)}° / ${lockDeg === undefined ? 'not entered' : `${lockDeg}°`}`],
    ['Left wheels / formation', `${m(t.wheelLeftM)} / ${m(t.formationLeftM)}`],
    ['Right wheels / formation', `${m(t.wheelRightM)} / ${m(t.formationRightM)}`],
    ['Widen left · right', `${m(t.requiredLeftWideningM)} · ${m(t.requiredRightWideningM)}`],
    ['Body past formation L · R', `${m(t.bodyBeyondLeftM)} · ${m(t.bodyBeyondRightM)}`],
  ]
  return (
    <li
      className={`rounded-md border p-2 text-xs ${bad ? 'border-red-300 dark:border-red-900' : ''}`}
      data-testid="road-swept-turn"
      data-fits={t.fits}
      data-lock-exceeded={t.lockExceeded === true}
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-medium">
          {t.id} · {turn(t.deflectionDegrees)}
          {Math.abs(Math.abs(t.deflectionDegrees) - 180) < 20 ? ' · switchback' : ''}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-3xs font-medium ${bad ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}`}
        >
          {bad
            ? [t.fits ? '' : `Widen ${m(need(t))}`, t.lockExceeded ? 'Beyond steering lock' : '']
                .filter(Boolean)
                .join(' · ')
            : 'Wheels fit'}
        </span>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        {formatRoadStation(t.start)}–{formatRoadStation(t.end)} · inside {inside.toLowerCase()}
        {both ? ` · governed by ${t.direction === 'up' ? 'up' : 'down'}-station travel` : ''}
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-3xs text-muted-foreground">{label}</dt>
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
      <legend className="px-1 text-2xs font-medium">{name}</legend>
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

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Steering lock and the turning calculator: editing the lock or any one radius solves the others
 * from the first unit's wheelbase and the vehicle width.
 */
function SteeringFields({
  vehicle,
  disabled,
  onChange,
}: {
  vehicle: DesignVehicle
  disabled: boolean
  onChange: (patch: Partial<DesignVehicle>) => void
}) {
  const [problem, setProblem] = useState('')
  const wheelbase = vehicle.units[0].wheelbaseM
  const lock = vehicle.steeringLockDeg
  const geometry = lock === undefined ? null : steeringGeometry(wheelbase, vehicle.widthM, { lockDeg: lock })
  const solve = (given: SteeringGiven) => {
    if (disabled) return
    try {
      const next = round2(steeringGeometry(wheelbase, vehicle.widthM, given).lockDeg)
      if (next < VEHICLE_LIMITS.steeringLockDeg[0] || next > VEHICLE_LIMITS.steeringLockDeg[1])
        throw Error(`That radius needs a ${next}° lock; enter one that gives 5–60°.`)
      setProblem('')
      onChange({ steeringLockDeg: next })
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'That radius cannot be steered.')
    }
  }
  return (
    <fieldset className="min-w-0 rounded-md border p-2" aria-label="Steering lock and turning radius">
      <legend className="px-1 text-2xs font-medium">Steering</legend>
      <OptionalNumberField
        label="Steering lock (°)"
        value={lock ?? null}
        min={VEHICLE_LIMITS.steeringLockDeg[0]}
        max={VEHICLE_LIMITS.steeringLockDeg[1]}
        step={0.5}
        placeholder="not checked"
        onChange={(value) => {
          if (disabled) return
          setProblem('')
          onChange({ steeringLockDeg: value ?? undefined })
        }}
        hint="Largest angle of the first unit’s steer axle. Every turn is checked against it; blank leaves it unchecked."
      />
      {geometry && (
        <details className="mt-2">
          <summary className="cursor-pointer text-2xs font-medium">Turning calculator</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="Steer-axle radius (m)"
              value={round2(geometry.steerRadiusM)}
              min={wheelbase}
              max={500}
              step={0.1}
              disabled={disabled}
              onChange={(steerRadiusM) => solve({ steerRadiusM })}
              hint="Steady minimum radius of the steer-axle centre’s path. A curve on the centreline tighter than this needs more than the lock."
            />
            <NumberField
              label="Outer front wheel radius (m)"
              value={round2(geometry.outerFrontWheelM)}
              min={0}
              max={500}
              step={0.1}
              disabled={disabled}
              onChange={(outerFrontM) => solve({ outerFrontM })}
              hint="The minimum turning radius design guides usually quote."
            />
            <NumberField
              label="Inner rear wheel radius (m)"
              value={round2(geometry.innerRearWheelM)}
              min={0}
              max={500}
              step={0.1}
              disabled={disabled}
              onChange={(innerRearM) => solve({ innerRearM })}
            />
            <div className="min-w-0 text-2xs">
              <p className="text-muted-foreground">Inner front wheel</p>
              <p className="font-mono tabular-nums">{m(geometry.innerFrontWheelM)}</p>
            </div>
          </div>
          {problem && <p className="mt-1 text-2xs text-destructive">{problem}</p>}
        </details>
      )}
    </fieldset>
  )
}

/** Loads lying from a bunk on one unit to a bunk on a later unit, such as logs on a truck and trailer. */
function LoadFields({
  vehicle,
  disabled,
  onChange,
}: {
  vehicle: DesignVehicle
  disabled: boolean
  onChange: (patch: Partial<DesignVehicle>) => void
}) {
  const loads = vehicle.loads ?? []
  const units = vehicle.units
  if (units.length < 2 && !loads.length) return null
  const setLoad = (index: number, patch: Partial<LoadSpan>) =>
    onChange({ loads: loads.map((load, i) => (i === index ? { ...load, ...patch } : load)) })
  const unitName = (index: number) => units[index]?.name || `Unit ${index + 1}`
  return (
    <fieldset className="min-w-0 space-y-2 rounded-md border p-2" aria-label="Loads spanning two units">
      <legend className="px-1 text-2xs font-medium">Load on two units</legend>
      {loads.map((load, i) => (
        <div key={i} className="grid grid-cols-2 gap-2">
          <NumberField
            label={`Front bunk behind ${unitName(load.front.unit)} pivot (m)`}
            value={load.front.behindPivotM}
            min={VEHICLE_LIMITS.loadBunkM[0]}
            max={VEHICLE_LIMITS.loadBunkM[1]}
            step={0.05}
            disabled={disabled}
            onChange={(behindPivotM) => setLoad(i, { front: { ...load.front, behindPivotM } })}
          />
          <NumberField
            label={`Rear bunk behind ${unitName(load.rear.unit)} pivot (m)`}
            value={load.rear.behindPivotM}
            min={VEHICLE_LIMITS.loadBunkM[0]}
            max={VEHICLE_LIMITS.loadBunkM[1]}
            step={0.05}
            disabled={disabled}
            onChange={(behindPivotM) => setLoad(i, { rear: { ...load.rear, behindPivotM } })}
          />
          <NumberField
            label="Load ahead of front bunk (m)"
            value={load.aheadOfFrontBunkM}
            min={VEHICLE_LIMITS.loadOverhangM[0]}
            max={VEHICLE_LIMITS.loadOverhangM[1]}
            step={0.05}
            disabled={disabled}
            onChange={(aheadOfFrontBunkM) => setLoad(i, { aheadOfFrontBunkM })}
          />
          <NumberField
            label="Load behind rear bunk (m)"
            value={load.behindRearBunkM}
            min={VEHICLE_LIMITS.loadOverhangM[0]}
            max={VEHICLE_LIMITS.loadOverhangM[1]}
            step={0.05}
            disabled={disabled}
            onChange={(behindRearBunkM) => setLoad(i, { behindRearBunkM })}
          />
          <Button
            size="sm"
            variant="outline"
            className="col-span-2"
            disabled={disabled}
            onClick={() => onChange({ loads: loads.filter((_, j) => j !== i) })}
          >
            Remove {load.name || 'load'}
          </Button>
        </div>
      ))}
      {units.length > 1 && loads.length < VEHICLE_LIMITS.loads && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() =>
            onChange({
              loads: [
                ...loads,
                {
                  name: 'Logs',
                  front: { unit: 0, behindPivotM: units[0].wheelbaseM },
                  rear: { unit: units.length - 1, behindPivotM: units.at(-1)!.wheelbaseM },
                  aheadOfFrontBunkM: 1,
                  behindRearBunkM: 1,
                },
              ],
            })
          }
        >
          Add a load from {unitName(0)} to {unitName(units.length - 1)}
        </Button>
      )}
      <p className="text-2xs text-muted-foreground">
        The load lies on the line between its two bunks and widens the body envelope. It does not steer the units.
      </p>
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
  alignment,
  junctions,
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
  /** With the project's roads, the panel also checks turns at this road's junctions. */
  alignment?: Alignment
  junctions?: JunctionTurnProps
}) {
  const [showAll, setShowAll] = useState(false)
  const turns = useMemo(() => {
    const list = governing(result?.maneuvers ?? [])
    // Widening first, largest first; then the tightest turns that still fit.
    return [
      ...list.filter(failingTurn).sort((a, b) => need(b) - need(a)),
      ...list.filter((t) => !failingTurn(t)).sort((a, b) => slack(a) - slack(b)),
    ]
  }, [result])
  const junctionPanel = (vehicleCheck: VehicleCheck) =>
    alignment && junctions ? (
      <JunctionTurnPanel
        alignment={alignment}
        vehicle={vehicleCheck.vehicle}
        clearanceM={vehicleCheck.clearanceM}
        junctions={junctions}
        onStation={onStation}
        showOnPlan={showOnPlan}
      />
    ) : null
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
        {junctionPanel(DEFAULT_VEHICLE_CHECK)}
      </div>
    )
  const set = (patch: Partial<VehicleCheck>) => onChange?.({ ...check, ...patch })
  const setVehicle = (patch: Partial<DesignVehicle>) => set({ vehicle: { ...check.vehicle, ...patch } })
  // Edited dimensions are no longer the preset's, so stop naming them as the preset.
  const setDimensions = (patch: Partial<DesignVehicle>) => {
    const example = VEHICLE_PRESETS.find((p) => p.vehicle.name === check.vehicle.name)
    setVehicle(
      example ? { ...patch, name: example.vehicle.name.replace(/ \((example|BC MoTI figure)\)$/, ' (edited)') } : patch,
    )
  }
  const preset = VEHICLE_PRESETS.find((p) => sameVehicle(p.vehicle, check.vehicle))
  const failing = turns.filter(failingTurn)
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
                  ? failing.every((t) => t.fits)
                    ? `${failing.length} of ${turns.length} turns need more steering than the lock`
                    : `${failing.length} of ${turns.length} turns need wider formation${failing.some((t) => t.lockExceeded) ? ' or more steering' : ''}`
                  : `Wheels stay on the formation in all ${turns.length} turns`}
        </p>
        <p className="mt-0.5 text-2xs opacity-80">
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
              lockDeg={check.vehicle.steeringLockDeg}
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
          <p key={w} className="border-l-2 border-amber-500 pl-2 text-2xs text-amber-800 dark:text-amber-300">
            {w}
          </p>
        ))}
      <details className="rounded-md border">
        <summary className="cursor-pointer p-2 font-medium">Vehicle, direction & clearance</summary>
        <div className="space-y-2 border-t p-2">
          <Field label="Starting configuration">
            <RoadSelect
              className={roadFieldClass}
              ariaLabel="Design vehicle preset"
              disabled={!onChange}
              value={preset?.id ?? 'custom'}
              onValueChange={(value) => {
                const next = VEHICLE_PRESETS.find((p) => p.id === value)
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
            </RoadSelect>
          </Field>
          <p className="text-2xs text-amber-800 dark:text-amber-300">
            Presets are example or transcribed dimensions, not approvals: the source below says which values to confirm.
            Enter your fleet’s truck, trailer and load before relying on a result.
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
              <RoadSelect
                className={roadFieldClass}
                ariaLabel="Design vehicle travel direction"
                disabled={!onChange}
                value={check.direction}
                onValueChange={(value) => set({ direction: value as VehicleCheck['direction'] })}
              >
                <option value="both">Both directions</option>
                <option value="up">Up-station</option>
                <option value="down">Down-station</option>
              </RoadSelect>
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
          <SteeringFields vehicle={check.vehicle} disabled={!onChange} onChange={setDimensions} />
          <LoadFields vehicle={check.vehicle} disabled={!onChange} onChange={setDimensions} />
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
      {junctionPanel(check)}
      <InfoTip label="How the swept path is calculated" showLabel bubbleClassName="w-96 space-y-1.5">
        <span className="block">{SWEPT_PATH_BASIS}</span>
        <span className="block">
          A turn spans each fitted curve plus a vehicle length either side; turns that overlap are judged together, so a
          switchback’s two curves read as one 180° turn.
        </span>
      </InfoTip>
    </div>
  )
}
