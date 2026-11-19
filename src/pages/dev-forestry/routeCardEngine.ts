/**
 * document-kit's recipe engine for the route card report (`src/lib/forestry/routeCard/report.ts`), loaded on demand
 * when the route card section is open or Save & export builds its file, never with the page. The section, the
 * workbook and the Word file all render through it, so they say the same thing.
 */
import { useEffect, useState } from 'react'

import type { RouteCardKit } from '@/lib/forestry/routeCard/report'

let loaded: RouteCardKit | null = null
let loading: Promise<RouteCardKit> | null = null

/** Loads the kit once; a failed load is tried again next time. */
export function loadRouteCardKit(): Promise<RouteCardKit> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= Promise.all([import('document-kit'), import('document-kit/recipe')])
    .then(([kit, recipe]) => {
      loaded = {
        compileRecipe: recipe.compileRecipe,
        renderRecipe: recipe.renderRecipe,
        sharedLibrary: recipe.sharedLibrary,
        plainText: kit.plainText,
      }
      return loaded
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

/** The kit while `active`, loading it the first time; null until it has loaded. */
export function useRouteCardKit(active: boolean): { kit: RouteCardKit | null; error: string | null } {
  const [state, setState] = useState<{ kit: RouteCardKit | null; error: string | null }>(() => ({
    kit: loaded,
    error: null,
  }))
  useEffect(() => {
    if (!active || state.kit) return
    let live = true
    loadRouteCardKit().then(
      (kit) => live && setState({ kit, error: null }),
      (error: unknown) =>
        live &&
        setState({
          kit: null,
          error: `The report engine did not load: ${error instanceof Error ? error.message : String(error)}`,
        }),
    )
    return () => {
      live = false
    }
  }, [active, state.kit])
  return state
}

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
