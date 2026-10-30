import { useId } from 'react'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { FilterChipGroup } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import {
  HEATMAP_OPTIONS,
  WALKABILITY_FACTOR_GROUPS,
  isFactorDroppedByOptions,
  type HeatmapFactorWeightState,
  type HeatmapOptionKey,
  type HeatmapOptionState,
  type WalkabilityFactorGroup,
} from '@/maps/pgdata/walkabilityFactors'

interface WalkabilityFactorWeightRowProps {
  factor: WalkabilityFactorGroup
  value: number
  dropped: boolean
  onChange: (value: number) => void
}

/** One report term, shared by MISC's equation builder and Index Lab's surface editor. */
export function WalkabilityFactorWeightRow({ factor, value, dropped, onChange }: WalkabilityFactorWeightRowProps) {
  const id = useId()
  return (
    <NumericRangeField
      label={
        <>
          <span className="block font-medium leading-4 text-foreground">
            {factor.ref} · {factor.label}
          </span>
          <span id={`${id}-method`} className="block leading-4 text-muted-foreground">
            {factor.group} · {factor.method}
          </span>
        </>
      }
      display={dropped ? 'off' : `${value.toFixed(2)}x`}
      className="space-y-0 rounded border border-border bg-background px-2 py-1.5"
      labelClassName="min-w-0"
      headerClassName="items-start gap-2"
      valueClassName="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-xs text-foreground"
      inputClassName="mt-1.5 h-2 accent-emerald-600 disabled:opacity-40"
      aria-label={`${factor.ref} ${factor.label} weight`}
      aria-describedby={`${id}-method`}
      aria-valuetext={dropped ? 'off' : `${value.toFixed(2)} times report weight`}
      min={0}
      max={2}
      step={0.25}
      value={value}
      disabled={dropped}
      onChange={onChange}
    />
  )
}

interface WalkabilityFactorControlsProps {
  factors?: readonly WalkabilityFactorGroup[]
  options: HeatmapOptionState
  weights: HeatmapFactorWeightState
  onChange: (ref: string, value: number) => void
  className?: string
}

export function WalkabilityFactorControls({
  factors = WALKABILITY_FACTOR_GROUPS,
  options,
  weights,
  onChange,
  className,
}: WalkabilityFactorControlsProps) {
  return (
    <div className={cn('space-y-1.5 pr-1', className)}>
      {factors.map((factor) => (
        <WalkabilityFactorWeightRow
          key={factor.ref}
          factor={factor}
          value={weights[factor.ref] ?? 1}
          dropped={isFactorDroppedByOptions(factor.ref, options)}
          onChange={(value) => onChange(factor.ref, value)}
        />
      ))}
    </div>
  )
}

interface WalkabilityOptionControlsProps {
  options: HeatmapOptionState
  onChange: (key: HeatmapOptionKey, enabled: boolean) => void
  /** Retain the compact MISC chips and the explanatory Index Lab rows. */
  variant?: 'rows' | 'chips'
}

export function WalkabilityOptionControls({ options, onChange, variant = 'rows' }: WalkabilityOptionControlsProps) {
  if (variant === 'chips') {
    return (
      <FilterChipGroup
        variant="filled"
        showDot={false}
        items={HEATMAP_OPTIONS.map((option) => ({
          value: option.key,
          label: option.label,
          color: '#10b981',
          title: option.description,
        }))}
        selectedValues={HEATMAP_OPTIONS.filter((option) => options[option.key]).map((option) => option.key)}
        onToggle={(key) => onChange(key, !options[key])}
      />
    )
  }
  return (
    <div className="space-y-1.5">
      {HEATMAP_OPTIONS.map((option) => (
        <label
          key={option.key}
          className="flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5"
        >
          <input
            type="checkbox"
            checked={options[option.key]}
            onChange={(event) => onChange(option.key, event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-emerald-600"
          />
          <span className="min-w-0">
            <span className="block font-medium leading-4 text-foreground">{option.label}</span>
            <span className="block leading-4 text-muted-foreground">{option.description}</span>
          </span>
        </label>
      ))}
    </div>
  )
}
