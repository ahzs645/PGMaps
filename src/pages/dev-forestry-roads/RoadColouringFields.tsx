/**
 * The controls for how the plan colours the active road (`roadColouring.ts`): what it is coloured
 * by, and for cost and grade their scale and colours. One component, drawn in the plan's map
 * settings and in Save & export's Map PDF options, both on the page's one value
 * (`useRoadColouring.ts`), so changing it in either place changes the plan and the printed map.
 */
import { useMemo } from 'react'
import { COLOR_RAMPS, COLOR_RAMP_KIND_LABELS } from '@pgmaps/geo-toolkit/scales/colorRamps'
import { isCustomRampId } from '@pgmaps/geo-toolkit/scales/customRamps'
import { useCustomRamps } from '@pgmaps/geo-toolkit/ui/custom-ramps'
import { ColorField } from '@/components/ui/color-field'
import { DisclosureRow } from '@/components/ui/disclosure'
import { RampField } from '@/components/ui/ramp-field'
import { StyledSelect } from '@/components/ui/styled-select'
import { TextButton } from '@/components/ui/text-button'
import { customRampStore } from '@/lib/customRamps'
import { Field, NumberField } from './Controls'
import {
  DEFAULT_COST_COLOURING,
  DEFAULT_GRADE_COLOURING,
  isDefaultCostColouring,
  isDefaultGradeColouring,
  ratioText,
  ROAD_COLOUR_MODES,
  ROAD_COLOURING_LIMITS,
  type CostColourSettings,
  type CostReference,
  type GradeColourClass,
  type GradeColourSettings,
  type RoadColourMode,
  type RoadColouring,
} from './roadColouring'

/**
 * Ramps for an amount: low to high, and either side of a middle (the reference is the ramp's
 * middle). A rainbow has no order a reader can rank, so it is not offered for a cost.
 */
const COST_RAMP_OPTIONS = COLOR_RAMPS.filter((ramp) => ramp.kind !== 'rainbow').map((ramp) => ({
  id: ramp.id,
  label: ramp.label,
  colors: ramp.colors,
  group: COLOR_RAMP_KIND_LABELS[ramp.kind],
}))

const GRADE_CLASS_LABELS: Record<GradeColourClass, string> = {
  gentle: 'Gentle',
  moderate: 'Moderate',
  steep: 'Steep',
}

const REFERENCES: readonly { value: CostReference; label: string }[] = [
  { value: 'average', label: 'The road average' },
  { value: 'target', label: 'A target $/m' },
]

const percent = (fraction: number) => Math.round(fraction * 1000) / 10

function rampLabel(settings: CostColourSettings): string {
  if (isCustomRampId(settings.ramp)) return settings.ramp.slice(settings.ramp.indexOf(':') + 1)
  return COLOR_RAMPS.find((ramp) => ramp.id === settings.ramp)?.label ?? settings.ramp
}

function CostScaleFields({
  value,
  onChange,
}: {
  value: CostColourSettings
  onChange: (value: CostColourSettings) => void
}) {
  const customRamps = useCustomRamps(customRampStore)
  const set = (patch: Partial<CostColourSettings>) => onChange({ ...value, ...patch })
  const L = ROAD_COLOURING_LIMITS
  return (
    <div className="grid gap-2">
      <Field label="Colour ramp">
        <RampField
          label="Cost colour ramp"
          value={value.ramp}
          ramps={COST_RAMP_OPTIONS}
          reverse={value.reverse}
          onReverseChange={(reverse) => set({ reverse })}
          custom={{ ramps: customRamps, onSave: customRampStore.save, onDelete: customRampStore.remove }}
          onChange={(ramp, colors) =>
            // A ramp of the person's own travels with the settings as its colours.
            onChange({ ...value, ramp, rampColors: isCustomRampId(ramp) ? [...colors] : undefined })
          }
        />
      </Field>
      <Field label="Read against">
        <StyledSelect
          value={value.reference}
          onValueChange={(reference) => set({ reference: reference as CostReference })}
          aria-label="Read cost against"
        >
          {REFERENCES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </StyledSelect>
      </Field>
      {value.reference === 'target' && (
        <NumberField
          label="Target ($/m)"
          value={value.targetPerMetre}
          min={L.targetPerMetre.min}
          max={L.targetPerMetre.max}
          step={10}
          precision={2}
          updateOn="commit"
          onChange={(targetPerMetre) => set({ targetPerMetre })}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Low end (×)"
          value={value.minRatio}
          min={L.minRatio.min}
          max={L.minRatio.max}
          step={0.05}
          precision={3}
          updateOn="commit"
          onChange={(minRatio) => set({ minRatio })}
        />
        <NumberField
          label="High end (×)"
          value={value.maxRatio}
          min={L.maxRatio.min}
          max={L.maxRatio.max}
          step={0.5}
          precision={3}
          updateOn="commit"
          onChange={(maxRatio) => set({ maxRatio })}
        />
      </div>
    </div>
  )
}

function GradeScaleFields({
  value,
  onChange,
}: {
  value: GradeColourSettings
  onChange: (value: GradeColourSettings) => void
}) {
  const [low, high] = value.breaks
  const { min, max } = ROAD_COLOURING_LIMITS.gradeBreak
  const setColour = (id: GradeColourClass, colour: string | null) =>
    onChange({ ...value, colors: { ...value.colors, [id]: colour ?? DEFAULT_GRADE_COLOURING.colors[id] } })
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Gentle to (%)"
          hint="Of the grade limit."
          value={percent(low)}
          min={percent(min)}
          max={percent(high) - 1}
          step={5}
          precision={1}
          updateOn="commit"
          onChange={(next) => onChange({ ...value, breaks: [next / 100, high] })}
        />
        <NumberField
          label="Moderate to (%)"
          hint="Of the grade limit; steep runs from here to the limit."
          value={percent(high)}
          min={percent(low) + 1}
          max={percent(max)}
          step={5}
          precision={1}
          updateOn="commit"
          onChange={(next) => onChange({ ...value, breaks: [low, next / 100] })}
        />
      </div>
      <div className="grid gap-1.5">
        {(Object.keys(GRADE_CLASS_LABELS) as GradeColourClass[]).map((id) => (
          <div key={id} className="flex items-center justify-between gap-2 text-xs">
            {GRADE_CLASS_LABELS[id]}
            <ColorField
              label={`${GRADE_CLASS_LABELS[id]} grade colour`}
              value={value.colors[id]}
              resettable={value.colors[id] !== DEFAULT_GRADE_COLOURING.colors[id]}
              presetDisplay="picker"
              onChange={(colour) => setColour(id, colour)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * What the active road is coloured by, then that mode's scale and colours in a fold. `folded`
 * starts the fold closed (the plan's narrow settings popover); the Map PDF options open it.
 */
export function RoadColouringFields({
  value,
  onChange,
  folded = true,
}: {
  value: RoadColouring
  onChange: (value: RoadColouring) => void
  folded?: boolean
}) {
  const summary = useMemo(() => {
    if (value.mode === 'cost') {
      const c = value.cost
      return `${rampLabel(c)}${c.reverse ? ', reversed' : ''} · ${ratioText(c.minRatio)}–${ratioText(c.maxRatio)}× ${
        c.reference === 'target' ? 'target' : 'average'
      }`
    }
    if (value.mode === 'grade')
      return `Breaks at ${percent(value.grade.breaks[0])} and ${percent(value.grade.breaks[1])} % of the limit`
    return undefined
  }, [value])
  const changed =
    value.mode === 'cost'
      ? !isDefaultCostColouring(value.cost)
      : value.mode === 'grade'
        ? !isDefaultGradeColouring(value.grade)
        : false
  const reset = () =>
    onChange(
      value.mode === 'cost'
        ? // A target typed earlier is kept for the next time it is chosen.
          { ...value, cost: { ...DEFAULT_COST_COLOURING, targetPerMetre: value.cost.targetPerMetre } }
        : { ...value, grade: DEFAULT_GRADE_COLOURING },
    )
  return (
    // One column held to the space it is given: a summary's full text never widens it (a narrow popover clipped it).
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 text-xs" data-testid="road-colouring">
      <label className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
        Colour road by
        <StyledSelect
          value={value.mode}
          onValueChange={(mode) => onChange({ ...value, mode: mode as RoadColourMode })}
          aria-label="Colour road by"
        >
          {ROAD_COLOUR_MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </StyledSelect>
      </label>
      {value.mode !== 'plain' && (
        <DisclosureRow
          key={value.mode}
          title="Scale and colours"
          summary={summary}
          defaultOpen={!folded}
          actions={
            changed ? (
              <TextButton tone="muted" onClick={reset}>
                Reset
              </TextButton>
            ) : undefined
          }
        >
          {value.mode === 'cost' ? (
            <CostScaleFields value={value.cost} onChange={(cost) => onChange({ ...value, cost })} />
          ) : (
            <GradeScaleFields value={value.grade} onChange={(grade) => onChange({ ...value, grade })} />
          )}
        </DisclosureRow>
      )}
    </div>
  )
}
