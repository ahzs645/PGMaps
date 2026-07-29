import area from '@turf/area'
import bbox from '@turf/bbox'
import difference from '@turf/difference'
import intersect from '@turf/intersect'
import union from '@turf/union'
import createWebShareEngine from '@firstform/json-url/web-share'
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronUp, ChevronsUpDown, EyeOff, Focus, GitCompareArrows, GripVertical, Layers, Loader2, Plus, RotateCcw, Search, SquareStack, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Map, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { MapFillLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MapSidebarShell, SidebarSection, StatGrid } from '@/components/ui/map-panels'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  BOUNDARY_SOURCE_OPTIONS,
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  getStudyAreaLevelLabel,
  isValidLevelForSource,
  loadStudyAreaRegions,
  studyAreaRegionsToFeatureCollection,
  type BoundarySource,
  type RegionLevel,
  type StudyAreaRegion,
} from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'
import { useIsMobile } from '@/hooks/useIsMobile'
import { BC_CENTER } from '@/components/ui/map-styles'

type LoadState = 'loading' | 'ready' | 'error'

interface BoundaryCacheEntry {
  regions: StudyAreaRegion[]
  state: LoadState
  error?: string
}

interface ActiveLayer {
  source: BoundarySource
  level: RegionLevel
  key: string
}

interface ActiveLayerView extends ActiveLayer {
  label: string
  optionLabel: string
  colors: { fill: string; line: string }
  opacity: number
  entry?: BoundaryCacheEntry
  regions: StudyAreaRegion[]
  filteredRegions: StudyAreaRegion[]
  loading: boolean
  error?: string
}

interface SelectedPmtilesFeature {
  id: string
  scope: string
  lngLat: { lng: number; lat: number }
  properties: Record<string, unknown>
}

interface SelectedFocusCard {
  focus: PolygonFocus
  title: string
  subtitle: string
  areaLabel?: string
  onOpen: () => void
}

interface SurfaceDifference {
  overlap: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  onlyA: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  onlyB: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  overlapKm2: number
  onlyAKm2: number
  onlyBKm2: number
  aShare: number
  bShare: number
}

interface DiffSurface {
  id: string
  name: string
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  areaKm2: number
}

type BoundaryBbox = [number, number, number, number]
type CensusParentLevel = 'cd' | 'csd' | 'ct'

interface BcDaChunkManifest {
  generatedAt: string
  tolerance: number
  features: number
  rawBytes: number
  gzipBytes: number
  levels?: BcDaChunkLevel[]
  parentBoundaries?: BcDaParentBoundary[]
  chunks: Array<{
    id: string
    path: string
    bbox: BoundaryBbox
    featureCount: number
    rawBytes: number
    gzipBytes: number
  }>
}

interface BcDaParentBoundary {
  level: CensusParentLevel
  label: string
  path: string
  features: number
  rawBytes: number
  gzipBytes: number
}

interface BcDaChunkLevel {
  id: string
  label: string
  tolerance: number
  minZoom: number
  maxZoom: number
  features: number
  coordinateCount: number
  rawBytes: number
  gzipBytes: number
  chunks: BcDaChunkManifest['chunks']
}

interface BcDaChunkFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>[]
}

interface ParentBoundaryCacheEntry {
  state: LoadState
  data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  error?: string
}

interface SelectedParentBoundary {
  id: string
  scope: string
  name: string
  code: string
  label: string
  bounds: BoundaryBbox
  areaKm2: number
}

interface ParentBoundaryView {
  level: CensusParentLevel
  parent: BcDaParentBoundary
  data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  style: { fill: string; line: string; width: number }
}

interface PolygonFocus {
  id: string
  scope: string
}

interface BoundariesShareState {
  version: 1
  activeSources: BoundarySource[]
  sourceLevels: Partial<Record<BoundarySource, RegionLevel>>
  sourceOpacities?: Partial<Record<BoundarySource, number>>
  enabledCensusParentLevels?: CensusParentLevel[]
  selectedPolygonFocuses?: PolygonFocus[]
  isolatedPolygonFocuses?: PolygonFocus[]
  hiddenPolygonFocuses?: PolygonFocus[]
  selectedId?: string | null
  selectedParentId?: string | null
  query?: string
}

interface PolygonClickMeta {
  shiftKey: boolean
}

const BC_DA_SIMPLIFIED_LEVEL = 'da' satisfies RegionLevel
const BC_DB_CHUNKED_LEVEL = 'db' satisfies RegionLevel
const NORTH_SOUTH_CSD_LEVEL = 'northSouthCsd' satisfies RegionLevel
type ChunkedCensusLevel = typeof BC_DA_SIMPLIFIED_LEVEL | typeof BC_DB_CHUNKED_LEVEL
const BC_DA_CHUNK_BASE_PATH = '/data/census/bc-da-simplified'
const BC_DA_CHUNK_MANIFEST_PATH = `${BC_DA_CHUNK_BASE_PATH}/manifest.json`
const BC_DB_DEFAULT_CHUNK_BASE_PATH = import.meta.env.PROD
  ? 'https://data.map.ahmad.sh/census/bc-db-chunks'
  : '/data/census/bc-db-chunks'
const BC_DB_CHUNK_BASE_PATH = (
  (import.meta.env.VITE_BC_DB_CHUNK_BASE_URL as string | undefined)?.replace(/\/+$/, '') || BC_DB_DEFAULT_CHUNK_BASE_PATH
)
const BC_DB_CHUNK_MANIFEST_PATH = `${BC_DB_CHUNK_BASE_PATH}/manifest.json`
const BC_DB_DEFAULT_PMTILES_URL = 'https://data.map.ahmad.sh/census/bc-db.pmtiles'
const BC_DB_PMTILES_URL = (
  (import.meta.env.VITE_BC_DB_PMTILES_URL as string | undefined)?.trim() || BC_DB_DEFAULT_PMTILES_URL
)
const BC_DB_PMTILES_SOURCE_LAYER = 'bc_db'
const CENSUS_CHUNK_CONFIG: Record<ChunkedCensusLevel, { basePath: string; manifestPath: string }> = {
  da: {
    basePath: BC_DA_CHUNK_BASE_PATH,
    manifestPath: BC_DA_CHUNK_MANIFEST_PATH,
  },
  db: {
    basePath: BC_DB_CHUNK_BASE_PATH,
    manifestPath: BC_DB_CHUNK_MANIFEST_PATH,
  },
}
const EMPTY_REGIONS: StudyAreaRegion[] = []
const EMPTY_POLYGON_FOCUSES: PolygonFocus[] = []
const EMPTY_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
  type: 'FeatureCollection',
  features: [],
}
const MAX_LAYER_DIFF_FEATURES = 500

const CENSUS_PARENT_LEVEL_ORDER: CensusParentLevel[] = ['cd', 'csd', 'ct']
const BC_CENSUS_PARENT_FILE_BY_LEVEL: Record<CensusParentLevel, string> = {
  cd: '/data/census/bc-da-simplified/parents/cd.geojson',
  csd: '/data/census/bc-da-simplified/parents/csd.geojson',
  ct: '/data/census/bc-da-simplified/parents/ct.geojson',
}

const CENSUS_PARENT_LAYER_STYLES: Record<CensusParentLevel, { fill: string; line: string; width: number }> = {
  cd: { fill: '#f59e0b', line: '#92400e', width: 2.2 },
  csd: { fill: '#38bdf8', line: '#0369a1', width: 1.6 },
  ct: { fill: '#a78bfa', line: '#6d28d9', width: 1.2 },
}

const NORTH_SOUTH_CSD_COLORS = {
  North: { fill: '#2563eb', line: '#1e3a8a' },
  South: { fill: '#f59e0b', line: '#92400e' },
} as const

const NORTH_SOUTH_CSD_FILL_EXPRESSION = [
  'match',
  ['get', 'north_south'],
  'North',
  NORTH_SOUTH_CSD_COLORS.North.fill,
  'South',
  NORTH_SOUTH_CSD_COLORS.South.fill,
  '#94a3b8',
]

const NORTH_SOUTH_CSD_LINE_EXPRESSION = [
  'match',
  ['get', 'north_south'],
  'North',
  NORTH_SOUTH_CSD_COLORS.North.line,
  'South',
  NORTH_SOUTH_CSD_COLORS.South.line,
  '#475569',
]

const BOUNDARY_EXPLORER_SOURCE_OPTIONS = BOUNDARY_SOURCE_OPTIONS.map((option) => (
  option.value === 'census'
    ? {
        ...option,
        description: 'National North/South CSDs plus BC-wide hierarchy, division to dissemination block',
      }
    : option
))

const DEFAULT_SOURCE_LEVELS = BOUNDARY_EXPLORER_SOURCE_OPTIONS.reduce<Record<BoundarySource, RegionLevel>>((acc, option) => {
  acc[option.value] = getDefaultLevelForSource(option.value)
  return acc
}, {} as Record<BoundarySource, RegionLevel>)

const BOUNDARY_SOURCE_VALUE_SET = new Set<string>(BOUNDARY_EXPLORER_SOURCE_OPTIONS.map((option) => option.value))
const boundaryExplorerRegionCache = new globalThis.Map<string, StudyAreaRegion[]>()

const boundariesShareEngine = createWebShareEngine<BoundariesShareState>({
  codecs: ['raw', 'lz'],
  maxLength: 12000,
  skipUnsupportedCodecs: true,
})

const SOURCE_COLORS: Record<BoundarySource, { fill: string; line: string }> = {
  cityCommunity: { fill: '#14b8a6', line: '#0f766e' },
  cityPG: { fill: '#f59e0b', line: '#b45309' },
  bcHealth: { fill: '#0ea5e9', line: '#0369a1' },
  regionalDistrict: { fill: '#8b5cf6', line: '#6d28d9' },
  bcMunicipality: { fill: '#ec4899', line: '#be185d' },
  census: { fill: '#ef4444', line: '#b91c1c' },
  watershed: { fill: '#22c55e', line: '#15803d' },
  bcDrainage: { fill: '#0891b2', line: '#155e75' },
  bcWildfire: { fill: '#dc2626', line: '#991b1b' },
  bcRfc: { fill: '#38bdf8', line: '#075985' },
  nrAdmin: { fill: '#64748b', line: '#334155' },
  uwr: { fill: '#84cc16', line: '#4d7c0f' },
  crownTenure: { fill: '#a855f7', line: '#7e22ce' },
  rangeTenure: { fill: '#f97316', line: '#c2410c' },
  mineralTenure: { fill: '#eab308', line: '#a16207' },
  walkabilityCommunity: { fill: '#06b6d4', line: '#0e7490' },
}

function encodeBoundariesShareState(state: BoundariesShareState): Promise<string> {
  return boundariesShareEngine.compress(state)
}

function decodeBoundariesShareState(token: string): Promise<BoundariesShareState> {
  return boundariesShareEngine.decompress(token, { deURI: true })
}

function cacheKey(source: BoundarySource, level: RegionLevel) {
  return `${source}:${level}`
}

function isBcDaSimplifiedLayer(layer: ActiveLayer) {
  return layer.source === 'census' && layer.level === BC_DA_SIMPLIFIED_LEVEL
}

function isChunkedCensusLevel(level: RegionLevel): level is ChunkedCensusLevel {
  return level === BC_DA_SIMPLIFIED_LEVEL || level === BC_DB_CHUNKED_LEVEL
}

function isChunkedCensusLayer(layer: ActiveLayer): layer is ActiveLayer & { level: ChunkedCensusLevel } {
  return layer.source === 'census' && isChunkedCensusLevel(layer.level)
}

function isDbPmtilesLayer(layer: ActiveLayer) {
  return layer.source === 'census' && layer.level === BC_DB_CHUNKED_LEVEL
}

function isNorthSouthCsdLayer(layer: ActiveLayer) {
  return layer.source === 'census' && layer.level === NORTH_SOUTH_CSD_LEVEL
}

function northSouthValue(properties: Record<string, unknown>) {
  const value = properties.north_south
  return value === 'North' || value === 'South' ? value : null
}

function northSouthColor(properties: Record<string, unknown>) {
  const value = northSouthValue(properties)
  return value ? NORTH_SOUTH_CSD_COLORS[value].fill : '#94a3b8'
}

function layerVisibleCount(layer: ActiveLayerView, visibleLayerRegionsByKey: Record<string, StudyAreaRegion[]>) {
  return visibleLayerRegionsByKey[layer.key]?.length ?? layer.filteredRegions.length
}

function layerSummaryText(layer: ActiveLayerView, visibleLayerRegionsByKey: Record<string, StudyAreaRegion[]>, loadingChunkCount: number) {
  if (layer.loading) return 'Loading'
  if (isDbPmtilesLayer(layer)) return 'PMTiles on map'
  return `${formatNumber(layerVisibleCount(layer, visibleLayerRegionsByKey))} / ${formatNumber(layer.filteredRegions.length)} ${layer.optionLabel}${isChunkedCensusLayer(layer) && loadingChunkCount > 0 ? ` · ${loadingChunkCount} loading` : ''}`
}

function pmtilesFeatureName(properties: Record<string, unknown>) {
  return String(properties.name ?? (properties.id ? `DB ${properties.id}` : 'Dissemination Block'))
}

function pmtilesFeatureCode(properties: Record<string, unknown>) {
  return String(properties.id ?? properties.code ?? '')
}

function pmtilesFeatureAreaKm2(properties: Record<string, unknown>) {
  const areaValue = Number(properties.areaKm2 ?? properties.areaSqKm)
  return Number.isFinite(areaValue) ? areaValue : 0
}

function bboxesIntersect(a: BoundaryBbox, b: BoundaryBbox) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function chunkUrl(level: ChunkedCensusLevel, path: string) {
  if (path.startsWith('/') || /^(https?:)?\/\//.test(path)) return path
  return `${CENSUS_CHUNK_CONFIG[level].basePath}/${path}`
}

function censusChunkCacheKey(level: ChunkedCensusLevel, detailId: string, chunkId: string) {
  return `${level}:${detailId}:${chunkId}`
}

function getBcDaManifestLevels(manifest: BcDaChunkManifest | null): BcDaChunkLevel[] {
  if (!manifest) return []
  if (manifest.levels?.length) {
    return manifest.levels.map((level) => ({
      ...level,
      chunks: level.chunks ?? manifest.chunks,
    }))
  }
  return [{
    id: 'medium',
    label: 'Medium',
    tolerance: manifest.tolerance,
    minZoom: 0,
    maxZoom: 24,
    features: manifest.features,
    coordinateCount: 0,
    rawBytes: manifest.rawBytes,
    gzipBytes: manifest.gzipBytes,
    chunks: manifest.chunks,
  }]
}

function chooseBcDaLevel(manifest: BcDaChunkManifest | null, zoom: number): BcDaChunkLevel | null {
  const levels = getBcDaManifestLevels(manifest)
  if (levels.length === 0) return null
  const matched = levels.find((level) => zoom >= level.minZoom && zoom < level.maxZoom)
  if (matched) return matched
  return zoom < levels[0].minZoom ? levels[0] : levels[levels.length - 1]
}

function formatArea(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--'
  if (value >= 1000) return `${Math.round(value).toLocaleString()} km²`
  if (value >= 10) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²`
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`
}


function formatGzipMiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const mib = bytes / 1024 / 1024
  return `${mib >= 10 ? Math.round(mib).toLocaleString() : mib.toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB gzip`
}

function sourceLabel(source: BoundarySource) {
  return BOUNDARY_EXPLORER_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source
}

function regionSearchText(region: StudyAreaRegion) {
  const properties = region.feature.properties ?? {}
  return [
    region.name,
    region.code,
    sourceLabel(region.source),
    getStudyAreaLevelLabel(region.level),
    properties.parentCdId,
    properties.parentCdName,
    properties.parentCsdId,
    properties.parentCsdName,
    properties.parentCtId,
    properties.parentCtName,
    properties.parentDaId,
    properties.parentChsaId,
    properties.parentChsaName,
    properties.parentLhaId,
    properties.parentLhaName,
    properties.parentHsdaId,
    properties.parentHsdaName,
    properties.parentHealthAuthorityId,
    properties.parentHealthAuthorityName,
    properties.CDUID,
    properties.CDNAME,
    properties.CSDUID,
    properties.CSDNAME,
    properties.north_south,
    properties.CTUID,
    properties.CTNAME,
  ].filter((value) => value != null).join(' ').toLowerCase()
}

function censusParentRows(properties: Record<string, unknown>) {
  return [
    {
      label: 'Census division',
      code: properties.parentCdId ?? properties.CDUID,
      name: properties.parentCdName ?? properties.CDNAME,
    },
    {
      label: 'Subdivision',
      code: properties.parentCsdId ?? properties.CSDUID,
      name: properties.parentCsdName ?? properties.CSDNAME,
    },
    {
      label: 'Census tract',
      code: properties.parentCtId ?? properties.CTUID,
      name: properties.parentCtName ?? properties.CTNAME,
    },
    {
      label: 'Dissemination area',
      code: properties.parentDaId ?? properties.DAUID,
      name: properties.parentDaName ?? properties.DANAME,
    },
    {
      label: 'CHSA',
      code: properties.parentChsaId,
      name: properties.parentChsaName,
    },
    {
      label: 'Local Health Area',
      code: properties.parentLhaId,
      name: properties.parentLhaName,
    },
    {
      label: 'HSDA',
      code: properties.parentHsdaId,
      name: properties.parentHsdaName,
    },
    {
      label: 'Health Authority',
      code: properties.parentHealthAuthorityId,
      name: properties.parentHealthAuthorityName,
    },
  ].filter((row) => row.code || row.name)
}

function censusParentSummary(properties: Record<string, unknown>) {
  const rows = censusParentRows(properties)
  if (rows.length === 0) return null
  return rows.map((row) => `${row.label}: ${row.name ?? row.code}${row.code && row.name ? ` (${row.code})` : ''}`).join(' · ')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function levelRange(regions: StudyAreaRegion[]) {
  const areas = regions.map((region) => region.areaKm2).filter((value) => Number.isFinite(value) && value > 0)
  if (areas.length === 0) return { min: 0, max: 0, total: 0 }
  return {
    min: Math.min(...areas),
    max: Math.max(...areas),
    total: areas.reduce((sum, value) => sum + value, 0),
  }
}

function polygonFeatureId(feature: GeoJSON.Feature<GeoJSON.Geometry | null>): string | null {
  const id = feature.properties?.boundaryId ?? feature.properties?.id
  return id == null ? null : String(id)
}

function samePolygonFocus(a: PolygonFocus, b: PolygonFocus) {
  return a.id === b.id && a.scope === b.scope
}

function polygonFocusKey(focus: PolygonFocus) {
  return `${focus.scope}:${focus.id}`
}

function uniquePolygonFocuses(focuses: PolygonFocus[]) {
  return focuses.filter((focus, index) => focuses.findIndex((candidate) => samePolygonFocus(candidate, focus)) === index)
}

function isBoundarySource(value: unknown): value is BoundarySource {
  return typeof value === 'string' && BOUNDARY_SOURCE_VALUE_SET.has(value)
}

function isCensusParentLevel(value: unknown): value is CensusParentLevel {
  return value === 'cd' || value === 'csd' || value === 'ct'
}

async function fetchBoundaryExplorerJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new Error(`Failed to fetch ${path}: file missing (got HTML fallback)`)
  }

  return response.json() as Promise<T>
}

function mapBcCensusParentFeatureToRegion(
  rawFeature: GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>,
  level: CensusParentLevel,
): StudyAreaRegion | null {
  if (!rawFeature.geometry || (rawFeature.geometry.type !== 'Polygon' && rawFeature.geometry.type !== 'MultiPolygon')) {
    return null
  }

  const feature = rawFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>
  const properties = feature.properties ?? {}
  const code = String(properties.boundaryCode ?? properties.id ?? rawFeature.id ?? '').trim()
  if (!code) return null

  const displayName = String(properties.boundaryName ?? properties.name ?? code).trim() || code
  const areaKm2 = Number(properties.areaKm2 ?? properties.areaSqKm ?? area(feature) / 1_000_000)
  const normalizedAreaKm2 = Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0
  const id = `census:${level}:${code}`
  const normalizedFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>> = {
    ...feature,
    properties: {
      ...properties,
      id,
      boundaryId: id,
      boundaryCode: code,
      boundaryName: displayName,
      boundaryLevel: level,
      boundarySource: 'census',
      areaKm2: normalizedAreaKm2,
    },
  }

  return {
    id,
    code,
    name: displayName,
    source: 'census',
    level,
    feature: normalizedFeature,
    bounds: bbox(normalizedFeature) as BoundaryBbox,
    areaKm2: normalizedAreaKm2,
  } satisfies StudyAreaRegion
}

async function loadBoundaryExplorerCensusParentRegions(
  level: CensusParentLevel,
  signal?: AbortSignal,
): Promise<StudyAreaRegion[]> {
  const cacheKey = `boundary-explorer:census:${level}`
  const cached = boundaryExplorerRegionCache.get(cacheKey)
  if (cached) return cached

  const collection = await fetchBoundaryExplorerJson<BcDaChunkFeatureCollection>(
    BC_CENSUS_PARENT_FILE_BY_LEVEL[level],
    signal,
  )
  const regions = collection.features
    .map((feature) => mapBcCensusParentFeatureToRegion(feature, level))
    .filter((region): region is StudyAreaRegion => region !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))

  boundaryExplorerRegionCache.set(cacheKey, regions)
  return regions
}

function loadBoundaryExplorerStudyAreaRegions(
  source: BoundarySource,
  level: RegionLevel,
  signal?: AbortSignal,
) {
  if (source === 'census' && isCensusParentLevel(level) && level !== 'csd') {
    return loadBoundaryExplorerCensusParentRegions(level, signal)
  }

  return loadStudyAreaRegions(source, level, signal)
}

function isPolygonFocus(value: unknown): value is PolygonFocus {
  if (!value || typeof value !== 'object') return false
  const focus = value as Partial<PolygonFocus>
  return typeof focus.id === 'string' && typeof focus.scope === 'string'
}

function normalizePolygonFocuses(value: unknown): PolygonFocus[] {
  return Array.isArray(value) ? uniquePolygonFocuses(value.filter(isPolygonFocus)) : []
}

function normalizeOpacity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(0.65, Math.max(0.04, value))
}

function polygonFocusScopes(focuses: PolygonFocus[]) {
  return new Set(focuses.map((focus) => focus.scope))
}

function filterRegionsForPolygonFocus(
  regions: StudyAreaRegion[],
  scope: string,
  isolatedFocuses: PolygonFocus[],
  hiddenFocuses: PolygonFocus[],
) {
  const isolatedIds = new Set(isolatedFocuses.filter((focus) => focus.scope === scope).map((focus) => focus.id))
  const hiddenIds = new Set(hiddenFocuses.filter((focus) => focus.scope === scope).map((focus) => focus.id))
  if (isolatedIds.size === 0 && hiddenIds.size === 0) return regions
  return regions.filter((region) => {
    if (isolatedIds.size > 0) return isolatedIds.has(region.id)
    return !hiddenIds.has(region.id)
  })
}

function filterFeatureCollectionForPolygonFocus(
  collection: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  scope: string,
  isolatedFocuses: PolygonFocus[],
  hiddenFocuses: PolygonFocus[],
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  const isolatedIds = new Set(isolatedFocuses.filter((focus) => focus.scope === scope).map((focus) => focus.id))
  const hiddenIds = new Set(hiddenFocuses.filter((focus) => focus.scope === scope).map((focus) => focus.id))
  if (isolatedIds.size === 0 && hiddenIds.size === 0) return collection

  const features = collection.features.filter((feature) => {
    const id = polygonFeatureId(feature)
    if (!id) return isolatedIds.size === 0
    if (isolatedIds.size > 0) return isolatedIds.has(id)
    return !hiddenIds.has(id)
  })

  return features.length === collection.features.length ? collection : { type: 'FeatureCollection', features }
}

function PolygonFocusControls({
  polygonId,
  polygonScope,
  targetFocuses,
  focusActive,
  onIsolate,
  onHide,
  onClear,
}: {
  polygonId: string
  polygonScope: string
  targetFocuses: PolygonFocus[]
  focusActive: boolean
  onIsolate: (focuses: PolygonFocus[]) => void
  onHide: (focuses: PolygonFocus[]) => void
  onClear: () => void
}) {
  const focus = { id: polygonId, scope: polygonScope }
  const targets = targetFocuses.some((target) => samePolygonFocus(target, focus)) ? targetFocuses : [focus]
  const multiple = targets.length > 1
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onIsolate(targets)}
        className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
      >
        <Focus className="size-3.5" />
        {multiple ? `Show ${targets.length} selected` : 'Show only'}
      </button>
      <button
        type="button"
        onClick={() => onHide(targets)}
        className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
      >
        <EyeOff className="size-3.5" />
        {multiple ? `Hide ${targets.length} selected` : 'Hide'}
      </button>
      {focusActive && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          <RotateCcw className="size-3.5" />
          Clear focus
        </button>
      )}
    </div>
  )
}

function singleFeatureCollection(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  return feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_COLLECTION
}

function diffSurfaceFromLayer(layer: ActiveLayerView, regions: StudyAreaRegion[]): DiffSurface | null {
  const polygonRegions = regions.filter((region) => (
    region.feature.geometry.type === 'Polygon' || region.feature.geometry.type === 'MultiPolygon'
  ))
  if (polygonRegions.length === 0 || polygonRegions.length > MAX_LAYER_DIFF_FEATURES) return null

  try {
    const dissolved = polygonRegions.reduce<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>((current, region) => {
      const feature = region.feature
      if (!current) return feature
      return union(current as never, feature as never) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
    }, null)

    if (!dissolved) return null
    const surfaceAreaKm2 = featureAreaKm2(dissolved)
    return {
      id: layer.key,
      name: `${layer.label} · ${layer.optionLabel}`,
      feature: {
        ...dissolved,
        properties: {
          ...(dissolved.properties ?? {}),
          id: `layer-diff:${layer.key}`,
          boundaryId: `layer-diff:${layer.key}`,
          boundaryName: `${layer.label} · ${layer.optionLabel}`,
        },
      },
      areaKm2: surfaceAreaKm2,
    }
  } catch {
    return null
  }
}

function polygonFeature(
  feature: GeoJSON.Feature<GeoJSON.Geometry | null> | null,
  properties: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (!feature?.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) return null
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties,
  }
}

function featureAreaKm2(feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null): number {
  if (!feature) return 0
  const squareMeters = area(feature as never)
  return Number.isFinite(squareMeters) && squareMeters > 0 ? squareMeters / 1_000_000 : 0
}

function findSelectedParentBoundary(views: ParentBoundaryView[], selectedParentId: string | null): SelectedParentBoundary | null {
  if (!selectedParentId) return null

  for (const view of views) {
    const feature = view.data.features.find((candidate) => polygonFeatureId(candidate) === selectedParentId)
    if (!feature) continue

    const properties = feature.properties ?? {}
    const code = String(properties.boundaryCode ?? properties.code ?? selectedParentId)
    const name = String(properties.boundaryName ?? properties.name ?? code)
    const areaKm2 = Number(properties.areaKm2 ?? area(feature as never) / 1_000_000)
    return {
      id: selectedParentId,
      scope: `census-parent:${view.level}`,
      name,
      code,
      label: view.parent.label,
      bounds: bbox(feature as never) as BoundaryBbox,
      areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
    }
  }

  return null
}

function mapBcDaChunkFeatureToRegion(
  rawFeature: GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>,
  level: ChunkedCensusLevel,
): StudyAreaRegion | null {
  if (!rawFeature.geometry || (rawFeature.geometry.type !== 'Polygon' && rawFeature.geometry.type !== 'MultiPolygon')) {
    return null
  }

  const feature = rawFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>
  const properties = feature.properties ?? {}
  const code = String(properties.boundaryCode ?? properties.DAUID ?? properties.id ?? '').trim()
  if (!code) return null

  const fallbackPrefix = level === BC_DB_CHUNKED_LEVEL ? 'DB' : 'DA'
  const displayName = String(properties.boundaryName ?? properties.name ?? `${fallbackPrefix} ${code}`).trim() || `${fallbackPrefix} ${code}`
  const areaKm2 = Number(properties.areaKm2 ?? properties.areaSqKm ?? area(feature) / 1_000_000)
  const bounds = bbox(feature) as BoundaryBbox

  return {
    id: `census:${level}:${code}`,
    code,
    name: displayName,
    source: 'census',
    level,
    feature,
    bounds,
    areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
  } satisfies StudyAreaRegion
}

function buildSurfaceDifference(a: DiffSurface, b: DiffSurface): SurfaceDifference {
  try {
    const overlap = polygonFeature(
      intersect(a.feature as never, b.feature as never) as GeoJSON.Feature<GeoJSON.Geometry | null> | null,
      { id: 'surface-overlap', boundaryId: 'surface-overlap', boundaryName: 'Overlap' },
    )
    const onlyA = polygonFeature(
      difference(a.feature as never, b.feature as never) as GeoJSON.Feature<GeoJSON.Geometry | null> | null,
      { id: 'surface-only-a', boundaryId: 'surface-only-a', boundaryName: `Only ${a.name}` },
    )
    const onlyB = polygonFeature(
      difference(b.feature as never, a.feature as never) as GeoJSON.Feature<GeoJSON.Geometry | null> | null,
      { id: 'surface-only-b', boundaryId: 'surface-only-b', boundaryName: `Only ${b.name}` },
    )
    const overlapKm2 = featureAreaKm2(overlap)
    return {
      overlap,
      onlyA,
      onlyB,
      overlapKm2,
      onlyAKm2: featureAreaKm2(onlyA),
      onlyBKm2: featureAreaKm2(onlyB),
      aShare: a.areaKm2 > 0 ? overlapKm2 / a.areaKm2 : 0,
      bShare: b.areaKm2 > 0 ? overlapKm2 / b.areaKm2 : 0,
    }
  } catch {
    return {
      overlap: null,
      onlyA: null,
      onlyB: null,
      overlapKm2: 0,
      onlyAKm2: a.areaKm2,
      onlyBKm2: b.areaKm2,
      aShare: 0,
      bShare: 0,
    }
  }
}

function FitToRegions({
  regions,
  selectedRegion,
  fitSelectedRegion,
  fitLayerRegions,
}: {
  regions: StudyAreaRegion[]
  selectedRegion: StudyAreaRegion | null
  fitSelectedRegion: boolean
  fitLayerRegions: boolean
}) {
  const { map, isLoaded } = useMap()
  const fittedLayerRegionsKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!fitLayerRegions) {
      fittedLayerRegionsKeyRef.current = null
      return
    }
    if (!isLoaded || !map) return
    if (regions.length === 0) return

    const layerRegionsKey = regions.map((region) => `${region.source}:${region.level}:${region.id}`).join('|')
    if (fittedLayerRegionsKeyRef.current === layerRegionsKey) return
    fittedLayerRegionsKeyRef.current = layerRegionsKey

    const bounds = bbox(studyAreaRegionsToFeatureCollection(regions) as never) as [number, number, number, number]
    map.fitBounds(bounds, {
      padding: 48,
      duration: 650,
      maxZoom: 7,
    })
  }, [fitLayerRegions, isLoaded, map, regions])

  useEffect(() => {
    if (!isLoaded || !map || !selectedRegion || !fitSelectedRegion) return
    const target = selectedRegion.feature
    const bounds = bbox(target as never) as [number, number, number, number]
    map.fitBounds(bounds, {
      padding: 96,
      duration: 650,
      maxZoom: 11,
    })
  }, [fitSelectedRegion, isLoaded, map, selectedRegion])

  return null
}

function TrackMapBounds({
  onBoundsChange,
  onZoomChange,
}: {
  onBoundsChange: (bounds: BoundaryBbox) => void
  onZoomChange: (zoom: number) => void
}) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!isLoaded || !map) return

    const updateBounds = () => {
      const bounds = map.getBounds()
      onBoundsChange([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
      onZoomChange(map.getZoom())
    }

    updateBounds()
    map.on('moveend', updateBounds)
    map.on('zoomend', updateBounds)

    return () => {
      map.off('moveend', updateBounds)
      map.off('zoomend', updateBounds)
    }
  }, [isLoaded, map, onBoundsChange, onZoomChange])

  return null
}

const STUDY_AREA_GROUP_ORDER = Array.from(
  new Set(BOUNDARY_EXPLORER_SOURCE_OPTIONS.map((option) => option.group ?? 'Other')),
)

function StudyAreaPickerSearch({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search sources, categories, levels"
        className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  )
}

function StudyAreaPickerRows({
  pickerQuery,
  activeSources,
  onToggleSource,
  sourceLevels,
  onSelectLevel,
}: {
  pickerQuery: string
  activeSources: BoundarySource[]
  onToggleSource: (source: BoundarySource) => void
  sourceLevels: Record<BoundarySource, RegionLevel>
  onSelectLevel: (source: BoundarySource, level: RegionLevel) => void
}) {
  const [expandedSource, setExpandedSource] = useState<BoundarySource | null>(null)

  const filteredGroups = useMemo(() => {
    const normalized = pickerQuery.trim().toLowerCase()
    return STUDY_AREA_GROUP_ORDER.map((group) => ({
      group,
      options: BOUNDARY_EXPLORER_SOURCE_OPTIONS.filter((option) => {
        if ((option.group ?? 'Other') !== group) return false
        if (!normalized) return true
        const levelLabels = getLevelOptionsForSource(option.value).map((level) => level.label)
        return [option.label, option.description, group, ...levelLabels]
          .join(' ')
          .toLowerCase()
          .includes(normalized)
      }),
    })).filter(({ options }) => options.length > 0)
  }, [pickerQuery])

  if (filteredGroups.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        No sources match "{pickerQuery}".
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filteredGroups.map(({ group, options }) => (
        <div key={group} className="space-y-1.5">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
            {group}
          </div>
          {options.map((option) => {
            const active = activeSources.includes(option.value)
            const levelOptions = getLevelOptionsForSource(option.value)
            const levelCount = levelOptions.length
            const hasLevels = levelCount > 1
            const expanded = expandedSource === option.value
            const selectedLevel = sourceLevels[option.value] ?? getDefaultLevelForSource(option.value)
            return (
              <div key={option.value} className="space-y-1.5">
                <div className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleSource(option.value)}
                    aria-pressed={active}
                    className={cn(
                      'min-w-0 flex-1 rounded-md border px-3 py-2 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: SOURCE_COLORS[option.value].fill }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
                      <span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                        {levelCount} level{levelCount === 1 ? '' : 's'}
                      </span>
                      {active && <Check className="size-3.5 shrink-0 text-primary" />}
                    </div>
                    <div className="mt-0.5 pl-[1.125rem] text-xs leading-4 text-muted-foreground">
                      {option.description}
                    </div>
                    {active && hasLevels && (
                      <div className="mt-0.5 pl-[1.125rem] text-xs font-medium leading-4 text-primary">
                        {getStudyAreaLevelLabel(selectedLevel)}
                      </div>
                    )}
                  </button>
                  {hasLevels && (
                    <button
                      type="button"
                      onClick={() => setExpandedSource((current) => (current === option.value ? null : option.value))}
                      aria-expanded={expanded}
                      aria-label={`Choose a level for ${option.label}`}
                      title="Choose a level"
                      className={cn(
                        'flex w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
                        expanded
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-input bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                    </button>
                  )}
                </div>
                {hasLevels && expanded && (
                  <div className="grid gap-1 rounded-md border bg-muted/20 p-1.5">
                    {levelOptions.map((level, levelIndex) => {
                      const levelActive = active && selectedLevel === level.value
                      return (
                        <button
                          key={level.value}
                          type="button"
                          onClick={() => {
                            onSelectLevel(option.value, level.value)
                            setExpandedSource(null)
                          }}
                          aria-pressed={levelActive}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                            levelActive
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border bg-background text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{level.label}</span>
                          {levelIndex === 0 && (
                            <span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                              Top
                            </span>
                          )}
                          {levelActive && <Check className="size-3.5 shrink-0 text-primary" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function StudyAreaSourcePicker({
  open,
  onOpenChange,
  activeSources,
  onToggleSource,
  sourceLevels,
  onSelectLevel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeSources: BoundarySource[]
  onToggleSource: (source: BoundarySource) => void
  sourceLevels: Record<BoundarySource, RegionLevel>
  onSelectLevel: (source: BoundarySource, level: RegionLevel) => void
}) {
  const [pickerQuery, setPickerQuery] = useState('')

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
      if (!nextOpen) setPickerQuery('')
    },
    [onOpenChange],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent variant="sheet" elevated className="sm:max-w-md">
        <div className="border-b border-border p-4 pb-3">
          <DialogTitle className="text-base font-semibold text-foreground">Add study areas</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
            Tap a source to add its top-level boundary. Use the chevron to pick a finer level in the hierarchy.
          </DialogDescription>
          <StudyAreaPickerSearch value={pickerQuery} onChange={setPickerQuery} className="mt-3" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <StudyAreaPickerRows
            pickerQuery={pickerQuery}
            activeSources={activeSources}
            onToggleSource={onToggleSource}
            sourceLevels={sourceLevels}
            onSelectLevel={onSelectLevel}
          />
        </div>

        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Done{activeSources.length > 0 ? ` · ${activeSources.length} active` : ''}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StudyAreaPickerSidebarPanel({
  onClose,
  activeSources,
  onToggleSource,
  sourceLevels,
  onSelectLevel,
}: {
  onClose: () => void
  activeSources: BoundarySource[]
  onToggleSource: (source: BoundarySource) => void
  sourceLevels: Record<BoundarySource, RegionLevel>
  onSelectLevel: (source: BoundarySource, level: RegionLevel) => void
}) {
  const [pickerQuery, setPickerQuery] = useState('')

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background md:border-r">
      <div className="border-b border-border p-4 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to study areas"
            title="Back"
            className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="text-sm font-semibold text-foreground">Add study areas</h2>
        </div>
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          Click a source to add its top-level boundary. Use the chevron to pick a finer level in the hierarchy.
        </p>
        <StudyAreaPickerSearch value={pickerQuery} onChange={setPickerQuery} className="mt-3" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <StudyAreaPickerRows
          pickerQuery={pickerQuery}
          activeSources={activeSources}
          onToggleSource={onToggleSource}
          sourceLevels={sourceLevels}
          onSelectLevel={onSelectLevel}
        />
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Done{activeSources.length > 0 ? ` · ${activeSources.length} active` : ''}
        </button>
      </div>
    </div>
  )
}

function DevBoundaries() {
  const [searchParams] = useSearchParams()
  const initialShareTokenValue = searchParams.get('s')
  const initialShareToken = useRef(initialShareTokenValue)
  const lastEncodedShareToken = useRef<string | null>(initialShareTokenValue)
  const [shareStateReady, setShareStateReady] = useState(() => !initialShareTokenValue)
  const [showSidebar, setShowSidebar] = useState(true)
  const [activeSources, setActiveSources] = useState<BoundarySource[]>([])
  const [sourceLevels, setSourceLevels] = useState<Record<BoundarySource, RegionLevel>>(() => DEFAULT_SOURCE_LEVELS)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  const [selectedPmtilesFeature, setSelectedPmtilesFeature] = useState<SelectedPmtilesFeature | null>(null)
  const [pmtilesFeatureCache, setPmtilesFeatureCache] = useState<Record<string, SelectedPmtilesFeature>>({})
  const [selectedPolygonFocuses, setSelectedPolygonFocuses] = useState<PolygonFocus[]>([])
  const [selectedTrayExpanded, setSelectedTrayExpanded] = useState(false)
  const [fitSelectedRegion, setFitSelectedRegion] = useState(true)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [isolatedPolygonFocuses, setIsolatedPolygonFocuses] = useState<PolygonFocus[]>([])
  const [hiddenPolygonFocuses, setHiddenPolygonFocuses] = useState<PolygonFocus[]>([])
  const [cache, setCache] = useState<Record<string, BoundaryCacheEntry>>({})
  const [mapBounds, setMapBounds] = useState<BoundaryBbox | null>(null)
  const [mapZoom, setMapZoom] = useState(5.2)
  const [censusChunkManifests, setCensusChunkManifests] = useState<Partial<Record<ChunkedCensusLevel, BcDaChunkManifest>>>({})
  const [censusChunkRegionsByKey, setCensusChunkRegionsByKey] = useState<Record<string, StudyAreaRegion[]>>({})
  const [censusChunkErrors, setCensusChunkErrors] = useState<Partial<Record<ChunkedCensusLevel, string>>>({})
  const [censusLoadingChunkIds, setCensusLoadingChunkIds] = useState<string[]>([])
  const censusRequestedChunkIds = useRef(new Set<string>())
  const [enabledCensusParentLevels, setEnabledCensusParentLevels] = useState<CensusParentLevel[]>([])
  const [parentBoundaryCache, setParentBoundaryCache] = useState<Partial<Record<CensusParentLevel, ParentBoundaryCacheEntry>>>({})
  const [surfaceDifferenceMode, setSurfaceDifferenceMode] = useState(false)
  const [layerDifferenceMode, setLayerDifferenceMode] = useState(false)
  const [sourceOpacities, setSourceOpacities] = useState<Record<BoundarySource, number>>(() => (
    BOUNDARY_EXPLORER_SOURCE_OPTIONS.reduce<Record<BoundarySource, number>>((acc, option) => {
      acc[option.value] = 0.22
      return acc
    }, {} as Record<BoundarySource, number>)
  ))
  const [draggedSource, setDraggedSource] = useState<BoundarySource | null>(null)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const isMobile = useIsMobile()

  useEffect(() => {
    const token = initialShareToken.current
    if (!token) return

    let cancelled = false
    decodeBoundariesShareState(token)
      .then((shareState) => {
        if (cancelled || shareState.version !== 1) return

        const nextActiveSources: BoundarySource[] = Array.isArray(shareState.activeSources)
          ? (shareState.activeSources as unknown[]).filter(isBoundarySource)
          : []
        const activeSourceSet = new Set<BoundarySource>()
        const normalizedActiveSources = nextActiveSources.filter((source) => {
          if (activeSourceSet.has(source)) return false
          activeSourceSet.add(source)
          return true
        })
        const nextSources: BoundarySource[] = normalizedActiveSources
        const nextLevels = { ...DEFAULT_SOURCE_LEVELS }

        nextSources.forEach((source) => {
          const level = shareState.sourceLevels?.[source]
          nextLevels[source] = level && isValidLevelForSource(source, level) ? level : getDefaultLevelForSource(source)
        })

        setActiveSources(nextSources)
        setSourceLevels(nextLevels)
        setSourceOpacities((current) => {
          const next = { ...current }
          nextSources.forEach((source) => {
            const opacity = normalizeOpacity(shareState.sourceOpacities?.[source])
            if (opacity != null) next[source] = opacity
          })
          return next
        })
        setEnabledCensusParentLevels(
          Array.isArray(shareState.enabledCensusParentLevels)
            ? CENSUS_PARENT_LEVEL_ORDER.filter((level) => shareState.enabledCensusParentLevels?.some((value) => isCensusParentLevel(value) && value === level))
            : [],
        )
        setSelectedPolygonFocuses(normalizePolygonFocuses(shareState.selectedPolygonFocuses))
        setIsolatedPolygonFocuses(normalizePolygonFocuses(shareState.isolatedPolygonFocuses))
        setHiddenPolygonFocuses(normalizePolygonFocuses(shareState.hiddenPolygonFocuses))
        setSelectedId(typeof shareState.selectedId === 'string' ? shareState.selectedId : null)
        setSelectedParentId(typeof shareState.selectedParentId === 'string' ? shareState.selectedParentId : null)
        setQuery(typeof shareState.query === 'string' ? shareState.query : '')
        setFitSelectedRegion(false)
        setCompareIds([])
        setSurfaceDifferenceMode(false)
        setLayerDifferenceMode(false)
      })
      .catch(() => {
        // Bad shared URLs should not block the page from loading with defaults.
      })
      .finally(() => {
        if (!cancelled) setShareStateReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const activeLayers = useMemo<ActiveLayer[]>(() => (
    activeSources.map((source) => {
      const level = sourceLevels[source] ?? getDefaultLevelForSource(source)
      return { source, level, key: cacheKey(source, level) }
    })
  ), [activeSources, sourceLevels])

  const activeCensusChunkLevel = useMemo<ChunkedCensusLevel | null>(() => (
    activeLayers.find((layer): layer is ActiveLayer & { level: ChunkedCensusLevel } => (
      isChunkedCensusLayer(layer) && !isDbPmtilesLayer(layer)
    ))?.level ?? null
  ), [activeLayers])
  const activeCensusChunkManifest = activeCensusChunkLevel ? censusChunkManifests[activeCensusChunkLevel] ?? null : null
  const activeCensusChunkError = activeCensusChunkLevel ? censusChunkErrors[activeCensusChunkLevel] ?? null : null
  const activeCensusChunkDetailLevel = useMemo(
    () => chooseBcDaLevel(activeCensusChunkManifest, mapZoom),
    [activeCensusChunkManifest, mapZoom],
  )
  const activeVisibleCensusChunks = useMemo(() => {
    if (!activeCensusChunkDetailLevel || !mapBounds) return []
    return activeCensusChunkDetailLevel.chunks.filter((chunk) => bboxesIntersect(chunk.bbox, mapBounds))
  }, [activeCensusChunkDetailLevel, mapBounds])
  const renderedCensusChunkDetailLevel = useMemo(() => {
    if (!activeCensusChunkLevel || !activeCensusChunkManifest || !activeCensusChunkDetailLevel || !mapBounds) {
      return activeCensusChunkDetailLevel
    }

    const levels = getBcDaManifestLevels(activeCensusChunkManifest)
    const targetIndex = levels.findIndex((level) => level.id === activeCensusChunkDetailLevel.id)
    const renderCandidates = (targetIndex >= 0 ? levels.slice(0, targetIndex + 1) : levels).reverse()

    for (const detailLevel of renderCandidates) {
      const visibleChunks = detailLevel.chunks.filter((chunk) => bboxesIntersect(chunk.bbox, mapBounds))
      if (visibleChunks.length === 0) return detailLevel

      const allVisibleChunksLoaded = visibleChunks.every((chunk) => (
        censusChunkRegionsByKey[censusChunkCacheKey(activeCensusChunkLevel, detailLevel.id, chunk.id)]
      ))
      if (allVisibleChunksLoaded) return detailLevel
    }

    return activeCensusChunkDetailLevel
  }, [
    activeCensusChunkDetailLevel,
    activeCensusChunkLevel,
    activeCensusChunkManifest,
    censusChunkRegionsByKey,
    mapBounds,
  ])
  const renderedVisibleCensusChunks = useMemo(() => {
    if (!renderedCensusChunkDetailLevel || !mapBounds) return []
    return renderedCensusChunkDetailLevel.chunks.filter((chunk) => bboxesIntersect(chunk.bbox, mapBounds))
  }, [mapBounds, renderedCensusChunkDetailLevel])
  const renderedVisibleCensusChunkKeys = useMemo(() => {
    if (!activeCensusChunkLevel || !renderedCensusChunkDetailLevel) return new Set<string>()
    return new Set(renderedVisibleCensusChunks.map((chunk) => censusChunkCacheKey(activeCensusChunkLevel, renderedCensusChunkDetailLevel.id, chunk.id)))
  }, [activeCensusChunkLevel, renderedCensusChunkDetailLevel, renderedVisibleCensusChunks])
  const bcDaActive = activeLayers.some(isBcDaSimplifiedLayer)
  const bcDaManifest = censusChunkManifests.da ?? null
  const parentBoundaryOptions = useMemo(() => bcDaManifest?.parentBoundaries ?? [], [bcDaManifest])

  useEffect(() => {
    const layersToLoad = activeLayers
      .filter((layer) => !isChunkedCensusLayer(layer) && !cache[layer.key])
    if (layersToLoad.length === 0) return

    queueMicrotask(() => {
      setCache((current) => {
        const next = { ...current }
        layersToLoad.forEach((layer) => {
          if (!next[layer.key]) {
            next[layer.key] = { regions: [], state: 'loading' }
          }
        })
        return next
      })
    })

    layersToLoad.forEach((layer) => {
      loadBoundaryExplorerStudyAreaRegions(layer.source, layer.level)
        .then((regions) => {
          setCache((current) => ({
            ...current,
            [layer.key]: { regions, state: 'ready' },
          }))
        })
        .catch((err) => {
          setCache((current) => ({
            ...current,
            [layer.key]: {
              regions: [],
              state: 'error',
              error: (err as Error).message || 'Unable to load boundary layer.',
            },
          }))
        })
    })
  }, [activeLayers, cache])

  useEffect(() => {
    if (!activeCensusChunkLevel) return
    if (censusChunkManifests[activeCensusChunkLevel] || censusChunkErrors[activeCensusChunkLevel]) return

    const controller = new AbortController()
    const { manifestPath } = CENSUS_CHUNK_CONFIG[activeCensusChunkLevel]
    fetch(manifestPath, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch ${manifestPath}: ${response.status}`)
        }
        return response.json() as Promise<BcDaChunkManifest>
      })
      .then((manifest) => {
        setCensusChunkManifests((current) => ({ ...current, [activeCensusChunkLevel]: manifest }))
        setCensusChunkErrors((current) => ({ ...current, [activeCensusChunkLevel]: undefined }))
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setCensusChunkErrors((current) => ({
          ...current,
          [activeCensusChunkLevel]: (err as Error).message || 'Unable to load census chunk manifest.',
        }))
      })

    return () => controller.abort()
  }, [activeCensusChunkLevel, censusChunkErrors, censusChunkManifests])

  useEffect(() => {
    if (!activeCensusChunkLevel || !activeCensusChunkDetailLevel || activeVisibleCensusChunks.length === 0) return

    const chunksToLoad = activeVisibleCensusChunks.filter((chunk) => {
        const key = censusChunkCacheKey(activeCensusChunkLevel, activeCensusChunkDetailLevel.id, chunk.id)
        return !censusChunkRegionsByKey[key] && !censusRequestedChunkIds.current.has(key)
      })

    if (chunksToLoad.length === 0) return

    const chunkKeys = chunksToLoad.map((chunk) => censusChunkCacheKey(activeCensusChunkLevel, activeCensusChunkDetailLevel.id, chunk.id))
    chunkKeys.forEach((key) => censusRequestedChunkIds.current.add(key))
    setCensusLoadingChunkIds((current) => Array.from(new Set([...current, ...chunkKeys])))

    chunksToLoad.forEach((chunk) => {
      const chunkKey = censusChunkCacheKey(activeCensusChunkLevel, activeCensusChunkDetailLevel.id, chunk.id)
      fetch(chunkUrl(activeCensusChunkLevel, chunk.path))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${chunk.path}: ${response.status}`)
          }
          return response.json() as Promise<BcDaChunkFeatureCollection>
        })
        .then((collection) => {
          const regions = collection.features
            .map((feature) => mapBcDaChunkFeatureToRegion(feature, activeCensusChunkLevel))
            .filter((region): region is StudyAreaRegion => region !== null)
            .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))

          setCensusChunkRegionsByKey((current) => ({ ...current, [chunkKey]: regions }))
        })
        .catch((err) => {
          censusRequestedChunkIds.current.delete(chunkKey)
          setCensusChunkErrors((current) => ({
            ...current,
            [activeCensusChunkLevel]: (err as Error).message || `Unable to load ${chunk.path}.`,
          }))
        })
        .finally(() => {
          setCensusLoadingChunkIds((current) => current.filter((id) => id !== chunkKey))
        })
    })
  }, [activeCensusChunkDetailLevel, activeCensusChunkLevel, activeVisibleCensusChunks, censusChunkRegionsByKey])

  useEffect(() => {
    if (!bcDaActive || !bcDaManifest) return
    const parentByLevel = new globalThis.Map(parentBoundaryOptions.map((parent) => [parent.level, parent]))
    const levelsToLoad = enabledCensusParentLevels.filter((level) => {
      const entry = parentBoundaryCache[level]
      return parentByLevel.has(level) && (!entry || entry.state === 'error')
    })
    if (levelsToLoad.length === 0) return

    levelsToLoad.forEach((level) => {
      const parent = parentByLevel.get(level)
      if (!parent) return
      setParentBoundaryCache((current) => ({
        ...current,
        [level]: { state: 'loading', data: EMPTY_COLLECTION },
      }))
      fetch(chunkUrl(BC_DA_SIMPLIFIED_LEVEL, parent.path))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${parent.path}: ${response.status}`)
          }
          return response.json() as Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>
        })
        .then((data) => {
          setParentBoundaryCache((current) => ({
            ...current,
            [level]: { state: 'ready', data },
          }))
        })
        .catch((err) => {
          setParentBoundaryCache((current) => ({
            ...current,
            [level]: {
              state: 'error',
              data: EMPTY_COLLECTION,
              error: (err as Error).message || `Unable to load ${parent.path}.`,
            },
          }))
        })
    })
  }, [bcDaActive, bcDaManifest, enabledCensusParentLevels, parentBoundaryCache, parentBoundaryOptions])

  const censusChunkRegions = useMemo(() => (
    Object.entries(censusChunkRegionsByKey)
      .filter(([key]) => renderedVisibleCensusChunkKeys.has(key))
      .flatMap(([, regions]) => regions)
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
  ), [censusChunkRegionsByKey, renderedVisibleCensusChunkKeys])

  const activeLayerViews = useMemo<ActiveLayerView[]>(() => {
    const term = query.trim().toLowerCase()
    return activeLayers.map((layer) => {
      const chunkedLayer = isChunkedCensusLayer(layer)
      const pmtilesLayer = isDbPmtilesLayer(layer)
      const entry = chunkedLayer
        ? {
            regions: censusChunkRegions,
            state: activeCensusChunkError ? 'error' : 'ready',
            error: activeCensusChunkError ?? undefined,
          } satisfies BoundaryCacheEntry
        : cache[layer.key]
      const regions = chunkedLayer && !pmtilesLayer ? censusChunkRegions : entry?.regions ?? EMPTY_REGIONS
      const filteredRegions = term
        ? regions.filter((region) => regionSearchText(region).includes(term))
        : regions

      return {
        ...layer,
        label: sourceLabel(layer.source),
        optionLabel: getStudyAreaLevelLabel(layer.level),
        colors: SOURCE_COLORS[layer.source],
        opacity: sourceOpacities[layer.source] ?? 0.22,
        entry,
        regions,
        filteredRegions,
        loading: chunkedLayer && !pmtilesLayer
          ? !activeCensusChunkError && (!activeCensusChunkManifest || (regions.length === 0 && censusLoadingChunkIds.length > 0))
          : !entry || entry.state === 'loading',
        error: entry?.state === 'error' ? entry.error : undefined,
      }
    })
  }, [
    activeCensusChunkError,
    activeCensusChunkManifest,
    activeLayers,
    cache,
    censusChunkRegions,
    censusLoadingChunkIds.length,
    query,
    sourceOpacities,
  ])

  const enabledParentBoundaryViews = useMemo<ParentBoundaryView[]>(() => (
    enabledCensusParentLevels
      .slice()
      .sort((a, b) => CENSUS_PARENT_LEVEL_ORDER.indexOf(a) - CENSUS_PARENT_LEVEL_ORDER.indexOf(b))
      .map((level) => {
        const parent = parentBoundaryOptions.find((option) => option.level === level)
        const entry = parentBoundaryCache[level]
        if (!parent || !entry || entry.state !== 'ready' || entry.data.features.length === 0) return null
        return {
          level,
          parent,
          data: entry.data,
          style: CENSUS_PARENT_LAYER_STYLES[level],
        }
      })
      .filter((view): view is ParentBoundaryView => Boolean(view))
  ), [enabledCensusParentLevels, parentBoundaryCache, parentBoundaryOptions])
  const hideBcDaChunksForParents = bcDaActive && enabledCensusParentLevels.length > 0

  const allRegions = useMemo(() => activeLayerViews.flatMap((layer) => layer.regions), [activeLayerViews])
  const selectedRegion = allRegions.find((region) => region.id === selectedId) ?? null
  const selectedRegionLayerScope = activeLayerViews.find((layer) => selectedRegion && layer.regions.some((region) => region.id === selectedRegion.id))?.key ?? null
  const regionByFocusKey = useMemo(() => (
    new globalThis.Map(activeLayerViews.flatMap((layer) => (
      layer.regions.map((region) => [polygonFocusKey({ id: region.id, scope: layer.key }), { region, scope: layer.key }] as const)
    )))
  ), [activeLayerViews])
  const selectedRegionLayerFocuses = selectedRegionLayerScope
    ? selectedPolygonFocuses.filter((focus) => focus.scope === selectedRegionLayerScope)
    : EMPTY_POLYGON_FOCUSES
  const selectedParentBoundary = findSelectedParentBoundary(enabledParentBoundaryViews, selectedParentId)
  const selectedParentBoundaryFocuses = selectedParentBoundary
    ? selectedPolygonFocuses.filter((focus) => focus.scope === selectedParentBoundary.scope)
    : EMPTY_POLYGON_FOCUSES
  const compareRegions = useMemo(
    () => compareIds.map((id) => allRegions.find((region) => region.id === id)).filter((region): region is StudyAreaRegion => Boolean(region)),
    [allRegions, compareIds],
  )
  const polygonFocusActive = Boolean(isolatedPolygonFocuses.length > 0 || hiddenPolygonFocuses.length > 0)
  const visibleLayerRegionsByKey = useMemo(() => (
    activeLayerViews.reduce<Record<string, StudyAreaRegion[]>>((regionsByKey, layer) => {
      regionsByKey[layer.key] = filterRegionsForPolygonFocus(layer.filteredRegions, layer.key, isolatedPolygonFocuses, hiddenPolygonFocuses)
      return regionsByKey
    }, {})
  ), [activeLayerViews, hiddenPolygonFocuses, isolatedPolygonFocuses])
  const allMapVisibleRegions = useMemo(() => (
    activeLayerViews.flatMap((layer) => visibleLayerRegionsByKey[layer.key] ?? layer.filteredRegions)
  ), [activeLayerViews, visibleLayerRegionsByKey])
  const layerDiffLayers = useMemo(() => activeLayerViews.slice(-2), [activeLayerViews])
  const layerDiffRegionCounts = useMemo(() => (
    layerDiffLayers.map((layer) => (visibleLayerRegionsByKey[layer.key] ?? layer.filteredRegions).length)
  ), [layerDiffLayers, visibleLayerRegionsByKey])
  const layerDiffBlockedReason = useMemo(() => {
    if (layerDiffLayers.length !== 2) return 'Select at least two active layers to diff whole layers.'
    const emptyIndex = layerDiffRegionCounts.findIndex((count) => count === 0)
    if (emptyIndex >= 0) return `${layerDiffLayers[emptyIndex].label} has no visible boundaries to diff.`
    const tooLargeIndex = layerDiffRegionCounts.findIndex((count) => count > MAX_LAYER_DIFF_FEATURES)
    if (tooLargeIndex >= 0) {
      return `${layerDiffLayers[tooLargeIndex].label} has ${formatNumber(layerDiffRegionCounts[tooLargeIndex])} visible boundaries; narrow it below ${formatNumber(MAX_LAYER_DIFF_FEATURES)} first.`
    }
    return null
  }, [layerDiffLayers, layerDiffRegionCounts])
  const layerDiffSurfaces = useMemo<[DiffSurface, DiffSurface] | null>(() => {
    if (layerDiffBlockedReason || layerDiffLayers.length !== 2) return null
    const surfaces = layerDiffLayers.map((layer) => (
      diffSurfaceFromLayer(layer, visibleLayerRegionsByKey[layer.key] ?? layer.filteredRegions)
    ))
    return surfaces[0] && surfaces[1] ? [surfaces[0], surfaces[1]] : null
  }, [layerDiffBlockedReason, layerDiffLayers, visibleLayerRegionsByKey])
  const surfaceDifference = useMemo(() => (
    compareRegions.length === 2 ? buildSurfaceDifference(compareRegions[0], compareRegions[1]) : null
  ), [compareRegions])
  const layerSurfaceDifference = useMemo(() => (
    layerDiffSurfaces ? buildSurfaceDifference(layerDiffSurfaces[0], layerDiffSurfaces[1]) : null
  ), [layerDiffSurfaces])
  const activeDifferenceSurfaces = layerDifferenceMode
    ? layerDiffSurfaces
    : surfaceDifferenceMode && compareRegions.length === 2
      ? [compareRegions[0], compareRegions[1]] as [DiffSurface, DiffSurface]
      : null
  const activeSurfaceDifference = layerDifferenceMode ? layerSurfaceDifference : surfaceDifferenceMode ? surfaceDifference : null
  const activeLoading = activeLayerViews.some((layer) => layer.loading)
  const activeErrors = activeLayerViews.filter((layer) => layer.error)
  const topLayerKey = activeLayerViews[activeLayerViews.length - 1]?.key ?? null
  const hasDbPmtilesLayer = activeLayerViews.some(isDbPmtilesLayer)
  const activeRange = useMemo(() => levelRange(allRegions), [allRegions])
  const visibleRange = useMemo(() => levelRange(allMapVisibleRegions), [allMapVisibleRegions])
  const fitRegions = useMemo(
    () => allMapVisibleRegions.filter((region) => !(region.source === 'census' && isChunkedCensusLevel(region.level))),
    [allMapVisibleRegions],
  )
  const activeSubtitle = activeLayerViews.length === 0
    ? 'No study areas selected'
    : activeLayerViews.length === 1
      ? `${activeLayerViews[0].label} - ${activeLayerViews[0].optionLabel}`
      : `${activeLayerViews.length} study areas - ${allMapVisibleRegions.length.toLocaleString()} visible boundaries${hasDbPmtilesLayer ? ' + PMTiles' : ''}`

  const boundariesShareState = useMemo<BoundariesShareState>(() => {
    const sharedSourceLevels = activeSources.reduce<Partial<Record<BoundarySource, RegionLevel>>>((levels, source) => {
      levels[source] = sourceLevels[source] ?? getDefaultLevelForSource(source)
      return levels
    }, {})
    const sharedSourceOpacities = activeSources.reduce<Partial<Record<BoundarySource, number>>>((opacities, source) => {
      opacities[source] = sourceOpacities[source] ?? 0.22
      return opacities
    }, {})

    return {
      version: 1,
      activeSources,
      sourceLevels: sharedSourceLevels,
      sourceOpacities: sharedSourceOpacities,
      enabledCensusParentLevels,
      selectedPolygonFocuses,
      isolatedPolygonFocuses,
      hiddenPolygonFocuses,
      selectedId,
      selectedParentId,
      query: query.trim() ? query : undefined,
    }
  }, [
    activeSources,
    enabledCensusParentLevels,
    hiddenPolygonFocuses,
    isolatedPolygonFocuses,
    query,
    selectedId,
    selectedParentId,
    selectedPolygonFocuses,
    sourceLevels,
    sourceOpacities,
  ])

  useEffect(() => {
    if (!shareStateReady) return

    let cancelled = false
    encodeBoundariesShareState(boundariesShareState)
      .then((token) => {
        if (cancelled || token === lastEncodedShareToken.current) return
        const url = new URL(window.location.href)
        url.searchParams.set('s', token)
        window.history.replaceState(null, '', url)
        lastEncodedShareToken.current = token
      })
      .catch(() => {
        // URL sync is best-effort; interaction should keep working if encoding fails.
      })

    return () => {
      cancelled = true
    }
  }, [boundariesShareState, shareStateReady])

  const clearPolygonFocusForScopes = useCallback((scopes: Set<string>) => {
    setSelectedPolygonFocuses((current) => current.filter((focus) => !scopes.has(focus.scope)))
    setIsolatedPolygonFocuses((current) => current.filter((focus) => !scopes.has(focus.scope)))
    setHiddenPolygonFocuses((current) => current.filter((focus) => !scopes.has(focus.scope)))
    setFitSelectedRegion(true)
    if (selectedRegionLayerScope && scopes.has(selectedRegionLayerScope)) {
      setSelectedId(null)
    }
    if (selectedPmtilesFeature && scopes.has(selectedPmtilesFeature.scope)) {
      setSelectedPmtilesFeature(null)
    }
    if (selectedParentBoundary && scopes.has(selectedParentBoundary.scope)) {
      setSelectedParentId(null)
    }
  }, [selectedParentBoundary, selectedPmtilesFeature, selectedRegionLayerScope])

  const toggleSource = useCallback((nextSource: BoundarySource) => {
    const removingSource = activeSources.includes(nextSource)
    if (removingSource) {
      const removedScope = cacheKey(nextSource, sourceLevels[nextSource] ?? getDefaultLevelForSource(nextSource))
      clearPolygonFocusForScopes(new Set([removedScope]))
    }
    setActiveSources((current) => {
      if (current.includes(nextSource)) {
        return current.filter((source) => source !== nextSource)
      }
      return [...current, nextSource]
    })
    setCompareIds([])
    setLayerDifferenceMode(false)
  }, [activeSources, clearPolygonFocusForScopes, sourceLevels])

  const handleSourcePickerOpenChange = useCallback((open: boolean) => {
    setSourcePickerOpen(open)
  }, [])

  const moveSource = useCallback((source: BoundarySource, direction: -1 | 1) => {
    setActiveSources((current) => {
      const index = current.indexOf(source)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }, [])

  const moveSourceTo = useCallback((source: BoundarySource, target: BoundarySource) => {
    if (source === target) return
    setActiveSources((current) => {
      const from = current.indexOf(source)
      const to = current.indexOf(target)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const handleVariantChange = useCallback((source: BoundarySource, nextLevel: RegionLevel) => {
    const currentLevel = sourceLevels[source] ?? getDefaultLevelForSource(source)
    if (currentLevel === nextLevel) return
    const scopesToClear = new Set([cacheKey(source, currentLevel)])
    if (source === 'census') {
      enabledCensusParentLevels.forEach((level) => scopesToClear.add(`census-parent:${level}`))
    }
    setSourceLevels((current) => ({ ...current, [source]: nextLevel }))
    if (source === 'census' && nextLevel !== BC_DA_SIMPLIFIED_LEVEL) {
      setEnabledCensusParentLevels([])
    }
    clearPolygonFocusForScopes(scopesToClear)
    setCompareIds([])
    setLayerDifferenceMode(false)
  }, [clearPolygonFocusForScopes, enabledCensusParentLevels, sourceLevels])

  // Picker "choose a level" action: add the source at the chosen level (or
  // switch its level if it is already on the map).
  const handlePickerSelectLevel = useCallback((source: BoundarySource, level: RegionLevel) => {
    if (activeSources.includes(source)) {
      handleVariantChange(source, level)
      return
    }
    setSourceLevels((current) => ({ ...current, [source]: level }))
    if (source === 'census' && level !== BC_DA_SIMPLIFIED_LEVEL) {
      setEnabledCensusParentLevels([])
    }
    setActiveSources((current) => (current.includes(source) ? current : [...current, source]))
    setCompareIds([])
    setLayerDifferenceMode(false)
  }, [activeSources, handleVariantChange])

  const handleOpacityChange = useCallback((source: BoundarySource, value: number) => {
    setSourceOpacities((current) => ({ ...current, [source]: value }))
  }, [])

  const selectPolygonFocus = useCallback((focus: PolygonFocus, additive: boolean) => {
    setSelectedPolygonFocuses((current) => (
      additive ? uniquePolygonFocuses([...current, focus]) : [focus]
    ))
  }, [])

  const removeSelectedFocus = useCallback((focus: PolygonFocus) => {
    setSelectedPolygonFocuses((current) => current.filter((candidate) => !samePolygonFocus(candidate, focus)))
    setIsolatedPolygonFocuses((current) => current.filter((candidate) => !samePolygonFocus(candidate, focus)))
    setHiddenPolygonFocuses((current) => current.filter((candidate) => !samePolygonFocus(candidate, focus)))
    if (selectedRegionLayerScope === focus.scope && selectedId === focus.id) setSelectedId(null)
    if (selectedParentBoundary?.scope === focus.scope && selectedParentId === focus.id) setSelectedParentId(null)
    if (selectedPmtilesFeature?.scope === focus.scope && selectedPmtilesFeature.id === focus.id) setSelectedPmtilesFeature(null)
  }, [selectedId, selectedParentBoundary, selectedParentId, selectedPmtilesFeature, selectedRegionLayerScope])

  const handleFeatureClick = useCallback((id: string, scope: string, event: PolygonClickMeta) => {
    selectPolygonFocus({ id, scope }, event.shiftKey)
    setFitSelectedRegion(!event.shiftKey)
    if (event.shiftKey) {
      setSelectedTrayExpanded(false)
      setSelectedId(null)
      setSelectedParentId(null)
      setSelectedPmtilesFeature(null)
    } else {
      setSelectedId(id)
      setSelectedParentId(null)
      setSelectedPmtilesFeature(null)
    }
  }, [selectPolygonFocus])

  const handleParentFeatureClick = useCallback((id: string, scope: string, event: PolygonClickMeta) => {
    selectPolygonFocus({ id, scope }, event.shiftKey)
    setFitSelectedRegion(false)
    if (event.shiftKey) {
      setSelectedTrayExpanded(false)
      setSelectedParentId(null)
      setSelectedId(null)
      setSelectedPmtilesFeature(null)
    } else {
      setSelectedParentId(id)
      setSelectedId(null)
      setSelectedPmtilesFeature(null)
    }
  }, [selectPolygonFocus])

  const handlePmtilesFeatureClick = useCallback((
    id: string,
    scope: string,
    event: PolygonClickMeta,
    properties: Record<string, unknown>,
    lngLat: { lng: number; lat: number } | null,
  ) => {
    selectPolygonFocus({ id, scope }, event.shiftKey)
    setFitSelectedRegion(false)
    setSelectedId(null)
    setSelectedParentId(null)
    if (event.shiftKey) setSelectedTrayExpanded(false)
    if (lngLat) {
      const nextFeature = {
        id,
        scope,
        lngLat,
        properties,
      }
      setPmtilesFeatureCache((current) => ({
        ...current,
        [polygonFocusKey({ id, scope })]: nextFeature,
      }))
      setSelectedPmtilesFeature(event.shiftKey ? null : nextFeature)
    }
  }, [selectPolygonFocus])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((current) => (
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current.slice(-1), id]
    ))
  }, [])

  const showLayerDiff = useCallback((id: string) => {
    setCompareIds((current) => (
      current.includes(id) ? current : [...current.slice(-1), id]
    ))
    setSurfaceDifferenceMode(true)
    setLayerDifferenceMode(false)
  }, [])

  const showWholeLayerDiff = useCallback(() => {
    if (layerDiffBlockedReason) return
    setSurfaceDifferenceMode(false)
    setLayerDifferenceMode(true)
  }, [layerDiffBlockedReason])

  const clearCompare = useCallback(() => {
    setCompareIds([])
    setSurfaceDifferenceMode(false)
    setLayerDifferenceMode(false)
  }, [])

  const isolatePolygon = useCallback((focuses: PolygonFocus[]) => {
    const targets = uniquePolygonFocuses(focuses)
    const targetScopes = polygonFocusScopes(targets)
    setFitSelectedRegion(false)
    setIsolatedPolygonFocuses((current) => uniquePolygonFocuses([
      ...current.filter((focus) => !targetScopes.has(focus.scope)),
      ...targets,
    ]))
    setHiddenPolygonFocuses((current) => current.filter((focus) => !targetScopes.has(focus.scope)))
  }, [])

	  const hidePolygon = useCallback((focuses: PolygonFocus[]) => {
	    const targets = uniquePolygonFocuses(focuses)
	    setFitSelectedRegion(false)
	    setIsolatedPolygonFocuses((current) => current.filter((focus) => !targets.some((target) => samePolygonFocus(target, focus))))
	    setHiddenPolygonFocuses((current) => (
	      uniquePolygonFocuses([...current, ...targets])
	    ))
	    setSelectedPolygonFocuses((current) => current.filter((focus) => !targets.some((target) => samePolygonFocus(target, focus))))
	    setSelectedId((current) => (targets.some((focus) => focus.id === current) ? null : current))
	    setSelectedParentId((current) => (targets.some((focus) => focus.id === current) ? null : current))
	    setSelectedPmtilesFeature((current) => (current && targets.some((focus) => samePolygonFocus(focus, current)) ? null : current))
	  }, [])

	  const clearPolygonFocus = useCallback(() => {
	    setFitSelectedRegion(false)
	    setIsolatedPolygonFocuses([])
	    setHiddenPolygonFocuses([])
	  }, [])

	  const clearSelectedFocuses = useCallback(() => {
	    setSelectedPolygonFocuses([])
	    setSelectedId(null)
	    setSelectedParentId(null)
	    setSelectedPmtilesFeature(null)
	  }, [])

	  const isolateSelectedFocuses = useCallback(() => {
	    if (selectedPolygonFocuses.length === 0) return
	    isolatePolygon(selectedPolygonFocuses)
	  }, [isolatePolygon, selectedPolygonFocuses])

	  const hideSelectedFocuses = useCallback(() => {
	    if (selectedPolygonFocuses.length === 0) return
	    hidePolygon(selectedPolygonFocuses)
	  }, [hidePolygon, selectedPolygonFocuses])

	  const selectedFocusCards = useMemo<SelectedFocusCard[]>(() => {
	    const cards: SelectedFocusCard[] = []
	    selectedPolygonFocuses.forEach((focus) => {
	      const regionMatch = regionByFocusKey.get(polygonFocusKey(focus))
	      if (regionMatch) {
	        const { region, scope } = regionMatch
	        cards.push({
	          focus,
	          title: region.name,
	          subtitle: `${sourceLabel(region.source)} · ${getStudyAreaLevelLabel(region.level)}`,
	          areaLabel: formatArea(region.areaKm2),
	          onOpen: () => {
	            setFitSelectedRegion(true)
	            setSelectedId(region.id)
	            setSelectedParentId(null)
	            setSelectedPmtilesFeature(null)
	            selectPolygonFocus({ id: region.id, scope }, true)
	          },
	        })
	        return
	      }

	      const pmtilesFeature = pmtilesFeatureCache[polygonFocusKey(focus)]
	      if (pmtilesFeature) {
	        cards.push({
	          focus,
	          title: pmtilesFeatureName(pmtilesFeature.properties),
	          subtitle: `Census boundaries · ${getStudyAreaLevelLabel(BC_DB_CHUNKED_LEVEL)}`,
	          areaLabel: formatArea(pmtilesFeatureAreaKm2(pmtilesFeature.properties)),
	          onOpen: () => {
	            setFitSelectedRegion(false)
	            setSelectedId(null)
	            setSelectedParentId(null)
	            setSelectedPmtilesFeature(pmtilesFeature)
	            selectPolygonFocus({ id: pmtilesFeature.id, scope: pmtilesFeature.scope }, true)
	          },
	        })
	        return
	      }

	      for (const view of enabledParentBoundaryViews) {
	        const scope = `census-parent:${view.level}`
	        if (focus.scope !== scope) continue
	        const feature = view.data.features.find((candidate) => polygonFeatureId(candidate) === focus.id)
	        if (!feature) continue
	        const properties = feature.properties ?? {}
	        cards.push({
	          focus,
	          title: String(properties.boundaryName ?? properties.name ?? focus.id),
	          subtitle: view.parent.label,
	          areaLabel: formatArea(Number(properties.areaKm2 ?? 0)),
	          onOpen: () => {
	            setFitSelectedRegion(false)
	            setSelectedId(null)
	            setSelectedParentId(focus.id)
	            setSelectedPmtilesFeature(null)
	            selectPolygonFocus(focus, true)
	          },
	        })
	        return
	      }
	    })
	    return cards
	  }, [enabledParentBoundaryViews, pmtilesFeatureCache, regionByFocusKey, selectPolygonFocus, selectedPolygonFocuses])

  const sidebar = (
    <MapSidebarShell
      className="h-full w-full min-w-0 border-0 shadow-none md:border-r md:shadow-xl"
      title="Boundaries"
      subtitle="Compare study-area layers"
      titleClassName="text-base"
    >
      <SidebarSection
        title="Study areas"
        actions={
          <button
            type="button"
            onClick={() => handleSourcePickerOpenChange(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="size-3.5" />
            Add
          </button>
        }
      >
        {activeSources.length === 0 ? (
          <button
            type="button"
            onClick={() => handleSourcePickerOpenChange(true)}
            className="w-full rounded-md border border-dashed bg-muted/20 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Plus className="size-3.5 text-muted-foreground" />
              Choose study areas
            </div>
            <div className="mt-1 text-xs leading-4 text-muted-foreground">
              {BOUNDARY_EXPLORER_SOURCE_OPTIONS.length} boundary sources across {STUDY_AREA_GROUP_ORDER.length}{' '}
              categories.
            </div>
          </button>
        ) : (
          <div className="space-y-1.5">
            {activeSources.map((source) => {
              const option = BOUNDARY_EXPLORER_SOURCE_OPTIONS.find((candidate) => candidate.value === source)
              const levelOptions = getLevelOptionsForSource(source)
              const selectedLevel = sourceLevels[source] ?? getDefaultLevelForSource(source)
              return (
                <div
                  key={source}
                  className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: SOURCE_COLORS[source].fill }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{option?.label ?? source}</div>
                    <div className="truncate text-xs leading-4 text-muted-foreground">
                      {getStudyAreaLevelLabel(selectedLevel)}
                      {levelOptions.length > 1 && ` · ${levelOptions.length} levels`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSource(source)}
                    aria-label={`Remove ${option?.label ?? source}`}
                    title="Remove study area"
                    className="flex size-6 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <StudyAreaSourcePicker
          open={sourcePickerOpen}
          onOpenChange={handleSourcePickerOpenChange}
          activeSources={activeSources}
          onToggleSource={toggleSource}
          sourceLevels={sourceLevels}
          onSelectLevel={handlePickerSelectLevel}
        />
      </SidebarSection>

      <SidebarSection title="Hierarchy / variant" icon={SquareStack}>
        <div className="space-y-3">
          {activeSources.length === 0 && (
            <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
              No study areas selected.
            </div>
          )}
          {activeLayerViews.length >= 2 && (
            <div className="rounded-md border bg-background p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground">Layer diff</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {layerDiffLayers.map((layer) => layer.label).join(' vs ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={showWholeLayerDiff}
                  disabled={Boolean(layerDiffBlockedReason)}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    layerDifferenceMode
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  title={layerDiffBlockedReason ?? 'Diff the two top active layers'}
                >
                  <GitCompareArrows className="size-3.5" />
                  Diff top layers
                </button>
              </div>
              {layerDiffBlockedReason && (
                <div className="mt-2 text-xs leading-4 text-muted-foreground">{layerDiffBlockedReason}</div>
              )}
            </div>
          )}
          {activeSources.map((source, index) => {
            const selectedLevel = sourceLevels[source] ?? getDefaultLevelForSource(source)
            const options = getLevelOptionsForSource(source)
            const opacity = sourceOpacities[source] ?? 0.22
            return (
              <div
                key={source}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const fromData = event.dataTransfer.getData('text/plain') as BoundarySource
                  moveSourceTo(draggedSource ?? fromData, source)
                  setDraggedSource(null)
                }}
                onDragEnd={() => setDraggedSource(null)}
                className={cn(
                  'rounded-md border bg-muted/20 p-2',
                  draggedSource === source && 'opacity-50',
                )}
              >
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span
                    draggable
                    onDragStart={(event) => {
                      setDraggedSource(source)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', source)
                    }}
                    onDragEnd={() => setDraggedSource(null)}
                    className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground active:cursor-grabbing"
                    role="button"
                    tabIndex={0}
                    aria-label={`Drag ${sourceLabel(source)} layer`}
                    title="Drag to reorder"
                  >
                    <GripVertical className="size-4" aria-hidden="true" />
                  </span>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[source].fill }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{sourceLabel(source)}</span>
                  <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                    {index === activeSources.length - 1 ? 'Top' : `Layer ${index + 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveSource(source, -1)}
                    disabled={index === 0}
                    className="flex size-6 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                    aria-label={`Move ${sourceLabel(source)} down`}
                    title="Move lower"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSource(source, 1)}
                    disabled={index === activeSources.length - 1}
                    className="flex size-6 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                    aria-label={`Move ${sourceLabel(source)} up`}
                    title="Move higher"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                </div>
                <div className="mb-2 rounded-md border bg-background p-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Transparency</span>
                    <span>{Math.round(opacity * 100)}% fill</span>
                  </div>
                  <input
                    type="range"
                    min={0.04}
                    max={0.65}
                    step={0.01}
                    value={opacity}
                    onInput={(event) => handleOpacityChange(source, Number(event.currentTarget.value))}
                    onChange={(event) => handleOpacityChange(source, Number(event.target.value))}
                    className="w-full accent-primary"
                    aria-label={`${sourceLabel(source)} fill opacity`}
                    draggable={false}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  {options.map((option) => {
                    const entry = cache[cacheKey(source, option.value)]
                    const optionChunkedLevel =
                      source === 'census' && isChunkedCensusLevel(option.value)
                        ? option.value
                        : null
                    const optionIsActiveChunked = optionChunkedLevel != null && activeCensusChunkLevel === optionChunkedLevel
                    const optionManifest = optionChunkedLevel ? censusChunkManifests[optionChunkedLevel] ?? null : null
                    const optionDetailLevel = optionIsActiveChunked
                      ? activeCensusChunkDetailLevel
                      : chooseBcDaLevel(optionManifest, mapZoom)
                    const optionRegions = optionIsActiveChunked ? censusChunkRegions : entry?.regions ?? EMPTY_REGIONS
                    const range = levelRange(optionRegions)
                    const chunkCount = optionChunkedLevel && optionDetailLevel
                      ? Object.keys(censusChunkRegionsByKey).filter((key) => key.startsWith(`${optionChunkedLevel}:${optionDetailLevel.id}:`)).length
                      : 0
                    const totalChunkCount = optionDetailLevel?.chunks.length ?? 0
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleVariantChange(source, option.value)}
                        className={cn(
                          'rounded-md border px-2.5 py-2 text-left transition-colors',
                          selectedLevel === option.value
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-background hover:bg-accent',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {optionChunkedLevel === BC_DB_CHUNKED_LEVEL
                              ? 'PMTiles'
                              : optionChunkedLevel
                              ? optionManifest
                                ? optionDetailLevel
                                  ? `${formatNumber(optionRegions.length)} / ${formatNumber(optionManifest.features)} loaded`
                                  : 'Not loaded'
                                : 'Not loaded'
                              : (entry ? `${formatNumber(entry.regions.length)} areas` : 'Not loaded')}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {optionChunkedLevel && optionDetailLevel
                            ? `Detail: ${optionDetailLevel.label} · Chunks: ${formatNumber(chunkCount)} / ${formatNumber(totalChunkCount)} · ${formatGzipMiB(optionDetailLevel.gzipBytes) ?? '--'} total`
                            : `Area range: ${entry && entry.regions.length > 0 ? `${formatArea(range.min)} - ${formatArea(range.max)}` : '--'}`}
                          {optionChunkedLevel && optionRegions.length > 0 && (
                            <> · Area range: {formatArea(range.min)} - {formatArea(range.max)}</>
                          )}
                          {option.value === BC_DA_SIMPLIFIED_LEVEL && selectedLevel === option.value && enabledCensusParentLevels.length > 0 && (
                            <> · DA hidden by parent outline</>
                          )}
                        </div>
                        {option.value === NORTH_SOUTH_CSD_LEVEL && selectedLevel === option.value && (
                          <div className="mt-2 flex flex-wrap gap-3 border-t border-border/70 pt-2 text-xs text-muted-foreground">
                            {(Object.keys(NORTH_SOUTH_CSD_COLORS) as Array<keyof typeof NORTH_SOUTH_CSD_COLORS>).map((classification) => (
                              <span key={classification} className="inline-flex items-center gap-1.5">
                                <span
                                  className="size-2.5 rounded-sm"
                                  style={{ backgroundColor: NORTH_SOUTH_CSD_COLORS[classification].fill }}
                                />
                                {classification}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </SidebarSection>

      <SidebarSection title="Area summary">
        <StatGrid
          columns={2}
          stats={[
            { label: 'Study areas', value: formatNumber(activeLayerViews.length) },
            { label: 'Visible boundaries', value: activeLoading ? '...' : `${formatNumber(allMapVisibleRegions.length)}${hasDbPmtilesLayer ? ' + PMTiles' : ''}` },
            { label: 'Total area', value: activeLoading ? '...' : formatArea(visibleRange.total || activeRange.total) },
            { label: 'Largest', value: activeLoading ? '...' : formatArea(visibleRange.max || activeRange.max) },
          ]}
        />
        <div className="mt-3 space-y-2 rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground">
          {activeLayerViews.length === 0 && (
            <div>No boundary layers selected.</div>
          )}
          {activeLayerViews.map((layer) => (
            <div key={layer.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{layer.label}</span>
              <span className="shrink-0 font-medium text-foreground">
                {layerSummaryText(layer, visibleLayerRegionsByKey, censusLoadingChunkIds.length)}
              </span>
            </div>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title="Search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="Search name, code, source, variant"
          />
        </div>
      </SidebarSection>

      <div className="pb-6">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
          <span>
            {activeLoading
              ? 'Loading boundaries'
              : polygonFocusActive
                ? `${allMapVisibleRegions.length.toLocaleString()} visible after filters${hasDbPmtilesLayer ? ' + PMTiles' : ''}`
                : `${allMapVisibleRegions.length.toLocaleString()} visible boundaries${hasDbPmtilesLayer ? ' + PMTiles' : ''}`}
          </span>
          {(compareIds.length > 0 || polygonFocusActive) && (
            <button
              type="button"
              onClick={polygonFocusActive ? clearPolygonFocus : clearCompare}
              className="hover:text-foreground"
            >
              {polygonFocusActive ? 'Clear focus' : 'Clear compare'}
            </button>
          )}
        </div>
        {activeLoading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading selected study areas
          </div>
        )}
        {activeErrors.map((layer) => (
          <div key={layer.key} className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {layer.label}: {layer.error}
          </div>
        ))}
        {!activeLoading && activeErrors.length === 0 && (
          <div className="divide-y divide-border">
            {activeLayerViews.map((layer) => (
              <div key={layer.key}>
                <div className="sticky top-[33px] z-10 border-b border-border bg-muted/80 px-4 py-2 text-xs font-semibold text-foreground backdrop-blur">
                  {isDbPmtilesLayer(layer)
                    ? `${layer.label} · ${layer.optionLabel} · PMTiles`
                    : `${layer.label} · ${layer.optionLabel} · ${layerVisibleCount(layer, visibleLayerRegionsByKey).toLocaleString()}`}
                  {polygonFocusActive && !isDbPmtilesLayer(layer) && layerVisibleCount(layer, visibleLayerRegionsByKey) !== layer.filteredRegions.length && (
                    <span className="text-muted-foreground"> / {layer.filteredRegions.length.toLocaleString()}</span>
                  )}
                </div>
                {isDbPmtilesLayer(layer) && layer.filteredRegions.length === 0 && (
                  <div className="px-4 py-3 text-xs text-muted-foreground">
                    Rendered from vector tiles. Search, list selection, and area totals are not available for this trial layer yet.
                  </div>
                )}
                {layer.filteredRegions.slice(0, 120).map((region) => {
                  const comparing = compareIds.includes(region.id)
                  return (
                    <div
                      key={region.id}
                      className={cn(
                        'px-4 py-3 transition-colors hover:bg-accent',
                        selectedId === region.id && 'bg-primary/10',
                      )}
                    >
                      <button
                        type="button"
	                        onClick={(event) => {
	                          setFitSelectedRegion(!event.shiftKey)
	                          if (event.shiftKey) {
	                            setSelectedId(null)
	                            setSelectedParentId(null)
	                            setSelectedPmtilesFeature(null)
	                          } else {
	                            setSelectedId(region.id)
	                            setSelectedParentId(null)
	                            setSelectedPmtilesFeature(null)
	                          }
	                          selectPolygonFocus({ id: region.id, scope: layer.key }, event.shiftKey)
	                        }}
                        className="w-full text-left"
                      >
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-medium text-foreground">{region.name}</span>
                          <span
                            className="mt-1 size-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: isNorthSouthCsdLayer(layer)
                                ? northSouthColor(region.feature.properties ?? {})
                                : layer.colors.fill,
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>{region.code}</span>
                          <span>{formatArea(region.areaKm2)}</span>
                        </div>
                        {region.source === 'census' && censusParentSummary(region.feature.properties ?? {}) && (
                          <div className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                            {censusParentSummary(region.feature.properties ?? {})}
                          </div>
                        )}
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                          {sourceLabel(region.source)} · {getStudyAreaLevelLabel(region.level)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCompare(region.id)}
                          className={cn(
                            'rounded border px-2 py-0.5 text-xs font-medium transition-colors',
                            comparing ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {comparing ? 'Comparing' : 'Compare'}
                        </button>
                      </div>
                    </div>
                  )
                })}
                {layer.filteredRegions.length > 120 && (
                  <div className="p-4 text-xs text-muted-foreground">
                    Showing first 120 {layer.optionLabel} results. Use search to narrow this layer.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </MapSidebarShell>
  )

  // On desktop the picker takes over the sidebar instead of opening a modal,
  // so the map stays visible while choosing sources. Mobile keeps the sheet dialog.
  const sidebarContent = !isMobile && sourcePickerOpen ? (
    <StudyAreaPickerSidebarPanel
      onClose={() => handleSourcePickerOpenChange(false)}
      activeSources={activeSources}
      onToggleSource={toggleSource}
      sourceLevels={sourceLevels}
      onSelectLevel={handlePickerSelectLevel}
    />
  ) : (
    sidebar
  )

  return (
    <MapSectionLayout
      sidebar={sidebarContent}
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={410}
      mobileInitialSheetState="half"
      selectedFeatureMobilePeek={{
        title: 'Boundaries',
        subtitle: activeSubtitle,
      }}
      >
      <Map
        center={BC_CENTER}
        zoom={5.2}
        loading={activeLoading}
        boxZoom={false}
        doubleClickZoom={false}
      >
        <MapControls position="top-right" mobilePosition="bottom-right" />
        <TrackMapBounds onBoundsChange={setMapBounds} onZoomChange={setMapZoom} />
        <FitToRegions
          regions={fitRegions}
          selectedRegion={selectedRegion}
          fitSelectedRegion={fitSelectedRegion}
          fitLayerRegions={!polygonFocusActive}
        />
        {activeLayerViews.map((layer) => {
          const focusedRegions = visibleLayerRegionsByKey[layer.key] ?? layer.filteredRegions
          const layerHiddenForParentOutlines = hideBcDaChunksForParents && isBcDaSimplifiedLayer(layer)
          const layerVisible = !layerHiddenForParentOutlines || isolatedPolygonFocuses.some((focus) => focus.scope === layer.key)
          const denseDbLayer = layer.source === 'census' && layer.level === BC_DB_CHUNKED_LEVEL
          const fillOpacity = denseDbLayer
            ? ['interpolate', ['linear'], ['zoom'], 5, 0.025, 7, 0.04, 9, 0.055, 11, Math.min(layer.opacity, 0.11), 13, Math.min(layer.opacity, 0.16)]
            : layer.opacity
          const lineWidth = denseDbLayer
            ? ['interpolate', ['linear'], ['zoom'], 5, 0.08, 7, 0.12, 9, 0.18, 11, 0.35, 13, 0.7]
            : activeLayerViews.length > 1 ? 1.1 : 0.9
          const lineOpacity = denseDbLayer ? 0.42 : 0.86
          const northSouthLayer = isNorthSouthCsdLayer(layer)
          const hoverEnabled = layer.key === topLayerKey && layerVisible && (!denseDbLayer || focusedRegions.length <= 2500)
          return (
            <Fragment key={`${activeSources.join('|')}:${layer.key}`}>
              {denseDbLayer ? (
	                <MapPmtilesFillLayer
	                  url={BC_DB_PMTILES_URL}
	                  sourceLayer={BC_DB_PMTILES_SOURCE_LAYER}
	                  fillColor={layer.colors.fill}
	                  fillOpacity={fillOpacity}
	                  lineColor={layer.colors.line}
	                  lineOpacity={lineOpacity}
	                  lineWidth={lineWidth}
	                  idProperty="id"
	                  selectedIds={selectedPolygonFocuses.filter((focus) => focus.scope === layer.key).map((focus) => focus.id)}
	                  selectionColor="#f97316"
	                  selectionWidth={3}
	                  visible={layerVisible}
	                  onFeatureClick={(id, event, properties, lngLat) => handlePmtilesFeatureClick(id, layer.key, event, properties, lngLat)}
	                  hoverHtml={hoverEnabled
	                    ? (properties) => {
	                        const parents = censusParentSummary(properties)
	                        return `<div class="min-w-48 max-w-80 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
	                          <div class="font-semibold leading-5">${escapeHtml(pmtilesFeatureName(properties))}</div>
	                          <div class="mt-1 text-muted-foreground">${escapeHtml(sourceLabel(layer.source))} &middot; ${escapeHtml(getStudyAreaLevelLabel(layer.level))}</div>
	                          <div class="mt-1 text-muted-foreground">${escapeHtml(pmtilesFeatureCode(properties))}</div>
	                          ${parents ? `<div class="mt-2 text-muted-foreground">${escapeHtml(parents)}</div>` : ''}
	                          <div class="mt-2 font-semibold">${escapeHtml(formatArea(pmtilesFeatureAreaKm2(properties)))}</div>
	                        </div>`
	                      }
	                    : undefined}
	                />
              ) : (
                <MapFillLayer
                  data={focusedRegions.length > 0 ? studyAreaRegionsToFeatureCollection(focusedRegions) : EMPTY_COLLECTION}
                  fillColor={northSouthLayer ? NORTH_SOUTH_CSD_FILL_EXPRESSION : layer.colors.fill}
                  fillOpacity={fillOpacity}
                  lineColor={northSouthLayer ? NORTH_SOUTH_CSD_LINE_EXPRESSION : layer.colors.line}
                  lineOpacity={lineOpacity}
                  lineWidth={lineWidth}
                  idProperty="boundaryId"
                  selectedIds={selectedPolygonFocuses.filter((focus) => focus.scope === layer.key).map((focus) => focus.id)}
                  selectionColor="#f97316"
                  selectionWidth={3}
                  visible={layerVisible}
                  onFeatureClick={(id, event) => handleFeatureClick(id, layer.key, event)}
                  hoverHtml={hoverEnabled
                    ? (properties) => {
                        const parents = censusParentSummary(properties)
                        const northSouth = northSouthValue(properties)
                        return `<div class="min-w-48 max-w-80 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                          <div class="font-semibold leading-5">${escapeHtml(String(properties.boundaryName ?? ''))}</div>
                          <div class="mt-1 text-muted-foreground">${escapeHtml(sourceLabel(String(properties.boundarySource ?? layer.source) as BoundarySource))} &middot; ${escapeHtml(getStudyAreaLevelLabel(String(properties.boundaryLevel ?? '')))}</div>
                          <div class="mt-1 text-muted-foreground">${escapeHtml(String(properties.boundaryCode ?? ''))}</div>
                          ${northSouth ? `<div class="mt-2 font-semibold">${escapeHtml(northSouth)}</div>` : ''}
                          ${parents ? `<div class="mt-2 text-muted-foreground">${escapeHtml(parents)}</div>` : ''}
                          <div class="mt-2 font-semibold">${escapeHtml(formatArea(Number(properties.areaKm2 ?? 0)))}</div>
                        </div>`
                      }
                    : undefined}
                />
              )}
              {isBcDaSimplifiedLayer(layer) && enabledParentBoundaryViews.map((view) => {
                const parentScope = `census-parent:${view.level}`
                return (
                  <MapFillLayer
                    key={parentScope}
                    data={filterFeatureCollectionForPolygonFocus(view.data, parentScope, isolatedPolygonFocuses, hiddenPolygonFocuses)}
                    fillColor={view.style.fill}
                    fillOpacity={0.035}
                    lineColor={view.style.line}
                    lineOpacity={0.95}
                    lineWidth={view.style.width}
                    idProperty="boundaryId"
                    selectedIds={selectedPolygonFocuses.filter((focus) => focus.scope === parentScope).map((focus) => focus.id)}
                    selectionColor="#f97316"
                    selectionWidth={3.2}
                    onFeatureClick={(id, event) => handleParentFeatureClick(id, parentScope, event)}
                    hoverHtml={(properties) => (
                      `<div class="min-w-44 max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                        <div class="font-semibold leading-5">${escapeHtml(String(properties.boundaryName ?? properties.name ?? ''))}</div>
                        <div class="mt-1 text-muted-foreground">${escapeHtml(String(properties.boundaryCode ?? properties.code ?? ''))}</div>
                        <div class="mt-2 font-semibold">${escapeHtml(formatArea(Number(properties.areaKm2 ?? 0)))}</div>
                      </div>`
                    )}
                  />
                )
              })}
            </Fragment>
          )
        })}
        {activeSurfaceDifference && activeDifferenceSurfaces && (
          <>
            <MapFillLayer
              data={singleFeatureCollection(activeSurfaceDifference.onlyA)}
              fillColor="#22c55e"
              fillOpacity={0.38}
              lineColor="#15803d"
              lineOpacity={0.95}
              lineWidth={1.3}
              idProperty="boundaryId"
              hoverHtml={() => (
                `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <div class="font-semibold">Only ${escapeHtml(activeDifferenceSurfaces[0].name)}</div>
                  <div class="mt-1">${escapeHtml(formatArea(activeSurfaceDifference.onlyAKm2))}</div>
                </div>`
              )}
            />
            <MapFillLayer
              data={singleFeatureCollection(activeSurfaceDifference.onlyB)}
              fillColor="#38bdf8"
              fillOpacity={0.38}
              lineColor="#0284c7"
              lineOpacity={0.95}
              lineWidth={1.3}
              idProperty="boundaryId"
              hoverHtml={() => (
                `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <div class="font-semibold">Only ${escapeHtml(activeDifferenceSurfaces[1].name)}</div>
                  <div class="mt-1">${escapeHtml(formatArea(activeSurfaceDifference.onlyBKm2))}</div>
                </div>`
              )}
            />
            <MapFillLayer
              data={singleFeatureCollection(activeSurfaceDifference.overlap)}
              fillColor="#f59e0b"
              fillOpacity={0.58}
              lineColor="#b45309"
              lineOpacity={1}
              lineWidth={1.6}
              idProperty="boundaryId"
              hoverHtml={() => (
                `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <div class="font-semibold">Overlap</div>
                  <div class="mt-1">${escapeHtml(formatArea(activeSurfaceDifference.overlapKm2))}</div>
                </div>`
              )}
            />
          </>
        )}
	        {selectedRegion && (
	          <MapPopup
	            key={`region:${selectedRegion.id}`}
            longitude={(selectedRegion.bounds[0] + selectedRegion.bounds[2]) / 2}
            latitude={(selectedRegion.bounds[1] + selectedRegion.bounds[3]) / 2}
            closeOnClick={false}
            onClose={() => {
              setSelectedId(null)
            }}
          >
            <div className="min-w-56 text-sm">
              <div className="font-semibold text-foreground">{selectedRegion.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{selectedRegion.code}</div>
              {selectedRegion.source === 'census' && censusParentRows(selectedRegion.feature.properties ?? {}).length > 0 && (
                <div className="mt-3 space-y-1.5 rounded border bg-muted/30 p-2 text-xs">
                  {censusParentRows(selectedRegion.feature.properties ?? {}).map((row) => (
                    <div key={row.label} className="flex items-start justify-between gap-3">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="text-right font-medium text-foreground">
                        {String(row.name ?? row.code)}
                        {Boolean(row.code && row.name) && <span className="ml-1 text-muted-foreground">({String(row.code)})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">Study area</div>
                  <div className="font-medium text-foreground">{sourceLabel(selectedRegion.source)}</div>
                </div>
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">Hierarchy / variant</div>
                  <div className="font-medium text-foreground">{getStudyAreaLevelLabel(selectedRegion.level)}</div>
                </div>
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">Area</div>
                  <div className="font-medium text-foreground">{formatArea(selectedRegion.areaKm2)}</div>
                </div>
                {northSouthValue(selectedRegion.feature.properties ?? {}) && (
                  <div className="rounded border bg-muted/30 p-2">
                    <div className="text-xs text-muted-foreground">North / South</div>
                    <div className="font-medium text-foreground">
                      {northSouthValue(selectedRegion.feature.properties ?? {})}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggleCompare(selectedRegion.id)}
                  className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
                >
                  <ChevronsUpDown className="size-3.5" />
                  {compareIds.includes(selectedRegion.id) ? 'Remove from compare' : 'Add to compare'}
                </button>
                <button
                  type="button"
                  onClick={() => showLayerDiff(selectedRegion.id)}
                  disabled={compareIds.length === 0 && !compareIds.includes(selectedRegion.id)}
                  className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  title={compareIds.length === 0 ? 'Add one boundary to compare first' : 'Show selected-boundary difference'}
                >
                  <GitCompareArrows className="size-3.5" />
                  Boundary diff
                </button>
              </div>
              {selectedRegionLayerScope && (
                <PolygonFocusControls
                  polygonId={selectedRegion.id}
                  polygonScope={selectedRegionLayerScope}
                  targetFocuses={selectedRegionLayerFocuses}
                  focusActive={polygonFocusActive}
                  onIsolate={isolatePolygon}
                  onHide={hidePolygon}
                  onClear={clearPolygonFocus}
                />
              )}
	            </div>
	          </MapPopup>
	        )}
	        {selectedPmtilesFeature && (
	          <MapPopup
	            key={`pmtiles:${selectedPmtilesFeature.id}`}
	            longitude={selectedPmtilesFeature.lngLat.lng}
	            latitude={selectedPmtilesFeature.lngLat.lat}
	            closeOnClick={false}
	            onClose={() => {
	              setSelectedPmtilesFeature(null)
	            }}
	          >
	            <div className="min-w-56 text-sm">
	              <div className="font-semibold text-foreground">{pmtilesFeatureName(selectedPmtilesFeature.properties)}</div>
	              <div className="mt-1 text-xs text-muted-foreground">{pmtilesFeatureCode(selectedPmtilesFeature.properties)}</div>
	              {censusParentRows(selectedPmtilesFeature.properties).length > 0 && (
	                <div className="mt-3 space-y-1.5 rounded border bg-muted/30 p-2 text-xs">
	                  {censusParentRows(selectedPmtilesFeature.properties).map((row) => (
	                    <div key={row.label} className="flex items-start justify-between gap-3">
	                      <span className="text-muted-foreground">{row.label}</span>
	                      <span className="text-right font-medium text-foreground">
	                        {String(row.name ?? row.code)}
	                        {Boolean(row.code && row.name) && <span className="ml-1 text-muted-foreground">({String(row.code)})</span>}
	                      </span>
	                    </div>
	                  ))}
	                </div>
	              )}
	              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
	                <div className="rounded border bg-muted/30 p-2">
	                  <div className="text-xs text-muted-foreground">Study area</div>
	                  <div className="font-medium text-foreground">Census boundaries</div>
	                </div>
	                <div className="rounded border bg-muted/30 p-2">
	                  <div className="text-xs text-muted-foreground">Hierarchy / variant</div>
	                  <div className="font-medium text-foreground">{getStudyAreaLevelLabel(BC_DB_CHUNKED_LEVEL)}</div>
	                </div>
	                <div className="rounded border bg-muted/30 p-2">
	                  <div className="text-xs text-muted-foreground">Area</div>
	                  <div className="font-medium text-foreground">{formatArea(pmtilesFeatureAreaKm2(selectedPmtilesFeature.properties))}</div>
	                </div>
	              </div>
	              <PolygonFocusControls
	                polygonId={selectedPmtilesFeature.id}
	                polygonScope={selectedPmtilesFeature.scope}
	                targetFocuses={selectedPolygonFocuses.filter((focus) => focus.scope === selectedPmtilesFeature.scope)}
	                focusActive={polygonFocusActive}
	                onIsolate={isolatePolygon}
	                onHide={hidePolygon}
	                onClear={clearPolygonFocus}
	              />
	            </div>
	          </MapPopup>
	        )}
	        {selectedParentBoundary && (
          <MapPopup
            key={`parent:${selectedParentBoundary.id}`}
            longitude={(selectedParentBoundary.bounds[0] + selectedParentBoundary.bounds[2]) / 2}
            latitude={(selectedParentBoundary.bounds[1] + selectedParentBoundary.bounds[3]) / 2}
            closeOnClick={false}
            onClose={() => {
              setSelectedParentId(null)
            }}
          >
            <div className="min-w-56 text-sm">
              <div className="font-semibold text-foreground">{selectedParentBoundary.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{selectedParentBoundary.code}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">Boundary</div>
                  <div className="font-medium text-foreground">{selectedParentBoundary.label}</div>
                </div>
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">Area</div>
                  <div className="font-medium text-foreground">{formatArea(selectedParentBoundary.areaKm2)}</div>
                </div>
              </div>
              <PolygonFocusControls
                polygonId={selectedParentBoundary.id}
                polygonScope={selectedParentBoundary.scope}
                targetFocuses={selectedParentBoundaryFocuses}
                focusActive={polygonFocusActive}
                onIsolate={isolatePolygon}
                onHide={hidePolygon}
                onClear={clearPolygonFocus}
              />
            </div>
          </MapPopup>
        )}
	      </Map>
	
	      {selectedFocusCards.length > 0 && compareRegions.length === 0 && !layerDifferenceMode && (
	        <div className="absolute bottom-4 left-3 right-3 z-20 max-w-full rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur sm:left-4 sm:right-4">
	          <div className={cn('flex flex-wrap items-center justify-between gap-2 p-2.5', selectedTrayExpanded && 'border-b')}>
	            <button
	              type="button"
	              onClick={() => setSelectedTrayExpanded((current) => !current)}
	              className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
	              aria-expanded={selectedTrayExpanded}
	            >
	              <SquareStack className="size-4 shrink-0 text-muted-foreground" />
	              <h2 className="truncate text-sm font-semibold">{selectedFocusCards.length} selected boundaries</h2>
	              <ChevronUp className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', !selectedTrayExpanded && 'rotate-180')} />
	            </button>
	            <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1">
	              <button
	                type="button"
	                onClick={isolateSelectedFocuses}
	                className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
	                title={`Show only ${selectedFocusCards.length} selected boundaries`}
	              >
	                <Focus className="size-3.5" />
	                <span className="hidden sm:inline">Show only</span>
	              </button>
	              <button
	                type="button"
	                onClick={hideSelectedFocuses}
	                className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
	                title={`Exclude ${selectedFocusCards.length} selected boundaries`}
	              >
	                <EyeOff className="size-3.5" />
	                <span className="hidden sm:inline">Exclude</span>
	              </button>
	              <button
	                type="button"
	                onClick={clearSelectedFocuses}
	                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
	                aria-label="Clear selected boundaries"
	                title="Clear selected boundaries"
	              >
	                <X className="size-4" />
	              </button>
	            </div>
	          </div>
	          {selectedTrayExpanded && (
	            <div className="grid max-h-48 gap-2 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-3">
	              {selectedFocusCards.map((card) => (
	                <div key={polygonFocusKey(card.focus)} className="group relative rounded-md border bg-background p-3">
	                  <button
	                    type="button"
	                    onClick={card.onOpen}
	                    className="block w-full pr-7 text-left"
	                  >
	                    <div className="line-clamp-1 text-sm font-medium text-foreground">{card.title}</div>
	                    <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{card.subtitle}</div>
	                    {card.areaLabel && (
	                      <div className="mt-3 flex items-center justify-between text-xs">
	                        <span className="text-muted-foreground">Area</span>
	                        <span className="font-semibold text-foreground">{card.areaLabel}</span>
	                      </div>
	                    )}
	                  </button>
	                  <button
	                    type="button"
	                    onClick={() => removeSelectedFocus(card.focus)}
	                    className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
	                    aria-label={`Remove ${card.title}`}
	                  >
	                    <X className="size-3.5" />
	                  </button>
	                </div>
	              ))}
	            </div>
	          )}
	        </div>
	      )}

	      {(compareRegions.length > 0 || layerDifferenceMode) && (
	        <div className="absolute bottom-4 left-1/2 z-20 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              <h2 className="truncate text-sm font-semibold">
                {layerDifferenceMode ? 'Diff active layers' : 'Compare selected boundaries'}
              </h2>
            </div>
            <button
              type="button"
              onClick={clearCompare}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear comparison"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="border-b p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">Layer diff</div>
                <div className="text-xs text-muted-foreground">
                  {layerDifferenceMode
                    ? 'Shows overlap and area unique to each whole active layer.'
                    : 'Shows overlap and area unique to each selected boundary.'}
                </div>
              </div>
              <button
                type="button"
                disabled={layerDifferenceMode ? !layerSurfaceDifference : compareRegions.length !== 2}
                onClick={layerDifferenceMode ? () => setLayerDifferenceMode(false) : () => setSurfaceDifferenceMode((current) => !current)}
                className={cn(
                  'h-8 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  (layerDifferenceMode || (surfaceDifferenceMode && compareRegions.length === 2))
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {layerDifferenceMode || (surfaceDifferenceMode && compareRegions.length === 2) ? 'Hide diff' : 'Show diff'}
              </button>
            </div>
            {!layerDifferenceMode && compareRegions.length !== 2 && (
              <div className="mt-2 text-xs text-muted-foreground">Select exactly two areas to enable surface difference mode.</div>
            )}
            {layerDifferenceMode && !layerSurfaceDifference && (
              <div className="mt-2 text-xs text-muted-foreground">{layerDiffBlockedReason ?? 'Unable to dissolve one of the selected layers.'}</div>
            )}
            {activeSurfaceDifference && activeDifferenceSurfaces && (
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded border bg-amber-500/10 p-2">
                  <div className="text-xs text-muted-foreground">Overlap</div>
                  <div className="font-semibold text-foreground">{formatArea(activeSurfaceDifference.overlapKm2)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {Math.round(activeSurfaceDifference.aShare * 100)}% of A · {Math.round(activeSurfaceDifference.bShare * 100)}% of B
                  </div>
                </div>
                <div className="rounded border bg-green-500/10 p-2">
                  <div className="text-xs text-muted-foreground">Only A</div>
                  <div className="font-semibold text-foreground">{formatArea(activeSurfaceDifference.onlyAKm2)}</div>
                  <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{activeDifferenceSurfaces[0].name}</div>
                </div>
                <div className="rounded border bg-sky-500/10 p-2">
                  <div className="text-xs text-muted-foreground">Only B</div>
                  <div className="font-semibold text-foreground">{formatArea(activeSurfaceDifference.onlyBKm2)}</div>
                  <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{activeDifferenceSurfaces[1].name}</div>
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {layerDifferenceMode && activeDifferenceSurfaces ? activeDifferenceSurfaces.map((surface, index) => (
              <div
                key={surface.id}
                className="rounded-md border bg-background p-3 text-left"
              >
                <div className="line-clamp-1 text-sm font-medium text-foreground">{surface.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">Layer {index === 0 ? 'A' : 'B'} dissolved surface</div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Area</span>
                  <span className="font-semibold text-foreground">{formatArea(surface.areaKm2)}</span>
                </div>
              </div>
            )) : compareRegions.map((region) => (
              <button
                key={region.id}
                type="button"
                onClick={() => {
                  setFitSelectedRegion(true)
                  setSelectedId(region.id)
                }}
                className="rounded-md border bg-background p-3 text-left transition-colors hover:bg-accent"
              >
                <div className="line-clamp-1 text-sm font-medium text-foreground">{region.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{sourceLabel(region.source)} · {getStudyAreaLevelLabel(region.level)}</div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Area</span>
                  <span className="font-semibold text-foreground">{formatArea(region.areaKm2)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </MapSectionLayout>
  )
}

export default DevBoundaries
