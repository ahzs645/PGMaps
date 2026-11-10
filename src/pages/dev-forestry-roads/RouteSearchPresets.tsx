import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import {
  matchingSearchPreset,
  SEARCH_PRESET_CONFIRM,
  SEARCH_PRESET_SOURCE,
  SEARCH_PRESETS,
  searchPresetSummary,
  type SearchPreset,
} from './searchPresets'
import type { RoadSettings } from './types'

/**
 * Spur, block road and mainline: each fills the grade limit and tightest curve from Table 3-5 of the
 * BC Engineering Manual. The one the settings match stays pressed until either value is changed.
 */
export function RouteSearchPresets({
  settings,
  disabled,
  onApply,
}: {
  settings: Pick<RoadSettings, 'maxGradePercent' | 'minRadius'>
  disabled?: boolean
  onApply: (preset: SearchPreset) => void
}) {
  const active = matchingSearchPreset(settings)
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Search presets">
      <span className="text-2xs text-muted-foreground">Preset</span>
      {SEARCH_PRESETS.map((preset) => (
        <Button
          key={preset.id}
          size="sm"
          variant={active?.id === preset.id ? 'default' : 'outline'}
          className="h-7 px-2 text-xs"
          aria-pressed={active?.id === preset.id}
          disabled={disabled}
          title={searchPresetSummary(preset).sets}
          data-testid={`road-route-preset-${preset.id}`}
          onClick={() => onApply(preset)}
        >
          {preset.label}
        </Button>
      ))}
      <InfoTip label="What the presets set" bubbleClassName="max-w-sm">
        {SEARCH_PRESETS.map((preset) => {
          const summary = searchPresetSummary(preset)
          return (
            <span key={preset.id} className="mb-1 block">
              <b>{preset.label}</b>: {summary.sets} {summary.shows} {summary.speed}
            </span>
          )
        })}
        <span className="mb-1 block">Source: {SEARCH_PRESET_SOURCE}</span>
        <span className="block">
          {SEARCH_PRESET_CONFIRM} A preset changes the project&apos;s grade limit and tightest curve, which every check
          reads; undo reverses it.
        </span>
      </InfoTip>
    </div>
  )
}
