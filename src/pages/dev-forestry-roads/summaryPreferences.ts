import { useEffect, useState } from 'react'
import type { WorkspaceLayout } from '@/components/interfaces/workspaceLayouts'
import {
  parseSummaryOptions,
  type SummaryLevel,
  type SummaryOptions,
} from '@/components/interfaces/workspaceLayoutSchema'

export type { SummaryLevel }
export type SummaryPreferences = Required<SummaryOptions>

const storageKey = (id: string) => `pgmaps-road-summary:${id}`

function read(id: string): SummaryOptions {
  try {
    return parseSummaryOptions(JSON.parse(localStorage.getItem(storageKey(id)) ?? '{}'))
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
    curveNote: overrides.curveNote ?? layout.summary?.curveNote ?? 'full',
  }
  function change(patch: SummaryOptions | null) {
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
