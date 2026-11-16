import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { StyledSelect } from '@/components/ui/form-field'
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

/** The ◀ name ▶ switcher over the planned views of interest (`summaryViewSwitch.ts`). */
export type SummaryViewSwitcher = {
  /** The planned view stood at, else where the reviewer is ("the road", a viewpoint's name). */
  label: string
  /** "2 of 5", or "5 planned" when no planned view is current. */
  position: string
  /** Stands at the previous or next planned view. */
  onStep: (step: 1 | -1) => void
  /** Why stepping is off, when it is (a capture is running). */
  disabledReason?: string | null
}

/** The block the summary reads, when the scene has two or more. The same selection as the sidebar's. */
export type SummaryBlockSwitcher = {
  blocks: ReadonlyArray<{ id: string; name: string }>
  value: string | null
  onChange: (blockId: string) => void
}

function SummarySwitchers({ view, block }: { view?: SummaryViewSwitcher | null; block?: SummaryBlockSwitcher | null }) {
  const blocks = block && block.blocks.length > 1 ? block : null
  if (!view && !blocks) return null
  const disabled = !!view?.disabledReason
  return (
    <>
      {view && (
        <div
          role="group"
          aria-label="Planned view"
          className="flex min-w-0 max-w-full flex-[1_1_12rem] items-center gap-1"
          title={view.disabledReason ?? undefined}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-2xs"
            className="shrink-0 touch:size-9"
            aria-label="Previous planned view"
            disabled={disabled}
            onClick={() => view.onStep(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-center" title={view.label} aria-live="polite">
            {view.label}
            <span className="ml-1 text-3xs text-muted-foreground">{view.position}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-2xs"
            className="shrink-0 touch:size-9"
            aria-label="Next planned view"
            disabled={disabled}
            onClick={() => view.onStep(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {blocks && (
        <StyledSelect
          aria-label="Block the summary reads"
          className="min-w-0 max-w-full flex-[1_1_9rem]"
          value={blocks.value ?? ''}
          onChange={(event) => blocks.onChange(event.target.value)}
        >
          {blocks.blocks.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      )}
    </>
  )
}

/**
 * The visual-quality "Viewpoint summary": the shared `MetricSummary` over `viewpointSummaryMetrics`,
 * with its settings in a dialog. A readout, but for two switchers under its heading: which planned
 * view of interest to stand at (◀ ▶, through the page's `standAt`) and which block the rows read
 * (the sidebar's own selection). Every other control it describes lives in the sidebar.
 * In a tiled pane (`variant="pane"`) the screen preset shows and places it, so its settings offer
 * only the rows.
 */
export function ViewpointSummary({
  metrics,
  controls,
  small = false,
  variant = 'aside',
  empty,
  viewSwitcher,
  blockSwitcher,
}: {
  metrics: MetricSummaryItem[]
  controls: ViewpointSummaryControls
  small?: boolean
  variant?: 'aside' | 'pane'
  empty?: ReactNode
  /** Steps through the planned views of interest; absent while none is planned. */
  viewSwitcher?: SummaryViewSwitcher | null
  /** Picks the block the rows read; shown only with two or more blocks. */
  blockSwitcher?: SummaryBlockSwitcher | null
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
        toolbar={
          viewSwitcher || (blockSwitcher && blockSwitcher.blocks.length > 1) ? (
            <SummarySwitchers view={viewSwitcher} block={blockSwitcher} />
          ) : undefined
        }
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
