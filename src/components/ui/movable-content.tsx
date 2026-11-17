import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders `children` once, in a host element that moves into `target` while there is one and is detached otherwise.
 * Its state and effects run all the time: use it for a panel whose state outlives the place that shows it (a dialog
 * pane mounted only while open), where rendering it in that place would reset it on every opening. React remounts a
 * portal whose container changes, so the portal's container stays fixed and the DOM node is what moves.
 */
export function MovableContent({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  const [host] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    if (!target) return
    target.appendChild(host)
    return () => host.remove()
  }, [target, host])
  return createPortal(children, host)
}
