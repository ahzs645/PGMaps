import { InfoTip } from '@/components/ui/info-tip'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import { EXAMPLE_RIGGING, RIGGING_LABELS, RIGGING_LIMITS, riggingErrors } from './cableMechanics'
import type { CableRigging } from './cableMechanics'
import type { CableLine } from './types'
import { insetBox } from '@/components/ui/inset-box'

type NumericField = keyof typeof RIGGING_LIMITS
const ROPE: NumericField[] = [
  'ropeMassKgPerM',
  'ropeDiameterMm',
  'metallicFillFactor',
  'elasticModulusKNPerMm2',
  'breakingForceKN',
  'safetyFactor',
]
const LOAD: NumericField[] = ['payloadKg', 'carriageKg', 'runningLinesKgPerM', 'minClearanceM']
const BASE: NumericField[] = ['baseTensionKN', 'extraRopeM']
const STEP: Partial<Record<NumericField, number>> = {
  ropeMassKgPerM: 0.05,
  metallicFillFactor: 0.01,
  safetyFactor: 0.1,
  runningLinesKgPerM: 0.05,
  minClearanceM: 0.5,
}

/**
 * The D-line's sag model and, for rope mechanics, its rigging. The rigging starts from example
 * values and is kept when the line switches back to the assumed sag.
 */
export function CableRiggingFields({
  line,
  onChange,
  omit = [],
}: {
  line: CableLine
  onChange: (next: CableLine) => void
  /** Fields the caller sets itself (the landing screen has its own clearance). */
  omit?: readonly NumericField[]
}) {
  const mechanics = line.sagModel === 'mechanics'
  const rigging = line.rigging ?? EXAMPLE_RIGGING
  const set = (patch: Partial<CableRigging>) => onChange({ ...line, rigging: { ...rigging, ...patch } })
  const errors = mechanics ? riggingErrors(rigging) : []
  const field = (key: NumericField) =>
    omit.includes(key) ? null : (
      <NumberField
        key={key}
        label={RIGGING_LABELS[key]}
        value={rigging[key]}
        min={RIGGING_LIMITS[key][0]}
        max={RIGGING_LIMITS[key][1]}
        step={STEP[key] ?? 1}
        onChange={(value) => set({ [key]: value })}
      />
    )
  return (
    <div className="space-y-2">
      <Field
        label="Sag from"
        hint="Assumed % draws a parabola below the chord. Rope and load solves the skyline as an elastic catenary with the carriage moved along it, and draws the loaded carriage path."
      >
        <RoadSelect
          ariaLabel="Sag from"
          className={roadFieldClass}
          value={mechanics ? 'mechanics' : 'assumed'}
          onValueChange={(value) =>
            onChange(
              value === 'mechanics'
                ? { ...line, sagModel: 'mechanics', rigging }
                : { ...line, sagModel: line.rigging ? 'assumed' : undefined },
            )
          }
        >
          <option value="assumed">Assumed %</option>
          <option value="mechanics">Rope and load</option>
        </RoadSelect>
      </Field>
      {mechanics && (
        <details className={insetBox()} data-testid="cable-rigging">
          <summary className="flex cursor-pointer items-center justify-between gap-1 text-xs">
            <span>
              Rigging · {rigging.ropeDiameterMm} mm · {rigging.payloadKg + rigging.carriageKg} kg
            </span>
            <InfoTip label="About the rigging">
              Starting values are an example 22 mm skyline, not a recommendation. Replace each with the rope, carriage
              and turn you will use. Not a rigging, anchor or WorkSafeBC compliance check.
            </InfoTip>
          </summary>
          <div className="mt-2 space-y-2">
            <Field label="Tension set by">
              <RoadSelect
                ariaLabel="Tension set by"
                className={roadFieldClass}
                value={rigging.tensionMode}
                onValueChange={(value) => set({ tensionMode: value as CableRigging['tensionMode'] })}
              >
                <option value="allowable">Allowable tension with load at mid-span</option>
                <option value="base">Base tension in the empty skyline</option>
              </RoadSelect>
            </Field>
            <div className="grid grid-cols-2 gap-1">{ROPE.map(field)}</div>
            {rigging.tensionMode === 'base' && <div className="grid grid-cols-2 gap-1">{BASE.map(field)}</div>}
            <div className="grid grid-cols-2 gap-1">{LOAD.map(field)}</div>
            {errors.map((error) => (
              <p key={error} className="text-2xs text-destructive">
                {error}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
