import { useCallback, useMemo, useReducer } from 'react'
import type { ProjectSceneDef, ProjectStoryLayerDef, ProjectStoryPlaceDef } from '../projects/storyTypes.js'
import { createSceneStoryState, reduceSceneStory } from './sceneController.js'
import { buildLegend, resolveLayer, sameLayerSet } from './storyScene.js'

export function useSceneStoryController(
  scenes: readonly ProjectSceneDef[],
  layers: readonly ProjectStoryLayerDef[],
  options: {
    accent?: string
    places?: readonly ProjectStoryPlaceDef[]
    labels?: Record<string, string>
    initialLayerIds?: readonly string[]
    layerLegend?: Parameters<typeof buildLegend>[4]
  } = {},
) {
  const [state, dispatch] = useReducer(
    (current: ReturnType<typeof createSceneStoryState>, event: Parameters<typeof reduceSceneStory>[1]) =>
      reduceSceneStory(current, event, scenes),
    scenes,
    () => createSceneStoryState(scenes, options.initialLayerIds),
  )
  const scene = scenes[state.activeSceneIndex]
  const visibleLayerIds = useMemo(() => new Set(state.visibleLayerIds), [state.visibleLayerIds])
  const accent = options.accent ?? '#047857'
  const resolvedLayers = useMemo(
    () => layers.map((layer) => resolveLayer(layer, options.labels?.[layer.id] ?? layer.id, scene, accent)),
    [layers, options.labels, scene, accent],
  )
  const legend = useMemo(
    () => buildLegend(scene, resolvedLayers, visibleLayerIds, accent, options.layerLegend),
    [scene, resolvedLayers, visibleLayerIds, accent, options.layerLegend],
  )
  const activePlaces = (options.places ?? []).filter((place) => scene?.placeIds?.includes(place.id))
  const selectScene = useCallback((index: number, force = false) => dispatch({ type: 'scene', index, force }), [])
  const setLayerVisibility = useCallback(
    (layerId: string, action: 'show' | 'hide' | 'toggle') => dispatch({ type: 'visibility', layerId, action }),
    [],
  )
  const setVisibleLayers = useCallback((ids: string[]) => dispatch({ type: 'layers', ids }), [])
  return {
    state,
    activeSceneIndex: state.activeSceneIndex,
    activeScene: scene,
    visibleLayerIds,
    resolvedLayers,
    legend,
    activePlaces,
    camera: state.cameraOverride ?? scene?.camera,
    overridden: state.mapActionActive || !sameLayerSet(visibleLayerIds, scene?.visibleLayerIds ?? []),
    selectScene,
    goToScene: selectScene,
    setLayerVisibility,
    setVisibleLayers,
    toggleLayer: (id: string) => setLayerVisibility(id, 'toggle'),
    resetScene: () => selectScene(state.activeSceneIndex, true),
    applyMapAction: (action: NonNullable<ProjectSceneDef['mapActions']>[number]) =>
      dispatch({ type: 'map-action', action, knownLayerIds: layers.map((layer) => layer.id) }),
  }
}
export type SceneStoryRenderState = ReturnType<typeof useSceneStoryController>
