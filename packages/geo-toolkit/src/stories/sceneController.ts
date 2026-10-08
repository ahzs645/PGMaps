import type { ProjectSceneDef } from '../projects/storyTypes.js'

export interface SceneStoryState {
  activeSceneIndex: number
  visibleLayerIds: string[]
  cameraOverride?: ProjectSceneDef['camera']
  mapActionActive: boolean
  readDirection: 1 | -1
}
export type SceneStoryEvent =
  | { type: 'scene'; index: number; force?: boolean }
  | { type: 'visibility'; layerId: string; action: 'show' | 'hide' | 'toggle' }
  | { type: 'layers'; ids: string[] }
  | { type: 'map-action'; action: NonNullable<ProjectSceneDef['mapActions']>[number]; knownLayerIds: string[] }
export function createSceneStoryState(
  scenes: readonly ProjectSceneDef[],
  defaultLayerIds: readonly string[] = [],
): SceneStoryState {
  return {
    activeSceneIndex: 0,
    visibleLayerIds: [...(scenes[0]?.visibleLayerIds ?? defaultLayerIds)],
    mapActionActive: false,
    readDirection: 1,
  }
}
/** Same-scene scroll updates preserve manual toggles; an explicit reset restores author intent. */
export function reduceSceneStory(
  state: SceneStoryState,
  event: SceneStoryEvent,
  scenes: readonly ProjectSceneDef[],
): SceneStoryState {
  if (event.type === 'scene') {
    const scene = scenes[event.index]
    if (!Number.isInteger(event.index) || !scene || (!event.force && event.index === state.activeSceneIndex))
      return state
    return {
      activeSceneIndex: event.index,
      visibleLayerIds: [...scene.visibleLayerIds],
      mapActionActive: false,
      readDirection:
        event.index === state.activeSceneIndex ? state.readDirection : event.index > state.activeSceneIndex ? 1 : -1,
    }
  }
  if (event.type === 'layers') return { ...state, visibleLayerIds: [...new Set(event.ids)] }
  if (event.type === 'map-action')
    return {
      ...state,
      mapActionActive: true,
      visibleLayerIds: event.action.visibleLayerIds.filter((id) => event.knownLayerIds.includes(id)),
      cameraOverride: event.action.camera ?? state.cameraOverride,
    }
  const ids = new Set(state.visibleLayerIds)
  if (event.action === 'show') ids.add(event.layerId)
  else if (event.action === 'hide') ids.delete(event.layerId)
  else if (ids.has(event.layerId)) ids.delete(event.layerId)
  else ids.add(event.layerId)
  return { ...state, visibleLayerIds: [...ids] }
}
