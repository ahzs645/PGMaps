import { useEffect, useState } from 'react'
import { WorkspaceKitProvider } from '@/components/interfaces/workspaceKit'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useOfflineTool } from '@/lib/offline/offlineTools'
import { kit, loadLayouts, preferences, type Layout } from './block-planning/layouts'
import { freshPlan, loadPlan, readPlan, type Plan } from './block-planning/document'
import { installPacks } from './legal-workbench/registry'
import Workspace from './block-planning/Workspace'

export default function BlockPlanningWorkspace() {
  useDocumentTitle('Block planning')
  useOfflineTool('block-planning')
  const [catalog, setCatalog] = useState<{
    layouts: Layout[]
    initial: Layout
    fallback: boolean
    initialPlan: Plan
    warning: string
  }>()
  useEffect(() => {
    const controller = new AbortController()
    async function restore() {
      try {
        const saved = await loadPlan()
        const plan = saved ? await readPlan(saved) : freshPlan()
        if (plan.packs.length) await installPacks(plan.packs)
        return { initialPlan: plan, warning: '' }
      } catch {
        return {
          initialPlan: freshPlan(),
          warning: 'The stored plan could not be opened. Automatic saving is paused. Open an exported plan to resume.',
        }
      }
    }
    void Promise.all([loadLayouts(controller.signal), restore()]).then(([{ layouts, fallback }, restored]) => {
      if (controller.signal.aborted) return
      const id = preferences.initialInterfaceId(layouts, location.search, preferences.readStoredInterface())
      setCatalog({ ...restored, layouts, initial: layouts.find((layout) => layout.id === id) ?? layouts[0], fallback })
    })
    return () => controller.abort()
  }, [])
  return catalog ? (
    <WorkspaceKitProvider kit={kit}>
      <Workspace {...catalog} />
    </WorkspaceKitProvider>
  ) : (
    <p role="status">Opening block planning…</p>
  )
}
