import { lazy, Suspense, useEffect, useState } from 'react'
import { WorkspaceKitProvider } from '@/components/interfaces/workspaceKit'
import { VISUALS_KIT } from '@/pages/dev-forestry/interface/visualsKit'
import {
  loadVisualsLayouts,
  visualsInterfaces,
  type VisualsInterface,
} from '@/pages/dev-forestry/interface/visualsLayouts'

const VisualQuality = lazy(() => import('./DevForestryVisuals'))

type Catalog = { layouts: VisualsInterface[]; initial: VisualsInterface; fallback: boolean }

/**
 * Opens visual quality straight into the interface the user last chose (or the one a link names),
 * as the road designer does (`ForestryRoadWorkspace.tsx`). Switching interface lives inside the
 * page, so it never gates the tool.
 */
export default function ForestryVisualsWorkspace() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadVisualsLayouts(controller.signal).then(({ layouts, fallback }) => {
      if (controller.signal.aborted) return
      const id = visualsInterfaces.initialInterfaceId(
        layouts,
        window.location.search,
        visualsInterfaces.readStoredInterface(),
      )
      setCatalog({ layouts, initial: layouts.find((layout) => layout.id === id) ?? layouts[0], fallback })
    })
    return () => controller.abort()
  }, [])
  const loading = (
    <p className="p-6" role="status">
      Opening visual quality…
    </p>
  )
  return (
    <div className="h-full">
      {catalog ? (
        <Suspense fallback={loading}>
          <WorkspaceKitProvider kit={VISUALS_KIT}>
            <VisualQuality
              layouts={catalog.layouts}
              initialInterface={catalog.initial}
              layoutsFallback={catalog.fallback}
            />
          </WorkspaceKitProvider>
        </Suspense>
      ) : (
        loading
      )}
    </div>
  )
}
