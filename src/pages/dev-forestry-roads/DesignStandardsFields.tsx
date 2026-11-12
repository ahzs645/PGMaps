import { Field, NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { gradeRule, STANDARD_LIMITS, type DesignStandards } from './designStandards'
import { settleJobStandards, type JobStandards } from './jobStandards'
import { VEHICLE_PRESETS } from './sweptPath'
import { STANDARD_LABELS, fieldIds, type StandardFieldId } from './roadFieldDefinitions'

const EITHER = 'either'
const NONE = 'none'

const optionalStandards = {
  shortPitchGradePercent: {
    limits: STANDARD_LIMITS.gradePercent,
    step: 1,
    placeholder: 'none',
    hint: 'A pitch may be steeper than the grade limit up to this grade, as long as it is no longer than the pitch length beside it. Enter both: 12 %, 18 % for pitches up to 100 m. A value between the adverse limit and the grade limit applies to loaded-uphill pitches only.',
  },
  shortPitchMaxLengthM: {
    limits: STANDARD_LIMITS.shortPitchLengthM,
    step: 10,
    placeholder: 'none',
    hint: undefined,
  },
  adverseGradePercent: {
    limits: STANDARD_LIMITS.gradePercent,
    step: 1,
    placeholder: 'same',
    hint: 'The sustained limit for loaded trucks climbing. It can only be at or below the grade limit.',
  },
  runningSurfaceWidthM: {
    limits: STANDARD_LIMITS.runningSurfaceWidthM,
    step: 0.5,
    placeholder: 'not set',
    hint: "Width of the running surface, both sides together. Review compares each road's template with it.",
  },
  maxClearingWidthM: {
    limits: STANDARD_LIMITS.clearingWidthM,
    step: 1,
    placeholder: 'not set',
    hint: 'The widest clearing the job allows, catch line to catch line plus any preparation margin. Review measures every section against it.',
  },
  designSpeedKmh: {
    limits: STANDARD_LIMITS.designSpeedKmh,
    step: 5,
    placeholder: 'not set',
    hint: 'Recorded and printed with the standards. Section → Superelevation & widening applies a speed to each road.',
  },
  maxCrossDrainSpacingM: {
    limits: STANDARD_LIMITS.crossDrainSpacingM,
    step: 10,
    placeholder: 'not set',
    hint: 'The longest run of road allowed between culverts, measured between culverts and from each road end.',
  },
}

type StandardProps = {
  value: JobStandards
  onChange: (next: JobStandards) => void
  disabled?: boolean
  /**
   * Keep a field that does not apply yet (the adverse limit before a loaded direction is chosen)
   * in place, disabled, instead of leaving it out, so a fixed strip such as the ribbon does not
   * reflow when it starts to apply.
   */
  keepPlace?: boolean
}

/** One project standard can be hosted in the ribbon or the full project standards editor. */
export function DesignStandardField({
  field,
  value,
  onChange,
  disabled = false,
  keepPlace = false,
}: StandardProps & { field: StandardFieldId }) {
  const s = value.standards
  const set = (patch: Partial<JobStandards>) => onChange(settleJobStandards({ ...value, ...patch }, value))
  const standard = (patch: Partial<DesignStandards>) => set({ standards: { ...s, ...patch } })
  switch (field) {
    case 'maxGradePercent':
      return (
        <NumberField
          label={STANDARD_LABELS[field]}
          hint="The sustained limit, checked at every station. With an adverse limit below it, this one applies to loaded trucks going downhill (favourable). Route searches use it as their maximum grade."
          // Apply the completed number before constraining the adverse grade to it.
          value={value.maxGradePercent}
          updateOn="commit"
          min={STANDARD_LIMITS.gradePercent[0]}
          max={STANDARD_LIMITS.gradePercent[1]}
          step={1}
          disabled={disabled}
          onChange={(maxGradePercent) => set({ maxGradePercent })}
        />
      )
    case 'minRadius':
      return (
        <NumberField
          label={STANDARD_LABELS[field]}
          hint="Horizontal curves tighter than this are raised in Review. Zero leaves the radius unchecked."
          value={value.minRadius}
          min={0}
          max={10000}
          step={5}
          disabled={disabled}
          onChange={(minRadius) => set({ minRadius })}
        />
      )
    case 'loadedDirection':
      return (
        <Field
          label={STANDARD_LABELS[field]}
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
      )
    case 'designVehicle': {
      // Preserve the name of a vehicle entered by hand in the swept-path check.
      const custom = s.designVehicle !== null && !VEHICLE_PRESETS.some((preset) => preset.id === s.designVehicle)
      return (
        <Field
          label={STANDARD_LABELS[field]}
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
      )
    }
    default: {
      const options = optionalStandards[field]
      const notYet = field === 'adverseGradePercent' && !s.loadedDirection
      if (notYet && !keepPlace) return null
      const rule = field === 'shortPitchGradePercent' ? gradeRule(value, s) : undefined
      const idlePitch = rule && s.shortPitchGradePercent !== null && s.shortPitchMaxLengthM !== null && !rule.shortPitch
      return (
        <OptionalNumberField
          label={STANDARD_LABELS[field]}
          value={s[field]}
          updateOn={field === 'shortPitchGradePercent' || field === 'shortPitchMaxLengthM' ? 'commit' : 'change'}
          disabled={disabled || notYet}
          hint={
            notYet
              ? `${options.hint} Choose which way loaded trucks travel to set it; until then the grade limit applies both ways.`
              : options.hint
          }
          min={options.limits[0]}
          max={field === 'adverseGradePercent' ? value.maxGradePercent : options.limits[1]}
          step={options.step}
          placeholder={options.placeholder}
          error={
            idlePitch
              ? `Enter more than ${Math.min(rule.adversePercent, rule.favourablePercent)} %: at or below every grade limit, the allowance permits nothing.`
              : undefined
          }
          onChange={(next) => standard({ [field]: next })}
        />
      )
    }
  }
}

/** The complete standards form is also used to prepare a new project before a workspace exists. */
export function DesignStandardsFields(props: StandardProps) {
  const { value, onChange, disabled } = props
  return (
    <div className="space-y-2" data-testid="road-design-standards">
      <div className="grid grid-cols-2 items-end gap-2">
        {fieldIds(STANDARD_LABELS)
          .filter((id) => id !== 'designVehicle')
          .map((field) =>
            field === 'adverseGradePercent' && !value.standards.loadedDirection ? (
              <p key={field} className="pb-1.5 text-2xs leading-4 text-muted-foreground">
                Choose a haul direction to set a lower adverse limit.
              </p>
            ) : (
              <DesignStandardField key={field} field={field} {...props} />
            ),
          )}
      </div>
      <DesignStandardField field="designVehicle" {...props} />
      <Field
        label="Source of these limits"
        hint="The road class, permit condition or company standard they come from. Printed in the report."
      >
        <input
          className={roadFieldClass}
          value={value.standards.source ?? ''}
          maxLength={500}
          disabled={disabled}
          placeholder="e.g. Company standard, class 3 spur"
          onChange={(event) =>
            onChange({ ...value, standards: { ...value.standards, source: event.target.value || undefined } })
          }
        />
      </Field>
    </div>
  )
}
