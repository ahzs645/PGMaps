import { useEffect, useRef, useState, type ReactNode } from 'react'

export function ExpandableMedia({ children, label = 'Expand media' }: { children: ReactNode; label?: string }) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expanded) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
        toggle.current?.focus()
      }
      if (event.key === 'Tab') {
        const focusable = panel.current?.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')
        if (!focusable?.length) return
        const first = focusable[0],
          last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', keydown)
    toggle.current?.focus()
    window.dispatchEvent(new Event('resize'))
    return () => {
      window.removeEventListener('keydown', keydown)
      window.dispatchEvent(new Event('resize'))
    }
  }, [expanded])
  return (
    <div
      ref={panel}
      className={`editorial-expandable${expanded ? ' is-expanded' : ''}`}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? 'Expanded story media' : undefined}
    >
      {children}
      <button
        ref={toggle}
        type="button"
        className="editorial-expand"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Close media ×' : `${label} ↗`}
      </button>
    </div>
  )
}
