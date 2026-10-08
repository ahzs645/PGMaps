import type { ProjectStoryOptionsDef } from '../projects/storyTypes.js'
/** Existing story-map-v1 defaults; callers may supply a partial presentation configuration. */
export const DEFAULT_STORY_OPTIONS: Readonly<ProjectStoryOptionsDef> = {
  layout: 'panel',
  sidecarVariant: 'docked',
  storyTheme: 'paper',
  storyCover: true,
  chapterNavigation: true,
  sectionUrl: false,
  narrativeSide: 'left',
  narrativeWidth: 'medium',
  sceneTransition: 'ease',
  sceneTransitionMs: 1150,
  mobileSheet: 'half',
  mobilePeekSceneText: false,
  mobilePeekTicker: false,
  legendCollapsed: 'auto',
  mapControls: 'auto',
  cameraFit: 'auto',
  slidesSwipeHint: 'off',
}
