import { useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { RoadPaneId } from '@/pages/dev-forestry-roads/RoadPaneLayout'
import type { WorkspaceLayout } from './workspaceLayouts'
import { storeInterface } from './interfacePreference'

const preferenceKey = (id: string) => `pgmaps-road-layout-${id}`

function readPreset(layout: WorkspaceLayout) {
  try {
    const saved = localStorage.getItem(preferenceKey(layout.id))
    // Earlier standalone versions kept workbench presets under the original PGMaps key.
    const legacy = layout.id === 'workbench' && !saved ? localStorage.getItem('pgmaps-road-layout') : null
    return saved ?? legacy ?? layout.preset
  } catch {
    return layout.preset
  }
}

/** Owns view preferences only. Project data and editing operations stay in the mounted road workspace. */
export function useWorkspaceLayout(initial: WorkspaceLayout) {
  const [active, setActive] = useState(initial)
  const [layoutSelection, setSelection] = useState(() => readPreset(initial))
  const [collapsed, setCollapsed] = useState(initial.sidebar === 'collapsed')
  const [controlsOpen, setControlsOpen] = useState(false)
  const [focusPane, setFocusPane] = useState<RoadPaneId>('plan')
  const smallWorkspace = useMediaQuery('(max-width: 1279px), (max-height: 620px)')
  const focusMode = smallWorkspace || active.view === 'focused'

  function selectLayout(next: WorkspaceLayout, showEvidence: boolean) {
    if (active.id === next.id) return
    storeInterface(next.id)
    setActive(next)
    setSelection(readPreset(next))
    setCollapsed(!showEvidence && next.sidebar === 'collapsed')
    setControlsOpen(showEvidence)
    if (next.view === 'focused') setFocusPane('plan')
  }

  function setLayoutSelection(value: string) {
    setSelection(value)
    try {
      localStorage.setItem(preferenceKey(active.id), value)
    } catch {
      /* The selected preset still applies to this session. */
    }
  }

  return {
    active,
    selectLayout,
    layoutSelection,
    setLayoutSelection,
    focusMode,
    collapsed,
    setCollapsed,
    controlsOpen,
    setControlsOpen,
    focusPane,
    setFocusPane,
  }
}
