import { NumberField } from '@/components/ui/form-field'

/** Relative weights for the periods of one summary (establishment or maturation), one field per period. */
export function PeriodWeightFields({
  label,
  periods,
  weights,
  onChange,
}: {
  label: string
  periods: readonly string[]
  weights: readonly number[]
  onChange: (weights: number[]) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label} period weights</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {periods.map((period, index) => (
          <NumberField
            key={period}
            label={`${label} ${period}`}
            value={weights[index]}
            min={0}
            step={0.05}
            onValueChange={(value) =>
              onChange(weights.map((weight, position) => (position === index ? value : weight)))
            }
          />
        ))}
      </div>
    </fieldset>
  )
}
