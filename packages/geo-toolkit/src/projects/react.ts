/** Opt-in React rendering kept out of the pure /projects repository entry point. */
export { SceneStoryRenderer, type SceneStoryRendererProps } from '../stories/SceneStoryRenderer.js'
export {
  EditorialDocumentRenderer,
  type EditorialMapRenderProps,
  type EditorialComparisonRenderProps,
  type EditorialShellRenderProps,
} from '../stories/EditorialDocumentRenderer.js'
export { useSceneStoryController, type SceneStoryRenderState } from '../stories/useSceneStoryController.js'
