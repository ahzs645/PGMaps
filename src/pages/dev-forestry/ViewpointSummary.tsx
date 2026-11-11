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

const TITLE = 'Viewpoint summary'

/** The two alteration rows open with their range note, which says what scale they are judged on. */
const DEFAULTS: MetricSummaryPreferences = {
  visible: true,
  placement: 'left',
  metrics: { perspective: 'detailed', planimetric: 'detailed' },
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
