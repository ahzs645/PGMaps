import { lazy, Suspense, useEffect, useState } from 'react'
import { WorkspaceKitProvider } from '@/components/interfaces/workspaceKit'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useOfflineTool } from '@/lib/offline/offlineTools'
import {
  loadPlanningLayouts,
  PLANNING_KIT,
  planningInterfaces,
  type PlanningInterface,
} from './block-planning/interface/layouts'
import { emptyPlan, type Plan } from './block-planning/plan'
import { loadStoredPlan } from './block-planning/store'
import { installPacks } from './legal-workbench/registry'

const BlockPlanner = lazy(() => import('./block-planning/BlockPlanner'))

type Opening = {
  layouts: PlanningInterface[]
  initial: PlanningInterface
  fallback: boolean
  plan: Plan
  notes: string[]
  storageBroken: boolean
}

/**
 * Opens the block planner straight into the interface last chosen (or the one a link names) with
 * the plan kept in this browser, as road design and visual quality open theirs.
 */
export default function BlockPlanningWorkspace() {
  useDocumentTitle('Block planning · PGMaps')
  useOfflineTool('block-planning')
  const [opening, setOpening] = useState<Opening | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    async function restore() {
      try {
        const stored = await loadStoredPlan()
        if (stored?.plan.packs.length) await installPacks(stored.plan.packs)
        return { plan: stored?.plan ?? emptyPlan(), notes: stored?.notes ?? [], storageBroken: false }
      } catch (e) {
        return {
          plan: emptyPlan(),
          notes: [
            `The plan kept in this browser could not be opened: ${e instanceof Error ? e.message : 'unreadable'}.`,
          ],
          storageBroken: true,
        }
      }
    }
    void Promise.all([loadPlanningLayouts(controller.signal), restore()]).then(([{ layouts, fallback }, restored]) => {
      if (controller.signal.aborted) return
      const id = planningInterfaces.initialInterfaceId(
        layouts,
        window.location.search,
        planningInterfaces.readStoredInterface(),
      )
      setOpening({ ...restored, layouts, initial: layouts.find((l) => l.id === id) ?? layouts[0], fallback })
    })
    return () => controller.abort()
  }, [])
  const loading = (
    <p className="p-6" role="status">
      Opening block planning…
    </p>
  )
  return (
    <div className="h-full">
      {opening ? (
        <Suspense fallback={loading}>
          <WorkspaceKitProvider kit={PLANNING_KIT}>
            <BlockPlanner
              layouts={opening.layouts}
              initialInterface={opening.initial}
              layoutsFallback={opening.fallback}
              initialPlan={opening.plan}
              initialNotes={opening.notes}
              storageBroken={opening.storageBroken}
            />
          </WorkspaceKitProvider>
        </Suspense>
      ) : (
        loading
      )}
    </div>
  )
}
