import { lazy, Suspense, useEffect, useState } from 'react'
import { loadWorkspaceLayouts, type WorkspaceLayout } from '../components/interfaces/workspaceLayouts'
import { initialInterfaceId, readStoredInterface } from '../components/interfaces/interfacePreference'

const RoadDesign = lazy(() => import('./DevForestryRoads'))

export default function ForestryRoadWorkspace() {
  return (
    <div className="h-full pt-[calc(env(safe-area-inset-top)+4rem)] md:pt-0">
      <RoadWorkspaceLoader />
    </div>
  )
}

type Catalog = { layouts: WorkspaceLayout[]; initial: WorkspaceLayout; fallback: boolean }

/**
 * Opens straight into the interface the user last chose (or the one a link names). Switching
 * interface lives inside the workspace, under View, so it never gates the designer.
 */
function RoadWorkspaceLoader() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadWorkspaceLayouts(controller.signal).then(({ layouts, fallback }) => {
      if (controller.signal.aborted) return
      const id = initialInterfaceId(layouts, window.location.search, readStoredInterface())
      setCatalog({ layouts, initial: layouts.find((layout) => layout.id === id) ?? layouts[0], fallback })
    })
    return () => controller.abort()
  }, [])
  const loading = (
    <p className="p-6" role="status">
      Opening the road workspace…
    </p>
  )
  if (!catalog) return loading
  return (
    <Suspense fallback={loading}>
      <RoadDesign layouts={catalog.layouts} initialInterface={catalog.initial} layoutsFallback={catalog.fallback} />
    </Suspense>
  )
}
