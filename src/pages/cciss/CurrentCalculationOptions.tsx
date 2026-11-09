import { NumberField, SelectField } from '@/components/ui/form-field'
import { CollapsibleSection } from '@/components/ui/map-panels'
import { PeriodWeightFields } from './PeriodWeightFields'
import { ESTABLISHMENT_PERIODS, MATURATION_PERIODS, SHINY_NOVELTY_CUTOFF } from './shinyReport'

type Weights = Record<string, number>
const ALL = '__all__'
const CUSTOM = '__custom__'

/** One option at full weight, every option equally, or anything else ("custom"). */
function weightPreset(names: string[], weights: Weights) {
  const active = names.filter((name) => weights[name] > 0)
  if (active.length === 1) return active[0]
  if (active.length === names.length && names.every((name) => weights[name] === weights[names[0]])) return ALL
  return CUSTOM
}

/** A quick pick over one weight group; the full fields live in the calculation options. */
export function WeightPreset({
  label,
  names,
  weights,
  onChange,
}: {
  label: string
  names: string[]
  weights: Weights
  onChange: (weights: Weights) => void
}) {
  return (
    <SelectField
      label={label}
      value={weightPreset(names, weights)}
      onChange={(event) =>
        onChange(
          Object.fromEntries(
            names.map((name) => [name, event.target.value === ALL || event.target.value === name ? 1 : 0]),
          ),
        )
      }
    >
      <option value={ALL}>All available · equal weights</option>
      <option value={CUSTOM} disabled>
        Custom weights
      </option>
      {names.map((name) => (
        <option key={name}>{name}</option>
      ))}
    </SelectField>
  )
}

function WeightFields({
  label,
  names,
  weights,
  onChange,
}: {
  label: string
  names: string[]
  weights: Weights
  onChange: (weights: Weights) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {names.map((name) => (
          <NumberField
            key={name}
            label={name}
            value={weights[name] ?? 0}
            onValueChange={(value) => onChange({ ...weights, [name]: value })}
            min={0}
            step={0.1}
          />
        ))}
      </div>
    </fieldset>
  )
}

export interface CalculationOptions {
  modelWeights: Weights
  scenarioWeights: Weights
  noveltyCutoff: number | null
  includeOutOfRange: boolean
  establishmentWeights: number[]
  maturationWeights: number[]
}

/** Every weight and switch behind the presets, folded away by default. */
export function CurrentCalculationOptions({
  models,
  scenarios,
  runs,
  value,
  onChange,
  defaultsNote,
}: {
  models: string[]
  scenarios: string[]
  runs: string[]
  value: CalculationOptions
  onChange: (patch: Partial<CalculationOptions>) => void
  /** How the starting weights relate to Shiny's defaults for this bundle. */
  defaultsNote: string
}) {
  return (
    <CollapsibleSection
      label="Model weights and calculation options"
      collapseOn="always"
      className="rounded-md border"
      contentClassName="space-y-4 px-3 pb-3"
    >
      <p className="text-xs text-muted-foreground">{defaultsNote}</p>
      {runs.length > 0 && <p className="text-xs text-muted-foreground">Available runs: {runs.join(', ')}.</p>}
      <WeightFields
        label="Model weights"
        names={models}
        weights={value.modelWeights}
        onChange={(modelWeights) => onChange({ modelWeights })}
      />
      <WeightFields
        label="Scenario weights"
        names={scenarios}
        weights={value.scenarioWeights}
        onChange={(scenarioWeights) => onChange({ scenarioWeights })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.noveltyCutoff !== null}
          onChange={(event) => onChange({ noveltyCutoff: event.target.checked ? SHINY_NOVELTY_CUTOFF : null })}
        />
        Apply novelty cutoff
      </label>
      {value.noveltyCutoff !== null && (
        <NumberField
          label="Novelty cutoff"
          value={value.noveltyCutoff}
          onValueChange={(noveltyCutoff) => onChange({ noveltyCutoff })}
          min={2}
          max={8}
          step={0.1}
          unit="sigma"
        />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.includeOutOfRange}
          onChange={(event) => onChange({ includeOutOfRange: event.target.checked })}
        />
        Include out-of-range ecological ratings
      </label>
      <p className="text-xs text-muted-foreground">
        Period summary weights follow the current calculator periods. Missing or incomplete conditional vote periods
        withhold the summary.
      </p>
      <PeriodWeightFields
        label="Establishment"
        periods={ESTABLISHMENT_PERIODS}
        weights={value.establishmentWeights}
        onChange={(establishmentWeights) => onChange({ establishmentWeights })}
      />
      <PeriodWeightFields
        label="Maturation"
        periods={MATURATION_PERIODS}
        weights={value.maturationWeights}
        onChange={(maturationWeights) => onChange({ maturationWeights })}
      />
    </CollapsibleSection>
  )
}
