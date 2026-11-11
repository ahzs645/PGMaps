import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { PanelCorner } from '@/components/ui/panel-corner'
import './ribbonTaskPane.css'

export const RibbonPaneHost = createContext<{ slot: HTMLDivElement | null; resizeKey?: string } | null>(null)
const owners = new WeakMap<HTMLElement, () => void>()

export function restorePaneFocus(target: HTMLElement | null) {
  requestAnimationFrame(() => {
    const active = document.activeElement
    const canRestore = !active || active === document.body || active.hasAttribute('data-radix-focus-guard')
    if (canRestore && target?.isConnected) target.focus({ preventScroll: true })
  })
}

/** A single workspace slot keeps desktop panels alongside the map. Phones use the same content in a side sheet. */
export function RibbonTaskPane({
  title,
  context,
  subtitle,
  footer,
  onClose,
  initialFocusRef,
  returnFocusRef,
  focusKey,
  children,
}: {
  title: string
  context?: string
  subtitle?: string
  footer?: ReactNode
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement>
  returnFocusRef?: RefObject<HTMLElement>
  focusKey?: string
  children: ReactNode
}) {
  const placement = useContext(RibbonPaneHost)
  const host = placement?.slot
  const wide = useMediaQuery('(min-width: 900px)')
  const heading = useId()
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const currentClose = useRef(onClose)
  useLayoutEffect(() => {
    currentClose.current = onClose
  }, [onClose])
  useLayoutEffect(() => {
    if (!host) return
    const close = () => currentClose.current()
    owners.get(host)?.()
    owners.set(host, close)
    return () => {
      if (owners.get(host) === close) owners.delete(host)
    }
  }, [host])

  const focusPane = useCallback(() => {
    ;(initialFocusRef?.current ?? closeButton.current)?.focus({ preventScroll: true })
  }, [initialFocusRef])
  useLayoutEffect(() => {
    if (host && wide) focusPane()
  }, [host, wide, focusKey, focusPane])
  function dismiss() {
    // Commit an in-progress field before its editor unmounts.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    const previous = returnFocusRef?.current ?? opener.current
    onClose()
    restorePaneFocus(previous)
  }
  if (!host) return null
  const header = (
    <header className="lp-task-heading">
      <div>
        {context && <span>{context}</span>}
        {wide ? <h2 id={heading}>{title}</h2> : <DialogTitle>{title}</DialogTitle>}
      </div>
      <button ref={closeButton} type="button" aria-label={`Close ${title}`} title="Close task pane" onClick={dismiss}>
        <X size={17} aria-hidden="true" />
      </button>
    </header>
  )
  const content = (
    <>
      {header}
      <div className="lp-task-content">
        {subtitle && <p className="lp-task-description">{subtitle}</p>}
        {children}
      </div>
      {footer && <footer className="lp-task-footer">{footer}</footer>}
      {placement?.resizeKey && <PanelCorner label="settings panel" storageKey={placement.resizeKey} viewport={!wide} />}
    </>
  )
  if (wide)
    return createPortal(
      <aside
        className="lp-task-pane"
        aria-labelledby={heading}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) {
            event.stopPropagation()
            dismiss()
          }
        }}
      >
        {content}
      </aside>,
      host,
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent
        elevated
        showClose={false}
        aria-modal="true"
        aria-describedby={undefined}
        portalContainer={host.closest<HTMLElement>('.road-workspace')}
        className="lp-task-sheet"
        overlayClassName="lp-task-backdrop"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusPane()
        }}
      >
        {content}
      </DialogContent>
    </Dialog>
  )
}
