import { lazy, Suspense, useEffect, useState } from 'react'
import { loadWorkspaceLayouts, type WorkspaceLayout } from '../components/interfaces/workspaceLayouts'
import { InterfaceChooser } from '../components/interfaces/InterfaceChooser'

const RoadDesign = lazy(() => import('./DevForestryRoads'))

export default function ForestryRoadWorkspace() {
  return (
    <div className="h-full pt-[calc(env(safe-area-inset-top)+4rem)] md:pt-0">
      <RoadWorkspaceChooser />
    </div>
  )
}

function RoadWorkspaceChooser() {
  const [initialInterface, choose] = useState<WorkspaceLayout | null>(null)
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadWorkspaceLayouts>> | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadWorkspaceLayouts(controller.signal).then((value) => {
      if (!controller.signal.aborted) setCatalog(value)
    })
    return () => controller.abort()
  }, [])
  if (!catalog)
    return (
      <p className="p-6" role="status">
        Loading workspaces…
      </p>
    )
  if (!initialInterface) return <InterfaceChooser {...catalog} onChoose={choose} />
  return (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Opening the road workspace…
        </p>
      }
    >
      <RoadDesign layouts={catalog.layouts} initialInterface={initialInterface} />
    </Suspense>
  )
}
