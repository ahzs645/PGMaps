/**
 * The VIA report's engine in the browser: document-kit's recipe renderer and the compiled JSON parts
 * (`viaReport/reportEngine.ts`), loaded once a session by dynamic import when Save & export opens, never with the page.
 * Until it has loaded nothing assembles a report: the dialog waits for it (`useReportEngine`), and an output's build
 * awaits `loadReportEngine` first.
 */
import { useEffect, useState } from 'react'

import { reportEngineLoaded, setReportEngine } from './viaReport/reportEngine'

let loading: Promise<void> | null = null

/** Loads the engine (once; a failed load is tried again next time). */
export function loadReportEngine(): Promise<void> {
  if (reportEngineLoaded()) return Promise.resolve()
  loading ??= Promise.all([
    import('document-kit/recipe'),
    import('./viaReport/engineParts'),
    import('./viaReport/recipeJson/parts.compiled.json'),
  ])
    .then(([kit, { makeReportEngine }, compiled]) =>
      setReportEngine(
        makeReportEngine(kit.renderRecipe, compiled.default.parts as unknown as Parameters<typeof makeReportEngine>[1]),
      ),
    )
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

/** Whether the engine is ready; starts loading it while `active` (the dialog is open). A failed load is the error. */
export function useReportEngine(active: boolean): { ready: boolean; error: string | null } {
  const [state, setState] = useState(() => ({ ready: reportEngineLoaded(), error: null as string | null }))
  useEffect(() => {
    if (!active || state.ready) return
    let live = true
    loadReportEngine().then(
      () => live && setState({ ready: true, error: null }),
      (error: unknown) =>
        live &&
        setState({
          ready: false,
          error: `The report's parts did not load: ${error instanceof Error ? error.message : String(error)}`,
        }),
    )
    return () => {
      live = false
    }
  }, [active, state.ready])
  return state
}
