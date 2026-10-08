import { describe, expect, it } from 'vitest'
import type { ProjectSceneDef } from '../projects/storyTypes.js'
import { createSceneStoryState, reduceSceneStory } from './sceneController.js'
const scenes: ProjectSceneDef[] = [
  {
    label: 'Open',
    title: 'Opening',
    text: 'Context',
    focus: 'Area',
    visibleLayerIds: ['areas'],
    camera: { center: [10, 40], zoom: 5 },
  },
  { label: 'Detail', title: 'Detail', text: 'Evidence', focus: 'Points', visibleLayerIds: ['points'] },
]
describe('scene lifecycle shared with PGMaps', () => {
  it('preserves manual visibility through repeated scroll observations, resets on explicit reset', () => {
    const initial = createSceneStoryState(scenes)
    const toggled = reduceSceneStory(initial, { type: 'visibility', layerId: 'areas', action: 'hide' }, scenes)
    expect(reduceSceneStory(toggled, { type: 'scene', index: 0 }, scenes)).toBe(toggled)
    expect(reduceSceneStory(toggled, { type: 'scene', index: 0, force: true }, scenes)).toEqual(initial)
  })
  it('filters map actions through host layer contracts, preserves an action camera until changing scenes', () => {
    const initial = createSceneStoryState(scenes)
    const camera = { center: [11, 41] as [number, number], zoom: 8 }
    const action = reduceSceneStory(
      initial,
      {
        type: 'map-action',
        action: { label: 'Zoom', visibleLayerIds: ['points', 'invented'], camera },
        knownLayerIds: ['areas', 'points'],
      },
      scenes,
    )
    expect(action).toMatchObject({ visibleLayerIds: ['points'], mapActionActive: true, cameraOverride: camera })
    const recolored = reduceSceneStory(
      action,
      { type: 'map-action', action: { label: 'Context', visibleLayerIds: ['areas'] }, knownLayerIds: ['areas'] },
      scenes,
    )
    expect(recolored.cameraOverride).toEqual(camera)
    expect(reduceSceneStory(action, { type: 'scene', index: 1 }, scenes)).toEqual({
      activeSceneIndex: 1,
      visibleLayerIds: ['points'],
      mapActionActive: false,
      readDirection: 1,
    })
  })
  it('ignores invalid navigation and tracks forward/backward reading direction', () => {
    const initial = createSceneStoryState(scenes)
    expect(reduceSceneStory(initial, { type: 'scene', index: -1 }, scenes)).toBe(initial)
    expect(reduceSceneStory(initial, { type: 'scene', index: 0.5 }, scenes)).toBe(initial)
    const next = reduceSceneStory(initial, { type: 'scene', index: 1 }, scenes)
    expect(reduceSceneStory(next, { type: 'scene', index: 0 }, scenes).readDirection).toBe(-1)
  })
})
