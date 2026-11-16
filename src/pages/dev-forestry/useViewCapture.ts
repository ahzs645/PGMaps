/**
 * Captures planned views of interest (`viewsOfInterest.ts`) as saved views, without the reviewer driving the road
 * view: for each place it stands there (the page's stand-at-viewpoint path), waits for the run and the road view to
 * be ready, faces each view's bearing with its lens, and saves the view as *Save viewpoint* does, tagged with
 * `plannedViewId` and `plannedKey`. Afterwards it steps back to where the reviewer was.
 *
 * STUB: the API below is the contract the panel, the export dialog and the summary wire to. The implementation is
 * filled in by the capture work; until then `capture` reports every view as not captured.
 */
import { useCallback, useState } from 'react'

export type ViewCaptureStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export type ViewCaptureState = {
  status: ViewCaptureStatus
  /** The planned view being captured now. */
  currentViewId: string | null
  done: number
  total: number
  /** Views that could not be captured, with the reason in the page's words. */
  failures: Array<{ viewId: string; reason: string }>
  /** One line for a status area: "Capturing 2 of 5: VLI 144, arrow 1…". */
  message: string | null
}

export type ViewCaptureReport = {
  captured: string[]
  failures: Array<{ viewId: string; reason: string }>
  cancelled: boolean
}

export type ViewCaptureApi = {
  state: ViewCaptureState
  /** Captures the given planned views in list order, grouped by place; resolves when all are tried or cancelled. */
  capture: (viewIds: readonly string[]) => Promise<ViewCaptureReport>
  cancel: () => void
  /** Stands at one planned view (run, then the road view facing it), as the finder's *Stand here* does. */
  standAt: (viewId: string) => void
}

export const IDLE_VIEW_CAPTURE: ViewCaptureState = {
  status: 'idle',
  currentViewId: null,
  done: 0,
  total: 0,
  failures: [],
  message: null,
}

export function useViewCapture(): ViewCaptureApi {
  const [state] = useState<ViewCaptureState>(IDLE_VIEW_CAPTURE)
  const capture = useCallback(
    async (viewIds: readonly string[]): Promise<ViewCaptureReport> => ({
      captured: [],
      failures: viewIds.map((viewId) => ({ viewId, reason: 'Capturing planned views is not available yet.' })),
      cancelled: false,
    }),
    [],
  )
  const cancel = useCallback(() => {}, [])
  const standAt = useCallback(() => {}, [])
  return { state, capture, cancel, standAt }
}
