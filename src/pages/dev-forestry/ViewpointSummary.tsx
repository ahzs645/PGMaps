import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelDialog } from '@/components/ui/dialog-shell'
import {
  MetricSummary,
  MetricSummaryReset,
  MetricSummarySettings,
  useMetricSummaryPreferences,
  type MetricSummaryItem,
  type MetricSummaryPreferences,
} from '@/components/ui/metric-summary'

import { LAND_CHECKS } from './landStatusChecks'

const TITLE = 'Viewpoint summary'

/**
 * Every row opens as its value: each card names its scale under its label, and its note (the range
 * it is judged against, or why it is withheld) is on its tooltip until a row is set to show detail.
 */
const DEFAULTS: MetricSummaryPreferences = {
  visible: true,
  placement: 'left',
  // The run's headline result and the land checks' sum show; the rest of the results and each check's
  // own card wait in the settings, so the stack stays short until the reviewer asks for more.
  metrics: Object.fromEntries(
    [
      'result-split',
      'result-block-seen',
      'result-apparent',
      'result-landform-seen',
      'result-forested',
      'result-screening',
      'result-stations',
      ...LAND_CHECKS.map((check) => `check-${check.id}`),
    ].map((key) => [key, 'hidden' as const]),
  ),
}

export function useViewpointSummaryPreferences() {
  return useMetricSummaryPreferences('pgmaps-visuals-summary', DEFAULTS)
}
export type ViewpointSummaryControls = ReturnType<typeof useViewpointSummaryPreferences>

/**
 * The visual-quality "Viewpoint summary": the shared `MetricSummary` over `viewpointSummaryMetrics`,
 * with its settings in a dialog. A readout only; every control it describes lives in the sidebar.
 * In a tiled pane (`variant="pane"`) the screen preset shows and places it, so its settings offer
 * only the rows.
 */
export function ViewpointSummary({
  metrics,
  controls,
  small = false,
  variant = 'aside',
  empty,
}: {
  metrics: MetricSummaryItem[]
  controls: ViewpointSummaryControls
  small?: boolean
  variant?: 'aside' | 'pane'
  empty?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const initialControl = useRef<HTMLButtonElement>(null)
  // Opened from a row: its control takes focus once the dialog has placed its own.
  useEffect(() => {
    if (!selected) return
    const frame = requestAnimationFrame(() => initialControl.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [selected])
  return (
    <>
      <MetricSummary
        title={TITLE}
        id="viewpoint-summary-measurements"
        metrics={metrics}
        preferences={controls.preferences}
        small={small}
        expanded={expanded}
        onExpand={() => setExpanded((open) => !open)}
        onSettings={(key) => setSelected(key ?? '')}
        variant={variant}
        empty={empty}
      />
      <PanelDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        size="md"
        title={`${TITLE} settings`}
        footer={<MetricSummaryReset onReset={() => controls.change(null)} />}
      >
        <MetricSummarySettings
          title={TITLE}
          metrics={metrics}
          controls={controls}
          selected={selected || undefined}
          initialControl={initialControl}
          onReveal={() => setExpanded(true)}
          visibility={variant !== 'pane'}
          placement={variant !== 'pane'}
        />
      </PanelDialog>
    </>
  )
}
