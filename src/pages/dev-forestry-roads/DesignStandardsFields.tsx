import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { gradeRule, STANDARD_LIMITS, type DesignStandards } from './designStandards'
import { settleJobStandards, type JobStandards } from './jobStandards'
import { VEHICLE_PRESETS } from './sweptPath'

const EITHER = 'either'
const NONE = 'none'

/**
 * The job's design standards as one form, used by the Review step and by New project. It edits a
 * `JobStandards` value; the caller decides where that lives.
 */
export function DesignStandardsFields({
  value,
  onChange,
  disabled = false,
}: {
  value: JobStandards
  onChange: (next: JobStandards) => void
  disabled?: boolean
}) {
  const s = value.standards
  const set = (patch: Partial<JobStandards>) => onChange(settleJobStandards({ ...value, ...patch }, value))
  const standard = (patch: Partial<DesignStandards>) => set({ standards: { ...s, ...patch } })
  // A vehicle typed by hand in the swept-path check keeps its name here.
  const custom = s.designVehicle !== null && !VEHICLE_PRESETS.some((preset) => preset.id === s.designVehicle)
  // An allowance no steeper than every sustained limit allows nothing; say so where it is typed.
  const rule = gradeRule({ maxGradePercent: value.maxGradePercent }, s)
  const idlePitch = s.shortPitchGradePercent !== null && s.shortPitchMaxLengthM !== null && !rule.shortPitch
  return (
    <div className="space-y-2" data-testid="road-design-standards">
      <div className="grid grid-cols-2 items-end gap-2">
        <NumberField
          label="Grade limit (%)"
          hint="The sustained limit, checked at every station. With an adverse limit below it, this one applies to loaded trucks going downhill (favourable). Route searches use it as their maximum grade."
          value={value.maxGradePercent}
          min={STANDARD_LIMITS.gradePercent[0]}
          max={STANDARD_LIMITS.gradePercent[1]}
          step={1}
          disabled={disabled}
          onChange={(maxGradePercent) => set({ maxGradePercent })}
        />
        <NumberField
          label="Minimum radius (m)"
          hint="Horizontal curves tighter than this are raised in Review. Zero leaves the radius unchecked."
          value={value.minRadius}
          min={0}
          max={10000}
          step={5}
          disabled={disabled}
          onChange={(minRadius) => set({ minRadius })}
        />
        <OptionalNumberField
          label="Short-pitch limit (%)"
          hint="A pitch may be steeper than the grade limit up to this grade, as long as it is no longer than the pitch length beside it. Enter both: 12 %, 18 % for pitches up to 100 m. A value between the adverse limit and the grade limit applies to loaded-uphill pitches only."
          error={
            idlePitch
              ? `Enter more than ${Math.min(rule.adversePercent, rule.favourablePercent)} %: at or below every grade limit, the allowance permits nothing.`
              : undefined
          }
          value={s.shortPitchGradePercent}
          min={STANDARD_LIMITS.gradePercent[0]}
          max={STANDARD_LIMITS.gradePercent[1]}
          step={1}
          placeholder="none"
          onChange={(shortPitchGradePercent) => standard({ shortPitchGradePercent })}
        />
        <OptionalNumberField
          label="Longest pitch (m)"
          value={s.shortPitchMaxLengthM}
          min={STANDARD_LIMITS.shortPitchLengthM[0]}
          max={STANDARD_LIMITS.shortPitchLengthM[1]}
          step={10}
          placeholder="none"
          onChange={(shortPitchMaxLengthM) => standard({ shortPitchMaxLengthM })}
        />
        <Field
          label="Loaded trucks travel"
          hint="Along each road's stationing. It tells an adverse grade (loaded uphill) from a favourable one (loaded downhill). A spur stationed from its junction usually hauls toward the start."
        >
          <RoadSelect
            ariaLabel="Loaded trucks travel"
            className={roadFieldClass}
            value={s.loadedDirection ?? EITHER}
            disabled={disabled}
            onValueChange={(picked) =>
              standard({
                loadedDirection: picked === EITHER ? null : (picked as DesignStandards['loadedDirection']),
                ...(picked === EITHER ? { adverseGradePercent: null } : {}),
              })
            }
          >
            <option value={EITHER}>Either way</option>
            <option value="end-to-start">Toward the road start</option>
            <option value="start-to-end">Toward the road end</option>
          </RoadSelect>
        </Field>
        {s.loadedDirection ? (
          <OptionalNumberField
            label="Adverse limit (%)"
            hint="The sustained limit for loaded trucks climbing. It can only be at or below the grade limit."
            value={s.adverseGradePercent}
            min={STANDARD_LIMITS.gradePercent[0]}
            max={value.maxGradePercent}
            step={1}
            placeholder="same"
            onChange={(adverseGradePercent) => standard({ adverseGradePercent })}
          />
        ) : (
          <p className="pb-1.5 text-2xs leading-4 text-muted-foreground">
            Choose a haul direction to set a lower adverse limit.
          </p>
        )}
        <OptionalNumberField
          label="Running surface (m)"
          hint="Width of the running surface, both sides together. Review compares each road's template with it."
          value={s.runningSurfaceWidthM}
          min={STANDARD_LIMITS.runningSurfaceWidthM[0]}
          max={STANDARD_LIMITS.runningSurfaceWidthM[1]}
          step={0.5}
          placeholder="not set"
          onChange={(runningSurfaceWidthM) => standard({ runningSurfaceWidthM })}
        />
        <OptionalNumberField
          label="Clearing limit (m)"
          hint="The widest clearing the job allows, catch line to catch line plus any preparation margin. Review measures every section against it."
          value={s.maxClearingWidthM}
          min={STANDARD_LIMITS.clearingWidthM[0]}
          max={STANDARD_LIMITS.clearingWidthM[1]}
          step={1}
          placeholder="not set"
          onChange={(maxClearingWidthM) => standard({ maxClearingWidthM })}
        />
        <OptionalNumberField
          label="Design speed (km/h)"
          hint="Recorded and printed with the standards. Section → Superelevation & widening applies a speed to each road."
          value={s.designSpeedKmh}
          min={STANDARD_LIMITS.designSpeedKmh[0]}
          max={STANDARD_LIMITS.designSpeedKmh[1]}
          step={5}
          placeholder="not set"
          onChange={(designSpeedKmh) => standard({ designSpeedKmh })}
        />
        <OptionalNumberField
          label="Drain spacing (m)"
          hint="The longest run of road allowed between culverts, measured between culverts and from each road end."
          value={s.maxCrossDrainSpacingM}
          min={STANDARD_LIMITS.crossDrainSpacingM[0]}
          max={STANDARD_LIMITS.crossDrainSpacingM[1]}
          step={10}
          placeholder="not set"
          onChange={(maxCrossDrainSpacingM) => standard({ maxCrossDrainSpacingM })}
        />
      </div>
      <Field
        label="Design vehicle"
        hint="The vehicle the swept-path check runs on each road. The presets are example dimensions: replace them with the fleet's in the swept-path view."
      >
        <RoadSelect
          ariaLabel="Design vehicle"
          className={roadFieldClass}
          value={s.designVehicle ?? NONE}
          disabled={disabled}
          onValueChange={(picked) => standard({ designVehicle: picked === NONE ? null : picked })}
        >
          <option value={NONE}>Not set</option>
          {VEHICLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
          {custom && <option value={s.designVehicle!}>{s.designVehicle}</option>}
        </RoadSelect>
      </Field>
      <Field
        label="Source of these limits"
        hint="The road class, permit condition or company standard they come from. Printed in the report."
      >
        <input
          className={roadFieldClass}
          value={s.source ?? ''}
          maxLength={500}
          disabled={disabled}
          placeholder="e.g. Company standard, class 3 spur"
          onChange={(event) => standard({ source: event.target.value || undefined })}
        />
      </Field>
    </div>
  )
}
