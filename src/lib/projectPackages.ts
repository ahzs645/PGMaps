import {
  SCORE_METRICS,
  SCORE_PRESETS,
  encodeWeightsToParams,
  getScoreDataSourcesForWeights,
} from '@/maps/scorebuilder/constants'
import type { ScoreBuilderShareState } from '@/maps/scorebuilder/lib/shareState'
import type { ScoreMetricWeightMap, ScoreMethodSettings } from '@/maps/scorebuilder/types'

/**
 * Serializable "project package" shared by the dev projects catalog, the project
 * workspace, and the Index Lab. Static packages live in public/data/projects/*.json;
 * user-imported and lab-exported packages persist in localStorage with `local: true`.
 */
export type ProjectKind = 'raster-story' | 'index-preset' | 'research-pack'
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

export interface ProjectSceneDef {
  label: string
  title: string
  text: string
  focus: string
  visibleLayerIds: string[]
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
  opacity: number
  legendColor: string
  legendLabel: string
  legendShape?: 'circle' | 'square' | 'line' | 'dashed-line'
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

export type ProjectWorkspaceDef = ProjectMapExplorerWorkspaceDef

export interface ProjectPackage {
  version: 1
  slug: string
  title: string
  kind: ProjectKind
  theme: ProjectTheme
  owner: string
  updated: string
  region: string
  status: string
  summary: string
  sourceNote: string
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
}

const MANIFEST_URL = '/data/projects/index.json'
const LOCAL_STORAGE_KEY = 'pgmaps.projects.local'
const MAX_LOCAL_PROJECTS = 30

const PROJECT_KINDS: ProjectKind[] = ['raster-story', 'index-preset', 'research-pack']
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
    Array.isArray(candidate?.visibleLayerIds)
  )
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
    updated: asString(candidate.updated, '—'),
    region: asString(candidate.region, 'Prince George'),
    status: asString(candidate.status, 'Draft'),
    summary: asString(candidate.summary),
    sourceNote: asString(candidate.sourceNote),
    details: asArray(candidate.details, (item): item is string => typeof item === 'string'),
    image: typeof image?.src === 'string' ? { src: image.src, alt: asString(image.alt, title) } : undefined,
    links: asArray(candidate.links, isLinkItem),
    catalogMetrics: asArray(candidate.catalogMetrics, isLabeledValue),
    layers: asArray(candidate.layers, isLayerDef),
    legend: asArray(candidate.legend, isLegendItem),
    scenes: asArray(candidate.scenes, isSceneDef),
    files: asArray(candidate.files, isFileItem),
    lab: hasLab ? lab : undefined,
    portalMap: hasPortalMap ? portalMap : undefined,
    workspace: normalizeWorkspace(candidate.workspace),
    local: candidate.local === true,
  }
}

export async function loadStaticProjectPackages(): Promise<ProjectPackage[]> {
  const manifestResponse = await fetch(MANIFEST_URL)
  if (!manifestResponse.ok) throw new Error(`Project manifest failed to load (${manifestResponse.status})`)
  const manifest = (await manifestResponse.json()) as { projects?: unknown }
  const files = Array.isArray(manifest.projects)
    ? manifest.projects.filter((file): file is string => typeof file === 'string')
    : []
  const packages = await Promise.all(
    files.map(async (file) => {
      try {
        const response = await fetch(`/data/projects/${file}`)
        if (!response.ok) return null
        return normalizeProjectPackage(await response.json())
      } catch {
        return null
      }
    }),
  )
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
