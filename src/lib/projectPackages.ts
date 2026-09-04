import {
  SCORE_METRICS,
  SCORE_PRESETS,
  encodeWeightsToParams,
  getScoreDataSourcesForWeights,
} from '@/maps/scorebuilder/constants'
import type { ScoreBuilderShareState } from '@/maps/scorebuilder/lib/shareState'
import type { ScoreMetricWeightMap, ScoreMethodSettings } from '@/maps/scorebuilder/types'
import { withBase } from './dataUrl'

/**
 * Serializable "project package" shared by the dev projects catalog, the project
 * workspace, and the Index Lab. Static packages live in public/data/projects/*.json;
 * user-imported and lab-exported packages persist in localStorage with `local: true`.
 */
export type ProjectKind = 'map-story' | 'raster-story' | 'index-preset' | 'research-pack'
export type ProjectTheme = 'cyan' | 'amber' | 'emerald' | 'blue' | 'slate'

export interface ProjectLayerDef {
  id: string
  label: string
  type: 'raster' | 'boundary' | 'point' | 'line' | 'base'
  checked: boolean
  locked?: boolean
  /** Binds the layer to a real element of the scored lab map instead of a narrative chip. */
  role?: 'score' | 'points'
}

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

export interface ProjectSceneDef {
  label: string
  title: string
  text: string
  focus: string
  visibleLayerIds: string[]
  kicker?: string
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

export interface ProjectPortalRasterLayerDef {
  id: string
  layerName: string
  mapPath?: string
}

export interface ProjectPortalContextLayerDef {
  id: string
  layerName: string
  mapPath?: string
  /** Local GeoJSON assembled at build time; when set, replaces the portal WMS tile layer. */
  data?: string
  /** Optional exact feature match within a shared local GeoJSON collection. */
  featureProperty?: string
  featureValue?: string | number
  idProperty?: string
  geometry?: 'polygon' | 'point'
  /** SVG icon used for local point features. */
  icon?: string
  labelProperty?: string
  opacity: number
  legendColor: string
  legendLabel: string
  legendShape?: 'circle' | 'square' | 'line' | 'dashed-line'
  fillOpacity?: number
  lineColor?: string
  lineOpacity?: number
  lineWidth?: number
}

export interface ProjectPortalMapDef {
  endpoint: string
  defaultMapPath: string
  bounds: [number, number, number, number]
  center: [number, number]
  zoom: number
  rasterLayers: ProjectPortalRasterLayerDef[]
  contextLayers: ProjectPortalContextLayerDef[]
  /** Layer id rendered from the local BCMoH Northern Health boundary. */
  localBoundaryLayerId?: string
}

export interface ProjectLabRecipe {
  /** Optional preset provenance, for display only — weights below are authoritative. */
  presetKey?: string
  boundarySource: string
  boundaryLevel: string
  weights: Record<string, number>
  normalization?: string
  aggregation?: string
  missingData?: ScoreMethodSettings['missingData']
  sensitivity?: boolean
  visualOutput?: ScoreMethodSettings['visualOutput']
  mapColorScale?: ScoreMethodSettings['mapColorScale']
  paletteOverride?: string
  mapSurface?: 'source' | 'boundary'
  selectedNetworks?: string[] | 'all'
  accessThreshold?: Partial<ScoreMethodSettings['accessThreshold']>
  healthyPlanPriority?: Partial<ScoreMethodSettings['healthyPlanPriority']>
  bcEnviroScreenComponentWeights?: Partial<ScoreMethodSettings['bcEnviroScreenComponentWeights']>
  bcEnviroScreenFormula?: ScoreMethodSettings['bcEnviroScreenFormula']
}

export interface ProjectExplorerCategoryDef {
  id: string
  label: string
  color: string
}

export type ProjectExplorerSummaryMetric = 'records' | 'locations' | 'year-range'
export type ProjectExplorerSummaryIcon = 'book-open' | 'map-pin' | 'calendar'
export interface ProjectExplorerSummaryItemDef {
  metric: ProjectExplorerSummaryMetric
  label: string
  icon: ProjectExplorerSummaryIcon
}

export type ProjectExplorerFeatureDef =
  | {
      type: 'summary-stats'
      items: ProjectExplorerSummaryItemDef[]
    }
  | {
      type: 'timeline'
      title: string
      granularity: 'decade'
      showLabel: string
      hideLabel: string
    }
  | { type: 'category-filter'; title: string }
  | {
      type: 'aggregate-records'
      triggerTemplate: string
      modalTitle: string
      modalDescription: string
    }
  | { type: 'search'; placeholder: string; fields: Array<'title' | 'author' | 'tags'> }
  | { type: 'ranked-list'; title: string; limit: number }
  | { type: 'map-legend'; title: string; description: string }
  | { type: 'location-popup'; maxCategories: number }

export interface ProjectMapExplorerWorkspaceDef {
  type: 'map-explorer'
  schema: 'map-explorer-v1'
  data: {
    adapter: 'research-records-v1'
    baseUrl: string
    files: {
      overview: string
      records: string
      locations: string
      timeline: string
    }
    categories: ProjectExplorerCategoryDef[]
    aggregateLocationIds: string[]
  }
  map: {
    center: [number, number]
    zoom: number
    minZoom: number
    maxZoom: number
  }
  labels: {
    recordSingular: string
    recordPlural: string
    locationSingular: string
    locationPlural: string
    yearPlural: string
    loading: string
    unavailable: string
  }
  features: ProjectExplorerFeatureDef[]
}

export interface ProjectStoryLayerDef {
  id: string
  data: string
  /** Source transport. GeoJSON is the default; PMTiles requires sourceLayer. */
  format?: 'geojson' | 'pmtiles'
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
  layout: 'panel' | 'scrolly' | 'slides'
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

export type ProjectWorkspaceDef = ProjectMapExplorerWorkspaceDef | ProjectStoryWorkspaceDef

export interface ProjectPackage {
  version: 1
  slug: string
  title: string
  kind: ProjectKind
  theme: ProjectTheme
  owner: string
  created?: string
  updated: string
  region: string
  status: string
  summary: string
  sourceNote: string
  angledLegendLabels?: boolean
  details?: string[]
  image?: { src: string; alt: string }
  links?: Array<{ label: string; href: string }>
  catalogMetrics: Array<{ label: string; value: string }>
  layers: ProjectLayerDef[]
  legend: Array<{ label: string; color: string }>
  scenes: ProjectSceneDef[]
  files: Array<{ label: string; detail: string }>
  lab?: ProjectLabRecipe
  portalMap?: ProjectPortalMapDef
  workspace?: ProjectWorkspaceDef
  /** Runtime flag: package came from this device (import or lab export), not the manifest. */
  local?: boolean
  /**
   * Present on catalog summaries built from index.json metadata, where
   * `layers`/`scenes` are empty: the real counts for catalog display.
   */
  catalogCounts?: { layers: number; scenes: number }
}

const MANIFEST_URL = '/data/projects/index.json'
const LOCAL_STORAGE_KEY = 'pgmaps.projects.local'
const MAX_LOCAL_PROJECTS = 30

const PROJECT_KINDS: ProjectKind[] = ['map-story', 'raster-story', 'index-preset', 'research-pack']
const PROJECT_THEMES: ProjectTheme[] = ['cyan', 'amber', 'emerald', 'blue', 'slate']

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asArray<T>(value: unknown, isItem: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(isItem) : []
}

function isLabeledValue(item: unknown): item is { label: string; value: string } {
  const candidate = item as { label?: unknown; value?: unknown }
  return typeof candidate?.label === 'string' && typeof candidate?.value === 'string'
}

function isLayerDef(item: unknown): item is ProjectLayerDef {
  const candidate = item as ProjectLayerDef
  return (
    typeof candidate?.id === 'string' &&
    typeof candidate?.label === 'string' &&
    typeof candidate?.type === 'string' &&
    typeof candidate?.checked === 'boolean'
  )
}

function isSceneDef(item: unknown): item is ProjectSceneDef {
  const candidate = item as ProjectSceneDef
  return (
    typeof candidate?.label === 'string' &&
    typeof candidate?.title === 'string' &&
    typeof candidate?.text === 'string' &&
    typeof candidate?.focus === 'string' &&
    Array.isArray(candidate?.visibleLayerIds) &&
    candidate.visibleLayerIds.every((layerId) => typeof layerId === 'string')
  )
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizeStoryCategory(value: unknown): ProjectStoryCategoryDef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const category = value as Partial<ProjectStoryCategoryDef>
  const colors = Object.fromEntries(
    Object.entries(category.colors ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return typeof category.property === 'string' &&
    typeof category.fallback === 'string' &&
    Object.keys(colors).length > 0
    ? { property: category.property, colors, fallback: category.fallback }
    : undefined
}

function normalizeSceneHighlights(value: unknown): ProjectSceneHighlightDef[] | undefined {
  const highlights = asArray(value, (item): item is ProjectSceneHighlightDef => {
    const candidate = item as Partial<ProjectSceneHighlightDef>
    return (
      typeof candidate?.layerId === 'string' &&
      typeof candidate.property === 'string' &&
      Array.isArray(candidate.values) &&
      candidate.values.some((entry) => typeof entry === 'string')
    )
  }).map((highlight) => ({
    layerId: highlight.layerId,
    property: highlight.property,
    values: highlight.values.filter((entry): entry is string => typeof entry === 'string'),
    color: typeof highlight.color === 'string' ? highlight.color : undefined,
    dimOpacity: isFiniteNumber(highlight.dimOpacity) ? clamp01(highlight.dimOpacity) : undefined,
    label: typeof highlight.label === 'string' ? highlight.label : undefined,
  }))
  return highlights.length > 0 ? highlights : undefined
}

function normalizeSceneLayerOverrides(value: unknown): Record<string, ProjectSceneLayerOverrideDef> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([layerId, raw]) => {
    if (typeof raw !== 'object' || raw === null) return []
    const override = raw as Partial<ProjectSceneLayerOverrideDef>
    const normalized: ProjectSceneLayerOverrideDef = {
      fillOpacity: isFiniteNumber(override.fillOpacity) ? clamp01(override.fillOpacity) : undefined,
      lineOpacity: isFiniteNumber(override.lineOpacity) ? clamp01(override.lineOpacity) : undefined,
      lineWidth: isFiniteNumber(override.lineWidth) ? Math.max(0, override.lineWidth) : undefined,
      category: normalizeStoryCategory(override.category),
    }
    const hasValue = Object.values(normalized).some((entry) => entry !== undefined)
    return hasValue ? ([[layerId, normalized]] as Array<[string, ProjectSceneLayerOverrideDef]>) : []
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function normalizeSceneCallout(value: unknown): ProjectSceneDef['callout'] {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.label !== 'string' || typeof candidate.value !== 'string') return undefined
  return {
    label: candidate.label,
    value: candidate.value,
    detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
  }
}

function normalizeSceneDef(value: unknown): ProjectSceneDef | null {
  if (!isSceneDef(value)) return null
  const camera = value.camera
  const hasCamera = Boolean(camera && isCoordinatePair(camera.center) && isFiniteNumber(camera.zoom))
  const sceneLegend = asArray((value as { legend?: unknown }).legend, isLegendItem)
  return {
    label: value.label,
    title: value.title,
    text: value.text,
    focus: value.focus,
    visibleLayerIds: value.visibleLayerIds,
    kicker: typeof value.kicker === 'string' ? value.kicker : undefined,
    highlights: normalizeSceneHighlights((value as { highlights?: unknown }).highlights),
    layerOverrides: normalizeSceneLayerOverrides((value as { layerOverrides?: unknown }).layerOverrides),
    legend: sceneLegend.length > 0 ? sceneLegend : undefined,
    callout: normalizeSceneCallout((value as { callout?: unknown }).callout),
    camera: hasCamera
      ? {
          center: camera!.center,
          zoom: camera!.zoom,
          bearing: isFiniteNumber(camera!.bearing) ? camera!.bearing : undefined,
          pitch: isFiniteNumber(camera!.pitch) ? camera!.pitch : undefined,
        }
      : undefined,
    placeIds: Array.isArray(value.placeIds)
      ? value.placeIds.filter((placeId): placeId is string => typeof placeId === 'string')
      : undefined,
  }
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])
}

function isProjectDataUrl(value: unknown): value is string {
  return typeof value === 'string' && ((value.startsWith('/') && !value.startsWith('//')) || isHttpsUrl(value))
}

function normalizeStoryOptions(value: unknown): ProjectStoryOptionsDef {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    layout: raw.layout === 'scrolly' || raw.layout === 'slides' ? raw.layout : 'panel',
    sceneTransition: raw.sceneTransition === 'fly' || raw.sceneTransition === 'jump' ? raw.sceneTransition : 'ease',
    sceneTransitionMs: isFiniteNumber(raw.sceneTransitionMs)
      ? Math.max(0, Math.min(5000, Math.round(raw.sceneTransitionMs)))
      : 1150,
    mobileSheet: raw.mobileSheet === 'collapsed' || raw.mobileSheet === 'full' ? raw.mobileSheet : 'half',
    mobilePeekSceneText: raw.mobilePeekSceneText === true,
    mobilePeekTicker: raw.mobilePeekTicker === true,
    legendCollapsed: raw.legendCollapsed === 'always' || raw.legendCollapsed === 'never' ? raw.legendCollapsed : 'auto',
    mapControls: raw.mapControls === 'hidden' ? 'hidden' : 'auto',
    cameraFit: raw.cameraFit === 'off' ? 'off' : 'auto',
    slidesSwipeHint:
      raw.slidesSwipeHint === true || raw.slidesSwipeHint === 'fullscreen'
        ? 'fullscreen'
        : raw.slidesSwipeHint === 'pane'
          ? 'pane'
          : 'off',
  }
}

function normalizeStoryWorkspace(value: Record<string, unknown>): ProjectStoryWorkspaceDef | undefined {
  if (value.type !== 'story-map' || value.schema !== 'story-map-v1') return undefined
  const map = value.map as Record<string, unknown> | undefined
  if (!map || !isCoordinatePair(map.center) || !isFiniteNumber(map.zoom)) return undefined

  const layers = asArray(value.layers, (item): item is ProjectStoryLayerDef => {
    const layer = item as Partial<ProjectStoryLayerDef>
    const format = layer?.format === 'pmtiles' ? 'pmtiles' : 'geojson'
    return (
      typeof layer?.id === 'string' &&
      isProjectDataUrl(layer.data) &&
      (format !== 'pmtiles' || typeof layer.sourceLayer === 'string') &&
      typeof layer.idProperty === 'string' &&
      typeof layer.labelProperty === 'string' &&
      typeof layer.fillColor === 'string' &&
      isFiniteNumber(layer.fillOpacity) &&
      typeof layer.lineColor === 'string' &&
      isFiniteNumber(layer.lineOpacity) &&
      isFiniteNumber(layer.lineWidth)
    )
  }).map((layer) => {
    const category = normalizeStoryCategory(layer.category)
    const attributes = layer.attributes
    const hasAttributes = Boolean(
      attributes &&
      isProjectDataUrl(attributes.data) &&
      typeof attributes.boundaryProperty === 'string' &&
      typeof attributes.attributeProperty === 'string',
    )
    return {
      ...layer,
      format: layer.format === 'pmtiles' ? ('pmtiles' as const) : ('geojson' as const),
      sourceLayer: layer.format === 'pmtiles' ? layer.sourceLayer : undefined,
      attributes: hasAttributes
        ? {
            data: attributes!.data,
            boundaryProperty: attributes!.boundaryProperty,
            attributeProperty: attributes!.attributeProperty,
            recordsProperty: typeof attributes!.recordsProperty === 'string' ? attributes!.recordsProperty : undefined,
          }
        : undefined,
      geometry: layer.geometry === 'point' ? ('point' as const) : ('polygon' as const),
      selectionTitleProperty:
        typeof layer.selectionTitleProperty === 'string' ? layer.selectionTitleProperty : undefined,
      selectionDetailProperty:
        typeof layer.selectionDetailProperty === 'string' ? layer.selectionDetailProperty : undefined,
      fillOpacity: Math.max(0, Math.min(1, layer.fillOpacity)),
      lineOpacity: Math.max(0, Math.min(1, layer.lineOpacity)),
      lineWidth: Math.max(0, layer.lineWidth),
      circleRadius: isFiniteNumber(layer.circleRadius) ? Math.max(1, layer.circleRadius) : undefined,
      category,
    }
  })

  const places = asArray(value.places, (item): item is ProjectStoryPlaceDef => {
    const place = item as Partial<ProjectStoryPlaceDef>
    return typeof place?.id === 'string' && typeof place.label === 'string' && isCoordinatePair(place.coordinates)
  })
  if (layers.length === 0) return undefined

  const basemap = map.basemap
  return {
    type: value.type,
    schema: value.schema,
    map: {
      center: map.center,
      zoom: map.zoom,
      minZoom: isFiniteNumber(map.minZoom) ? map.minZoom : 3,
      maxZoom: isFiniteNumber(map.maxZoom) ? map.maxZoom : 14,
      basemap: basemap === 'light' || basemap === 'dark' ? basemap : 'auto',
    },
    accent: typeof value.accent === 'string' ? value.accent : '#0e7490',
    options: normalizeStoryOptions(value.options),
    layers,
    places,
  }
}

function isLegendItem(item: unknown): item is { label: string; color: string } {
  const candidate = item as { label?: unknown; color?: unknown }
  return typeof candidate?.label === 'string' && typeof candidate?.color === 'string'
}

function isFileItem(item: unknown): item is { label: string; detail: string } {
  const candidate = item as { label?: unknown; detail?: unknown }
  return typeof candidate?.label === 'string' && typeof candidate?.detail === 'string'
}

function isLinkItem(item: unknown): item is { label: string; href: string } {
  const candidate = item as { label?: unknown; href?: unknown }
  return typeof candidate?.label === 'string' && typeof candidate?.href === 'string'
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeExplorerFeature(value: unknown): ProjectExplorerFeatureDef | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>

  switch (candidate.type) {
    case 'summary-stats': {
      const items = asArray(candidate.items, (item): item is ProjectExplorerSummaryItemDef => {
        const entry = item as Record<string, unknown>
        return (
          ['records', 'locations', 'year-range'].includes(asString(entry.metric)) &&
          typeof entry.label === 'string' &&
          ['book-open', 'map-pin', 'calendar'].includes(asString(entry.icon))
        )
      })
      return items.length > 0 ? { type: 'summary-stats', items } : null
    }
    case 'timeline':
      return {
        type: 'timeline',
        title: asString(candidate.title, 'Timeline'),
        granularity: 'decade',
        showLabel: asString(candidate.showLabel, 'Show Timeline'),
        hideLabel: asString(candidate.hideLabel, 'Hide Timeline'),
      }
    case 'category-filter':
      return { type: 'category-filter', title: asString(candidate.title, 'Categories') }
    case 'aggregate-records':
      return {
        type: 'aggregate-records',
        triggerTemplate: asString(candidate.triggerTemplate, '{count} records tagged to the whole region'),
        modalTitle: asString(candidate.modalTitle, 'Regional Records'),
        modalDescription: asString(
          candidate.modalDescription,
          '{count} records tagged to the region without a specific location',
        ),
      }
    case 'search': {
      const allowedFields = ['title', 'author', 'tags']
      const fields = asArray(candidate.fields, (item): item is 'title' | 'author' | 'tags' =>
        allowedFields.includes(asString(item)),
      )
      return {
        type: 'search',
        placeholder: asString(candidate.placeholder, 'Search…'),
        fields: fields.length > 0 ? fields : ['title', 'author', 'tags'],
      }
    }
    case 'ranked-list':
      return {
        type: 'ranked-list',
        title: asString(candidate.title, 'Locations'),
        limit: isFiniteNumber(candidate.limit) ? Math.max(1, Math.floor(candidate.limit)) : 30,
      }
    case 'map-legend':
      return {
        type: 'map-legend',
        title: asString(candidate.title, 'Legend'),
        description: asString(candidate.description),
      }
    case 'location-popup':
      return {
        type: 'location-popup',
        maxCategories: isFiniteNumber(candidate.maxCategories) ? Math.max(1, Math.floor(candidate.maxCategories)) : 5,
      }
    default:
      return null
  }
}

function normalizeWorkspace(value: unknown): ProjectWorkspaceDef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  const storyWorkspace = normalizeStoryWorkspace(candidate)
  if (storyWorkspace) return storyWorkspace
  if (candidate.type !== 'map-explorer' || candidate.schema !== 'map-explorer-v1') return undefined

  const data = candidate.data as Record<string, unknown> | undefined
  if (data?.adapter !== 'research-records-v1' || !isHttpsUrl(data.baseUrl)) return undefined
  const files = data.files as Record<string, unknown> | undefined
  const map = candidate.map as Record<string, unknown> | undefined
  const labels = candidate.labels as Record<string, unknown> | undefined
  const center = map?.center
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !isFiniteNumber(center[0]) ||
    !isFiniteNumber(center[1]) ||
    !isFiniteNumber(map?.zoom)
  ) {
    return undefined
  }

  const categories = asArray(data.categories, (item): item is ProjectExplorerCategoryDef => {
    const entry = item as Partial<ProjectExplorerCategoryDef>
    return typeof entry?.id === 'string' && typeof entry.label === 'string' && typeof entry.color === 'string'
  })
  const features = Array.isArray(candidate.features)
    ? candidate.features
        .map(normalizeExplorerFeature)
        .filter((item): item is ProjectExplorerFeatureDef => item !== null)
    : []
  if (categories.length === 0 || features.length === 0) return undefined

  return {
    type: candidate.type,
    schema: candidate.schema,
    data: {
      adapter: data.adapter,
      baseUrl: data.baseUrl.endsWith('/') ? data.baseUrl : `${data.baseUrl}/`,
      files: {
        overview: asString(files?.overview, 'overview.json'),
        records: asString(files?.records, 'records.json'),
        locations: asString(files?.locations, 'locations.json'),
        timeline: asString(files?.timeline, 'timeline.json'),
      },
      categories,
      aggregateLocationIds: asArray(data.aggregateLocationIds, (item): item is string => typeof item === 'string'),
    },
    map: {
      center: [center[0], center[1]],
      zoom: map.zoom,
      minZoom: isFiniteNumber(map.minZoom) ? map.minZoom : 4,
      maxZoom: isFiniteNumber(map.maxZoom) ? map.maxZoom : 15,
    },
    labels: {
      recordSingular: asString(labels?.recordSingular, 'record'),
      recordPlural: asString(labels?.recordPlural, 'records'),
      locationSingular: asString(labels?.locationSingular, 'location'),
      locationPlural: asString(labels?.locationPlural, 'locations'),
      yearPlural: asString(labels?.yearPlural, 'years'),
      loading: asString(labels?.loading, 'Loading data…'),
      unavailable: asString(labels?.unavailable, 'Data unavailable'),
    },
    features,
  }
}

/** Accepts a parsed JSON value and returns a well-formed package, or null if it isn't one. */
export function normalizeProjectPackage(raw: unknown): ProjectPackage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Record<string, unknown>
  const slug = asString(candidate.slug).trim()
  const title = asString(candidate.title).trim()
  if (!slug || !title) return null

  const kind = PROJECT_KINDS.includes(candidate.kind as ProjectKind) ? (candidate.kind as ProjectKind) : 'index-preset'
  const theme = PROJECT_THEMES.includes(candidate.theme as ProjectTheme) ? (candidate.theme as ProjectTheme) : 'slate'

  const image = candidate.image as { src?: unknown; alt?: unknown } | undefined
  const lab = candidate.lab as ProjectLabRecipe | undefined
  const hasLab =
    typeof lab === 'object' &&
    lab !== null &&
    typeof lab.boundarySource === 'string' &&
    typeof lab.boundaryLevel === 'string' &&
    typeof lab.weights === 'object' &&
    lab.weights !== null

  const portalMap = candidate.portalMap as ProjectPortalMapDef | undefined
  const hasPortalMap =
    typeof portalMap === 'object' &&
    portalMap !== null &&
    typeof portalMap.endpoint === 'string' &&
    Array.isArray(portalMap.bounds) &&
    Array.isArray(portalMap.rasterLayers)

  return {
    version: 1,
    slug,
    title,
    kind,
    theme,
    owner: asString(candidate.owner, 'PGMaps'),
    created: typeof candidate.created === 'string' ? candidate.created : undefined,
    updated: asString(candidate.updated, '—'),
    region: asString(candidate.region, 'Prince George'),
    status: asString(candidate.status, 'Draft'),
    summary: asString(candidate.summary),
    sourceNote: asString(candidate.sourceNote),
    angledLegendLabels: typeof candidate.angledLegendLabels === 'boolean' ? candidate.angledLegendLabels : undefined,
    details: asArray(candidate.details, (item): item is string => typeof item === 'string'),
    image: typeof image?.src === 'string' ? { src: image.src, alt: asString(image.alt, title) } : undefined,
    links: asArray(candidate.links, isLinkItem),
    catalogMetrics: asArray(candidate.catalogMetrics, isLabeledValue),
    layers: asArray(candidate.layers, isLayerDef),
    legend: asArray(candidate.legend, isLegendItem),
    scenes: Array.isArray(candidate.scenes)
      ? candidate.scenes.map(normalizeSceneDef).filter((scene): scene is ProjectSceneDef => scene !== null)
      : [],
    files: asArray(candidate.files, isFileItem),
    lab: hasLab ? lab : undefined,
    portalMap: hasPortalMap ? portalMap : undefined,
    workspace: normalizeWorkspace(candidate.workspace),
    local: candidate.local === true,
  }
}

type ProjectManifestEntry = {
  file: string
  revision?: string
  /** Catalog metadata embedded by generate-project-index.mjs (newer indexes). */
  catalog?: Record<string, unknown>
}

let manifestPromise: Promise<ProjectManifestEntry[]> | null = null
/** Full-package fetches, keyed by file — a project page fetches exactly one. */
const packagePromises = new Map<string, Promise<ProjectPackage | null>>()

async function loadProjectManifest(): Promise<ProjectManifestEntry[]> {
  manifestPromise ??= (async () => {
    const requestToken = Date.now().toString(36)
    const manifestUrl = new URL(withBase(MANIFEST_URL), window.location.href)
    manifestUrl.searchParams.set('_project_index', requestToken)
    const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' })
    if (!manifestResponse.ok) throw new Error(`Project manifest failed to load (${manifestResponse.status})`)
    const manifest = (await manifestResponse.json()) as { projects?: unknown }
    if (!Array.isArray(manifest.projects)) return []
    return manifest.projects.flatMap((entry): ProjectManifestEntry[] => {
      if (typeof entry === 'string') return [{ file: entry }]
      if (!entry || typeof entry !== 'object') return []
      const candidate = entry as { file?: unknown; revision?: unknown; catalog?: unknown }
      if (typeof candidate.file !== 'string') return []
      return [
        {
          file: candidate.file,
          revision: typeof candidate.revision === 'string' ? candidate.revision : undefined,
          catalog:
            candidate.catalog && typeof candidate.catalog === 'object'
              ? (candidate.catalog as Record<string, unknown>)
              : undefined,
        },
      ]
    })
  })()
  try {
    return await manifestPromise
  } catch (error) {
    // Don't cache a failed fetch — a retry (e.g. after a flaky reload) should refetch.
    manifestPromise = null
    throw error
  }
}

function fetchStaticProjectPackage(entry: ProjectManifestEntry): Promise<ProjectPackage | null> {
  let pending = packagePromises.get(entry.file)
  if (!pending) {
    pending = (async () => {
      try {
        const projectUrl = new URL(withBase(`/data/projects/${entry.file}`), window.location.href)
        projectUrl.searchParams.set('v', entry.revision ?? Date.now().toString(36))
        const response = await fetch(projectUrl)
        if (!response.ok) return null
        return normalizeProjectPackage(await response.json())
      } catch {
        return null
      }
    })()
    packagePromises.set(entry.file, pending)
  }
  return pending
}

function catalogEntryToSummary(entry: ProjectManifestEntry): ProjectPackage | null {
  if (!entry.catalog) return null
  const pkg = normalizeProjectPackage(entry.catalog)
  if (!pkg) return null
  const counts = entry.catalog as { layerCount?: unknown; sceneCount?: unknown }
  return {
    ...pkg,
    catalogCounts: {
      layers: typeof counts.layerCount === 'number' ? counts.layerCount : pkg.layers.length,
      scenes: typeof counts.sceneCount === 'number' ? counts.sceneCount : pkg.scenes.length,
    },
  }
}

/**
 * Catalog listing without the fan-out: summaries come straight from the
 * manifest's embedded metadata, so no per-project files are fetched. Entries
 * from an older index without metadata fall back to fetching their package.
 */
export async function loadProjectCatalogSummaries(): Promise<ProjectPackage[]> {
  const entries = await loadProjectManifest()
  const summaries = await Promise.all(
    entries.map(async (entry) => catalogEntryToSummary(entry) ?? (await fetchStaticProjectPackage(entry))),
  )
  return summaries.filter((pkg): pkg is ProjectPackage => pkg !== null)
}

export async function loadStaticProjectPackages(): Promise<ProjectPackage[]> {
  const entries = await loadProjectManifest()
  const packages = await Promise.all(entries.map(fetchStaticProjectPackage))
  return packages.filter((pkg): pkg is ProjectPackage => pkg !== null)
}

export function loadLocalProjectPackages(): ProjectPackage[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeProjectPackage)
      .filter((pkg): pkg is ProjectPackage => pkg !== null)
      .map((pkg) => ({ ...pkg, local: true }))
  } catch {
    return []
  }
}

function persistLocalProjectPackages(packages: ProjectPackage[]): ProjectPackage[] {
  const trimmed = packages.slice(0, MAX_LOCAL_PROJECTS)
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Private browsing or full storage — imports silently stay session-only.
  }
  return trimmed
}

export function saveLocalProjectPackage(pkg: ProjectPackage): ProjectPackage[] {
  const entry = { ...pkg, local: true }
  const existing = loadLocalProjectPackages().filter((candidate) => candidate.slug !== entry.slug)
  return persistLocalProjectPackages([entry, ...existing])
}

export function removeLocalProjectPackage(slug: string): ProjectPackage[] {
  return persistLocalProjectPackages(loadLocalProjectPackages().filter((pkg) => pkg.slug !== slug))
}

export async function findProjectPackageBySlug(slug: string): Promise<ProjectPackage | null> {
  const local = loadLocalProjectPackages().find((pkg) => pkg.slug === slug)
  if (local) return local
  try {
    const entries = await loadProjectManifest()
    const entry = entries.find((candidate) => candidate.catalog?.slug === slug)
    if (entry) return fetchStaticProjectPackage(entry)
    // Older index without embedded metadata: no slug→file mapping, so resolve
    // the slug the expensive way.
    const packages = await loadStaticProjectPackages()
    return packages.find((pkg) => pkg.slug === slug) ?? null
  } catch {
    return null
  }
}

function clampWeight(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
}

/** Expands a package's sparse weight map into the full SCORE_METRICS-ordered map. */
export function projectLabWeights(recipe: ProjectLabRecipe): ScoreMetricWeightMap {
  const weights = {} as ScoreMetricWeightMap
  for (const metric of SCORE_METRICS) {
    const value = recipe.weights[metric.key]
    weights[metric.key] = typeof value === 'number' && Number.isFinite(value) ? clampWeight(value) : 0
  }
  return weights
}

/**
 * Builds the Index Lab search params for a package's recipe. The lab hydrates its full
 * control state from these at mount, and the `project` param lets it pin the package as
 * the comparison baseline.
 */
export function buildProjectLabParams(pkg: ProjectPackage): URLSearchParams | null {
  if (!pkg.lab) return null
  const weights = projectLabWeights(pkg.lab)
  const params = new URLSearchParams()
  params.set('src', pkg.lab.boundarySource)
  params.set('level', pkg.lab.boundaryLevel)
  params.set('w', encodeWeightsToParams(weights))
  const dataSources = getScoreDataSourcesForWeights(weights)
  if (dataSources.length) params.set('ds', dataSources.join(','))
  if (pkg.lab.normalization) params.set('norm', pkg.lab.normalization)
  if (pkg.lab.aggregation) params.set('agg', pkg.lab.aggregation)
  if (pkg.lab.missingData) params.set('missing', pkg.lab.missingData)
  if (typeof pkg.lab.sensitivity === 'boolean') params.set('sens', pkg.lab.sensitivity ? 'on' : 'off')
  if (pkg.lab.visualOutput) params.set('vis', pkg.lab.visualOutput)
  if (pkg.lab.mapColorScale) params.set('cscale', pkg.lab.mapColorScale)
  if (pkg.lab.paletteOverride) params.set('pal', pkg.lab.paletteOverride)
  if (pkg.lab.mapSurface) params.set('surface', pkg.lab.mapSurface)
  if (pkg.lab.selectedNetworks === 'all') {
    params.set('networks', 'all')
  } else if (Array.isArray(pkg.lab.selectedNetworks) && pkg.lab.selectedNetworks.length > 0) {
    params.set('networks', pkg.lab.selectedNetworks.join(','))
  }
  if (typeof pkg.lab.accessThreshold?.minimumAccess === 'number') {
    params.set('accessMin', String(pkg.lab.accessThreshold.minimumAccess))
  }
  if (typeof pkg.lab.accessThreshold?.minimumHits === 'number') {
    params.set('accessHits', String(pkg.lab.accessThreshold.minimumHits))
  }
  if (pkg.lab.healthyPlanPriority?.demographicMetric) {
    params.set('hpDemo', pkg.lab.healthyPlanPriority.demographicMetric)
  }
  if (pkg.lab.healthyPlanPriority?.environmentMetric) {
    params.set('hpEnv', pkg.lab.healthyPlanPriority.environmentMetric)
  }
  const bcWeights = pkg.lab.bcEnviroScreenComponentWeights
  if (typeof bcWeights?.exposures === 'number') params.set('bcExp', String(bcWeights.exposures))
  if (typeof bcWeights?.environmentalEffects === 'number') params.set('bcEff', String(bcWeights.environmentalEffects))
  if (typeof bcWeights?.sensitivePopulations === 'number') params.set('bcSens', String(bcWeights.sensitivePopulations))
  if (typeof bcWeights?.socioeconomicFactors === 'number') params.set('bcSoc', String(bcWeights.socioeconomicFactors))
  if (pkg.lab.bcEnviroScreenFormula) {
    params.set('bcFormulaMode', pkg.lab.bcEnviroScreenFormula.mode)
    if (pkg.lab.bcEnviroScreenFormula.mode === 'custom') {
      params.set('bcFormula', pkg.lab.bcEnviroScreenFormula.expression)
    }
  }
  params.set('project', pkg.slug)
  return params
}

export function buildProjectLabUrl(pkg: ProjectPackage): string | null {
  const params = buildProjectLabParams(pkg)
  return params ? `/score-builder?${params.toString()}` : null
}

/** Human-readable weight bars derived from the recipe, for the project side panels. */
export function projectRecipeBars(pkg: ProjectPackage): Array<{ label: string; value: number; tone: string }> {
  if (!pkg.lab) return []
  return SCORE_METRICS.filter((metric) => (pkg.lab!.weights[metric.key] ?? 0) !== 0)
    .map((metric) => {
      const value = clampWeight(pkg.lab!.weights[metric.key] ?? 0)
      return {
        label: metric.label,
        value,
        tone: value > 0 ? 'bg-orange-500' : 'bg-emerald-600',
      }
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
}

function shareBoundaryLevel(share: ScoreBuilderShareState): string {
  switch (share.boundarySource) {
    case 'bcHealth':
      return share.healthBoundaryLevel
    case 'cityCommunity':
      return share.communityBoundaryLevel ?? 'communityPolygon'
    case 'cityPG':
      return share.cityBoundaryLevel ?? 'elementarySchoolCatchment'
    case 'regionalDistrict':
      return share.regionalDistrictBoundaryLevel ?? 'regionalDistrict'
    case 'bcMunicipality':
      return share.municipalityBoundaryLevel ?? 'municipality'
    case 'watershed':
      return share.watershedBoundaryLevel ?? 'watershedGroup'
    case 'bcDrainage':
      return share.drainageBoundaryLevel ?? 'oceanDrainageArea'
    case 'bcWildfire':
      return share.fireZoneBoundaryLevel ?? 'fireCentre'
    default:
      return share.censusBoundaryLevel
  }
}

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'custom-index'}-${suffix}`
}

/** Promotes the lab's current share state into a portable project package. */
export function buildProjectPackageFromShareState(
  share: ScoreBuilderShareState,
  label: string,
  description?: string,
): ProjectPackage {
  const nonZeroWeights = Object.fromEntries(
    Object.entries(share.weights).filter(
      ([key, value]) => typeof value === 'number' && value !== 0 && SCORE_METRICS.some((metric) => metric.key === key),
    ),
  ) as Record<string, number>
  const matchingPreset = SCORE_PRESETS.find((preset) => {
    return SCORE_METRICS.every((metric) => (preset.weights[metric.key] ?? 0) === (share.weights[metric.key] ?? 0))
  })
  const boundaryLevel = shareBoundaryLevel(share)
  const hasCustomMetrics = (share.customMetricRecipes?.length ?? 0) > 0

  return {
    version: 1,
    slug: slugify(label),
    title: label,
    kind: 'index-preset',
    theme: 'slate',
    owner: 'Local export',
    updated: new Date().toISOString().slice(0, 10),
    region: 'Prince George',
    status: 'Draft',
    summary: description || 'Custom index exported from the PGMaps Index Lab.',
    sourceNote: hasCustomMetrics
      ? 'Exported from Index Lab. Custom uploaded metrics are not portable and were left out of the recipe.'
      : 'Exported from Index Lab with the full weight, boundary, and method configuration.',
    catalogMetrics: [
      { label: 'Boundary', value: boundaryLevel.toUpperCase() },
      { label: 'Metrics', value: String(Object.keys(nonZeroWeights).length) },
      { label: 'Lab', value: 'Yes' },
    ],
    layers: [
      { id: 'base', label: 'Muted streets', type: 'base', checked: true, locked: true },
      { id: 'score-surface', label: 'Score surface', type: 'raster', checked: true, role: 'score' },
      { id: 'points', label: 'Facility points', type: 'point', checked: true, role: 'points' },
    ],
    legend: [
      { label: 'Lower score', color: '#dbeafe' },
      { label: 'Mid score', color: '#fde68a' },
      { label: 'Higher score', color: '#fb923c' },
      { label: 'Highest score', color: '#b91c1c' },
    ],
    scenes: [
      {
        label: 'Overview',
        title: 'Scored regions',
        text: 'The exported index scored across the selected boundary level.',
        focus: 'Score surface',
        visibleLayerIds: ['base', 'score-surface', 'points'],
      },
      {
        label: 'Recipe',
        title: 'Editable recipe',
        text: 'Open the package in Index Lab to adjust weights, boundary level, and method settings.',
        focus: 'Index Lab handoff',
        visibleLayerIds: ['base', 'score-surface'],
      },
    ],
    files: [{ label: 'Project package', detail: 'Recipe, layers, scenes, and notes' }],
    lab: {
      presetKey: matchingPreset?.key,
      boundarySource: share.boundarySource,
      boundaryLevel,
      weights: nonZeroWeights,
      normalization: share.methodSettings?.normalization,
      aggregation: share.methodSettings?.aggregation,
      missingData: share.methodSettings?.missingData,
      sensitivity: share.methodSettings?.sensitivity,
      visualOutput: share.methodSettings?.visualOutput,
      mapColorScale: share.methodSettings?.mapColorScale,
      paletteOverride: share.methodSettings?.paletteOverride ?? undefined,
      mapSurface: share.mapSurface,
      selectedNetworks: share.selectedNetworks,
      accessThreshold: share.methodSettings?.accessThreshold,
      healthyPlanPriority: share.methodSettings?.healthyPlanPriority,
      bcEnviroScreenComponentWeights: share.methodSettings?.bcEnviroScreenComponentWeights,
      bcEnviroScreenFormula: share.methodSettings?.bcEnviroScreenFormula,
    },
  }
}

export function downloadProjectPackage(pkg: ProjectPackage): void {
  const clean = { ...pkg }
  delete clean.local
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${pkg.slug}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function importProjectPackageFile(file: File): Promise<ProjectPackage> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a valid JSON file.')
  }
  const pkg = normalizeProjectPackage(parsed)
  if (!pkg) throw new Error('The file is not a PGMaps project package.')
  saveLocalProjectPackage(pkg)
  return { ...pkg, local: true }
}
