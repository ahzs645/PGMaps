/**
 * The cable yarder's fields in the extraction-reach panel: a machine preset, where the yarder
 * stands, the carriage, the line's heights and lengths, line rules and the rope and load. Presets
 * are Sylvaccess 3.6's machine types (Dupire et al. 2015; INRAE user notice, 2024). Written from a
 * functional specification; no code from Sylvaccess (GPL-3.0-or-later) was used.
 */
import { InfoTip } from '@/components/ui/info-tip'
import { Field, NumberField, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import {
  CABLE_PRESETS,
  CABLE_RULE_LABELS,
  CABLE_RULE_LIMITS,
  cableRuleErrors,
  SIDE_SLOPE_MAX_M,
  SIDE_SLOPE_MAX_SHARE,
  SIDE_SLOPE_OFF_FALL_LINE_DEG,
  SIDE_SLOPE_PERCENT,
  usableSkylineM,
  type CableCarriageSystem,
  type CableCoverageRule,
  type CablePosition,
  type CablePresetId,
} from './cableCoverageRule'
import { RIGGING_LABELS, RIGGING_LIMITS, type CableRigging } from './cableMechanics'
import { applyRiggingSetToRule, type RiggingSet } from './dline/riggingSets'
import { RiggingSetPicker } from './RiggingSetPicker'

const POSITIONS: { value: CablePosition; label: string }[] = [
  { value: 'either', label: 'Above or below' },
  { value: 'above', label: 'Above the line' },
  { value: 'below', label: 'Below the line' },
]
const SYSTEMS: { value: CableCarriageSystem; label: string }[] = [
  { value: 'multi-cable', label: 'Haulback (multi-cable)' },
  { value: 'two-cable', label: 'Gravity (two-cable)' },
]
type RuleNumber = keyof typeof CABLE_RULE_LIMITS
const STEP: Partial<Record<RuleNumber, number>> = {
  towerHeightM: 0.5,
  supportHeightM: 0.5,
  tailHeightM: 0.5,
  maxSupports: 1,
  maxSkylineM: 10,
  minLineM: 10,
  lateralM: 5,
  maxHeightAboveGroundM: 5,
  minSupportSpacingM: 5,
  maxBreakDeg: 1,
  bearingStepDeg: 1,
  landingSpacingM: 5,
  maxOutsideBlockM: 5,
}
const HINT: Partial<Record<RuleNumber, string>> = {
  maxSkylineM: 'Rope on the drum. The guyline to the anchor behind the tail comes off it.',
  minLineM: 'Lines shorter than this, along the skyline, are not kept.',
  lateralM: 'Half the width of ground a line yards, either side of the skyline.',
  maxHeightAboveGroundM: 'The far end is pulled in until the loaded line runs no higher than this above the ground.',
  minSupportSpacingM: 'Least distance between two intermediate supports.',
  maxBreakDeg: 'Largest loaded break angle at an intermediate support, at every carriage position.',
  bearingStepDeg: 'Lines leave each landing this many degrees apart.',
  landingSpacingM: 'One landing every this far along each counted truck road near the block.',
  maxOutsideBlockM: 'Longest stretch a line may run outside the block; it must end inside it.',
}
const RIGGING: (keyof typeof RIGGING_LIMITS)[] = [
  'ropeDiameterMm',
  'ropeMassKgPerM',
  'breakingForceKN',
  'safetyFactor',
  'elasticModulusKNPerMm2',
  'metallicFillFactor',
  'payloadKg',
  'carriageKg',
  'runningLinesKgPerM',
  'minClearanceM',
]

/** The cable yarder's rule, edited in place. */
export function CableCoverageFields({
  rule,
  onRule,
  riggingSets,
}: {
  rule: CableCoverageRule
  onRule: (update: (r: CableCoverageRule) => CableCoverageRule) => void
  /** The project's named rigging sets, shared with the D-lines. */
  riggingSets?: { sets: readonly RiggingSet[]; onSetsChange: (sets: RiggingSet[]) => void }
}) {
  const set = (patch: Partial<CableCoverageRule>) => onRule((r) => ({ ...r, ...patch }))
  const rigging = (patch: Partial<CableRigging>) => onRule((r) => ({ ...r, rigging: { ...r.rigging, ...patch } }))
  const errors = cableRuleErrors(rule)
  const number = (key: RuleNumber) => (
    <NumberField
      key={key}
      label={CABLE_RULE_LABELS[key]}
      value={rule[key]}
      min={CABLE_RULE_LIMITS[key][0]}
      max={CABLE_RULE_LIMITS[key][1]}
      step={STEP[key] ?? 1}
      hint={HINT[key]}
      onChange={(value) => set({ [key]: key === 'maxSupports' ? Math.round(value) : value })}
    />
  )
  return (
    <div className="space-y-2">
      <Field label="Machine preset">
        <RoadSelect
          ariaLabel="Cable machine preset"
          value=""
          placeholder="Fill from a preset…"
          onValueChange={(id) => {
            const preset = CABLE_PRESETS[id as CablePresetId]
            if (preset)
              onRule((r) => ({ ...preset.rule, landingSpacingM: r.landingSpacingM, bearingStepDeg: r.bearingStepDeg }))
          }}
          options={Object.entries(CABLE_PRESETS).map(([value, p]) => ({ value, label: p.label }))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Yarder stands">
          <RoadSelect
            ariaLabel="Yarder stands"
            value={rule.position}
            onValueChange={(value) => set({ position: value as CablePosition })}
            options={POSITIONS}
          />
        </Field>
        <Field label="Carriage">
          <RoadSelect
            ariaLabel="Carriage"
            value={rule.system}
            onValueChange={(value) => set({ system: value as CableCarriageSystem })}
            options={SYSTEMS}
          />
        </Field>
        {number('maxSkylineM')}
        {number('minLineM')}
        {number('towerHeightM')}
        {number('maxSupports')}
        {number('supportHeightM')}
        {number('tailHeightM')}
        {number('lateralM')}
        {number('bearingStepDeg')}
      </div>
      <RoadSection
        title="Line rules"
        summary={`${Math.round(usableSkylineM(rule))} m usable · ${rule.landingSpacingM} m landings`}
        help={
          <>
            Each line is cut, before any rope check, at unknown ground, a stream (when streams stop extraction), its
            usable length, too long a run outside the block, or too much side-slope ground: ground steeper than{' '}
            {SIDE_SLOPE_PERCENT} % crossed {SIDE_SLOPE_OFF_FALL_LINE_DEG}° or more off the fall line, up to{' '}
            {SIDE_SLOPE_MAX_M} m and {100 * SIDE_SLOPE_MAX_SHARE} % of the line at its end (Sylvaccess&apos;s fixed
            rule). The usable length is the skyline less a 45° guyline from the tail top to its anchor.
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {number('landingSpacingM')}
          {number('maxOutsideBlockM')}
          {number('maxHeightAboveGroundM')}
          {number('minSupportSpacingM')}
          {number('maxBreakDeg')}
        </div>
      </RoadSection>
      <RoadSection
        title="Rope and load"
        summary={`${rule.rigging.ropeDiameterMm} mm · ${rule.rigging.payloadKg.toLocaleString('en-CA')} kg`}
        help="Each line is tensioned to the rope's allowable working tension (breaking force ÷ safety factor) and checked as an elastic catenary with the loaded carriage moved along every span."
      >
        {riggingSets && (
          <RiggingSetPicker
            sets={riggingSets.sets}
            rigging={rule.rigging}
            ignoreTensionMode
            onApply={(set) => onRule((r) => applyRiggingSetToRule(r, set))}
            onSetsChange={riggingSets.onSetsChange}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          {RIGGING.map((key) => (
            <NumberField
              key={key}
              label={RIGGING_LABELS[key]}
              value={rule.rigging[key]}
              min={RIGGING_LIMITS[key][0]}
              max={RIGGING_LIMITS[key][1]}
              step={key === 'metallicFillFactor' ? 0.01 : key === 'safetyFactor' || key === 'ropeMassKgPerM' ? 0.05 : 1}
              onChange={(value) => rigging({ [key]: value })}
            />
          ))}
        </div>
      </RoadSection>
      {errors.length > 0 && <p className="text-2xs text-destructive">{errors[0]}</p>}
      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
        Presets: Sylvaccess 3.6 machine types, not BC ratings.
        <InfoTip label="About the cable presets">
          Each preset fills the rope, carriage and line lengths from Sylvaccess 3.6 (INRAE): rope modulus on the full
          circle, 2,500 kg payload, 400 kg carriage, 3.5 m load clearance, 12 m supports and tail. Replace them with
          your yarder&apos;s ratings and the job&apos;s rigging.
        </InfoTip>
      </p>
    </div>
  )
}
