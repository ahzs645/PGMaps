import { useCallback, useState } from 'react'
import type { MapRef } from '@/components/ui/map'
import type { TerrainLayer } from './TerrainLayerSelect'

export type FitRequest = { revision: number; target: 'roads' | 'active' | 'terrain' }

/** Where the plan's legend sits: folded over the map's corner, or in a strip of its own under it. */
export type PlanLegendPlacement = 'map' | 'below'
/** How the plan's toolbar lays out: wrapped to the map's width, one row along the top, or one column down the side. */
export type PlanToolbarLayout = 'wrap' | 'top' | 'side'

const LEGEND_PLACEMENT_KEY = 'pgmaps-road-legend-placement'
const TOOLBAR_LAYOUT_KEY = 'pgmaps-road-plan-toolbar'

function readStored<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return values.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

/** A layout choice is this browser's, like the symbol style; it still holds for the session without storage. */
function useStoredChoice<T extends string>(key: string, values: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, values, fallback))
  const choose = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* The choice stays for this session when browser storage is unavailable. */
      }
    },
    [key],
  )
  return [value, choose] as const
}

const LEGEND_PLACEMENTS = ['map', 'below'] as const
const TOOLBAR_LAYOUTS = ['wrap', 'top', 'side'] as const

/** The map controls and any configured ribbon commands edit the same display state. */
export function usePlanDisplay() {
  const [navigationMap, setNavigationMap] = useState<MapRef | null>(null)
  const zoom = navigationMap
    ? (step: number) => navigationMap.zoomTo(navigationMap.getZoom() + step, { duration: 300 })
    : undefined
  const [terrainLayer, setTerrainLayer] = useState<TerrainLayer>('hillshade')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [legendPlacement, setLegendPlacement] = useStoredChoice<PlanLegendPlacement>(
    LEGEND_PLACEMENT_KEY,
    LEGEND_PLACEMENTS,
    'map',
  )
  const [toolbarLayout, setToolbarLayout] = useStoredChoice<PlanToolbarLayout>(
    TOOLBAR_LAYOUT_KEY,
    TOOLBAR_LAYOUTS,
    'wrap',
  )
  const [showContours, setShowContours] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showEarthwork, setShowEarthwork] = useState(true)
  const [notesOpen, setNotesOpen] = useState(false)
  // Sentinel-2 imagery reads from the network, so it starts off.
  const [showSentinel, setShowSentinel] = useState(false)
  const [showHrdem, setShowHrdem] = useState(true)
  const [fitRequest, setFitRequest] = useState<FitRequest>({ revision: 0, target: 'roads' })
  const fit = (target: FitRequest['target']) =>
    setFitRequest((previous) => ({ revision: previous.revision + 1, target }))
  return {
    navigationMap,
    setNavigationMap,
    zoom,
    terrainLayer,
    setTerrainLayer,
    settingsOpen,
    setSettingsOpen,
    legendOpen,
    setLegendOpen,
    legendPlacement,
    setLegendPlacement,
    toolbarLayout,
    setToolbarLayout,
    showContours,
    setShowContours,
    showLabels,
    setShowLabels,
    showEarthwork,
    setShowEarthwork,
    notesOpen,
    setNotesOpen,
    showSentinel,
    setShowSentinel,
    showHrdem,
    setShowHrdem,
    fitRequest,
    fit,
  }
}
