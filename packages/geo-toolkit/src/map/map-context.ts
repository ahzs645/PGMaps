'use client'

import type MapLibreGL from 'maplibre-gl'
import { createContext, useContext } from 'react'

import {
  MOBILE_MAP_BLANK_CLICK_EVENT,
  MOBILE_MAP_FEATURE_CLICK_EVENT,
  MOBILE_MAP_INTERACTION_EVENT,
} from '../workspace/workspace-events.js'

type MapContextValue = {
  map: MapLibreGL.Map | null
  isLoaded: boolean
}

const MapContext = createContext<MapContextValue | null>(null)

function useMap() {
  const context = useContext(MapContext)
  if (!context) {
    throw new Error('useMap must be used within a Map component')
  }
  return context
}

// Each MapLibre instance publishes only into its owning workspace.
const mapEventTargets = new WeakMap<MapLibreGL.Map, EventTarget>()

function registerMapInteractions(map: MapLibreGL.Map, target: EventTarget) {
  mapEventTargets.set(map, target)
  return () => {
    mapEventTargets.delete(map)
  }
}

function dispatchMobileMapInteraction(type: 'click' | 'gesture' = 'gesture', map?: MapLibreGL.Map | null) {
  if (map) mapEventTargets.get(map)?.dispatchEvent(new CustomEvent(MOBILE_MAP_INTERACTION_EVENT, { detail: { type } }))
}

function dispatchMobileMapBlankClick(map?: MapLibreGL.Map | null) {
  if (map) mapEventTargets.get(map)?.dispatchEvent(new CustomEvent(MOBILE_MAP_BLANK_CLICK_EVENT))
}

function dispatchMobileMapFeatureClick(map?: MapLibreGL.Map | null) {
  if (map) mapEventTargets.get(map)?.dispatchEvent(new CustomEvent(MOBILE_MAP_FEATURE_CLICK_EVENT))
}

export {
  MapContext,
  registerMapInteractions,
  useMap,
  dispatchMobileMapInteraction,
  dispatchMobileMapBlankClick,
  dispatchMobileMapFeatureClick,
}

export type { MapContextValue }
