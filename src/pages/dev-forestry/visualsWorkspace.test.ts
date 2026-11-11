import { describe, expect, it } from 'vitest'
import { tilePanelsEdited } from '@/components/ui/tiled-workspace'
import { VISUALS_WORKSPACE, visibleVisualsPanes } from './visualsWorkspace'

describe('visual-quality workspace', () => {
  it('withholds the road view until it opens and the summary until a run exists', () => {
    expect(visibleVisualsPanes([], { road: false, summary: false })).toEqual(['road', 'summary'])
    expect(visibleVisualsPanes([], { road: false, summary: true })).toEqual(['road'])
    expect(visibleVisualsPanes([], { road: true, summary: true })).toEqual([])
  })
  it('falls back to the map when a layout leaves nothing to show', () => {
    // "Road view only" before the road view opens.
    expect(visibleVisualsPanes(['map', 'summary'], { road: false, summary: true })).toEqual(['road', 'summary'])
    expect(visibleVisualsPanes(['map', 'summary'], { road: true, summary: true })).toEqual(['map', 'summary'])
  })
  it('notices panels changed in a preset', () => {
    expect(tilePanelsEdited(VISUALS_WORKSPACE, 'map', ['summary', 'road'])).toBe(false)
    expect(tilePanelsEdited(VISUALS_WORKSPACE, 'map-road', [])).toBe(true)
  })
})
