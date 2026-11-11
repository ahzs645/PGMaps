import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { StatTileBody } from '@/components/ui/stat-group'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { RibbonTaskPane } from '@/components/interfaces/RibbonTaskPane'
import { CheckboxField } from '@/components/ui/form-field'
import { RoadSelect, type RoadSelectOption } from './Controls'
import type { RoadSummaryMetric } from './roadSummaryMetrics'
import type { SummaryControls, SummaryLevel, SummaryPreferences } from './summaryPreferences'
import './roadSummary.css'

const PLACEMENTS: RoadSelectOption[] = [
  { value: 'left', label: 'Left stack' },
  { value: 'top', label: 'Top row' },
]
const CURVE_NOTE_OPTIONS: RoadSelectOption[] = [
  { value: 'full', label: 'curve-corrected' },
  { value: 'short', label: 'curve' },
]
const LEVELS: RoadSelectOption[] = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'value', label: 'Value' },
  { value: 'detailed', label: 'Value and detail' },
]

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
  const [menu, setMenu] = useState<{ metric: RoadSummaryMetric; container: Element | null } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const option = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  useLayoutEffect(() => {
    if (menu) option.current?.focus()
  }, [menu])
  function openMenu(node: HTMLElement, metric: RoadSummaryMetric) {
    anchor.current = node
    node.focus({ preventScroll: true })
    setMenu({ metric, container: node.closest('.road-workspace') })
  }

  const shown = metrics.filter((metric) => preferences.metrics[metric.key] !== 'hidden')
  if (!preferences.visible || !shown.length) return null
  return (
    <aside className="road-summary-panel" aria-label="Road summary">
      <div className="road-summary-heading">
        {small ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="road-summary-measurements"
            aria-label={expanded ? 'Hide road summary' : 'Show road summary'}
            onClick={onExpand}
          >
            <BarChart3 size={15} /> <span className="road-summary-label">Road summary</span>{' '}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <h2>Road summary</h2>
        )}
        <button
          type="button"
          title="Road summary settings"
          aria-label="Configure road summary"
          onClick={() => onSettings()}
        >
          <Settings2 size={15} />
        </button>
      </div>
      <div
        className="road-summary"
        id="road-summary-measurements"
        hidden={small && !expanded}
        onClick={(event) => {
          if (small && expanded && event.target instanceof Element && event.target.closest('button')) onExpand()
        }}
      >
        {shown.map((metric) => (
          <dl
            key={metric.key}
            data-metric={metric.key}
            tabIndex={metric.onToggle ? -1 : 0}
            aria-label={metric.label}
            aria-haspopup="menu"
            onContextMenu={(event) => {
              event.preventDefault()
              openMenu(event.currentTarget, metric)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault()
                openMenu(event.currentTarget, metric)
              }
            }}
          >
            <StatTileBody
              size="sm"
              align="start"
              item={{ ...metric, note: preferences.metrics[metric.key] === 'detailed' ? metric.note : undefined }}
            />
          </dl>
        ))}
      </div>
      <AnchoredPopover
        open={!!menu}
        anchorRef={anchor}
        onClose={closeMenu}
        role="menu"
        ariaLabel={menu ? `Options for ${menu.metric.label}` : undefined}
        width={204}
        container={menu?.container}
        className="p-1"
      >
        <button
          ref={option}
          type="button"
          role="menuitem"
          className="road-summary-menu-action"
          onKeyDown={(event) => {
            if (event.key === 'Tab') closeMenu()
          }}
          onClick={() => {
            const key = menu?.metric.key
            anchor.current?.focus()
            closeMenu()
            onSettings(key)
          }}
        >
          <Settings2 size={15} /> Road summary settings
        </button>
      </AnchoredPopover>
    </aside>
  )
}

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
      footer={
        <button type="button" className="road-summary-reset" onClick={() => change(null)}>
          Restore defaults
        </button>
      }
    >
      <div className="road-summary-form">
        <CheckboxField
          className="road-summary-show"
          label="Show road summary"
          checked={preferences.visible}
          onCheckedChange={(visible) => {
            change({ visible })
            if (visible) onReveal()
          }}
        />
        <div className="road-summary-position">
          <span aria-hidden="true">Position</span>
          <RoadSelect
            ariaLabel="Position"
            className="w-[56%]"
            value={preferences.placement}
            onValueChange={(value) => change({ placement: value === 'left' ? 'left' : 'top' })}
            options={PLACEMENTS}
          />
        </div>
        <div className="road-summary-position">
          <span aria-hidden="true">Curve note</span>
          <RoadSelect
            ariaLabel="Curve-corrected volume note"
            className="w-[56%]"
            value={preferences.curveNote}
            onValueChange={(value) => change({ curveNote: value === 'short' ? 'short' : 'full' })}
            options={CURVE_NOTE_OPTIONS}
          />
        </div>
        <fieldset>
          <legend>Measurements</legend>
          {metrics.map((metric) => (
            <div key={metric.key} className="road-summary-level">
              <span>{metric.label}</span>
              <RoadSelect
                triggerRef={metric.key === selected ? initialControl : undefined}
                ariaLabel={`Display for ${metric.label}`}
                className="w-[56%]"
                value={preferences.metrics[metric.key] ?? 'value'}
                onValueChange={(value) => change({ metrics: { [metric.key]: value as SummaryLevel } })}
                options={LEVELS}
              />
            </div>
          ))}
        </fieldset>
        {preferences.visible && metrics.every((metric) => preferences.metrics[metric.key] === 'hidden') && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            All measurements are hidden. Select a value to show it in the summary.
          </p>
        )}
      </div>
    </RibbonTaskPane>
  )
}
