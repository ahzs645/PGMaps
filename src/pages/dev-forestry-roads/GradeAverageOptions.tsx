import { useCallback, useState } from 'react'
import { Check, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { NumberField } from './Controls'
import {
  DEFAULT_GRADE_AVERAGE,
  GRADE_AVERAGE_LIMITS,
  GRADE_AVERAGE_PRESETS_M,
  parseGradeAverage,
  type GradeAverageSeries,
  type GradeAverageSettings,
} from './gradeDiagram'

const STORAGE_KEY = 'pgmaps-road-grade-average'

/**
 * The grade charts' rolling-average settings, one set for every grade chart on the page and kept
 * in this browser. A display choice only: it is never written to the project file.
 */
export function useGradeAverage() {
  const [settings, setSettings] = useState<GradeAverageSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? parseGradeAverage(JSON.parse(saved)) : DEFAULT_GRADE_AVERAGE
    } catch {
      return DEFAULT_GRADE_AVERAGE
    }
  })
  const update = useCallback((patch: Partial<GradeAverageSettings>) => {
    setSettings((previous) => {
      const next = parseGradeAverage({ ...previous, ...patch })
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Private windows can refuse storage; the choice still holds for this session.
      }
      return next
    })
  }, [])
  return [settings, update] as const
}

const SERIES_OPTIONS: { value: GradeAverageSeries; label: string }[] = [
  { value: 'ground', label: 'Ground' },
  { value: 'design', label: 'Design' },
  { value: 'both', label: 'Both' },
]

/** The grade chart's options button: the rolling average and its parameters. */
export function GradeAverageOptions({
  settings,
  onChange,
  designShown,
  inHeader,
}: {
  settings: GradeAverageSettings
  onChange: (patch: Partial<GradeAverageSettings>) => void
  /** False where only the ground grade is drawn (no profile designed, or a terrain profile). */
  designShown: boolean
  inHeader: boolean
}) {
  const { windowM, minCoveragePercent } = GRADE_AVERAGE_LIMITS
  return (
    <ToolbarPopover
      label="Grade chart options"
      icon={<SlidersHorizontal className="size-3.5" />}
      count={Number(settings.enabled)}
      align="end"
      width={232}
      {...(inHeader ? ({ variant: 'ghost', buttonClassName: 'size-8' } as const) : { buttonClassName: 'size-6' })}
    >
      <div role="group" aria-label="Rolling average" className="grid gap-2 p-2 text-xs">
        <div className="flex items-center justify-between gap-1 px-0.5 text-2xs text-muted-foreground">
          <span>Rolling average</span>
          <InfoTip label="About the rolling average">
            Each point of the average line is the length-weighted mean grade over the window, centred on that point.
            Over complete ground that is the rise across the window divided by its length. Near the road&apos;s ends the
            window is cut to the road. Unknown ground adds nothing, and where less of the window than the minimum known
            share has a grade, the average is left unknown. The average is for reading the chart only: the grade
            standard, the red stretches and the Review still judge the station grades.
          </InfoTip>
        </div>
        <Button
          size="xs"
          variant={settings.enabled ? 'secondary' : 'ghost'}
          className="w-full justify-start"
          aria-pressed={settings.enabled}
          data-autofocus
          onClick={() => onChange({ enabled: !settings.enabled })}
        >
          Show rolling average
          {settings.enabled && <Check className="ml-auto" aria-hidden />}
        </Button>
        <fieldset disabled={!settings.enabled} className="grid gap-2 disabled:opacity-60">
          <div className="grid gap-1">
            <span className="text-2xs text-muted-foreground">Average of</span>
            <SegmentedControl
              label="Average of"
              size="sm"
              value={designShown ? settings.series : 'ground'}
              onChange={(series) => onChange({ series })}
              options={SERIES_OPTIONS.map((option) => ({
                ...option,
                disabled: !designShown && option.value !== 'ground',
                title: !designShown && option.value !== 'ground' ? 'No designed profile on this road' : undefined,
              }))}
            />
          </div>
          <NumberField
            label="Window (m)"
            value={settings.windowM}
            min={windowM.min}
            max={windowM.max}
            step={5}
            precision={0}
            updateOn="commit"
            onChange={(value) => onChange({ windowM: value })}
          />
          <div role="group" aria-label="Window presets" className="flex gap-1">
            {GRADE_AVERAGE_PRESETS_M.map((preset) => (
              <Button
                key={preset}
                size="xs"
                variant={settings.windowM === preset ? 'secondary' : 'outline'}
                className="flex-1 px-1"
                aria-pressed={settings.windowM === preset}
                onClick={() => onChange({ windowM: preset })}
              >
                {preset} m
              </Button>
            ))}
          </div>
          <NumberField
            label="Minimum known (%)"
            hint="The least share of a window that needs a known grade before its average is drawn."
            value={settings.minCoveragePercent}
            min={minCoveragePercent.min}
            max={minCoveragePercent.max}
            step={5}
            precision={0}
            updateOn="commit"
            onChange={(value) => onChange({ minCoveragePercent: value })}
          />
        </fieldset>
      </div>
    </ToolbarPopover>
  )
}
