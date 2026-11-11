import { ArrowDownRight, PanelRightOpen } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { RibbonTaskPane } from './RibbonTaskPane'
import type { RibbonTool } from './ribbonToolCatalog'
import './ribbonGroupSettings.css'

/** Prefer the editor itself to any adjacent help button when finding a field. */
function ribbonControl(item: HTMLElement | null) {
  return (
    item?.querySelector<HTMLElement>(
      'input:not([type="hidden"], :disabled), [role="combobox"]:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
    ) ??
    item?.querySelector<HTMLElement>('button:not(:disabled)') ??
    item
  )
}

export function focusRibbonItem(item: HTMLElement | null) {
  const control = ribbonControl(item)
  control?.focus({ preventScroll: true })
  control?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

export const settingsTitleFor = (label: string) => (/\bsettings$/i.test(label) ? label : `${label} settings`)

export function RibbonGroupSettings({
  tab,
  label,
  open,
  focusItem,
  standalone,
  onOpenChange,
  children,
}: {
  tab: string
  label: string
  open: boolean
  focusItem?: RibbonTool
  standalone: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const anchor = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const initial = useRef<HTMLElement | null>(null)
  const settingsTitle = settingsTitleFor(label)
  const Icon = standalone ? PanelRightOpen : ArrowDownRight
  useLayoutEffect(() => {
    if (open && focusItem) anchor.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [open, focusItem])
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      list.current = node
      const selector = focusItem ? `[data-ribbon-item="${CSS.escape(focusItem)}"]` : '[data-ribbon-item]:not(:disabled)'
      initial.current = ribbonControl(node?.querySelector<HTMLElement>(selector) ?? null)
    },
    [focusItem],
  )
  function close() {
    // Escape can unmount a numeric draft without moving focus first. Commit through the existing field.
    const active = document.activeElement
    if (active instanceof HTMLInputElement && list.current?.contains(active)) active.blur()
    onOpenChange(false)
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="lp-group-label lp-settings-launcher"
        data-standalone={standalone || undefined}
        aria-label={`Open ${settingsTitle}`}
        aria-expanded={open}
        title={`Open ${settingsTitle}`}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        <span>{label}</span>
        <Icon size={standalone ? 19 : 12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <RibbonTaskPane
          title={settingsTitle}
          context={tab}
          onClose={close}
          initialFocusRef={initial}
          returnFocusRef={anchor}
          focusKey={focusItem}
        >
          <div
            ref={attachList}
            className="lp-group-settings-list"
            onFocusCapture={(event) => {
              if (focusItem && event.target === initial.current)
                event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }}
          >
            {children}
          </div>
        </RibbonTaskPane>
      )}
    </>
  )
}
