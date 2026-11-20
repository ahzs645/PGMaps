import { lazy, Suspense, useEffect, useState } from 'react'
import { loadWorkspaceLayouts, type WorkspaceLayout } from '@/pages/dev-forestry-roads/interface/workspaceLayouts'
import { initialInterfaceId, readStoredInterface } from '@/pages/dev-forestry-roads/interface/interfacePreference'
import { BrandScope } from '../branding/BrandScope'
import { WorkspaceKitProvider } from '@/components/interfaces/workspaceKit'
import { ROAD_KIT } from '@/pages/dev-forestry-roads/interface/roadKit'
import { useOfflineTool } from '../lib/offline/offlineTools'

const RoadDesign = lazy(() => import('./DevForestryRoads'))

export default function ForestryRoadWorkspace() {
  // Opened once online, the designer and everything it loads later stays available with no network.
  useOfflineTool('road-design')
  return (
    <BrandScope>
      <div className="h-full pt-[calc(env(safe-area-inset-top)+var(--app-navbar-offset,4rem))] md:pt-0">
        <link rel="stylesheet" href={`${import.meta.env.BASE_URL}brand/access.css`} />
        <RoadWorkspaceLoader />
      </div>
    </BrandScope>
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
      <WorkspaceKitProvider kit={ROAD_KIT}>
        <RoadDesign layouts={catalog.layouts} initialInterface={catalog.initial} layoutsFallback={catalog.fallback} />
      </WorkspaceKitProvider>
    </Suspense>
  )
}
