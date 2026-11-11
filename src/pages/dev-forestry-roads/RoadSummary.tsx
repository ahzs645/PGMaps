import { useRef } from 'react'
import { RibbonTaskPane } from '@/components/interfaces/RibbonTaskPane'
import { MetricSummary, MetricSummaryReset, MetricSummarySettings } from '@/components/ui/metric-summary'
import { RoadSelect, type RoadSelectOption } from './Controls'
import type { RoadSummaryMetric } from './roadSummaryMetrics'
import type { SummaryControls, SummaryPreferences } from './summaryPreferences'

const CURVE_NOTE_OPTIONS: RoadSelectOption[] = [
  { value: 'full', label: 'curve-corrected' },
  { value: 'short', label: 'curve' },
]

/** The shared `MetricSummary` as the road's "Road summary" stack. */
export function RoadSummary({
  metrics,
  preferences,
  small,
  expanded,
  onExpand,
  onSettings,
}: {
  metrics: RoadSummaryMetric[]
  preferences: SummaryPreferences
  small: boolean
  expanded: boolean
  onExpand: () => void
  onSettings: (key?: string) => void
}) {
  return (
    <MetricSummary
      title="Road summary"
      id="road-summary-measurements"
      metrics={metrics}
      preferences={preferences}
      small={small}
      expanded={expanded}
      onExpand={onExpand}
      onSettings={onSettings}
      popoverContainer=".road-workspace"
    />
  )
}

/** The shared summary settings in the ribbon's task pane, plus the road's own curve-note wording. */
export function RoadSummarySettings({
  metrics,
  controls,
  selected,
  onClose,
  onReveal,
}: {
  metrics: RoadSummaryMetric[]
  controls: SummaryControls
  selected?: string
  onClose: () => void
  onReveal: () => void
}) {
  const { preferences, change } = controls
  const initialControl = useRef<HTMLButtonElement>(null)
  return (
    <RibbonTaskPane
      title="Road summary settings"
      context="View"
      onClose={onClose}
      initialFocusRef={selected ? initialControl : undefined}
      focusKey={selected}
      footer={<MetricSummaryReset onReset={() => change(null)} />}
    >
      <MetricSummarySettings
        title="Road summary"
        metrics={metrics}
        controls={controls}
        selected={selected}
        initialControl={initialControl}
        onReveal={onReveal}
      >
        <div className="metric-summary-position">
          <span aria-hidden="true">Curve note</span>
          <RoadSelect
            ariaLabel="Curve-corrected volume note"
            className="w-[56%]"
            value={preferences.curveNote}
            onValueChange={(value) => change({ curveNote: value === 'short' ? 'short' : 'full' })}
            options={CURVE_NOTE_OPTIONS}
          />
        </div>
      </MetricSummarySettings>
    </RibbonTaskPane>
  )
}
