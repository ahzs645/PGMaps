import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { BarChart3, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { StatTileBody, type StatItem } from '@/components/ui/stat-group'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { CheckboxField } from '@/components/ui/form-field'
import { AppSelect, compactSelectTriggerClass, workspaceSelectContentClass } from '@/components/ui/select'
import './metric-summary.css'

/** How much of a row the summary shows. */
export type MetricLevel = 'hidden' | 'value' | 'detailed'
export type MetricSummaryPlacement = 'left' | 'top'

/** One row. `key` stays stable when its value, warning or wording changes. */
export interface MetricSummaryItem extends StatItem {
  key: string
  label: string
  /**
   * A short line under the label saying what the value is measured on or over, e.g. "perspective
   * scale" or "whole road". It is part of the row's name, so keep the label itself short.
   */
  qualifier?: string
  value: string
  note: string
}

/** A row's full name: its label and qualifier, as the settings, the tooltip and assistive technology read it. */
export function metricName(metric: Pick<MetricSummaryItem, 'label' | 'qualifier'>) {
  return metric.qualifier ? `${metric.label} · ${metric.qualifier}` : metric.label
}

function MetricLabel({ metric }: { metric: MetricSummaryItem }) {
  return (
    <>
      {metric.label}
      {metric.qualifier && <span className="metric-summary-qualifier">{metric.qualifier}</span>}
    </>
  )
}

export interface MetricSummaryOptions {
  visible?: boolean
  placement?: MetricSummaryPlacement
  metrics?: Record<string, MetricLevel>
}
export type MetricSummaryPreferences = Required<MetricSummaryOptions>

const LEVELS = [
  { value: 'hidden', label: 'Hidden' },
  { value: 'value', label: 'Value' },
  { value: 'detailed', label: 'Value and detail' },
]
const PLACEMENTS = [
  { value: 'left', label: 'Left stack' },
  { value: 'top', label: 'Top row' },
]

/** A browser preference read leniently: anything unknown is dropped, never thrown. */
export function parseMetricSummaryOptions(value: unknown): MetricSummaryOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const options: MetricSummaryOptions = {}
  if (typeof source.visible === 'boolean') options.visible = source.visible
  if (source.placement === 'left' || source.placement === 'top') options.placement = source.placement
  if (source.metrics && typeof source.metrics === 'object' && !Array.isArray(source.metrics)) {
    options.metrics = Object.fromEntries(
      Object.entries(source.metrics as Record<string, unknown>).filter(
        (entry): entry is [string, MetricLevel] =>
          entry[1] === 'hidden' || entry[1] === 'value' || entry[1] === 'detailed',
      ),
    )
  }
  return options
}

function readOptions<O>(storageKey: string, parse: (value: unknown) => O): O | Record<string, never> {
  try {
    return parse(JSON.parse(localStorage.getItem(storageKey) ?? '{}'))
  } catch {
    return {}
  }
}

/**
 * The summary's display choices on this device, over `defaults`. `storageKey` names the browser
 * entry, so each tool (and each of its layouts) keeps its own. A tool with extra options (the road's
 * curve note) passes its own type and parser; `change(null)` restores the defaults.
 */
export function useMetricSummaryPreferences<O extends MetricSummaryOptions = MetricSummaryOptions>(
  storageKey: string,
  defaults: Required<O>,
  parse: (value: unknown) => O = parseMetricSummaryOptions as (value: unknown) => O,
) {
  const [entry, setEntry] = useState(() => ({ key: storageKey, options: readOptions(storageKey, parse) as O }))
  if (entry.key !== storageKey) setEntry({ key: storageKey, options: readOptions(storageKey, parse) as O })
  // `parse` is a module-level function, so the listener is added once per key.
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (!event.key || event.key === storageKey)
        setEntry({ key: storageKey, options: readOptions(storageKey, parse) as O })
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [storageKey, parse])

  const overrides = entry.options
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined))
  const preferences = {
    ...defaults,
    ...defined,
    metrics: { ...defaults.metrics, ...overrides.metrics },
  } as Required<O>
  function change(patch: Partial<O> | null) {
    const options = (patch ? { ...overrides, ...patch, metrics: { ...overrides.metrics, ...patch.metrics } } : {}) as O
    setEntry({ key: storageKey, options })
    try {
      if (patch) localStorage.setItem(storageKey, JSON.stringify(options))
      else localStorage.removeItem(storageKey)
    } catch {
      // Keep this session's choices if browser storage is unavailable.
    }
  }
  return { preferences, change }
}
export type MetricSummaryControls<O extends MetricSummaryOptions = MetricSummaryOptions> = {
  preferences: Required<O>
  change: (patch: Partial<O> | null) => void
}

/**
 * Lays the summary beside (`left`) or above (`top`) the views it describes. On a small screen it
 * collapses to its heading, which opens the rows over the views.
 */
export function MetricSummaryLayout({
  placement,
  small,
  className,
  children,
}: {
  placement: MetricSummaryPlacement
  small: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={className ? `metric-summary-layout ${className}` : 'metric-summary-layout'}
      data-placement={placement}
      data-small={small || undefined}
    >
      {children}
    </div>
  )
}

/**
 * A titled stack of headline measurements. Each row is a keyed `StatItem`, shown as hidden, value,
 * or value and detail per the preferences; a right-click (or Shift+F10) on a row offers the settings.
 * A row's tooltip carries its full name and, while only its value shows, its detail.
 * `variant="pane"` fills a tiled pane instead of standing beside the views: the rows flow into as many
 * columns as fit, every card the same height, and the heading has no collapse.
 */
export function MetricSummary({
  title,
  metrics,
  preferences,
  small = false,
  expanded = true,
  onExpand,
  onSettings,
  popoverContainer,
  showHeading = true,
  variant = 'aside',
  empty,
  id = 'metric-summary-measurements',
}: {
  /** "Road summary": names the region, its heading and its buttons. */
  title: string
  metrics: MetricSummaryItem[]
  preferences: Pick<MetricSummaryPreferences, 'visible' | 'metrics'>
  small?: boolean
  expanded?: boolean
  onExpand?: () => void
  onSettings: (key?: string) => void
  /** Selector of the ancestor the row menu renders in, e.g. a full-screen workspace. */
  popoverContainer?: string
  /** Hide the desktop heading and offer settings from the card's context menu. */
  showHeading?: boolean
  variant?: 'aside' | 'pane'
  /** Shown in a pane when there is nothing to summarise yet. */
  empty?: ReactNode
  /** The rows' element id, for the small screen's expand button. */
  id?: string
}) {
  const [menu, setMenu] = useState<{ metric?: MetricSummaryItem; container: Element | null } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const option = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  useLayoutEffect(() => {
    if (menu) option.current?.focus()
  }, [menu])
  function openMenu(node: HTMLElement, metric?: MetricSummaryItem) {
    anchor.current = node
    node.focus({ preventScroll: true })
    setMenu({ metric, container: popoverContainer ? node.closest(popoverContainer) : null })
  }

  const lower = title.toLowerCase()
  const pane = variant === 'pane'
  const collapsible = small && !pane
  const shown = metrics.filter((metric) => preferences.metrics[metric.key] !== 'hidden')
  if (!pane && (!preferences.visible || !shown.length)) return null
  return (
    <aside
      className="metric-summary-panel"
      data-variant={variant}
      data-headingless={!showHeading && !collapsible ? '' : undefined}
      aria-label={title}
      tabIndex={showHeading ? undefined : -1}
      onContextMenu={(event) => {
        if (showHeading || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return
        event.preventDefault()
        openMenu(event.currentTarget)
      }}
    >
      {(showHeading || collapsible) && (
        <div className="metric-summary-heading">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={id}
              aria-label={expanded ? `Hide ${lower}` : `Show ${lower}`}
              onClick={onExpand}
            >
              <BarChart3 size={15} /> <span className="metric-summary-label">{title}</span>{' '}
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          ) : (
            <h2>{title}</h2>
          )}
          <button
            type="button"
            title={`${title} settings`}
            aria-label={`Configure ${lower}`}
            onClick={() => onSettings()}
          >
            <Settings2 size={15} />
          </button>
        </div>
      )}
      {pane && !shown.length ? (
        <div className="metric-summary-empty">
          {metrics.length ? 'All measurements are hidden. Choose which to show in the settings.' : empty}
        </div>
      ) : (
        <div
          className="metric-summary"
          id={id}
          hidden={collapsible && !expanded}
          onClick={(event) => {
            if (collapsible && expanded && event.target instanceof Element && event.target.closest('button'))
              onExpand?.()
          }}
        >
          {shown.map((metric) => {
            const detailed = preferences.metrics[metric.key] === 'detailed'
            const name = metricName(metric)
            return (
              <dl
                key={metric.key}
                data-metric={metric.key}
                tabIndex={metric.onToggle ? -1 : 0}
                title={detailed || !metric.note ? name : `${name}\n${metric.note}`}
                aria-label={name}
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
                  item={{
                    ...metric,
                    label: <MetricLabel metric={metric} />,
                    toggleLabel: metric.toggleLabel ?? name,
                    note: detailed ? metric.note : undefined,
                  }}
                />
              </dl>
            )
          })}
        </div>
      )}
      <AnchoredPopover
        open={!!menu}
        anchorRef={anchor}
        onClose={closeMenu}
        role="menu"
        ariaLabel={`Options for ${menu?.metric ? metricName(menu.metric) : lower}`}
        width={204}
        container={menu?.container}
        className="p-1"
      >
        <button
          ref={option}
          type="button"
          role="menuitem"
          className="metric-summary-menu-action"
          onKeyDown={(event) => {
            if (event.key === 'Tab') closeMenu()
          }}
          onClick={() => {
            const key = menu?.metric?.key
            anchor.current?.focus()
            closeMenu()
            onSettings(key)
          }}
        >
          <Settings2 size={15} /> {title} settings
        </button>
      </AnchoredPopover>
    </aside>
  )
}

/** The summary settings' dropdown: the shared styled select at the workspace's compact size. */
export function MetricSummarySelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  triggerRef,
}: {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
  triggerRef?: RefObject<HTMLButtonElement>
}) {
  return (
    <AppSelect
      className="w-[56%] min-w-0"
      triggerClassName={compactSelectTriggerClass}
      contentClassName={workspaceSelectContentClass}
      triggerAriaLabel={ariaLabel}
      value={value}
      onValueChange={onValueChange}
      options={options}
      searchable={false}
      triggerRef={triggerRef}
    />
  )
}

/**
 * The settings form: show or hide the summary, its position, and each row's level. Put it in the
 * tool's own frame (a ribbon task pane, a dialog) with `MetricSummaryReset` as its footer. `children`
 * adds a tool's own options under the position. Leave out `visibility` or `placement` where the
 * tool decides them elsewhere, e.g. a summary in a tiled pane that a screen preset shows.
 */
export function MetricSummarySettings({
  title,
  metrics,
  controls,
  selected,
  initialControl,
  onReveal,
  visibility = true,
  placement = true,
  children,
}: {
  title: string
  metrics: Pick<MetricSummaryItem, 'key' | 'label' | 'qualifier'>[]
  controls: MetricSummaryControls
  /** The row whose control takes focus first. */
  selected?: string
  initialControl?: RefObject<HTMLButtonElement>
  onReveal?: () => void
  visibility?: boolean
  placement?: boolean
  children?: ReactNode
}) {
  const { preferences, change } = controls
  return (
    <div className="metric-summary-form">
      {visibility && (
        <CheckboxField
          className="metric-summary-show"
          label={`Show ${title.toLowerCase()}`}
          checked={preferences.visible}
          onCheckedChange={(visible) => {
            change({ visible })
            if (visible) onReveal?.()
          }}
        />
      )}
      {placement && (
        <div className="metric-summary-position">
          <span aria-hidden="true">Position</span>
          <MetricSummarySelect
            ariaLabel="Position"
            value={preferences.placement}
            onValueChange={(value) => change({ placement: value === 'left' ? 'left' : 'top' })}
            options={PLACEMENTS}
          />
        </div>
      )}
      {children}
      <fieldset>
        <legend>Measurements</legend>
        {metrics.map((metric) => (
          <div key={metric.key} className="metric-summary-level">
            <span>{metricName(metric)}</span>
            <MetricSummarySelect
              triggerRef={metric.key === selected ? initialControl : undefined}
              ariaLabel={`Display for ${metricName(metric)}`}
              value={preferences.metrics[metric.key] ?? 'value'}
              onValueChange={(value) => change({ metrics: { [metric.key]: value as MetricLevel } })}
              options={LEVELS}
            />
          </div>
        ))}
      </fieldset>
      {(preferences.visible || !visibility) &&
        metrics.every((metric) => preferences.metrics[metric.key] === 'hidden') && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            All measurements are hidden. Select a value to show it in the summary.
          </p>
        )}
    </div>
  )
}

export function MetricSummaryReset({ onReset }: { onReset: () => void }) {
  return (
    <button type="button" className="metric-summary-reset" onClick={onReset}>
      Restore defaults
    </button>
  )
}
