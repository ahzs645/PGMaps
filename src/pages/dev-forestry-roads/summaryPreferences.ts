import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { WorkspaceLayout } from '@/components/interfaces/workspaceLayouts'

const level = z.enum(['hidden', 'value', 'detailed'])
export const summaryOptions = z.strictObject({
  visible: z.boolean().optional(),
  placement: z.enum(['left', 'top']).optional(),
  metrics: z.record(z.string(), level).optional(),
})
type Options = z.infer<typeof summaryOptions>
export type SummaryLevel = z.infer<typeof level>
export type SummaryPreferences = Required<Options>

const storageKey = (id: string) => `light-path-summary:${id}`

function read(id: string): Options {
  try {
    return summaryOptions.parse(JSON.parse(localStorage.getItem(storageKey(id)) ?? '{}'))
  } catch {
    return {}
  }
}

export function useSummaryPreferences(layout: WorkspaceLayout) {
  const [entry, setEntry] = useState(() => ({ id: layout.id, options: read(layout.id) }))
  if (entry.id !== layout.id) setEntry({ id: layout.id, options: read(layout.id) })
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (!event.key || event.key === storageKey(layout.id)) setEntry({ id: layout.id, options: read(layout.id) })
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [layout.id])

  const overrides = entry.options
  const preferences: SummaryPreferences = {
    visible: overrides.visible ?? layout.summary?.visible ?? true,
    placement: overrides.placement ?? layout.summary?.placement ?? 'left',
    metrics: { ...layout.summary?.metrics, ...overrides.metrics },
  }
  function change(patch: Options | null) {
    const options = patch ? { ...overrides, ...patch, metrics: { ...overrides.metrics, ...patch.metrics } } : {}
    setEntry({ id: layout.id, options })
    try {
      if (patch) localStorage.setItem(storageKey(layout.id), JSON.stringify(options))
      else localStorage.removeItem(storageKey(layout.id))
    } catch {
      // Keep this session's choices if browser storage is unavailable.
    }
  }
  return { preferences, change }
}
export type SummaryControls = ReturnType<typeof useSummaryPreferences>
