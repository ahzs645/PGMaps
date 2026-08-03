import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useTheme } from 'next-themes'
import { AlertCircle, HeartPulse, Users } from 'lucide-react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { Map as PgMap } from '@/components/ui/map'
import { useAirQualityData, type AirMonitor } from '@/maps/airquality'
import { distanceKm, getAqhiCategory, getMonitorAqhiPm25, isFemMonitor } from '@/maps/airquality/lib/monitorPopup'
import {
  AQ_OBSERVATION_NETWORKS,
  type AqBasemap,
  type AqMonitorGroup,
  type AqNetworkSlug,
  monitorKey,
} from './lib/monitorPresentation'
import { useAqmapSmokeLayers } from './lib/useAqmapSmokeLayers'
import { type SmokeLayerKey } from './lib/smokeLayers'
import {
  CANADA_CENTER,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  isValidMapView,
  parseAqmapHash,
  serializeAqmapHash,
  serializeSet,
} from './lib/urlState'
import { WMS_LAYERS, type WmsLayerKey } from './lib/wmsLayers'
import {
  buildObservationRowLabels,
  formatAqhiCategory,
  formatAqmapPm25Localized,
  formatLocalizedDate,
  localizeHealthMessage,
  localizeMonitorType,
  translate,
  type AqmapLocale,
} from './lib/i18n'
import { exportAqmap, type ExportFormat } from './lib/exportMap'
import {
  BASEMAP_STYLES,
  FORECAST_ZONES_LOCAL_URL,
  FORECAST_ZONES_VECTOR_URL,
  REVEAL_CLUSTER_DEFAULTS,
  URL_UPDATE_DELAY_MS,
  clampRevealClusterMaxZoom,
  clampRevealClusterRadius,
} from './lib/aqMapConstants'
import type {
  ActiveFiresRenderMode,
  AqClusterColorScheme,
  AqMonitorIconMode,
  AqRingCenter,
  AqRingShape,
  AqRingStyle,
  FireDangerRenderMode,
  FirePerimetersRenderMode,
  ForecastZoneFeatureProperties,
  ForecastZonesRenderMode,
  MobileFeatureDisplay,
  ModelledSmokeRenderMode,
  OverlayRenderMode,
} from './lib/aqMapTypes'
import { getAqhiPlusColor } from './lib/aqhiScale'
import { FloatingLayerControl, MainLayerControl, MapStatusBar, MapUtilityControls } from './components/AqMapControls'
import {
  AqMonitorLegend,
  DEFAULT_FIRE_DANGER_LEGEND_VARIANT,
  type FireDangerLegendVariant,
} from './components/AqMapLegends'
import { AqMapSidebar } from './components/AqMapSidebar'
import {
  ActiveFiresVectorLayer,
  AqMonitorLayer,
  FireDangerVectorLayer,
  FirePerimetersVectorLayer,
  ForecastZonesVectorLayer,
  ModelledPm25VectorLayer,
  SmokePolygonLayer,
  WmsRasterLayer,
} from './components/AqMapLayers'
import { MonitorPopup, MonitorTooltip } from './components/MonitorPopup'
import { MonitorPlotPanel, type NearbyFem } from './components/MonitorPlotPanel'
import { WindCanvasLayer } from './components/WindCanvasLayer'
import { VectorWindBarbLayer } from './components/VectorWindBarbLayer'
import type maplibregl from 'maplibre-gl'

type ForecastZoneFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>
type ForecastZoneCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  ForecastZoneFeatureProperties
>
type ForecastZoneBounds = [minLng: number, minLat: number, maxLng: number, maxLat: number]
type ForecastZoneAssignment = {
  code: string | null
  name: string | null
}
type ForecastZoneAssignmentResult = {
  forecastZoneData: ForecastZoneCollection
  monitors: AirMonitor[]
  assignments: Map<string, ForecastZoneAssignment>
}
type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
  cancelIdleCallback?: (handle: number) => void
}
export type AqMapDebugInfo = {
  zoom: number
  center: [number, number]
  visibleWmsLayers: WmsLayerKey[]
  visibleSmokeLayers: SmokeLayerKey[]
  deckTileKeys: WmsLayerKey[]
  fireDangerDeck: boolean
  renderModes: {
    modelledPm25: ModelledSmokeRenderMode
    activeFires: ActiveFiresRenderMode
    fireDanger: FireDangerRenderMode
    firePerimeters: FirePerimetersRenderMode
    forecastZones: ForecastZonesRenderMode
  }
  mapLayerCount: number
  mapSourceCount: number
  selectedFeature: string
}
type AqMapStyleStats = {
  layerCount: number
  sourceCount: number
}

const EMPTY_MAP_STYLE_STATS: AqMapStyleStats = {
  layerCount: 0,
  sourceCount: 0,
}

function mapStyleStats(map: maplibregl.Map): AqMapStyleStats {
  const style = map.getStyle()
  return {
    layerCount: style?.layers?.length ?? 0,
    sourceCount: style?.sources ? Object.keys(style.sources).length : 0,
  }
}

function mapStyleStatsEqual(left: AqMapStyleStats, right: AqMapStyleStats) {
  return left.layerCount === right.layerCount && left.sourceCount === right.sourceCount
}

let forecastZoneDataCache: ForecastZoneCollection | null = null
let forecastZoneDataPromise: Promise<ForecastZoneCollection> | null = null
const forecastZoneBoundsCache = new WeakMap<ForecastZoneFeature, ForecastZoneBounds>()

async function fetchForecastZones(url: string): Promise<ForecastZoneCollection> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load forecast zones: ${response.status}`)
  return (await response.json()) as ForecastZoneCollection
}

function loadForecastZoneData(): Promise<ForecastZoneCollection> {
  if (forecastZoneDataCache) return Promise.resolve(forecastZoneDataCache)

  // Prefer the slimmed same-origin snapshot; fall back to the live gov API only
  // if it's missing (e.g. snapshot not built) so the layer still works.
  forecastZoneDataPromise ??= fetchForecastZones(FORECAST_ZONES_LOCAL_URL)
    .catch(() => fetchForecastZones(FORECAST_ZONES_VECTOR_URL))
    .then((payload) => {
      forecastZoneDataCache = payload
      return forecastZoneDataCache
    })
    .catch((error) => {
      forecastZoneDataPromise = null
      throw error
    })

  return forecastZoneDataPromise
}

function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = Number(ring[index][0])
    const yi = Number(ring[index][1])
    const xj = Number(ring[previous][0])
    const yj = Number(ring[previous][1])
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function pointInPolygonCoordinates(lng: number, lat: number, rings: GeoJSON.Position[][]): boolean {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false
  return !rings.slice(1).some((hole) => pointInRing(lng, lat, hole))
}

function computeForecastZoneBounds(zone: ForecastZoneFeature): ForecastZoneBounds {
  const cached = forecastZoneBoundsCache.get(zone)
  if (cached) return cached

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const visit = (coordinates: GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][]) => {
    for (const entry of coordinates) {
      if (typeof entry[0] === 'number') {
        const [lng, lat] = entry as GeoJSON.Position
        minLng = Math.min(minLng, lng)
        minLat = Math.min(minLat, lat)
        maxLng = Math.max(maxLng, lng)
        maxLat = Math.max(maxLat, lat)
      } else {
        visit(entry as GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][])
      }
    }
  }

  visit(zone.geometry.coordinates)
  const bounds: ForecastZoneBounds = [minLng, minLat, maxLng, maxLat]
  forecastZoneBoundsCache.set(zone, bounds)
  return bounds
}

function pointInForecastZone(monitor: AirMonitor, zone: ForecastZoneFeature): boolean {
  const { longitude, latitude } = monitor
  const [minLng, minLat, maxLng, maxLat] = computeForecastZoneBounds(zone)
  if (longitude < minLng || longitude > maxLng || latitude < minLat || latitude > maxLat) return false

  const { geometry } = zone
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(longitude, latitude, geometry.coordinates)
  }
  return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(longitude, latitude, polygon))
}

function getForecastZoneName(properties: ForecastZoneFeatureProperties): string | null {
  const name = String(properties.NAME ?? properties.NOM ?? '').trim()
  return name || null
}

function getForecastZoneMonitorGroup(monitor: AirMonitor): 'FEM' | 'PA' | 'EGG' | null {
  if (monitor.network === 'FEM' || monitor.network === 'BC ENV') return 'FEM'
  if (monitor.network === 'PA') return 'PA'
  if (monitor.network === 'EGG') return 'EGG'
  return null
}

function mean(values: Array<number | null | undefined>): number | null {
  const numericValues = values.filter((value): value is number => Number.isFinite(value))
  if (!numericValues.length) return null
  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}

function formatForecastZoneMean(value: number | null): string {
  if (value === null) return '-'
  return value.toFixed(1)
}

function getForecastZoneMonitors(zone: ForecastZoneFeature, monitors: AirMonitor[]): AirMonitor[] {
  const zoneCode = String(zone.properties?.CLC ?? '').trim()
  const monitorsByCode = zoneCode
    ? monitors.filter((monitor) => monitor.forecastZoneCode === zoneCode)
    : []
  return monitorsByCode.length
    ? monitorsByCode
    : monitors.filter((monitor) => pointInForecastZone(monitor, zone))
}

function buildForecastZoneAssignments(
  monitors: AirMonitor[],
  forecastZones: ForecastZoneCollection,
): Map<string, ForecastZoneAssignment> {
  const assignments = new Map<string, ForecastZoneAssignment>()

  for (const monitor of monitors) {
    const zone = forecastZones.features.find((feature) => pointInForecastZone(monitor, feature))
    if (!zone) continue

    assignments.set(monitorKey(monitor), {
      code: String(zone.properties?.CLC ?? '').trim() || null,
      name: getForecastZoneName(zone.properties),
    })
  }

  return assignments
}

function splitHealthLine(line: string): { label: string; detail: string } {
  const match = line.match(/^(.*?)\s[-—–]\s(.*)$/)
  if (match) return { label: match[1], detail: match[2] }
  return { label: '', detail: line }
}

function parseOverlayMode(value: string | null, fallback: OverlayRenderMode): OverlayRenderMode {
  return value === 'raster' || value === 'vector' || value === 'deckgl' ? value : fallback
}

function parseFireDangerLegendVariant(value: string | null): FireDangerLegendVariant {
  return value === 'compact' || value === 'full' || value === 'tilted' || value === 'rows'
    ? value
    : DEFAULT_FIRE_DANGER_LEGEND_VARIANT
}

function parseMainNetworks(value: string | null): Set<AqNetworkSlug> {
  const allowed = new Set<AqNetworkSlug>(AQ_OBSERVATION_NETWORKS)
  const parsed = (value ?? '')
    .split(',')
    .filter((item): item is AqNetworkSlug => allowed.has(item as AqNetworkSlug))
  return new Set(parsed.length > 0 ? parsed : AQ_OBSERVATION_NETWORKS)
}

// deck.gl is heavy and only used by deck.gl render modes, so load it lazily.
const AqMapDeckOverlay = lazy(() =>
  import('./components/AqMapDeckLayers').then((module) => ({ default: module.AqMapDeckOverlay })),
)

// Which monitor icon style the simplified /dev/aqmap/main view locks to. All
// three modes stay available everywhere; flip this constant to choose the one
// the main view uses: 'ring' (pie-donut clusters), 'revealed' (grey reveal
// clusters) or 'aqmap' (always-on coloured markers).
const MAIN_VIEW_ICON_MODE: AqMonitorIconMode = 'ring'
const MAIN_VIEW_RING_STYLE: AqRingStyle = {
  shape: 'donut',
  showNumber: false,
  center: 'transparent',
  showShadow: false,
}

export default function AqMapSection({ variant = 'full' }: { variant?: 'full' | 'main' | 'ring' } = {}) {
  const isMain = variant === 'main'
  const isRing = variant === 'ring'
  const { resolvedTheme } = useTheme()
  const { monitors, loading, error } = useAirQualityData({ aqmapCompatible: true })
  const isMobileViewport = useIsMobile()
  const { layers: smokeLayers, error: smokeError } = useAqmapSmokeLayers()
  const initialUrlState = useMemo(
    () => parseAqmapHash(window.location.hash, new URLSearchParams(window.location.search)),
    [],
  )
  const [showSidebar, setShowSidebar] = useState(false)
  const [visibleGroups, setVisibleGroups] = useState<Set<AqMonitorGroup>>(() => initialUrlState.visibleGroups)
  // Main page (/dev/aqmap/main) toggles individual observation networks
  // (FEM/PA/EGG) rather than the agency/lcm/other groups. All three start on.
  const [visibleNetworks, setVisibleNetworks] = useState<Set<AqNetworkSlug>>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseMainNetworks(params.get('networks'))
  })
  const [visibleWmsLayers, setVisibleWmsLayers] = useState<Set<WmsLayerKey>>(() => initialUrlState.visibleWmsLayers)
  const [visibleSmokeLayers, setVisibleSmokeLayers] = useState<Set<SmokeLayerKey>>(
    () => initialUrlState.visibleSmokeLayers,
  )
  const [activeFiresMode, setActiveFiresMode] = useState<ActiveFiresRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseOverlayMode(params.get('activeFires'), 'vector')
  })
  const [fireDangerMode, setFireDangerMode] = useState<FireDangerRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseOverlayMode(params.get('fireDanger'), 'raster')
  })
  const [fireDangerLegendVariant, setFireDangerLegendVariant] = useState<FireDangerLegendVariant>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseFireDangerLegendVariant(params.get('fireDangerLegend'))
  })
  const [firePerimetersMode, setFirePerimetersMode] = useState<FirePerimetersRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseOverlayMode(params.get('firePerimeters'), 'vector')
  })
  const [forecastZonesMode, setForecastZonesMode] = useState<ForecastZonesRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseOverlayMode(params.get('forecastZones'), 'vector')
  })
  const [modelledSmokeMode, setModelledSmokeMode] = useState<ModelledSmokeRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return parseOverlayMode(params.get('modelledSmoke'), 'vector')
  })
  const [iconMode, setIconMode] = useState<AqMonitorIconMode>(() => {
    const params = new URLSearchParams(window.location.search)
    const icons = params.get('icons')
    if (icons === 'revealed') return 'revealed'
    if (icons === 'ring') return 'ring'
    return isRing ? 'ring' : 'aqmap'
  })
  // Ring (pie-donut) cluster sub-type knobs: shape, centre count and hole fill,
  // all independent. Defaults reproduce the original donut (white hole + count).
  const [ringShape, setRingShape] = useState<AqRingShape>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('ringShape') === 'pie' ? 'pie' : 'donut'
  })
  const [ringNumber, setRingNumber] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('ringNumber') !== '0'
  })
  const [ringCenter, setRingCenter] = useState<AqRingCenter>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('ringCenter') === 'transparent' ? 'transparent' : 'white'
  })
  const [ringShadow, setRingShadow] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('ringShadow') !== '0'
  })
  const ringStyle = useMemo<AqRingStyle>(
    () => ({ shape: ringShape, showNumber: ringNumber, center: ringCenter, showShadow: ringShadow }),
    [ringShape, ringNumber, ringCenter, ringShadow],
  )
  const handleRingStyleChange = useCallback((style: AqRingStyle) => {
    setRingShape(style.shape)
    setRingNumber(style.showNumber)
    setRingCenter(style.center)
    setRingShadow(style.showShadow)
  }, [])
  const [clusterRadius, setClusterRadius] = useState<number>(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('clusterRadius')
    return raw === null ? REVEAL_CLUSTER_DEFAULTS.radius : clampRevealClusterRadius(Number(raw))
  })
  const [clusterMaxZoom, setClusterMaxZoom] = useState<number>(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('clusterMaxZoom')
    return raw === null ? REVEAL_CLUSTER_DEFAULTS.maxZoom : clampRevealClusterMaxZoom(Number(raw))
  })
  const [clusterColorScheme, setClusterColorScheme] = useState<AqClusterColorScheme>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('clusterColors') === 'classic' ? 'classic' : 'slate'
  })
  const [tightClusters, setTightClusters] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('tightClusters') === '1'
  })
  const [mobileFeatureDisplay, setMobileFeatureDisplay] = useState<MobileFeatureDisplay>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('feature') === 'popup' ? 'popup' : 'card'
  })
  const effectiveMobileFeatureDisplay: MobileFeatureDisplay = isMain ? 'card' : mobileFeatureDisplay
  const [mainBasemapOverride, setMainBasemapOverride] = useState<AqBasemap | null>(() =>
    initialUrlState.basemap === 'topographic' ? 'topographic' : null,
  )
  const themeBasemap: AqBasemap = resolvedTheme === 'dark' ? 'dark' : 'light'
  const basemap: AqBasemap = isMain ? mainBasemapOverride ?? themeBasemap : themeBasemap
  const windBasemapTone = basemap === 'dark' ? 'dark' : 'light'
  const [mapView, setMapView] = useState(() => initialUrlState.mapView)
  const [locale, setLocale] = useState<AqmapLocale>(() => initialUrlState.locale)
  const [windVisible, setWindVisible] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('wind') === '1' || (isMain && initialUrlState.visibleWmsLayers.has('surfaceWinds'))
  })
  const [vectorWindBarbsVisible, setVectorWindBarbsVisible] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('windBarbs') === 'vector'
  })
  const [debugVisible, setDebugVisible] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('debug') === '1'
  })
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [selectedForecastZone, setSelectedForecastZone] = useState<ForecastZoneFeature | null>(null)
  const [hoveredMonitor, setHoveredMonitor] = useState<AirMonitor | null>(null)
  const [exportStatus, setExportStatus] = useState<{ format: ExportFormat | null; error: string | null }>({
    format: null,
    error: null,
  })
  const [forecastZoneData, setForecastZoneData] = useState<ForecastZoneCollection | null>(null)
  const [forecastZoneAssignments, setForecastZoneAssignments] = useState<ForecastZoneAssignmentResult | null>(null)
  const [forecastZoneError, setForecastZoneError] = useState<string | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const [styleStats, setStyleStats] = useState<AqMapStyleStats>(EMPTY_MAP_STYLE_STATS)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const handleMapRef = useCallback((map: maplibregl.Map | null) => {
    mapRef.current = map
    setMapInstance((current) => (current === map ? current : map))
  }, [])
  const activeForecastZoneAssignments =
    forecastZoneAssignments?.forecastZoneData === forecastZoneData && forecastZoneAssignments.monitors === monitors
      ? forecastZoneAssignments.assignments
      : null
  const enrichedMonitors = useMemo<AirMonitor[]>(() => {
    if (!activeForecastZoneAssignments) return monitors
    return monitors.map((monitor) => {
      const assignment = activeForecastZoneAssignments.get(monitorKey(monitor))
      if (!assignment) return monitor

      return {
        ...monitor,
        forecastZoneCode: assignment.code,
        forecastZoneName: assignment.name,
      }
    })
  }, [activeForecastZoneAssignments, monitors])
  // On the main page the monitor icons are locked to MAIN_VIEW_ICON_MODE and the
  // key AQ overlays use the deck.gl snapshot paths. The dedicated /ring route
  // forces ring mode; everywhere else the icon-mode toggle drives it.
  const effIconMode: AqMonitorIconMode = isMain ? MAIN_VIEW_ICON_MODE : iconMode
  const effRingStyle: AqRingStyle = isMain ? MAIN_VIEW_RING_STYLE : ringStyle
  const effActiveFiresMode: ActiveFiresRenderMode = isMain ? 'vector' : activeFiresMode
  const effFireDangerMode: FireDangerRenderMode = isMain ? 'deckgl' : fireDangerMode
  const effFirePerimetersMode: FirePerimetersRenderMode = isMain ? 'vector' : firePerimetersMode
  const effForecastZonesMode: ForecastZonesRenderMode = isMain ? 'vector' : forecastZonesMode
  const effModelledSmokeMode: ModelledSmokeRenderMode = isMain ? 'deckgl' : modelledSmokeMode
  // WMS overlays flipped to the experimental "deck.gl" render mode. Fire danger
  // uses a dedicated tiled vector path. PM2.5 uses a native RAQDPS GRIB-derived
  // vector path. The remaining overlays re-render their WMS/XYZ tiles through
  // deck.gl.
  const deckTileKeys = useMemo<WmsLayerKey[]>(() => {
    const modes: Record<WmsLayerKey, OverlayRenderMode> = {
      modelledPm25: effModelledSmokeMode,
      activeFires: effActiveFiresMode,
      firePerimeters: effFirePerimetersMode,
      fireDanger: effFireDangerMode,
      forecastZones: effForecastZonesMode,
      surfaceWinds: 'raster',
    }
    // Fire danger and PM2.5 have dedicated vector deck.gl paths. Other deck
    // modes re-render the exact same WMS/XYZ tiles as native raster mode.
    return WMS_LAYERS.map((layer) => layer.key).filter(
      (key) =>
        key !== 'fireDanger' &&
        visibleWmsLayers.has(key) &&
        modes[key] === 'deckgl',
    )
  }, [
    effActiveFiresMode,
    effFireDangerMode,
    effFirePerimetersMode,
    effForecastZonesMode,
    effModelledSmokeMode,
    visibleWmsLayers,
  ])
  const fireDangerDeck = visibleWmsLayers.has('fireDanger') && effFireDangerMode === 'deckgl'
  const deckActive = deckTileKeys.length > 0 || fireDangerDeck
  const latestDate = enrichedMonitors
    .map((monitor) => monitor.dateObserved)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)
  const legendVisibleSmokeLayers = useMemo(() => {
    return new Set(visibleSmokeLayers)
  }, [visibleSmokeLayers])
  const legendVisibleWmsLayers = useMemo(() => {
    const next = new Set(visibleWmsLayers)
    if (effModelledSmokeMode === 'vector') {
      next.delete('modelledPm25')
    }
    return next
  }, [effModelledSmokeMode, visibleWmsLayers])

  useEffect(() => {
    if (!visibleWmsLayers.has('forecastZones') || forecastZoneData || forecastZoneError) return
    let cancelled = false

    loadForecastZoneData()
      .then((payload) => {
        if (!cancelled) setForecastZoneData(payload)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Forecast zone monitor join failed', err)
          setForecastZoneError((err as Error).message)
        }
      })

    return () => {
      cancelled = true
    }
  }, [forecastZoneData, forecastZoneError, visibleWmsLayers])

  useEffect(() => {
    if (!forecastZoneData || monitors.length === 0) return

    let cancelled = false
    let idleId: number | null = null
    const idleWindow = window as IdleWindow

    const joinMonitorsToZones = () => {
      const assignments = buildForecastZoneAssignments(monitors, forecastZoneData)
      if (!cancelled) setForecastZoneAssignments({ forecastZoneData, monitors, assignments })
    }

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(joinMonitorsToZones, { timeout: 1000 })
    } else {
      idleId = window.setTimeout(joinMonitorsToZones, 0)
    }

    return () => {
      cancelled = true
      if (idleId !== null && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleId)
      else if (idleId !== null) window.clearTimeout(idleId)
    }
  }, [forecastZoneData, monitors])

  useEffect(() => {
    if (forecastZoneData || forecastZoneError) return
    let cancelled = false
    let idleId: number | null = null
    const idleWindow = window as IdleWindow

    const preload = () => {
      loadForecastZoneData()
        .then((payload) => {
          if (!cancelled) setForecastZoneData(payload)
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Forecast zone preload failed', err)
          }
        })
    }

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(preload, { timeout: 3000 })
    } else {
      idleId = window.setTimeout(preload, 1200)
    }

    return () => {
      cancelled = true
      if (idleId !== null && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleId)
      else if (idleId !== null) window.clearTimeout(idleId)
    }
  }, [forecastZoneData, forecastZoneError])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search)
      const groups = serializeSet(visibleGroups)
      const wms = serializeSet(visibleWmsLayers)
      const smoke = serializeSet(visibleSmokeLayers)
      const networks = serializeSet(visibleNetworks)

      next.delete('basemap')

      if (groups === 'agency,lcm') next.delete('groups')
      else next.set('groups', groups)

      if (isMain) {
        if (networks === serializeSet(new Set(AQ_OBSERVATION_NETWORKS))) next.delete('networks')
        else next.set('networks', networks)
      } else {
        next.delete('networks')
      }

      if (wms) next.set('wms', wms)
      else next.delete('wms')

      if (smoke) next.set('smoke', smoke)
      else next.delete('smoke')

      if (locale === 'en') next.delete('lang')
      else next.set('lang', locale)

      if (windVisible) next.set('wind', '1')
      else next.delete('wind')

      if (vectorWindBarbsVisible) next.set('windBarbs', 'vector')
      else next.delete('windBarbs')

      if (fireDangerMode !== 'raster') next.set('fireDanger', fireDangerMode)
      else next.delete('fireDanger')

      if (fireDangerLegendVariant !== DEFAULT_FIRE_DANGER_LEGEND_VARIANT) {
        next.set('fireDangerLegend', fireDangerLegendVariant)
      } else {
        next.delete('fireDangerLegend')
      }

      if (activeFiresMode !== 'vector') next.set('activeFires', activeFiresMode)
      else next.delete('activeFires')

      if (firePerimetersMode !== 'vector') next.set('firePerimeters', firePerimetersMode)
      else next.delete('firePerimeters')

      if (forecastZonesMode !== 'vector') next.set('forecastZones', forecastZonesMode)
      else next.delete('forecastZones')

      if (modelledSmokeMode !== 'vector') next.set('modelledSmoke', modelledSmokeMode)
      else next.delete('modelledSmoke')

      if (iconMode === 'revealed') next.set('icons', 'revealed')
      else if (iconMode === 'ring') next.set('icons', 'ring')
      else next.delete('icons')

      if (iconMode === 'ring' && ringShape === 'pie') next.set('ringShape', 'pie')
      else next.delete('ringShape')

      if (iconMode === 'ring' && !ringNumber) next.set('ringNumber', '0')
      else next.delete('ringNumber')

      if (iconMode === 'ring' && !ringShadow) next.set('ringShadow', '0')
      else next.delete('ringShadow')

      // Transparent centre only applies to a donut (a pie has no hole).
      if (iconMode === 'ring' && ringShape === 'donut' && ringCenter === 'transparent')
        next.set('ringCenter', 'transparent')
      else next.delete('ringCenter')

      if (iconMode === 'revealed' && clusterRadius !== REVEAL_CLUSTER_DEFAULTS.radius)
        next.set('clusterRadius', String(clusterRadius))
      else next.delete('clusterRadius')

      if (iconMode === 'revealed' && clusterMaxZoom !== REVEAL_CLUSTER_DEFAULTS.maxZoom)
        next.set('clusterMaxZoom', String(clusterMaxZoom))
      else next.delete('clusterMaxZoom')

      if (clusterColorScheme === 'classic') next.set('clusterColors', 'classic')
      else next.delete('clusterColors')

      if (iconMode === 'revealed' && tightClusters) next.set('tightClusters', '1')
      else next.delete('tightClusters')

      if (mobileFeatureDisplay === 'popup') next.set('feature', 'popup')
      else next.delete('feature')

      if (debugVisible) next.set('debug', '1')
      else next.delete('debug')

      next.delete('time')

      if (isValidMapView(mapView)) {
        next.set('lng', mapView.center[0].toFixed(4))
        next.set('lat', mapView.center[1].toFixed(4))
        next.set('z', mapView.zoom.toFixed(2))
      }

      const nextSearch = next.toString()
      const nextHash = serializeAqmapHash({
        basemap: isMain ? mainBasemapOverride ?? 'light' : 'light',
        visibleGroups,
        visibleWmsLayers,
        visibleSmokeLayers,
        selectedTimestamp: '',
        mapView,
        locale,
      })
      if (nextSearch !== window.location.search.slice(1) || nextHash !== window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}?${nextSearch}${nextHash}`)
      }
    }, URL_UPDATE_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [
    activeFiresMode,
    basemap,
    clusterColorScheme,
    clusterMaxZoom,
    clusterRadius,
    debugVisible,
    fireDangerMode,
    fireDangerLegendVariant,
    firePerimetersMode,
    forecastZonesMode,
    iconMode,
    isMain,
    locale,
    mainBasemapOverride,
    mapView,
    mobileFeatureDisplay,
    modelledSmokeMode,
    ringShape,
    ringNumber,
    ringCenter,
    ringShadow,
    tightClusters,
    vectorWindBarbsVisible,
    visibleGroups,
    visibleNetworks,
    visibleSmokeLayers,
    visibleWmsLayers,
    windVisible,
  ])

  const toggleGroup = useCallback((group: AqMonitorGroup) => {
    setVisibleGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const toggleNetwork = useCallback((network: AqNetworkSlug) => {
    setVisibleNetworks((current) => {
      const next = new Set(current)
      if (next.has(network)) next.delete(network)
      else next.add(network)
      return next
    })
  }, [])

  const toggleWmsLayer = useCallback((layer: WmsLayerKey) => {
    setVisibleWmsLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const toggleSmokeLayer = useCallback((layer: SmokeLayerKey) => {
    setVisibleSmokeLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const resetView = useCallback(() => {
    setMapView({ center: CANADA_CENTER, zoom: DEFAULT_ZOOM })
  }, [])

  const handleMonitorClick = useCallback((monitor: AirMonitor) => {
    setSelectedForecastZone(null)
    setSelectedMonitor((current) => (current?.id === monitor.id ? null : monitor))
  }, [])

  const handleMonitorHover = useCallback(
    (monitor: AirMonitor | null) => {
      if (isMobileViewport) {
        return
      }
      setHoveredMonitor(monitor)
    },
    [isMobileViewport],
  )

  const handleForecastZoneClick = useCallback((zone: ForecastZoneFeature) => {
    setSelectedMonitor(null)
    if (!isMobileViewport || effectiveMobileFeatureDisplay !== 'card') {
      setSelectedForecastZone(null)
      return false
    }
    setSelectedForecastZone(zone)
    return true
  }, [effectiveMobileFeatureDisplay, isMobileViewport])

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!mapRef.current) return
      setExportStatus({ format, error: null })
      try {
        await exportAqmap(format, {
          map: mapRef.current,
          container: mapContainerRef.current,
          baseName: 'aqmap',
        })
        setExportStatus({ format: null, error: null })
      } catch (error) {
        console.error('AQmap export failed', error)
        setExportStatus({ format: null, error: translate('export.failed', locale) })
      }
    },
    [locale],
  )

  const toggleWind = useCallback(() => setWindVisible((value) => !value), [])
  const toggleVectorWindBarbs = useCallback(() => setVectorWindBarbsVisible((value) => !value), [])
  useEffect(() => {
    if (!mapInstance) return

    let frameId: number | null = null
    const updateStyleStats = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const next = mapStyleStats(mapInstance)
        setStyleStats((current) => (mapStyleStatsEqual(current, next) ? current : next))
      })
    }

    updateStyleStats()
    mapInstance.on('idle', updateStyleStats)
    mapInstance.on('load', updateStyleStats)
    mapInstance.on('sourcedata', updateStyleStats)
    mapInstance.on('styledata', updateStyleStats)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      mapInstance.off('idle', updateStyleStats)
      mapInstance.off('load', updateStyleStats)
      mapInstance.off('sourcedata', updateStyleStats)
      mapInstance.off('styledata', updateStyleStats)
    }
  }, [
    deckActive,
    deckTileKeys,
    effActiveFiresMode,
    effFireDangerMode,
    effFirePerimetersMode,
    effForecastZonesMode,
    effModelledSmokeMode,
    fireDangerDeck,
    mapInstance,
    smokeLayers,
    visibleSmokeLayers,
    visibleWmsLayers,
  ])
  const selectedMonitorWithZone = useMemo(() => {
    if (!selectedMonitor) return null
    return (
      enrichedMonitors.find(
        (monitor) =>
          monitor.id === selectedMonitor.id &&
          monitor.network === selectedMonitor.network &&
          monitor.latitude === selectedMonitor.latitude &&
          monitor.longitude === selectedMonitor.longitude,
      ) ?? selectedMonitor
    )
  }, [enrichedMonitors, selectedMonitor])

  // Nearest regulatory (FEM) monitor for the "Compare → With Nearby FEM" plot.
  // Only relevant for low-cost sensors (PurpleAir / AQegg) and within ~150 km.
  const nearbyFem = useMemo<NearbyFem | null>(() => {
    if (!selectedMonitorWithZone) return null
    if (selectedMonitorWithZone.network !== 'PA' && selectedMonitorWithZone.network !== 'EGG') return null
    let best: NearbyFem | null = null
    for (const candidate of enrichedMonitors) {
      if (!isFemMonitor(candidate)) continue
      const distance = distanceKm(selectedMonitorWithZone, candidate)
      if (!best || distance < best.distanceKm) best = { monitor: candidate, distanceKm: distance }
    }
    return best && best.distanceKm <= 150 ? best : null
  }, [enrichedMonitors, selectedMonitorWithZone])

  const debugInfo = useMemo<AqMapDebugInfo>(() => {
    return {
      zoom: mapView.zoom,
      center: mapView.center,
      visibleWmsLayers: [...visibleWmsLayers].sort(),
      visibleSmokeLayers: [...visibleSmokeLayers].sort(),
      deckTileKeys: [...deckTileKeys].sort(),
      fireDangerDeck,
      renderModes: {
        modelledPm25: effModelledSmokeMode,
        activeFires: effActiveFiresMode,
        fireDanger: effFireDangerMode,
        firePerimeters: effFirePerimetersMode,
        forecastZones: effForecastZonesMode,
      },
      mapLayerCount: styleStats.layerCount,
      mapSourceCount: styleStats.sourceCount,
      selectedFeature: selectedMonitorWithZone
        ? `monitor:${selectedMonitorWithZone.id}`
        : selectedForecastZone
          ? `forecast-zone:${selectedForecastZone.properties?.CLC ?? selectedForecastZone.properties?.FEATURE_ID ?? 'selected'}`
          : 'none',
    }
  }, [
    deckTileKeys,
    effActiveFiresMode,
    effFireDangerMode,
    effFirePerimetersMode,
    effForecastZonesMode,
    effModelledSmokeMode,
    fireDangerDeck,
    mapView,
    selectedForecastZone,
    selectedMonitorWithZone,
    styleStats,
    visibleSmokeLayers,
    visibleWmsLayers,
  ])

  const sidebar = (
    <AqMapSidebar
      monitors={enrichedMonitors}
      smokeLayers={smokeLayers}
      visibleGroups={visibleGroups}
      onToggleGroup={toggleGroup}
      iconMode={iconMode}
      onIconModeChange={setIconMode}
      ringStyle={ringStyle}
      onRingStyleChange={handleRingStyleChange}
      clusterColorScheme={clusterColorScheme}
      onClusterColorSchemeChange={setClusterColorScheme}
      clusterRadius={clusterRadius}
      onClusterRadiusChange={setClusterRadius}
      clusterMaxZoom={clusterMaxZoom}
      onClusterMaxZoomChange={setClusterMaxZoom}
      tightClusters={tightClusters}
      onTightClustersChange={setTightClusters}
      mobileFeatureDisplay={mobileFeatureDisplay}
      onMobileFeatureDisplayChange={setMobileFeatureDisplay}
      visibleWmsLayers={visibleWmsLayers}
      onToggleWmsLayer={toggleWmsLayer}
      visibleSmokeLayers={visibleSmokeLayers}
      onToggleSmokeLayer={toggleSmokeLayer}
      activeFiresMode={activeFiresMode}
      onActiveFiresModeChange={setActiveFiresMode}
      fireDangerMode={fireDangerMode}
      onFireDangerModeChange={setFireDangerMode}
      fireDangerLegendVariant={fireDangerLegendVariant}
      onFireDangerLegendVariantChange={setFireDangerLegendVariant}
      firePerimetersMode={firePerimetersMode}
      onFirePerimetersModeChange={setFirePerimetersMode}
      forecastZonesMode={forecastZonesMode}
      onForecastZonesModeChange={setForecastZonesMode}
      modelledSmokeMode={modelledSmokeMode}
      onModelledSmokeModeChange={setModelledSmokeMode}
      windVisible={windVisible}
      onToggleWind={toggleWind}
      vectorWindBarbsVisible={vectorWindBarbsVisible}
      onToggleVectorWindBarbs={toggleVectorWindBarbs}
      debugVisible={debugVisible}
      onDebugVisibleChange={setDebugVisible}
      debugInfo={debugInfo}
      locale={locale}
      onLocaleChange={setLocale}
      onExport={handleExport}
      exportStatus={exportStatus}
      loading={loading}
      error={error || smokeError}
    />
  )

  return (
    <MapSectionLayout
      sidebar={isMain ? null : sidebar}
      disableSidebar={isMain}
      showDesktopSidebar={!isMain && showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((value) => !value)}
      desktopSidebarWidth={360}
      mobileInitialSheetState="half"
      mobilePeek={<div className="text-sm font-semibold text-foreground">{translate('app.title', locale)}</div>}
    >
      <div ref={mapContainerRef} className="relative h-full w-full">
        <PgMap
          key={basemap}
          ref={handleMapRef}
          viewport={{
            center: mapView.center,
            zoom: mapView.zoom,
          }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          attributionControl={false}
          renderWorldCopies
          styles={BASEMAP_STYLES[basemap]}
          // Symbol labels fade out over fadeDuration (default 300ms) while
          // circle layers cut instantly. Setting it to 0 keeps the cluster
          // count from lingering after its bubble vanishes on zoom.
          fadeDuration={0}
          loading={loading}
          onViewportChange={(viewport) => {
            if (!isValidMapView(viewport)) return
            setMapView({
              center: viewport.center,
              zoom: viewport.zoom,
            })
          }}
        >
          {smokeLayers.map((layer) => (
            <SmokePolygonLayer
              key={layer.key}
              definition={layer}
              visible={
                layer.key === 'modelledSmoke'
                  ? visibleSmokeLayers.has('modelledSmoke')
                  : visibleSmokeLayers.has(layer.key)
              }
            />
          ))}
          {WMS_LAYERS.map((layer) => (
            <WmsRasterLayer
              key={layer.key}
              definition={layer}
              visible={
                visibleWmsLayers.has(layer.key) &&
                (layer.key !== 'surfaceWinds' || !isMain) &&
                (layer.key !== 'activeFires' || effActiveFiresMode === 'raster') &&
                (layer.key !== 'fireDanger' || effFireDangerMode === 'raster') &&
                (layer.key !== 'firePerimeters' || effFirePerimetersMode === 'raster') &&
                (layer.key !== 'forecastZones' || effForecastZonesMode === 'raster') &&
                (layer.key !== 'modelledPm25' || effModelledSmokeMode === 'raster')
              }
            />
          ))}
          <ActiveFiresVectorLayer visible={visibleWmsLayers.has('activeFires') && effActiveFiresMode === 'vector'} />
          <ModelledPm25VectorLayer
            visible={visibleWmsLayers.has('modelledPm25') && effModelledSmokeMode === 'vector'}
          />
          <FireDangerVectorLayer visible={visibleWmsLayers.has('fireDanger') && effFireDangerMode === 'vector'} />
          <FirePerimetersVectorLayer
            visible={visibleWmsLayers.has('firePerimeters') && effFirePerimetersMode === 'vector'}
          />
          <ForecastZonesVectorLayer
            visible={visibleWmsLayers.has('forecastZones') && effForecastZonesMode === 'vector'}
            data={forecastZoneData}
            monitors={enrichedMonitors}
            onZoneClick={handleForecastZoneClick}
          />
          {deckActive && (
            <Suspense fallback={null}>
              <AqMapDeckOverlay
                tileKeys={deckTileKeys}
                fireDangerActive={fireDangerDeck}
                suppressHoverPopups={Boolean(hoveredMonitor || selectedMonitor || selectedMonitorWithZone)}
              />
            </Suspense>
          )}
          <WindCanvasLayer visible={windVisible} basemap={windBasemapTone} />
          <VectorWindBarbLayer visible={vectorWindBarbsVisible} basemap={windBasemapTone} />
          <AqMonitorLayer
            key={effIconMode}
            monitors={enrichedMonitors}
            visibleGroups={visibleGroups}
            visibleNetworks={isMain ? visibleNetworks : undefined}
            iconMode={effIconMode}
            ringStyle={effRingStyle}
            darkBasemap={basemap === 'dark'}
            clusterColorScheme={clusterColorScheme}
            clusterRadius={clusterRadius}
            clusterMaxZoom={clusterMaxZoom}
            tightClusters={tightClusters}
            onMonitorClick={handleMonitorClick}
            onMonitorHover={handleMonitorHover}
          />
          {!isMobileViewport && hoveredMonitor && selectedMonitorWithZone !== hoveredMonitor && (
            <MonitorTooltip monitor={hoveredMonitor} locale={locale} />
          )}
          {selectedMonitorWithZone && (!isMobileViewport || effectiveMobileFeatureDisplay === 'popup') && (
            <MonitorPopup
              monitor={selectedMonitorWithZone}
              locale={locale}
              nearbyFem={nearbyFem}
              onClose={() => setSelectedMonitor(null)}
            />
          )}
          {selectedMonitorWithZone && isMobileViewport && effectiveMobileFeatureDisplay === 'card' && (
            <MobileAqMonitorFeatureCard
              monitor={selectedMonitorWithZone}
              locale={locale}
              nearbyFem={nearbyFem}
              onClose={() => setSelectedMonitor(null)}
            />
          )}
          {selectedForecastZone && isMobileViewport && effectiveMobileFeatureDisplay === 'card' && (
            <MobileForecastZoneFeatureCard
              zone={selectedForecastZone}
              monitors={enrichedMonitors}
              onClose={() => setSelectedForecastZone(null)}
            />
          )}
          {isMain ? (
            <MainLayerControl
              basemap={basemap}
              onBasemapChange={(nextBasemap) =>
                setMainBasemapOverride(nextBasemap === 'topographic' ? 'topographic' : null)
              }
              visibleNetworks={visibleNetworks}
              onToggleNetwork={toggleNetwork}
              visibleWmsLayers={visibleWmsLayers}
              onToggleWmsLayer={toggleWmsLayer}
              surfaceWindVisible={windVisible}
              onToggleSurfaceWind={toggleWind}
              visibleSmokeLayers={visibleSmokeLayers}
              onToggleSmokeLayer={toggleSmokeLayer}
              smokeLayers={smokeLayers}
              locale={locale}
            />
          ) : (
            !isMobileViewport && (
              <FloatingLayerControl
                visibleGroups={visibleGroups}
                onToggleGroup={toggleGroup}
                iconMode={iconMode}
                onIconModeChange={setIconMode}
                ringStyle={ringStyle}
                onRingStyleChange={handleRingStyleChange}
                clusterColorScheme={clusterColorScheme}
                onClusterColorSchemeChange={setClusterColorScheme}
                clusterRadius={clusterRadius}
                onClusterRadiusChange={setClusterRadius}
                clusterMaxZoom={clusterMaxZoom}
                onClusterMaxZoomChange={setClusterMaxZoom}
                tightClusters={tightClusters}
                onTightClustersChange={setTightClusters}
                visibleWmsLayers={visibleWmsLayers}
                onToggleWmsLayer={toggleWmsLayer}
                visibleSmokeLayers={visibleSmokeLayers}
                onToggleSmokeLayer={toggleSmokeLayer}
                activeFiresMode={activeFiresMode}
                onActiveFiresModeChange={setActiveFiresMode}
                fireDangerMode={fireDangerMode}
                onFireDangerModeChange={setFireDangerMode}
                fireDangerLegendVariant={fireDangerLegendVariant}
                onFireDangerLegendVariantChange={setFireDangerLegendVariant}
                firePerimetersMode={firePerimetersMode}
                onFirePerimetersModeChange={setFirePerimetersMode}
                forecastZonesMode={forecastZonesMode}
                onForecastZonesModeChange={setForecastZonesMode}
                modelledSmokeMode={modelledSmokeMode}
                onModelledSmokeModeChange={setModelledSmokeMode}
                windVisible={windVisible}
                onToggleWind={toggleWind}
                vectorWindBarbsVisible={vectorWindBarbsVisible}
                onToggleVectorWindBarbs={toggleVectorWindBarbs}
                smokeLayers={smokeLayers}
                locale={locale}
              />
            )
          )}
          <AqMonitorLegend
            visibleWmsLayers={legendVisibleWmsLayers}
            visibleSmokeLayers={legendVisibleSmokeLayers}
            smokeLayers={smokeLayers}
            windVisible={windVisible}
            vectorWindBarbsVisible={vectorWindBarbsVisible}
            fireDangerLegendVariant={fireDangerLegendVariant}
            locale={locale}
          />
          <MapUtilityControls onReset={resetView} locale={locale} />
          <MapStatusBar latestDate={latestDate} locale={locale} />
        </PgMap>
      </div>
    </MapSectionLayout>
  )
}

function MobileForecastZoneFeatureCard({
  zone,
  monitors,
  onClose,
}: {
  zone: ForecastZoneFeature
  monitors: AirMonitor[]
  onClose: () => void
}) {
  const zoneName = getForecastZoneName(zone.properties) ?? 'Forecast zone'
  const columns = ['FEM', 'PA', 'EGG', 'ALL'] as const
  const grouped = useMemo(() => {
    const zoneMonitors = getForecastZoneMonitors(zone, monitors)
    return {
      FEM: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'FEM'),
      PA: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'PA'),
      EGG: zoneMonitors.filter((monitor) => getForecastZoneMonitorGroup(monitor) === 'EGG'),
      ALL: zoneMonitors,
    }
  }, [monitors, zone])
  const rows = [
    {
      label: '# of Monitors',
      values: columns.map((column) => String(grouped[column].length)),
    },
    {
      label: (
        <>
          1hr PM2.5 (&micro;g m<sup>-3</sup>)
        </>
      ),
      values: columns.map((column) => formatForecastZoneMean(mean(grouped[column].map((monitor) => monitor.pm25OneHour)))),
    },
    {
      label: (
        <>
          24hr PM2.5 (&micro;g m<sup>-3</sup>)
        </>
      ),
      values: columns.map((column) => formatForecastZoneMean(mean(grouped[column].map((monitor) => monitor.pm25TwentyFourHour)))),
    },
  ]

  return (
    <MobileFeatureCard
      title={`Forecast Zone: ${zoneName}`}
      subtitle="Forecast zone"
      cardKey={`forecast-zone:${String(zone.properties?.FEATURE_ID ?? zone.properties?.CLC ?? zoneName)}`}
      onClose={onClose}
    >
      <div className="space-y-3 text-xs text-foreground">
        <div className="overflow-x-auto rounded-md border border-border bg-background p-3">
          <table className="w-full min-w-[18rem] border-collapse text-xs">
            <thead>
              <tr>
                <th className="whitespace-nowrap py-1 pr-3 text-left font-medium text-muted-foreground" />
                {columns.map((column) => (
                  <th key={column} className="px-2 py-1 text-right font-semibold text-foreground">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.label)} className="border-t border-border">
                  <td className="whitespace-nowrap py-1 pr-3 text-muted-foreground">{row.label}</td>
                  {row.values.map((value, index) => (
                    <td
                      key={`${String(row.label)}:${columns[index]}`}
                      className="px-2 py-1 text-right font-medium tabular-nums text-foreground"
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </MobileFeatureCard>
  )
}

function MobileAqMonitorFeatureCard({
  monitor,
  locale,
  nearbyFem,
  onClose,
}: {
  monitor: AirMonitor
  locale: AqmapLocale
  nearbyFem?: NearbyFem | null
  onClose: () => void
}) {
  const pm25 = getMonitorAqhiPm25(monitor)
  const aqhiCategory = getAqhiCategory(pm25)
  const health = localizeHealthMessage(aqhiCategory, locale)
  const monitorTypeLabel = localizeMonitorType(monitor.network, locale)
  const unit = translate('aqhi.unit', locale)
  const aqColor = getAqhiPlusColor(pm25)
  const categoryLabel = formatAqhiCategory(aqhiCategory, locale)
  const isNoData = pm25 === null
  const observationRows = buildObservationRowLabels(locale)
    .map((row) => {
      const valueByKey: Record<string, number | null> = {
        pm25_10min: monitor.pm25Recent ?? null,
        pm25_1hr: monitor.pm25OneHour ?? null,
        pm25_3hr: monitor.pm25ThreeHour ?? null,
        pm25_24hr: monitor.pm25TwentyFourHour ?? null,
      }
      return { ...row, value: valueByKey[row.key] ?? null }
    })
    .filter((row) => !isFemMonitor(monitor) || row.key !== 'pm25_10min')

  return (
    <MobileFeatureCard
      title={monitor.name}
      subtitle={`${monitorTypeLabel} ${translate('popup.monitor', locale)}`}
      cardKey={monitor.id}
      onClose={onClose}
    >
      <div className="space-y-3 text-xs text-foreground">
        <div className="rounded-md border border-border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-foreground"
              style={{ backgroundColor: `${aqColor}26` }}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: aqColor }} aria-hidden="true" />
              {categoryLabel}
              <span className="font-normal text-muted-foreground">·</span>
              <span className="tabular-nums">
                {formatAqmapPm25Localized(pm25, locale)} {unit}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {formatLocalizedDate(monitor.dateObserved, locale)}
            </span>
          </div>
          {monitor.forecastZoneName && (
            <div className="mt-2 flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{translate('popup.forecastZone', locale)}</span>
              <span className="max-w-[13rem] text-right font-medium text-foreground">{monitor.forecastZoneName}</span>
            </div>
          )}
          <div className="mt-1 flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Network</span>
            <span className="font-medium text-foreground">{monitor.network}</span>
          </div>
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {translate('popup.readings', locale)}
          </div>
          <div className="space-y-1.5">
            {observationRows.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3" title={row.title}>
                <span className="text-muted-foreground">{row.label}</span>
                <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: getAqhiPlusColor(row.value) }}
                    aria-hidden="true"
                  />
                  {formatAqmapPm25Localized(row.value, locale)}
                  <span className="font-normal text-muted-foreground">{unit}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div
            className="text-xs font-semibold leading-snug text-foreground"
            title={translate('popup.healthMessage', locale)}
          >
            {health.heading}
          </div>
          <div className="mt-2 space-y-1.5">
            {health.lines.map((line, index) => {
              const { label, detail } = splitHealthLine(line)
              const Icon = isNoData ? AlertCircle : index === 0 ? Users : HeartPulse
              return (
                <div key={line} className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">
                    {label && <span className="font-medium text-foreground">{label}: </span>}
                    {detail}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <MonitorPlotPanel monitor={monitor} locale={locale} nearbyFem={nearbyFem} />
      </div>
    </MobileFeatureCard>
  )
}
