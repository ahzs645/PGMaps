import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * The slot at the end of the road data schedule's tab row. A schedule view portals its toolbar
 * there, so the tabs and the view's buttons share one line instead of stacking two rows.
 */
export const ScheduleToolbarContext = createContext<HTMLElement | null>(null)

/** The schedule tab row's toolbar slot, or null outside `DesignSchedules`. */
export function useScheduleToolbar() {
  return useContext(ScheduleToolbarContext)
}

/**
 * A schedule view's toolbar: in the tab row inside `DesignSchedules`, else a row of its own above
 * the view.
 */
export function ScheduleToolbar({ children }: { children: ReactNode }) {
  const slot = useScheduleToolbar()
  if (slot) return createPortal(children, slot)
  return <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>
}
