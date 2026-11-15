import { CheckboxField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { OptionalNumberField } from './Controls'
import { RANGE_LIMITS, type EstimateSettings, type RangeOptions } from './reportPackage'
import { createRoadReportSettings, parseRoadReportSettings, type RoadReportSettings } from './reportSettings'

const FIELDS = [
  ['crossDrainSpacingM', 'Cross-drain every (m)', 'none'],
  ['crossDrainCost', 'Each cross-drain ($)', 'not priced'],
  ['endHaulRate', 'End haul ($/m³)', 'not priced'],
] as const

/** Writes the estimate settings back into the report settings, dropping them when all are blank. */
function withEstimate(settings: RoadReportSettings, estimate: EstimateSettings): RoadReportSettings {
  const next: RoadReportSettings = { ...settings, estimate }
  if (!Object.keys(estimate).length) delete next.estimate
  return parseRoadReportSettings(next)
}

/**
 * The preliminary estimate's allowances: cross-drain spacing and price, and an end-haul rate. Each is
 * the person's own figure; a blank one is counted and named in the estimate, never priced.
 */
export function EstimateAllowances({
  value,
  onChange,
}: {
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
}) {
  const settings = value ?? createRoadReportSettings()
  const estimate = settings.estimate ?? {}
  return (
    <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-3" data-testid="road-estimate-allowances">
      {FIELDS.map(([key, label, blank]) => (
        <OptionalNumberField
          key={key}
          label={label}
          value={estimate[key] ?? null}
          placeholder={blank}
          min={RANGE_LIMITS[key][0]}
          max={RANGE_LIMITS[key][1]}
          step={key === 'endHaulRate' ? 0.5 : 1}
          updateOn="commit"
          onChange={(next) => {
            const changed: EstimateSettings = { ...estimate }
            if (next === null) delete changed[key as keyof RangeOptions]
            else changed[key as keyof RangeOptions] = next
            onChange(withEstimate(settings, changed))
          }}
        />
      ))}
    </div>
  )
}

/** What the Preliminary estimate export holds: the allowances and whether its figures count contingency. */
export function EstimateSettingsEditor({
  value,
  onChange,
}: {
  value?: RoadReportSettings
  onChange: (settings: RoadReportSettings) => void
}) {
  const settings = value ?? createRoadReportSettings()
  const estimate = settings.estimate ?? {}
  const heading = 'text-3xs font-semibold uppercase tracking-wide text-muted-foreground'
  return (
    <div className="space-y-3 text-xs" data-testid="road-estimate-settings">
      <div className="flex items-center gap-2">
        <h4 className={heading}>Allowances</h4>
        <InfoTip label="About the preliminary estimate">
          Each road priced three ways on copies of it; its own estimate is unchanged. Low: the 1:1 fill wherever it
          closes a section, and the longer reach that closes the rest. Medium: each stretch&apos;s leading fix in Review
          (full bench on ground of 60% or more, else the 1:1 fill, else the reach). High: every fill stretch
          full-benched, and the stretches a slope sheet shows steeper. Medium and high add cross-drains at your spacing
          and price; every level prices surplus cut at your end-haul rate where a road has no haul rates of its own. A
          blank figure is counted and named, never guessed. The report package can print the same range on its summary
          page.
        </InfoTip>
      </div>
      <EstimateAllowances value={settings} onChange={onChange} />
      <CheckboxField
        label="Include contingency in estimates and totals"
        checked={estimate.contingency !== false}
        onCheckedChange={(on) => {
          const changed: EstimateSettings = { ...estimate }
          if (on) delete changed.contingency
          else changed.contingency = false
          onChange(withEstimate(settings, changed))
        }}
      />
    </div>
  )
}
