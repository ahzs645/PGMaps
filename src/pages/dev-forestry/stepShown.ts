import { createContext, useContext } from 'react'
import { useProjected } from '@/components/ui/movable-content'

/**
 * Whether the step panel a piece of the sidebar sits in is the one shown. The steps are tabs whose panels stay
 * mounted but `hidden`; a `VirtualResultList` must not render in a hidden panel, where every row measures 0 × 0 and
 * its layout effects set state without end ("Maximum update depth exceeded"). Shown as well while the piece is in
 * Save & export (`useProjected`), wherever its step is.
 */
export const StepShownContext = createContext(true)
export function useStepShown(): boolean {
  const shown = useContext(StepShownContext)
  const projected = useProjected()
  return shown || projected
}
