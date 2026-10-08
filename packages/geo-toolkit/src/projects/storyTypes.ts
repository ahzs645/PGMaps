/**
 * Spotlights a subset of a layer's features for one scene by matching a property
 * against a value list. Non-matching features stay visible but are dimmed, which
 * is how a story says "this boundary, these regions" without a second dataset.
 */
export interface ProjectSceneHighlightDef {
  layerId: string
  property: string
  values: string[]
  /** Outline colour for matched features. Defaults to the story accent. */
  color?: string
  /** Fill opacity applied to features that do not match (0 hides them). */
  dimOpacity?: number
  /** Legend caption describing what the spotlight means. */
  label?: string
}

export interface ProjectStoryCategoryDef {
  property: string
  colors: Record<string, string>
  fallback: string
}

/** Per-scene paint tweaks for an already-visible layer. */
export interface ProjectSceneLayerOverrideDef {
  fillOpacity?: number
  lineOpacity?: number
  lineWidth?: number
  /** Recolours one shared source by a different property for this scene. */
  category?: ProjectStoryCategoryDef
}

export interface ProjectSceneInteractionDef {
  type: 'choices' | 'bars' | 'hierarchy'
  title: string
  description?: string
  items: Array<{
    label: string
    sceneLabel: string
    group?: string
    /** Share of the explicitly described denominator, from 0 to 1. */
    share?: number
    detail?: string
  }>
}

export interface ProjectSceneDef {
  label: string
  title: string
  text: string
  focus: string
  visibleLayerIds: string[]
  kicker?: string
  interaction?: ProjectSceneInteractionDef
  /** Optional sidecar presentation for a chapter in a mixed editorial story. */
  presentation?: 'docked' | 'floating' | 'slideshow'
  /** Editorial paragraphs after the scene's introductory text. */
  paragraphs?: string[]
  /** Optional views within this chapter; selecting one does not advance the story. */
  mapActions?: Array<{
    label: string
    visibleLayerIds: string[]
    camera?: ProjectSceneDef['camera']
  }>
  /** Two synchronized maps revealed by a slider within this chapter. */
  comparison?: {
    leftLayerIds: string[]
    rightLayerIds: string[]
    leftLabel: string
    rightLabel: string
  }
  camera?: {
    center: [number, number]
    zoom: number
    bearing?: number
    pitch?: number
  }
  placeIds?: string[]
  highlights?: ProjectSceneHighlightDef[]
  layerOverrides?: Record<string, ProjectSceneLayerOverrideDef>
  /** Replaces the auto-derived legend while this scene is active. */
  legend?: Array<{ label: string; color: string }>
  /** Short pull-quote or statistic rendered beside the card body. */
  callout?: { label: string; value: string; detail?: string }
}

export interface ProjectStoryClimateDef {
  product: string
  horizon: string
  percentile: 'p10' | 'p50' | 'p90' | null
  season: 'annual' | 'spring' | 'summer' | 'autumn' | 'winter'
  measure: 'absolute' | 'source-delta'
  baseline: string | null
  /** Fixed display bins, shared across comparable scenes; never a risk score. */
  domain: [number, number]
  /** Optional unequal bin edges; exactly colors.length - 1 increasing values. */
  breaks?: number[]
  colors: string[]
  units: string
  /** Fine grids are fetched only when zoomed in; viewport cell budget also applies. */
  minZoom?: number
}

export interface ProjectStoryLayerDef {
  id: string
  data: string
  /** Source transport. GeoJSON is the default; PMTiles requires sourceLayer. */
  format?: 'geojson' | 'pmtiles' | 'climate-grid'
  /** `data` points to a BCDataMapper native-grid-v1 manifest, not embedded cells. */
  climate?: ProjectStoryClimateDef
  /** Vector layer name inside a PMTiles archive. */
  sourceLayer?: string
  /** Optional tabular attributes joined onto shared boundary geometry at load time. */
  attributes?: {
    data: string
    boundaryProperty: string
    attributeProperty: string
    /** Property containing the row array. Defaults to `records`. */
    recordsProperty?: string
  }
  /** Geometry renderer. Omitted polygon remains the v1 default. */
  geometry?: 'polygon' | 'point'
  idProperty: string
  labelProperty: string
  selectionTitleProperty?: string
  selectionDetailProperty?: string
  fillColor: string
  fillOpacity: number
  lineColor: string
  lineOpacity: number
  lineWidth: number
  circleRadius?: number
  category?: ProjectStoryCategoryDef
  attribution?: string
}

export interface ProjectStoryPlaceDef {
  id: string
  label: string
  coordinates: [number, number]
  note?: string
  color?: string
}

/** Per-story presentation options. Authored in the package JSON; every field
 *  is optional there and normalized to these defaults. */
export interface ProjectStoryOptionsDef {
  /**
   * Overall presentation. 'panel' is the native PGMaps shell (desktop sidebar,
   * mobile bottom sheet). 'scrolly' replicates the Mapbox/MapLibre storytelling
   * template: fullscreen map with chapter cards scrolling over it. 'slides'
   * replicates KnightLab StoryMapJS: map on top, slide pane below, arrow/swipe
   * navigation.
   */
  layout: 'panel' | 'scrolly' | 'slides' | 'sidecar'
  /** Default chapter presentation in the editorial sidecar layout. */
  sidecarVariant: 'docked' | 'floating' | 'slideshow'
  /** Editorial story palette; map styling remains authored separately. */
  storyTheme: 'paper' | 'ink'
  /** Show the editorial cover before the chapters. */
  storyCover: boolean
  /** Show named chapter navigation in the editorial layout. */
  chapterNavigation: boolean
  /** Editorial documents only: track and restore chapter/panel URL fragments. */
  sectionUrl: boolean
  /** Side of the map occupied by the desktop editorial narrative. */
  narrativeSide: 'left' | 'right'
  /** Width of the desktop editorial narrative. */
  narrativeWidth: 'medium' | 'large'
  /** Camera motion between scenes. Reduced-motion readers always jump. */
  sceneTransition: 'ease' | 'fly' | 'jump'
  /** Duration of ease/fly camera transitions, in milliseconds. */
  sceneTransitionMs: number
  /** Where the mobile bottom sheet opens when the story loads. */
  mobileSheet: 'collapsed' | 'half' | 'full'
  /** Show the active scene's narrative text in the collapsed mobile peek,
   *  so the story reads while the map stays visible. */
  mobilePeekSceneText: boolean
  /** Marquee-scroll a too-long scene title in the mobile peek instead of
   *  truncating it, and hide the sheet chevron to give the title the room.
   *  Reduced-motion readers keep the static truncated title. */
  mobilePeekTicker: boolean
  /** Layers panel start state. 'auto' collapses it on mobile only. */
  legendCollapsed: 'auto' | 'always' | 'never'
  /** Map zoom/compass controls. 'hidden' removes them entirely; scrolly
   *  layouts drop them regardless, since the scroll overlay owns the pointer. */
  mapControls: 'auto' | 'hidden'
  /** Re-fit each scene camera to the real map pane. Authored zooms assume a
   *  desktop-sized pane, so on a phone (or the short pane of a slides story)
   *  the same zoom crops the framing; 'auto' zooms out far enough to keep the
   *  authored ground extent in view, never past the story's own minZoom.
   *  'off' uses the authored zoom on every screen. */
  cameraFit: 'auto' | 'off'
  /** Slides layout only: KnightLab-style "swipe to navigate" intro overlay on
   *  touch screens, dismissed by tapping OK or swiping. 'fullscreen' dims the
   *  whole story, 'pane' dims only the slide pane (as KnightLab does). The
   *  JSON also accepts true as an alias for 'fullscreen'. */
  slidesSwipeHint: 'off' | 'fullscreen' | 'pane'
}

export interface ProjectStoryWorkspaceDef {
  type: 'story-map'
  schema: 'story-map-v1'
  /** Imported editorial document; its own graph supplies maps and narrative. */
  document?: {
    schema: 'arcgis-story-document-v1' | 'pgmaps-editorial-v1'
    data: string
    basemap?: 'source' | 'pgmaps-dark' | 'pgmaps'
  }
  map: {
    center: [number, number]
    zoom: number
    minZoom: number
    maxZoom: number
    /** Basemap to draw under the story. 'auto' follows the app's light/dark theme. */
    basemap: 'auto' | 'light' | 'dark'
  }
  /** Accent colour for scene chrome and default highlight outlines. */
  accent: string
  options: ProjectStoryOptionsDef
  layers: ProjectStoryLayerDef[]
  places: ProjectStoryPlaceDef[]
}
