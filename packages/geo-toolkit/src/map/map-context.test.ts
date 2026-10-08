import { describe, expect, it, vi } from 'vitest'
import type MapLibreGL from 'maplibre-gl'
import {
  dispatchMobileMapBlankClick,
  dispatchMobileMapFeatureClick,
  dispatchMobileMapInteraction,
  registerMapInteractions,
} from './map-context.js'
import {
  MOBILE_MAP_BLANK_CLICK_EVENT,
  MOBILE_MAP_FEATURE_CLICK_EVENT,
  MOBILE_MAP_INTERACTION_EVENT,
} from '../workspace/workspace-events.js'

describe('map interaction scopes', () => {
  it('publishes features, blank clicks and gestures only to the owning workspace', () => {
    const firstMap = {} as MapLibreGL.Map
    const secondMap = {} as MapLibreGL.Map
    const first = new EventTarget()
    const second = new EventTarget()
    const onFirst = vi.fn()
    const onSecond = vi.fn()
    for (const event of [MOBILE_MAP_FEATURE_CLICK_EVENT, MOBILE_MAP_BLANK_CLICK_EVENT, MOBILE_MAP_INTERACTION_EVENT]) {
      first.addEventListener(event, onFirst)
      second.addEventListener(event, onSecond)
    }
    const releaseFirst = registerMapInteractions(firstMap, first)
    const releaseSecond = registerMapInteractions(secondMap, second)
    dispatchMobileMapFeatureClick(firstMap)
    dispatchMobileMapBlankClick(firstMap)
    dispatchMobileMapInteraction('gesture', firstMap)
    expect(onFirst).toHaveBeenCalledTimes(3)
    expect(onSecond).not.toHaveBeenCalled()
    dispatchMobileMapFeatureClick(secondMap)
    expect(onFirst).toHaveBeenCalledTimes(3)
    expect(onSecond).toHaveBeenCalledTimes(1)
    releaseFirst()
    dispatchMobileMapFeatureClick(firstMap)
    expect(onFirst).toHaveBeenCalledTimes(3)
    releaseSecond()
  })
})
