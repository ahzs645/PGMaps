import { useState } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useWorkspaceKit } from './workspaceKit'
import type { AnyLayout } from './workspaceLayoutSchema'

/** Each interface keeps its own screen preset: `pgmaps-<storage>-layout-<interface>`. */
const preferenceKey = (storage: string, id: string) => `pgmaps-${storage}-layout-${id}`

function readPreset(storage: string, layout: AnyLayout, legacyKey?: (id: string) => string | undefined) {
  try {
    const saved = localStorage.getItem(preferenceKey(storage, layout.id))
    // A preset kept under an earlier key (the road's first workbench, visual quality's single layout).
    const legacyName = !saved ? legacyKey?.(layout.id) : undefined
    const legacy = legacyName ? localStorage.getItem(legacyName) : null
    return saved ?? legacy ?? layout.preset
  } catch {
    return layout.preset
  }
}

/**
 * Owns view preferences only: the interface in use, its screen preset, whether the controls show
 * and which pane a small screen focuses. Project data and editing operations stay in the tool.
 */
export function useWorkspaceLayout<L extends AnyLayout, P extends string>(
  initial: L,
  {
    defaultPane,
    storeInterface,
    legacyPresetKey,
  }: {
    /** The pane a small screen shows first. */
    defaultPane: P
    /** Remember a chosen interface (`interfacePreferences(...).storeInterface`). */
    storeInterface: (id: string) => void
    /** An earlier key a preset may still be stored under, read when this interface has none. */
    legacyPresetKey?: (layoutId: string) => string | undefined
  },
) {
  const { storage } = useWorkspaceKit()
  const [active, setActive] = useState(initial)
  const [layoutSelection, setSelection] = useState(() => readPreset(storage, initial, legacyPresetKey))
  const [collapsed, setCollapsed] = useState(initial.sidebar === 'collapsed')
  const [controlsOpen, setControlsOpen] = useState(false)
  const [focusPane, setFocusPane] = useState<P>(defaultPane)
  const smallWorkspace = useMediaQuery('(max-width: 1279px), (max-height: 620px)')
  const focusMode = smallWorkspace || active.view === 'focused'

  function selectLayout(next: L, showEvidence = false) {
    if (active.id === next.id) return
    storeInterface(next.id)
    setActive(next)
    setSelection(readPreset(storage, next, legacyPresetKey))
    setCollapsed(!showEvidence && next.sidebar === 'collapsed')
    setControlsOpen(showEvidence)
    if (next.view === 'focused') setFocusPane(defaultPane)
  }

  function setLayoutSelection(value: string) {
    setSelection(value)
    try {
      localStorage.setItem(preferenceKey(storage, active.id), value)
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
