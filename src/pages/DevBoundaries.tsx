import area from '@turf/area'
import bbox from '@turf/bbox'
import difference from '@turf/difference'
import intersect from '@turf/intersect'
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, GripVertical, Layers, Loader2, Search, SquareStack, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map, MapControls, MapPopup, useMap } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MapSidebarShell, SidebarSection, StatGrid } from '@/components/ui/map-panels'
import {
  BOUNDARY_SOURCE_OPTIONS,
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  getStudyAreaLevelLabel,
  loadStudyAreaRegions,
  type BoundarySource,
  type RegionLevel,
  type StudyAreaRegion,
} from '@/lib/studyArea'
import { cn } from '@/lib/utils'

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

type BoundaryBbox = [number, number, number, number]

interface BcDaChunkManifest {
  generatedAt: string
  tolerance: number
  features: number
  rawBytes: number
  gzipBytes: number
  levels?: BcDaChunkLevel[]
  chunks: Array<{
    id: string
    path: string
    bbox: BoundaryBbox
    featureCount: number
    rawBytes: number
    gzipBytes: number
  }>
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

const BC_CENTER: [number, number] = [-124.4, 53.9]
const BC_DA_SIMPLIFIED_LEVEL: RegionLevel = 'bcDaSimplified'
const BC_DA_CHUNK_BASE_PATH = '/data/census/bc-da-simplified'
const BC_DA_CHUNK_MANIFEST_PATH = `${BC_DA_CHUNK_BASE_PATH}/manifest.json`
const EMPTY_REGIONS: StudyAreaRegion[] = []
const EMPTY_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> = {
  type: 'FeatureCollection',
  features: [],
}

const DEFAULT_SOURCE_LEVELS = BOUNDARY_SOURCE_OPTIONS.reduce<Record<BoundarySource, RegionLevel>>((acc, option) => {
  acc[option.value] = getDefaultLevelForSource(option.value)
  return acc
}, {} as Record<BoundarySource, RegionLevel>)

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
  nrAdmin: { fill: '#64748b', line: '#334155' },
  uwr: { fill: '#84cc16', line: '#4d7c0f' },
  crownTenure: { fill: '#a855f7', line: '#7e22ce' },
  rangeTenure: { fill: '#f97316', line: '#c2410c' },
  mineralTenure: { fill: '#eab308', line: '#a16207' },
  walkabilityCommunity: { fill: '#06b6d4', line: '#0e7490' },
}

function cacheKey(source: BoundarySource, level: RegionLevel) {
  return `${source}:${level}`
}

function isBcDaSimplifiedLayer(layer: ActiveLayer) {
  return layer.source === 'census' && layer.level === BC_DA_SIMPLIFIED_LEVEL
}

function bboxesIntersect(a: BoundaryBbox, b: BoundaryBbox) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function chunkUrl(path: string) {
  return path.startsWith('/') ? path : `${BC_DA_CHUNK_BASE_PATH}/${path}`
}

function getBcDaManifestLevels(manifest: BcDaChunkManifest | null): BcDaChunkLevel[] {
  if (!manifest) return []
  if (manifest.levels?.length) return manifest.levels
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
  return levels.find((level) => zoom >= level.minZoom && zoom < level.maxZoom) ?? levels[levels.length - 1] ?? null
}

function formatArea(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--'
  if (value >= 1000) return `${Math.round(value).toLocaleString()} km²`
  if (value >= 10) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} km²`
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} km²`
}

function formatNumber(value: number) {
  return value.toLocaleString()
}

function sourceLabel(source: BoundarySource) {
  return BOUNDARY_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source
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

function featureCollection(regions: StudyAreaRegion[]): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => ({
      ...region.feature,
      properties: {
        ...region.feature.properties,
        id: region.id,
        boundaryId: region.id,
        boundaryName: region.name,
        boundaryCode: region.code,
        boundaryLevel: region.level,
        boundarySource: region.source,
        areaKm2: region.areaKm2,
      },
    })),
  }
}

function singleFeatureCollection(
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  return feature ? { type: 'FeatureCollection', features: [feature] } : EMPTY_COLLECTION
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

function mapBcDaChunkFeatureToRegion(
  rawFeature: GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>,
): StudyAreaRegion | null {
  if (!rawFeature.geometry || (rawFeature.geometry.type !== 'Polygon' && rawFeature.geometry.type !== 'MultiPolygon')) {
    return null
  }

  const feature = rawFeature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>
  const properties = feature.properties ?? {}
  const code = String(properties.boundaryCode ?? properties.DAUID ?? properties.id ?? '').trim()
  if (!code) return null

  const displayName = String(properties.boundaryName ?? properties.name ?? `DA ${code}`).trim() || `DA ${code}`
  const areaKm2 = Number(properties.areaKm2 ?? area(feature) / 1_000_000)
  const bounds = bbox(feature) as BoundaryBbox

  return {
    id: `census:${BC_DA_SIMPLIFIED_LEVEL}:${code}`,
    code,
    name: displayName,
    source: 'census',
    level: BC_DA_SIMPLIFIED_LEVEL,
    feature,
    bounds,
    areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0,
  } satisfies StudyAreaRegion
}

function buildSurfaceDifference(a: StudyAreaRegion, b: StudyAreaRegion): SurfaceDifference {
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

function FitToRegions({ regions, selectedRegion }: { regions: StudyAreaRegion[]; selectedRegion: StudyAreaRegion | null }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!isLoaded || !map) return
    const target = selectedRegion?.feature ?? (regions.length > 0 ? featureCollection(regions) : null)
    if (!target) return
    const bounds = bbox(target as never) as [number, number, number, number]
    map.fitBounds(bounds, {
      padding: selectedRegion ? 96 : 48,
      duration: 650,
      maxZoom: selectedRegion ? 11 : 7,
    })
  }, [isLoaded, map, regions, selectedRegion])

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

function DevBoundaries() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [activeSources, setActiveSources] = useState<BoundarySource[]>(['cityCommunity'])
  const [sourceLevels, setSourceLevels] = useState<Record<BoundarySource, RegionLevel>>(() => DEFAULT_SOURCE_LEVELS)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [cache, setCache] = useState<Record<string, BoundaryCacheEntry>>({})
  const [mapBounds, setMapBounds] = useState<BoundaryBbox | null>(null)
  const [mapZoom, setMapZoom] = useState(5.2)
  const [bcDaManifest, setBcDaManifest] = useState<BcDaChunkManifest | null>(null)
  const [bcDaChunks, setBcDaChunks] = useState<Record<string, StudyAreaRegion[]>>({})
  const [bcDaError, setBcDaError] = useState<string | null>(null)
  const [bcDaLoadingChunkIds, setBcDaLoadingChunkIds] = useState<string[]>([])
  const bcDaRequestedChunkIds = useRef(new Set<string>())
  const [surfaceDifferenceMode, setSurfaceDifferenceMode] = useState(false)
  const [sourceOpacities, setSourceOpacities] = useState<Record<BoundarySource, number>>(() => (
    BOUNDARY_SOURCE_OPTIONS.reduce<Record<BoundarySource, number>>((acc, option) => {
      acc[option.value] = 0.22
      return acc
    }, {} as Record<BoundarySource, number>)
  ))
  const [draggedSource, setDraggedSource] = useState<BoundarySource | null>(null)

  const activeLayers = useMemo<ActiveLayer[]>(() => (
    activeSources.map((source) => {
      const level = sourceLevels[source] ?? getDefaultLevelForSource(source)
      return { source, level, key: cacheKey(source, level) }
    })
  ), [activeSources, sourceLevels])

  const bcDaActive = activeLayers.some(isBcDaSimplifiedLayer)
  const bcDaLevel = useMemo(() => chooseBcDaLevel(bcDaManifest, mapZoom), [bcDaManifest, mapZoom])

  useEffect(() => {
    const layersToLoad = activeLayers.filter((layer) => !isBcDaSimplifiedLayer(layer) && !cache[layer.key])
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
      loadStudyAreaRegions(layer.source, layer.level)
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
    if (!bcDaActive || bcDaManifest || bcDaError) return

    const controller = new AbortController()
    fetch(BC_DA_CHUNK_MANIFEST_PATH, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch ${BC_DA_CHUNK_MANIFEST_PATH}: ${response.status}`)
        }
        return response.json() as Promise<BcDaChunkManifest>
      })
      .then((manifest) => {
        setBcDaManifest(manifest)
        setBcDaError(null)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return
        setBcDaError((err as Error).message || 'Unable to load BC DA chunk manifest.')
      })

    return () => controller.abort()
  }, [bcDaActive, bcDaError, bcDaManifest])

  useEffect(() => {
    if (!bcDaActive || !bcDaLevel || !mapBounds) return

    const chunksToLoad = bcDaLevel.chunks
      .filter((chunk) => bboxesIntersect(chunk.bbox, mapBounds))
      .filter((chunk) => {
        const key = `${bcDaLevel.id}:${chunk.id}`
        return !bcDaChunks[key] && !bcDaRequestedChunkIds.current.has(key)
      })

    if (chunksToLoad.length === 0) return

    const chunkKeys = chunksToLoad.map((chunk) => `${bcDaLevel.id}:${chunk.id}`)
    chunkKeys.forEach((key) => bcDaRequestedChunkIds.current.add(key))
    setBcDaLoadingChunkIds((current) => Array.from(new Set([...current, ...chunkKeys])))

    chunksToLoad.forEach((chunk) => {
      const chunkKey = `${bcDaLevel.id}:${chunk.id}`
      fetch(chunkUrl(chunk.path))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch ${chunk.path}: ${response.status}`)
          }
          return response.json() as Promise<BcDaChunkFeatureCollection>
        })
        .then((collection) => {
          const regions = collection.features
            .map((feature) => mapBcDaChunkFeatureToRegion(feature))
            .filter((region): region is StudyAreaRegion => region !== null)
            .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))

          setBcDaChunks((current) => ({ ...current, [chunkKey]: regions }))
        })
        .catch((err) => {
          bcDaRequestedChunkIds.current.delete(chunkKey)
          setBcDaError((err as Error).message || `Unable to load ${chunk.path}.`)
        })
        .finally(() => {
          setBcDaLoadingChunkIds((current) => current.filter((id) => id !== chunkKey))
        })
    })
  }, [bcDaActive, bcDaChunks, bcDaLevel, mapBounds])

  const bcDaRegions = useMemo(() => (
    Object.entries(bcDaChunks)
      .filter(([key]) => key.startsWith(`${bcDaLevel?.id ?? ''}:`))
      .flatMap(([, regions]) => regions)
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
  ), [bcDaChunks, bcDaLevel?.id])

  const activeLayerViews = useMemo<ActiveLayerView[]>(() => {
    const term = query.trim().toLowerCase()
    return activeLayers.map((layer) => {
      const chunkedLayer = isBcDaSimplifiedLayer(layer)
      const entry = chunkedLayer
        ? {
            regions: bcDaRegions,
            state: bcDaError ? 'error' : 'ready',
            error: bcDaError ?? undefined,
          } satisfies BoundaryCacheEntry
        : cache[layer.key]
      const regions = chunkedLayer ? bcDaRegions : entry?.regions ?? EMPTY_REGIONS
      const filteredRegions = term
        ? regions.filter((region) => (
            region.name.toLowerCase().includes(term) ||
            region.code.toLowerCase().includes(term) ||
            sourceLabel(region.source).toLowerCase().includes(term) ||
            getStudyAreaLevelLabel(region.level).toLowerCase().includes(term)
          ))
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
        loading: chunkedLayer
          ? regions.length === 0 && !bcDaError && (!bcDaManifest || bcDaLoadingChunkIds.length > 0)
          : !entry || entry.state === 'loading',
        error: entry?.state === 'error' ? entry.error : undefined,
      }
    })
  }, [activeLayers, bcDaError, bcDaLoadingChunkIds.length, bcDaManifest, bcDaRegions, cache, query, sourceOpacities])

  const allRegions = useMemo(() => activeLayerViews.flatMap((layer) => layer.regions), [activeLayerViews])
  const allFilteredRegions = useMemo(() => activeLayerViews.flatMap((layer) => layer.filteredRegions), [activeLayerViews])
  const selectedRegion = allRegions.find((region) => region.id === selectedId) ?? null
  const compareRegions = useMemo(
    () => compareIds.map((id) => allRegions.find((region) => region.id === id)).filter((region): region is StudyAreaRegion => Boolean(region)),
    [allRegions, compareIds],
  )
  const surfaceDifference = useMemo(() => (
    compareRegions.length === 2 ? buildSurfaceDifference(compareRegions[0], compareRegions[1]) : null
  ), [compareRegions])
  const activeLoading = activeLayerViews.some((layer) => layer.loading)
  const activeErrors = activeLayerViews.filter((layer) => layer.error)
  const topLayerKey = activeLayerViews[activeLayerViews.length - 1]?.key ?? null
  const activeRange = useMemo(() => levelRange(allRegions), [allRegions])
  const visibleRange = useMemo(() => levelRange(allFilteredRegions), [allFilteredRegions])
  const fitRegions = useMemo(
    () => allFilteredRegions.filter((region) => region.level !== BC_DA_SIMPLIFIED_LEVEL),
    [allFilteredRegions],
  )
  const activeSubtitle = activeLayerViews.length === 1
    ? `${activeLayerViews[0].label} - ${activeLayerViews[0].optionLabel}`
    : `${activeLayerViews.length} study areas - ${allFilteredRegions.length.toLocaleString()} visible boundaries`

  const sourceGroups = useMemo(() => (
    BOUNDARY_SOURCE_OPTIONS.reduce<Record<string, typeof BOUNDARY_SOURCE_OPTIONS>>((groups, option) => {
      const group = option.group ?? 'Other'
      groups[group] = groups[group] ?? []
      groups[group].push(option)
      return groups
    }, {})
  ), [])

  const toggleSource = useCallback((nextSource: BoundarySource) => {
    setActiveSources((current) => {
      if (current.includes(nextSource)) {
        if (current.length === 1) return current
        return current.filter((source) => source !== nextSource)
      }
      return [...current, nextSource]
    })
    setSelectedId(null)
    setCompareIds([])
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
    setSourceLevels((current) => ({ ...current, [source]: nextLevel }))
    setSelectedId(null)
    setCompareIds([])
  }, [])

  const handleOpacityChange = useCallback((source: BoundarySource, value: number) => {
    setSourceOpacities((current) => ({ ...current, [source]: value }))
  }, [])

  const handleFeatureClick = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((current) => (
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current.slice(-2), id]
    ))
  }, [])

  const clearCompare = useCallback(() => {
    setCompareIds([])
    setSurfaceDifferenceMode(false)
  }, [])

  const sidebar = (
    <MapSidebarShell
      className="h-full w-full min-w-0 border-0 shadow-none md:w-[410px] md:border-r md:shadow-xl"
      title="Boundaries"
      subtitle="Compare study-area layers"
      titleClassName="text-base"
    >
      <SidebarSection title="Study areas">
        <div className="space-y-3">
          {Object.entries(sourceGroups).map(([group, options]) => (
            <div key={group} className="space-y-1.5">
              <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                {group}
              </div>
              {options.map((option) => {
                const active = activeSources.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleSource(option.value)}
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                    )}
                    aria-pressed={active}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{option.label}</div>
                        <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{option.description}</div>
                      </div>
                      {active && <Check className="size-3.5 shrink-0 text-primary" />}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title="Hierarchy / variant" icon={SquareStack}>
        <div className="space-y-3">
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
                  <span className="rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
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
                    const chunkedOption = source === 'census' && option.value === BC_DA_SIMPLIFIED_LEVEL
                    const optionRegions = chunkedOption ? bcDaRegions : entry?.regions ?? EMPTY_REGIONS
                    const range = levelRange(optionRegions)
                    const chunkCount = bcDaLevel ? Object.keys(bcDaChunks).filter((key) => key.startsWith(`${bcDaLevel.id}:`)).length : 0
                    const totalChunkCount = bcDaLevel?.chunks.length ?? 0
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
                          <span className="text-[10px] text-muted-foreground">
                            {chunkedOption
                              ? (bcDaManifest ? `${formatNumber(optionRegions.length)} / ${formatNumber(bcDaManifest.features)} loaded` : 'Not loaded')
                              : (entry ? `${formatNumber(entry.regions.length)} areas` : 'Not loaded')}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {chunkedOption && bcDaLevel
                            ? `Detail: ${bcDaLevel.label} · Chunks: ${formatNumber(chunkCount)} / ${formatNumber(totalChunkCount)} · ${formatNumber(Math.round(bcDaLevel.gzipBytes / 1024 / 1024))} MiB gzip total`
                            : `Area range: ${entry && entry.regions.length > 0 ? `${formatArea(range.min)} - ${formatArea(range.max)}` : '--'}`}
                          {chunkedOption && optionRegions.length > 0 && (
                            <> · Area range: {formatArea(range.min)} - {formatArea(range.max)}</>
                          )}
                        </div>
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
            { label: 'Visible boundaries', value: activeLoading ? '...' : formatNumber(allFilteredRegions.length) },
            { label: 'Total area', value: activeLoading ? '...' : formatArea(visibleRange.total || activeRange.total) },
            { label: 'Largest', value: activeLoading ? '...' : formatArea(visibleRange.max || activeRange.max) },
          ]}
        />
        <div className="mt-3 space-y-2 rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground">
          {activeLayerViews.map((layer) => (
            <div key={layer.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">{layer.label}</span>
              <span className="shrink-0 font-medium text-foreground">
                {layer.loading
                  ? 'Loading'
                  : `${formatNumber(layer.filteredRegions.length)} ${layer.optionLabel}${isBcDaSimplifiedLayer(layer) && bcDaLoadingChunkIds.length > 0 ? ` · ${bcDaLoadingChunkIds.length} loading` : ''}`}
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
          <span>{activeLoading ? 'Loading boundaries' : `${allFilteredRegions.length.toLocaleString()} visible boundaries`}</span>
          {compareIds.length > 0 && (
            <button type="button" onClick={clearCompare} className="hover:text-foreground">
              Clear compare
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
                  {layer.label} · {layer.optionLabel} · {layer.filteredRegions.length.toLocaleString()}
                </div>
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
                      <button type="button" onClick={() => setSelectedId(region.id)} className="w-full text-left">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="line-clamp-1 text-sm font-medium text-foreground">{region.name}</span>
                          <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: layer.colors.fill }} />
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>{region.code}</span>
                          <span>{formatArea(region.areaKm2)}</span>
                        </div>
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {sourceLabel(region.source)} · {getStudyAreaLevelLabel(region.level)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCompare(region.id)}
                          className={cn(
                            'rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
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

  return (
    <MapSectionLayout
      sidebar={sidebar}
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={410}
      mobileInitialSheetState="half"
      selectedFeatureMobilePeek={{
        title: 'Boundaries',
        subtitle: activeSubtitle,
      }}
      >
      <Map center={BC_CENTER} zoom={5.2} loading={activeLoading}>
        <MapControls position="top-right" mobilePosition="bottom-right" />
        <TrackMapBounds onBoundsChange={setMapBounds} onZoomChange={setMapZoom} />
        <FitToRegions regions={fitRegions} selectedRegion={selectedRegion} />
        {activeLayerViews.map((layer) => (
          <MapFillLayer
            key={`${activeSources.join('|')}:${layer.key}`}
            data={layer.filteredRegions.length > 0 ? featureCollection(layer.filteredRegions) : EMPTY_COLLECTION}
            fillColor={layer.colors.fill}
            fillOpacity={layer.opacity}
            lineColor={layer.colors.line}
            lineOpacity={0.86}
            lineWidth={activeLayerViews.length > 1 ? 1.1 : 0.9}
            idProperty="boundaryId"
            selectedId={selectedId}
            selectionColor="#f97316"
            selectionWidth={3}
            onFeatureClick={handleFeatureClick}
            hoverHtml={layer.key === topLayerKey
              ? (properties) => (
                  `<div class="min-w-48 max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                    <div class="font-semibold leading-5">${escapeHtml(String(properties.boundaryName ?? ''))}</div>
                    <div class="mt-1 text-muted-foreground">${escapeHtml(sourceLabel(String(properties.boundarySource ?? layer.source) as BoundarySource))} &middot; ${escapeHtml(getStudyAreaLevelLabel(String(properties.boundaryLevel ?? '')))}</div>
                    <div class="mt-1 text-muted-foreground">${escapeHtml(String(properties.boundaryCode ?? ''))}</div>
                    <div class="mt-2 font-semibold">${escapeHtml(formatArea(Number(properties.areaKm2 ?? 0)))}</div>
                  </div>`
                )
              : undefined}
          />
        ))}
        {surfaceDifferenceMode && surfaceDifference && (
          <>
            <MapFillLayer
              data={singleFeatureCollection(surfaceDifference.onlyA)}
              fillColor="#22c55e"
              fillOpacity={0.38}
              lineColor="#15803d"
              lineOpacity={0.95}
              lineWidth={1.3}
              idProperty="boundaryId"
              hoverHtml={() => (
                `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <div class="font-semibold">Only ${escapeHtml(compareRegions[0].name)}</div>
                  <div class="mt-1">${escapeHtml(formatArea(surfaceDifference.onlyAKm2))}</div>
                </div>`
              )}
            />
            <MapFillLayer
              data={singleFeatureCollection(surfaceDifference.onlyB)}
              fillColor="#38bdf8"
              fillOpacity={0.38}
              lineColor="#0284c7"
              lineOpacity={0.95}
              lineWidth={1.3}
              idProperty="boundaryId"
              hoverHtml={() => (
                `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <div class="font-semibold">Only ${escapeHtml(compareRegions[1].name)}</div>
                  <div class="mt-1">${escapeHtml(formatArea(surfaceDifference.onlyBKm2))}</div>
                </div>`
              )}
            />
            <MapFillLayer
              data={singleFeatureCollection(surfaceDifference.overlap)}
              fillColor="#f59e0b"
              fillOpacity={0.58}
              lineColor="#b45309"
              lineOpacity={1}
              lineWidth={1.6}
              idProperty="boundaryId"
              hoverHtml={() => (
                `<div class="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                  <div class="font-semibold">Overlap</div>
                  <div class="mt-1">${escapeHtml(formatArea(surfaceDifference.overlapKm2))}</div>
                </div>`
              )}
            />
          </>
        )}
        {selectedRegion && (
          <MapPopup
            longitude={(selectedRegion.bounds[0] + selectedRegion.bounds[2]) / 2}
            latitude={(selectedRegion.bounds[1] + selectedRegion.bounds[3]) / 2}
            onClose={() => setSelectedId(null)}
          >
            <div className="min-w-56 text-sm">
              <div className="font-semibold text-foreground">{selectedRegion.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{selectedRegion.code}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Study area</div>
                  <div className="font-medium text-foreground">{sourceLabel(selectedRegion.source)}</div>
                </div>
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Hierarchy / variant</div>
                  <div className="font-medium text-foreground">{getStudyAreaLevelLabel(selectedRegion.level)}</div>
                </div>
                <div className="rounded border bg-muted/30 p-2">
                  <div className="text-[10px] text-muted-foreground">Area</div>
                  <div className="font-medium text-foreground">{formatArea(selectedRegion.areaKm2)}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleCompare(selectedRegion.id)}
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <ChevronsUpDown className="size-3.5" />
                {compareIds.includes(selectedRegion.id) ? 'Remove from compare' : 'Add to compare'}
              </button>
            </div>
          </MapPopup>
        )}
      </Map>

      {compareRegions.length > 0 && (
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              <h2 className="truncate text-sm font-semibold">Compare selected areas</h2>
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
                <div className="text-xs font-semibold text-foreground">Surface difference</div>
                <div className="text-[10px] text-muted-foreground">Shows overlap and area unique to each of two selected surfaces.</div>
              </div>
              <button
                type="button"
                disabled={compareRegions.length !== 2}
                onClick={() => setSurfaceDifferenceMode((current) => !current)}
                className={cn(
                  'h-8 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  surfaceDifferenceMode && compareRegions.length === 2
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {surfaceDifferenceMode && compareRegions.length === 2 ? 'Hide surfaces' : 'Show surfaces'}
              </button>
            </div>
            {compareRegions.length !== 2 && (
              <div className="mt-2 text-[10px] text-muted-foreground">Select exactly two areas to enable surface difference mode.</div>
            )}
            {surfaceDifference && (
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded border bg-amber-500/10 p-2">
                  <div className="text-[10px] text-muted-foreground">Overlap</div>
                  <div className="font-semibold text-foreground">{formatArea(surfaceDifference.overlapKm2)}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {Math.round(surfaceDifference.aShare * 100)}% of A · {Math.round(surfaceDifference.bShare * 100)}% of B
                  </div>
                </div>
                <div className="rounded border bg-green-500/10 p-2">
                  <div className="text-[10px] text-muted-foreground">Only A</div>
                  <div className="font-semibold text-foreground">{formatArea(surfaceDifference.onlyAKm2)}</div>
                </div>
                <div className="rounded border bg-sky-500/10 p-2">
                  <div className="text-[10px] text-muted-foreground">Only B</div>
                  <div className="font-semibold text-foreground">{formatArea(surfaceDifference.onlyBKm2)}</div>
                </div>
              </div>
            )}
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {compareRegions.map((region) => (
              <button
                key={region.id}
                type="button"
                onClick={() => setSelectedId(region.id)}
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
