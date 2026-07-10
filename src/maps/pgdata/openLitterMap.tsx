import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { MapClusterLayer, MapMarker, MapPopup, MarkerContent, useMap } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer } from '@/components/ui/map-layers'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import {
  InlineAlert,
  LegendItem,
  MapGradientLegendItem,
  MapLegendNote,
  SelectedItemCard,
  SidebarSection,
  StatGrid,
  ToggleChip,
} from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import { formatDate, useJsonManifest } from './shared'

export const OPEN_LITTER_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 mo' },
  { value: 3, label: '3 mo' },
  { value: 6, label: '6 mo' },
  { value: 12, label: '12 mo' },
  { value: -1, label: 'Cumul.' },
]

interface LitterSummaryEntry {
  name: string
  count: number
  litter: number
}

interface LitterContributorEntry extends LitterSummaryEntry {
  username: string | null
  team: string | null
  flag: string | null
}

export interface OpenLitterMapManifest {
  source: string
  sourcePage: string
  sourceApi: string
  dedication?: string
  sourceLicense: string
  coverage: string
  generatedAt: string
  bbox: [number, number, number, number]
  rows: number
  totalLitter: number
  pickedUpRecords: number
  verifiedRecords: number
  dateStart: string | null
  dateEnd: string | null
  yearStart: number | null
  yearEnd: number | null
  categories: LitterSummaryEntry[]
  objects: LitterSummaryEntry[]
  materials: LitterSummaryEntry[]
  contributors?: LitterContributorEntry[]
  years: LitterSummaryEntry[]
  months: LitterSummaryEntry[]
  geojson: string | null
  geojsonGzip?: string
  hexGeojson: string | null
  hexGeojsonGzip?: string | null
  hexComputedClientSide?: boolean
  hexSizeM: number
  rawBytes?: number
  gzipBytes?: number
  hexRawBytes?: number
  hexGzipBytes?: number
}

interface OpenLitterMapProperties {
  id: number
  sourceId: number
  datetime: string | null
  year: number | null
  month: string | null
  verified: number
  picked_up?: boolean
  pickedUp: boolean
  summary?: {
    tags?: Array<{ quantity?: number }>
    totals?: { litter?: number }
  }
  username: string | null
  name: string | null
  team: string | null
  flag: string | null
  categoryNames: string[]
  objectNames: string[]
  materialNames: string[]
  brandNames: string[]
  customTags: string[]
  litterCount: number
  tagCount: number
}

type OpenLitterPointFeature = GeoJSON.Feature<GeoJSON.Point, OpenLitterMapProperties>
type OpenLitterPointCollection = GeoJSON.FeatureCollection<GeoJSON.Point, OpenLitterMapProperties>

interface OpenLitterHexProperties {
  id: string
  recordCount: number
  litterCount: number
  topCategory: string
  categories: LitterSummaryEntry[]
  hexSizeM: number
}

type OpenLitterHexCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, OpenLitterHexProperties>

type OpenLitterPointProperties = OpenLitterMapProperties & {
  featureKey: string
  primaryCategory: string
}

const ALL_CATEGORIES = 'all'
const ALL_OBJECTS = 'all'

const CATEGORY_COLORS: Record<string, string> = {
  alcohol: '#7c3aed',
  art: '#db2777',
  brands: '#0f766e',
  coffee: '#92400e',
  dumping: '#475569',
  food: '#f97316',
  industrial: '#64748b',
  other: '#64748b',
  plastic: '#2563eb',
  sanitary: '#be123c',
  smoking: '#dc2626',
  softdrinks: '#0891b2',
}

const FALLBACK_COLORS = ['#0d9488', '#9333ea', '#ca8a04', '#0369a1', '#be185d', '#65a30d', '#ea580c', '#4f46e5']

type DecompressionStreamConstructor = new (format: 'gzip') => TransformStream<Uint8Array, Uint8Array>

function useGzipJson<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setData(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    const resolvedPath = path
    async function load() {
      try {
        setError(null)
        const response = await fetch(resolvedPath, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch ${resolvedPath}: ${response.status}`)
        const buffer = await response.arrayBuffer()
        let text = new TextDecoder().decode(buffer)
        if (!text.trimStart().startsWith('{')) {
          const DecompressionStreamCtor = (
            globalThis as typeof globalThis & { DecompressionStream?: DecompressionStreamConstructor }
          ).DecompressionStream
          if (!DecompressionStreamCtor) throw new Error('This browser cannot decompress gzip map data')
          const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStreamCtor('gzip'))
          text = await new Response(stream).text()
        }
        setData(JSON.parse(text) as T)
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setData(null)
        setError((err as Error).message || `Unable to load ${resolvedPath}`)
      }
    }

    void load()
    return () => controller.abort()
  }, [path])

  return { data, error }
}

function hashName(name: string): number {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = ((hash << 5) - hash + name.charCodeAt(index)) | 0
  return Math.abs(hash)
}

function getCategoryColor(category: string): string {
  const key = category.toLowerCase()
  return CATEGORY_COLORS[key] ?? FALLBACK_COLORS[hashName(category) % FALLBACK_COLORS.length]
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function parseLitterDate(feature: OpenLitterPointFeature): Date | null {
  const value = feature.properties.datetime
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatLitterDate(value: string | null): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// OpenLitterMap ships raw snake_case / lowercase tags (e.g. "beer_can",
// "softdrinks"). These overrides cover names that a plain title-casing pass
// would leave awkward; everything else falls through to the generic formatter.
const LITTER_NAME_OVERRIDES: Record<string, string> = {
  softdrinks: 'Soft drinks',
  petfood: 'Pet food',
  fastfood: 'Fast food',
  dogpoo: 'Dog waste',
  dumping: 'Illegal dumping',
  ppe: 'PPE',
  sup: 'Single-use plastic',
  tv: 'TV',
  diy: 'DIY',
  bbq: 'BBQ',
  other: 'Other',
}

/** Turn a raw litter tag into a human-readable label without losing its identity. */
export function formatLitterName(name: string | null | undefined): string {
  if (!name) return 'Unknown'
  const key = name.trim().toLowerCase()
  if (LITTER_NAME_OVERRIDES[key]) return LITTER_NAME_OVERRIDES[key]
  const spaced = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!spaced) return 'Unknown'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Join a list of raw litter tags into a display string, formatting each. */
function formatLitterNames(names: string[] | null | undefined, fallback = 'Unknown'): string {
  if (!names || names.length === 0) return fallback
  return names.map((name) => formatLitterName(name)).join(', ')
}

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return 'Unknown size'
  const bytes = Number(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function getFeatureKey(feature: OpenLitterPointFeature): string {
  return `olm:${feature.properties.sourceId ?? feature.properties.id}`
}

function getPrimaryCategory(feature: OpenLitterPointFeature): string {
  return feature.properties.categoryNames?.[0] || 'Unknown'
}

function hexSizeForZoom(zoom: number, baseSizeM: number): number {
  if (zoom < 10) return Math.max(baseSizeM * 2.4, 800)
  if (zoom < 11) return Math.max(baseSizeM * 1.8, 650)
  if (zoom < 12) return Math.max(baseSizeM * 1.35, 475)
  if (zoom < 13) return baseSizeM
  if (zoom < 14) return Math.max(baseSizeM * 0.65, 225)
  if (zoom < 15) return Math.max(baseSizeM * 0.34, 120)
  if (zoom < 16) return Math.max(baseSizeM * 0.22, 75)
  if (zoom < 17) return Math.max(baseSizeM * 0.16, 55)
  return Math.max(baseSizeM * 0.12, 40)
}

function hexOpacityForZoom(zoom: number): number {
  if (zoom < 11) return 0.84
  if (zoom < 12.5) return 0.66
  if (zoom < 13.5) return 0.5
  if (zoom < 14.5) return 0.32
  return 0.16
}

function hexLineOpacityForZoom(zoom: number): number {
  if (zoom < 12.5) return 0.46
  if (zoom < 14) return 0.3
  return 0.16
}

function hexScaleMax(hexes: OpenLitterHexCollection | null): number {
  const counts = (hexes?.features ?? [])
    .map((feature) => feature.properties.litterCount)
    .filter((count) => count > 0)
    .sort((a, b) => a - b)

  if (counts.length === 0) return 10

  const percentileIndex = Math.min(counts.length - 1, Math.floor(counts.length * 0.9))
  return Math.max(10, counts[percentileIndex])
}

function buildClientHexAggregate(
  features: OpenLitterPointFeature[],
  bounds: [number, number, number, number],
  sizeM: number,
): OpenLitterHexCollection {
  const centerLat = (bounds[1] + bounds[3]) / 2
  const metersPerLng = 111_320 * Math.cos((centerLat * Math.PI) / 180)
  const metersPerLat = 110_540
  const minX = bounds[0] * metersPerLng
  const maxX = bounds[2] * metersPerLng
  const minY = bounds[1] * metersPerLat
  const maxY = bounds[3] * metersPerLat
  const radius = sizeM
  const dx = Math.sqrt(3) * radius
  const dy = 1.5 * radius
  const hexes: Array<{
    id: string
    row: number
    col: number
    geometry: GeoJSON.Polygon
    points: OpenLitterPointFeature[]
  }> = []
  const hexByGrid = new Map<string, (typeof hexes)[number]>()

  for (let y = minY - radius, row = 0; y <= maxY + radius; y += dy, row += 1) {
    const offset = row % 2 === 0 ? 0 : dx / 2
    for (let x = minX - dx, col = 0; x <= maxX + dx; x += dx, col += 1) {
      const hex = {
        id: `hex-${row}-${col}`,
        row,
        col,
        geometry: clientHexPolygon(x + offset, y, radius, metersPerLng, metersPerLat),
        points: [],
      }
      hexes.push(hex)
      hexByGrid.set(`${row}:${col}`, hex)
    }
  }

  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates
    const projectedX = lng * metersPerLng
    const projectedY = lat * metersPerLat
    const approximateRow = Math.round((projectedY - (minY - radius)) / dy)
    let hex: (typeof hexes)[number] | undefined

    for (let rowDelta = -2; rowDelta <= 2 && !hex; rowDelta += 1) {
      const row = approximateRow + rowDelta
      const offset = row % 2 === 0 ? 0 : dx / 2
      const rowStartX = minX - dx + offset
      const approximateCol = Math.round((projectedX - rowStartX) / dx)

      for (let colDelta = -2; colDelta <= 2; colDelta += 1) {
        const candidate = hexByGrid.get(`${row}:${approximateCol + colDelta}`)
        if (candidate && pointInRing(lng, lat, candidate.geometry.coordinates[0])) {
          hex = candidate
          break
        }
      }
    }

    hex?.points.push(feature)
  }

  return {
    type: 'FeatureCollection',
    features: hexes
      .filter((hex) => hex.points.length > 0)
      .map((hex) => {
        const categories = new Map<string, LitterSummaryEntry>()
        let litterCount = 0
        for (const feature of hex.points) {
          const count = Number(feature.properties.litterCount) || 1
          litterCount += count
          for (const category of feature.properties.categoryNames?.length ? feature.properties.categoryNames : ['Unknown']) {
            const entry = categories.get(category) ?? { name: category, count: 0, litter: 0 }
            entry.count += 1
            entry.litter += count
            categories.set(category, entry)
          }
        }
        const categoryList = Array.from(categories.values()).sort(
          (a, b) => b.litter - a.litter || b.count - a.count || a.name.localeCompare(b.name),
        )
        return {
          type: 'Feature',
          geometry: hex.geometry,
          properties: {
            id: hex.id,
            recordCount: hex.points.length,
            litterCount,
            topCategory: categoryList[0]?.name ?? 'Unknown',
            categories: categoryList.slice(0, 12),
            hexSizeM: sizeM,
          },
        }
      }),
  }
}

function clientHexPolygon(
  centerX: number,
  centerY: number,
  radius: number,
  metersPerLng: number,
  metersPerLat: number,
): GeoJSON.Polygon {
  const coordinates: GeoJSON.Position[] = []
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index - 30)
    const x = centerX + radius * Math.cos(angle)
    const y = centerY + radius * Math.sin(angle)
    coordinates.push([x / metersPerLng, y / metersPerLat])
  }
  coordinates.push(coordinates[0])
  return { type: 'Polygon', coordinates: [coordinates] }
}

function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

export function useOpenLitterMapData(
  active: boolean,
  initialCategory: string | null,
  initialShowPoints: string | null = null,
  initialShowHeatmap: string | null = null,
  initialShowHexes: string | null = null,
  initialObject: string | null = null,
) {
  const [selectedCategory, setSelectedCategoryState] = useState(initialCategory || ALL_CATEGORIES)
  const [selectedObject, setSelectedObjectState] = useState(initialObject || ALL_OBJECTS)
  const [showPoints, setShowPoints] = useState(initialShowPoints !== '0')
  const [showHeatmap, setShowHeatmap] = useState(initialShowHeatmap === '1')
  const [showHexes, setShowHexes] = useState(initialShowHexes === '1')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(3)

  const manifest = useJsonManifest<OpenLitterMapManifest>(active ? '/data/open-litter-map/manifest.json' : null)
  const points = useGzipJson<OpenLitterPointCollection>(
    active && manifest.data ? (manifest.data.geojsonGzip ?? manifest.data.geojson) : null,
  )
  const features = useMemo(() => points.data?.features ?? [], [points.data])

  const setSelectedCategory = useCallback((category: string) => {
    setSelectedCategoryState(category)
    // Objects differ per category, so drop any active object filter when the
    // category changes to avoid an empty selection.
    setSelectedObjectState(ALL_OBJECTS)
    setSelectedId(null)
  }, [])

  const setSelectedObject = useCallback((object: string) => {
    setSelectedObjectState(object)
    setSelectedId(null)
  }, [])

  const categoryFilteredFeatures = useMemo(
    () =>
      features.filter((feature) => {
        if (selectedCategory === ALL_CATEGORIES) return true
        return feature.properties.categoryNames?.includes(selectedCategory)
      }),
    [features, selectedCategory],
  )

  const objectOptions = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; litter: number }>()
    for (const feature of categoryFilteredFeatures) {
      for (const object of feature.properties.objectNames ?? []) {
        const entry = counts.get(object) ?? { name: object, count: 0, litter: 0 }
        entry.count += 1
        entry.litter += Number(feature.properties.litterCount) || 1
        counts.set(object, entry)
      }
    }
    return Array.from(counts.values()).sort(
      (a, b) => b.litter - a.litter || b.count - a.count || a.name.localeCompare(b.name),
    )
  }, [categoryFilteredFeatures])

  const scopedFeatures = useMemo(() => {
    if (selectedObject === ALL_OBJECTS) return categoryFilteredFeatures
    return categoryFilteredFeatures.filter((feature) => feature.properties.objectNames?.includes(selectedObject))
  }, [categoryFilteredFeatures, selectedObject])

  const dateRange = useMemo(() => {
    if (features.length === 0) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    let min: Date | null = null
    let max: Date | null = null
    for (const feature of features) {
      const date = parseLitterDate(feature)
      if (!date) continue
      if (!min || date < min) min = date
      if (!max || date > max) max = date
    }
    if (!min || !max) {
      const now = new Date()
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
    }
    return { start: min, end: max }
  }, [features])

  const effectiveTimelineDate = useMemo(() => {
    if (timelineDate) return timelineDate
    return features.length > 0 ? new Date(dateRange.end.getFullYear(), dateRange.end.getMonth(), 1) : null
  }, [dateRange.end, features.length, timelineDate])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !effectiveTimelineDate) return null
    const isCumulative = timelineWindowSize === -1
    const start = isCumulative
      ? new Date(dateRange.start.getFullYear(), dateRange.start.getMonth(), 1)
      : new Date(effectiveTimelineDate.getFullYear(), effectiveTimelineDate.getMonth(), 1)
    const end = isCumulative
      ? new Date(effectiveTimelineDate.getFullYear(), effectiveTimelineDate.getMonth() + 1, 0, 23, 59, 59, 999)
      : new Date(
          effectiveTimelineDate.getFullYear(),
          effectiveTimelineDate.getMonth() + timelineWindowSize,
          0,
          23,
          59,
          59,
          999,
        )
    return { start: start.getTime(), end: end.getTime() }
  }, [dateRange.start, effectiveTimelineDate, timelineEnabled, timelineWindowSize])

  const filteredFeatures = useMemo(() => {
    if (!timelineFilterRange) return scopedFeatures
    return scopedFeatures.filter((feature) => {
      const date = parseLitterDate(feature)
      if (!date) return false
      const time = date.getTime()
      return time >= timelineFilterRange.start && time <= timelineFilterRange.end
    })
  }, [scopedFeatures, timelineFilterRange])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feature of scopedFeatures) {
      const date = parseLitterDate(feature)
      if (!date) continue
      const key = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [scopedFeatures])

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; litter: number; color: string }>()
    for (const feature of filteredFeatures) {
      const categories = feature.properties.categoryNames?.length ? feature.properties.categoryNames : ['Unknown']
      for (const category of categories) {
        const entry = counts.get(category) ?? {
          name: category,
          count: 0,
          litter: 0,
          color: getCategoryColor(category),
        }
        entry.count += 1
        entry.litter += Number(feature.properties.litterCount) || 1
        counts.set(category, entry)
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.litter - a.litter || a.name.localeCompare(b.name))
  }, [filteredFeatures])

  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: filteredFeatures.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          weight: Math.max(1, Number(feature.properties.litterCount) || 1),
        },
      })),
    }),
    [filteredFeatures],
  )

  const selectedFeature = useMemo(() => {
    if (!selectedId) return null
    return filteredFeatures.find((feature) => getFeatureKey(feature) === selectedId) ?? null
  }, [filteredFeatures, selectedId])

  const totalLitter = useMemo(
    () => filteredFeatures.reduce((sum, feature) => sum + (Number(feature.properties.litterCount) || 1), 0),
    [filteredFeatures],
  )

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  return {
    manifest,
    points,
    hexes: { data: null as OpenLitterHexCollection | null, error: null as string | null },
    features,
    filteredFeatures,
    heatmapData,
    selectedCategory,
    setSelectedCategory,
    selectedObject,
    setSelectedObject,
    objectOptions,
    showPoints,
    setShowPoints,
    showHeatmap,
    setShowHeatmap,
    showHexes,
    setShowHexes,
    selectedId,
    setSelectedId,
    selectedFeature,
    totalLitter,
    categoryBreakdown,
    bucketCounts,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate: effectiveTimelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    dateRange,
    handleTimelineDisable,
  }
}

export type OpenLitterMapState = ReturnType<typeof useOpenLitterMapData>

export function OpenLitterMapLayerControls({ litter }: { litter: OpenLitterMapState }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleChip active={litter.showPoints} onClick={() => litter.setShowPoints(!litter.showPoints)}>
        {litter.showPoints ? 'Hide points' : 'Points'}
      </ToggleChip>
      <ToggleChip active={litter.showHeatmap} onClick={() => litter.setShowHeatmap(!litter.showHeatmap)} tone="orange">
        Heatmap
      </ToggleChip>
      <ToggleChip active={litter.showHexes} onClick={() => litter.setShowHexes(!litter.showHexes)} tone="teal">
        Hexagons
      </ToggleChip>
    </div>
  )
}

export function OpenLitterMapSidebar({
  litter,
  showSelectedRecord = true,
  showLayerControls = false,
}: {
  litter: OpenLitterMapState
  showSelectedRecord?: boolean
  showLayerControls?: boolean
}) {
  const manifest = litter.manifest.data
  const dateLabel = manifest?.dateStart && manifest.dateEnd
    ? `${formatLitterDate(manifest.dateStart)} - ${formatLitterDate(manifest.dateEnd)}`
    : 'All dates'
  const objectFilterActive = litter.selectedObject !== ALL_OBJECTS

  return (
    <>
      <SidebarSection
        title="OpenLitterMap Records"
        icon={Trash2}
        iconClassName="text-rose-600"
        actions={
          <ToggleChip active={litter.timelineEnabled} onClick={() => litter.setTimelineEnabled(!litter.timelineEnabled)}>
            Timeline
          </ToggleChip>
        }
      >
        <div className="space-y-3">
          {showLayerControls && (
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Map layers</span>
              <OpenLitterMapLayerControls litter={litter} />
            </div>
          )}

          <label className="block text-xs font-medium text-foreground">
            Category
            <AppSelect
              value={litter.selectedCategory}
              onValueChange={litter.setSelectedCategory}
              options={[
                { value: ALL_CATEGORIES, label: 'All categories' },
                ...(manifest?.categories ?? []).map((category) => ({
                  value: category.name,
                  label: `${formatLitterName(category.name)} (${category.litter.toLocaleString()})`,
                  selectedLabel: formatLitterName(category.name),
                })),
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>

          {litter.objectOptions.length > 0 && (
            <label className="block text-xs font-medium text-foreground">
              Object
              <AppSelect
                value={litter.selectedObject}
                onValueChange={litter.setSelectedObject}
                options={[
                  {
                    value: ALL_OBJECTS,
                    label:
                      litter.selectedCategory === ALL_CATEGORIES
                        ? 'All objects'
                        : `All objects in ${formatLitterName(litter.selectedCategory)}`,
                    selectedLabel: 'All objects',
                  },
                  ...litter.objectOptions.map((object) => ({
                    value: object.name,
                    label: `${formatLitterName(object.name)} (${object.litter.toLocaleString()})`,
                    selectedLabel: formatLitterName(object.name),
                  })),
                ]}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
          )}

          {objectFilterActive && (
            <button
              type="button"
              onClick={() => litter.setSelectedObject(ALL_OBJECTS)}
              className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
            >
              Clear object filter
            </button>
          )}

          <StatGrid
            stats={[
              { label: 'records', value: litter.filteredFeatures.length.toLocaleString() },
              { label: 'items', value: litter.totalLitter.toLocaleString() },
              { label: 'period', value: dateLabel },
            ]}
          />

          {litter.points.error && <InlineAlert tone="error">{litter.points.error}</InlineAlert>}
          {litter.manifest.error && <InlineAlert tone="error">{litter.manifest.error}</InlineAlert>}
          {manifest?.dedication && <InlineAlert tone="info">{manifest.dedication}</InlineAlert>}
          <InlineAlert>
            Records are clipped to the Prince George community-boundary union from the OpenLitterMap public map API.
          </InlineAlert>
        </div>
      </SidebarSection>

      {manifest?.contributors?.length ? (
        <SidebarSection title="Top Contributors">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {manifest.contributors.slice(0, 6).map((contributor) => (
              <li key={`${contributor.name}-${contributor.team ?? ''}`} className="flex items-start justify-between gap-3">
                <span className="min-w-0 truncate font-medium text-foreground">{contributor.name}</span>
                <span className="shrink-0 text-right">
                  {contributor.litter.toLocaleString()} items
                  {contributor.team ? <span className="block max-w-36 truncate text-xs">{contributor.team}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </SidebarSection>
      ) : null}

      {showSelectedRecord && litter.selectedFeature && (
        <SidebarSection title="Selected Record">
          <SelectedItemCard
            title={formatLitterNames(litter.selectedFeature.properties.categoryNames, 'Litter record')}
            onClear={() => litter.setSelectedId(null)}
            rows={[
              { label: 'Observed', value: formatLitterDate(litter.selectedFeature.properties.datetime) },
              { label: 'Objects', value: formatLitterNames(litter.selectedFeature.properties.objectNames) },
              { label: 'Materials', value: formatLitterNames(litter.selectedFeature.properties.materialNames) },
              { label: 'Items', value: litter.selectedFeature.properties.litterCount.toLocaleString() },
              { label: 'Picked up', value: litter.selectedFeature.properties.pickedUp ? 'Yes' : 'No' },
              { label: 'Contributor', value: litter.selectedFeature.properties.name || 'Unknown' },
              { label: 'Username', value: litter.selectedFeature.properties.username || 'Unknown' },
              { label: 'Team', value: litter.selectedFeature.properties.team || 'Unknown' },
            ]}
          />
        </SidebarSection>
      )}
    </>
  )
}

export function OpenLitterMapSourceNotes({ litter }: { litter: OpenLitterMapState }) {
  return (
    <>
      <p>OpenLitterMap extract updated {formatDate(litter.manifest.data?.generatedAt)}.</p>
      {litter.manifest.data?.dedication && <p>{litter.manifest.data.dedication}</p>}
      {litter.manifest.data?.gzipBytes && (
        <p>
          Point GeoJSON is {formatBytes(litter.manifest.data.rawBytes)} raw, {formatBytes(litter.manifest.data.gzipBytes)} gzipped.
          Hexes are calculated client-side from the compressed point payload.
        </p>
      )}
      <p>{litter.manifest.data?.sourceLicense ?? 'OpenLitterMap public map data.'}</p>
    </>
  )
}

export function OpenLitterMapLayer({ litter }: { litter: OpenLitterMapState }) {
  const { map, isLoaded } = useMap()
  const [hexZoom, setHexZoom] = useState(9.4)

  useEffect(() => {
    if (!isLoaded || !map) return
    const updateZoom = () => setHexZoom(map.getZoom())
    updateZoom()
    map.on('zoomend', updateZoom)
    return () => {
      map.off('zoomend', updateZoom)
    }
  }, [isLoaded, map])

  const collectionsByCategory = useMemo(() => {
    const grouped = new Map<string, GeoJSON.FeatureCollection<GeoJSON.Point, OpenLitterPointProperties>>()

    litter.filteredFeatures.forEach((feature) => {
      const category = getPrimaryCategory(feature)
      if (!grouped.has(category)) {
        grouped.set(category, { type: 'FeatureCollection', features: [] })
      }
      grouped.get(category)?.features.push({
        ...feature,
        properties: {
          ...feature.properties,
          primaryCategory: category,
          featureKey: getFeatureKey(feature),
        },
      })
    })

    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [litter.filteredFeatures])

  const dynamicHexSizeM = useMemo(
    () => hexSizeForZoom(hexZoom, litter.manifest.data?.hexSizeM || 350),
    [hexZoom, litter.manifest.data?.hexSizeM],
  )

  const manifestBbox = litter.manifest.data?.bbox
  const filteredHexes = useMemo<OpenLitterHexCollection | null>(() => {
    if (!litter.showHexes || !manifestBbox || litter.filteredFeatures.length === 0) return null
    return buildClientHexAggregate(litter.filteredFeatures, manifestBbox, dynamicHexSizeM)
  }, [dynamicHexSizeM, litter.filteredFeatures, manifestBbox, litter.showHexes])

  const maxHexLitter = useMemo(() => hexScaleMax(filteredHexes), [filteredHexes])
  const hexOpacity = hexOpacityForZoom(hexZoom)
  const hexLineOpacity = hexLineOpacityForZoom(hexZoom)

  return (
    <>
      {litter.showHexes && filteredHexes && filteredHexes.features.length > 0 && (
        <MapFillLayer
          data={filteredHexes}
          fillColor={[
            'interpolate',
            ['linear'],
            ['coalesce', ['to-number', ['get', 'litterCount']], 0],
            0,
            '#fef3c7',
            maxHexLitter * 0.35,
            '#fb923c',
            maxHexLitter,
            '#dc2626',
          ]}
          fillOpacity={hexOpacity}
          lineColor="#991b1b"
          lineWidth={0.45}
          lineOpacity={hexLineOpacity}
          idProperty="id"
        />
      )}

      {litter.showHeatmap && litter.filteredFeatures.length > 0 && (
        <MapHeatmapLayer
          data={litter.heatmapData}
          weight={['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 1], 1, 0.35, 8, 1]}
          intensityStops={[
            [9, 0.75],
            [12, 1.45],
            [15, 2.2],
          ]}
          radiusStops={[
            [9, 14],
            [12, 26],
            [15, 42],
          ]}
          opacity={[
            [9, 0.56],
            [15, 0.76],
          ]}
          colorRamp={[
            [0, 'rgba(248, 113, 113, 0)'],
            [0.2, '#fde68a'],
            [0.45, '#fb923c'],
            [0.7, '#ef4444'],
            [1, '#7f1d1d'],
          ]}
        />
      )}

      {litter.showPoints &&
        collectionsByCategory.map(([category, collection]) => {
          const color = getCategoryColor(category)
          return (
            <MapClusterLayer<OpenLitterPointProperties>
              key={category}
              data={collection}
              pointColor={color}
              clusterColors={[hexToRgba(color, 0.65), hexToRgba(color, 0.82), color]}
              clusterMaxZoom={12}
              clusterRadius={42}
              clusterThresholds={[50, 250]}
              onPointClick={(feature) => {
                const featureKey = feature.properties?.featureKey
                if (featureKey) litter.setSelectedId(litter.selectedId === featureKey ? null : featureKey)
              }}
            />
          )
        })}

      {litter.showPoints && litter.selectedFeature && (() => {
        const [longitude, latitude] = litter.selectedFeature.geometry.coordinates
        const category = getPrimaryCategory(litter.selectedFeature)
        return (
          <MapMarker longitude={longitude} latitude={latitude} onClick={() => litter.setSelectedId(null)}>
            <MarkerContent>
              <div
                className="size-4 rounded-full border-2 border-white shadow-md ring-2 ring-cyan-400"
                style={{ backgroundColor: getCategoryColor(category) }}
                title={`${formatLitterName(category)}: ${formatLitterDate(litter.selectedFeature.properties.datetime)}`}
              />
            </MarkerContent>
          </MapMarker>
        )
      })()}

      {litter.selectedFeature && (
        <MapPopup
          longitude={litter.selectedFeature.geometry.coordinates[0]}
          latitude={litter.selectedFeature.geometry.coordinates[1]}
          onClose={() => litter.setSelectedId(null)}
        >
          <div className="min-w-52 text-xs">
            <div className="pr-5 text-sm font-semibold text-foreground">
              {formatLitterNames(litter.selectedFeature.properties.categoryNames, 'Litter record')}
            </div>
            <div className="text-muted-foreground">{formatLitterDate(litter.selectedFeature.properties.datetime)}</div>
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground">Objects</span>
              <span className="font-medium text-foreground">
                {formatLitterNames(litter.selectedFeature.properties.objectNames)}
              </span>
              <span className="text-muted-foreground">Items</span>
              <span className="font-medium text-foreground">{litter.selectedFeature.properties.litterCount}</span>
              <span className="text-muted-foreground">Picked up</span>
              <span className="font-medium text-foreground">
                {litter.selectedFeature.properties.pickedUp ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </MapPopup>
      )}
    </>
  )
}

export function MobileOpenLitterMapFeatureCard({ litter }: { litter: OpenLitterMapState }) {
  const feature = litter.selectedFeature
  if (!feature) return null

  return (
    <MobileFeatureCard
      cardKey={litter.selectedId ?? getFeatureKey(feature)}
      title={formatLitterNames(feature.properties.categoryNames, 'Litter record')}
      subtitle={formatLitterDate(feature.properties.datetime)}
      onClose={() => litter.setSelectedId(null)}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          {[
            ['Objects', formatLitterNames(feature.properties.objectNames)],
            ['Materials', formatLitterNames(feature.properties.materialNames)],
            ['Items', feature.properties.litterCount.toLocaleString()],
            ['Picked up', feature.properties.pickedUp ? 'Yes' : 'No'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{label}</span>
              <span className="max-w-[12rem] text-right font-medium text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </MobileFeatureCard>
  )
}

export function OpenLitterMapLegend({ litter }: { litter: OpenLitterMapState }) {
  return (
    <div className="w-full space-y-1.5 text-xs text-muted-foreground md:w-56 md:space-y-2 md:text-xs">
      {litter.showHeatmap && (
        <div className="space-y-1 border-b border-border pb-2">
          <div className="px-1 text-xs font-medium text-foreground">Litter density</div>
          <MapGradientLegendItem
            className="px-1"
            colors={['#fde68a', '#fb923c', '#ef4444', '#7f1d1d']}
            minLabel="Low"
            maxLabel="High"
          />
        </div>
      )}
      {litter.showHexes && (
        <div className="space-y-1 border-b border-border pb-2">
          <div className="px-1 text-xs font-medium text-foreground">Hex item count</div>
          <MapGradientLegendItem
            className="px-1"
            colors={['#fef2f2', '#fb923c', '#b91c1c']}
            minLabel="Low"
            maxLabel="High"
          />
        </div>
      )}
      {litter.showPoints && (
        <>
          {litter.categoryBreakdown.length === 0 ? (
            <MapLegendNote className="italic">No records in current filter.</MapLegendNote>
          ) : (
            <ul className="max-h-36 space-y-0.5 overflow-y-auto pr-1 md:max-h-48 md:space-y-1">
              {litter.categoryBreakdown.slice(0, 16).map((entry) => (
                <li key={entry.name}>
                  <LegendItem
                    color={entry.color}
                    label={`${formatLitterName(entry.name)} (${entry.litter.toLocaleString()})`}
                    active
                    className="md:gap-2"
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
