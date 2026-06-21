import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { AlertCircle, HeartPulse, Users } from 'lucide-react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { Map as PgMap } from '@/components/ui/map'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAirQualityData, type AirMonitor } from '@/maps/airquality'
import { distanceKm, getAqhiCategory, getMonitorAqhiPm25, isFemMonitor } from '@/maps/airquality/lib/monitorPopup'
import {
  AQ_OBSERVATION_NETWORKS,
  type AqBasemap,
  type AqMonitorGroup,
  type AqNetworkSlug,
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
  FireDangerRenderMode,
  FirePerimetersRenderMode,
  ForecastZoneFeatureProperties,
  ForecastZonesRenderMode,
  MobileFeatureDisplay,
  ModelledSmokeRenderMode,
} from './lib/aqMapTypes'
import { getAqhiPlusColor } from './lib/aqhiScale'
import { FloatingLayerControl, MainLayerControl, MapStatusBar, MapUtilityControls } from './components/AqMapControls'
import { AqMonitorLegend } from './components/AqMapLegends'
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

let forecastZoneDataCache: ForecastZoneCollection | null = null
let forecastZoneDataPromise: Promise<ForecastZoneCollection> | null = null

function loadForecastZoneData(): Promise<ForecastZoneCollection> {
  if (forecastZoneDataCache) return Promise.resolve(forecastZoneDataCache)

  forecastZoneDataPromise ??= fetch(FORECAST_ZONES_VECTOR_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load forecast zones: ${response.status}`)
      return response.json()
    })
    .then((payload) => {
      forecastZoneDataCache = payload as ForecastZoneCollection
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

function pointInForecastZone(monitor: AirMonitor, zone: ForecastZoneFeature): boolean {
  const { longitude, latitude } = monitor
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

function splitHealthLine(line: string): { label: string; detail: string } {
  const match = line.match(/^(.*?)\s[-—–]\s(.*)$/)
  if (match) return { label: match[1], detail: match[2] }
  return { label: '', detail: line }
}

export default function AqMapSection({ variant = 'full' }: { variant?: 'full' | 'main' } = {}) {
  const isMain = variant === 'main'
  const { resolvedTheme } = useTheme()
  const { monitors, loading, error } = useAirQualityData({ aqmapCompatible: true })
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const { layers: smokeLayers, error: smokeError } = useAqmapSmokeLayers()
  const initialUrlState = useMemo(
    () => parseAqmapHash(window.location.hash, new URLSearchParams(window.location.search)),
    [],
  )
  const [showSidebar, setShowSidebar] = useState(false)
  const [visibleGroups, setVisibleGroups] = useState<Set<AqMonitorGroup>>(() => initialUrlState.visibleGroups)
  // Main page (/dev/aqmap/main) toggles individual observation networks
  // (FEM/PA/EGG) rather than the agency/lcm/other groups. All three start on.
  const [visibleNetworks, setVisibleNetworks] = useState<Set<AqNetworkSlug>>(() => new Set(AQ_OBSERVATION_NETWORKS))
  const [visibleWmsLayers, setVisibleWmsLayers] = useState<Set<WmsLayerKey>>(() => initialUrlState.visibleWmsLayers)
  const [visibleSmokeLayers, setVisibleSmokeLayers] = useState<Set<SmokeLayerKey>>(
    () => initialUrlState.visibleSmokeLayers,
  )
  const [activeFiresMode, setActiveFiresMode] = useState<ActiveFiresRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    if (!import.meta.env.DEV) return 'raster'
    return params.get('activeFires') === 'raster' ? 'raster' : 'vector'
  })
  const [fireDangerMode, setFireDangerMode] = useState<FireDangerRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('fireDanger') === 'vector' ? 'vector' : 'raster'
  })
  const [firePerimetersMode, setFirePerimetersMode] = useState<FirePerimetersRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('firePerimeters') === 'raster' ? 'raster' : 'vector'
  })
  const [forecastZonesMode, setForecastZonesMode] = useState<ForecastZonesRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('forecastZones') === 'raster' ? 'raster' : 'vector'
  })
  const [modelledSmokeMode, setModelledSmokeMode] = useState<ModelledSmokeRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('modelledSmoke') === 'raster' ? 'raster' : 'vector'
  })
  const [iconMode, setIconMode] = useState<AqMonitorIconMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('icons') === 'revealed' ? 'revealed' : 'aqmap'
  })
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
  const basemap: AqBasemap = resolvedTheme === 'dark' ? 'dark' : 'light'
  const [mapView, setMapView] = useState(() => initialUrlState.mapView)
  const [locale, setLocale] = useState<AqmapLocale>(() => initialUrlState.locale)
  const [windVisible, setWindVisible] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('wind') === '1'
  })
  const [vectorWindBarbsVisible, setVectorWindBarbsVisible] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('windBarbs') === 'vector'
  })
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [hoveredMonitor, setHoveredMonitor] = useState<AirMonitor | null>(null)
  const [exportStatus, setExportStatus] = useState<{ format: ExportFormat | null; error: string | null }>({
    format: null,
    error: null,
  })
  const [forecastZoneData, setForecastZoneData] = useState<ForecastZoneCollection | null>(null)
  const [forecastZoneError, setForecastZoneError] = useState<string | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const enrichedMonitors = useMemo<AirMonitor[]>(() => {
    if (!forecastZoneData) return monitors
    return monitors.map((monitor) => {
      const zone = forecastZoneData.features.find((feature) => pointInForecastZone(monitor, feature))
      if (!zone) return monitor
      return {
        ...monitor,
        forecastZoneCode: String(zone.properties?.CLC ?? '').trim() || null,
        forecastZoneName: getForecastZoneName(zone.properties),
      }
    })
  }, [forecastZoneData, monitors])
  // On the main page everything renders as vector and the monitor icons are
  // locked to "reveal" mode — there are no raster/icon-mode toggles to flip.
  const effIconMode: AqMonitorIconMode = isMain ? 'revealed' : iconMode
  const effActiveFiresMode: ActiveFiresRenderMode = !import.meta.env.DEV
    ? 'raster'
    : isMain
      ? 'vector'
      : activeFiresMode
  const effFireDangerMode: FireDangerRenderMode = isMain ? 'raster' : fireDangerMode
  const effFirePerimetersMode: FirePerimetersRenderMode = isMain ? 'vector' : firePerimetersMode
  const effForecastZonesMode: ForecastZonesRenderMode = isMain ? 'vector' : forecastZonesMode
  const effModelledSmokeMode: ModelledSmokeRenderMode = isMain ? 'raster' : modelledSmokeMode
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
    // The main page is a fixed, shareable view — don't mirror its (locked) state to the URL.
    if (isMain) return
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search)
      const groups = serializeSet(visibleGroups)
      const wms = serializeSet(visibleWmsLayers)
      const smoke = serializeSet(visibleSmokeLayers)

      next.delete('basemap')

      if (groups === 'agency,lcm') next.delete('groups')
      else next.set('groups', groups)

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

      if (fireDangerMode === 'vector') next.set('fireDanger', 'vector')
      else next.delete('fireDanger')

      if (activeFiresMode === 'raster') next.set('activeFires', 'raster')
      else next.delete('activeFires')

      if (firePerimetersMode === 'raster') next.set('firePerimeters', 'raster')
      else next.delete('firePerimeters')

      if (forecastZonesMode === 'raster') next.set('forecastZones', 'raster')
      else next.delete('forecastZones')

      if (modelledSmokeMode === 'raster') next.set('modelledSmoke', 'raster')
      else next.delete('modelledSmoke')

      if (iconMode === 'revealed') next.set('icons', 'revealed')
      else next.delete('icons')

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

      next.delete('time')

      if (isValidMapView(mapView)) {
        next.set('lng', mapView.center[0].toFixed(4))
        next.set('lat', mapView.center[1].toFixed(4))
        next.set('z', mapView.zoom.toFixed(2))
      }

      const nextSearch = next.toString()
      const nextHash = serializeAqmapHash({
        basemap: 'light',
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
    fireDangerMode,
    firePerimetersMode,
    forecastZonesMode,
    iconMode,
    isMain,
    locale,
    mapView,
    mobileFeatureDisplay,
    modelledSmokeMode,
    tightClusters,
    vectorWindBarbsVisible,
    visibleGroups,
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

  const handleForecastZoneClick = useCallback(() => {
    setSelectedMonitor(null)
  }, [])

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

  const sidebar = (
    <AqMapSidebar
      monitors={enrichedMonitors}
      smokeLayers={smokeLayers}
      visibleGroups={visibleGroups}
      onToggleGroup={toggleGroup}
      iconMode={iconMode}
      onIconModeChange={setIconMode}
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
          ref={mapRef}
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
          <WindCanvasLayer visible={windVisible} basemap={basemap} />
          <VectorWindBarbLayer visible={vectorWindBarbsVisible} basemap={basemap} />
          <AqMonitorLayer
            key={effIconMode}
            monitors={enrichedMonitors}
            visibleGroups={visibleGroups}
            visibleNetworks={isMain ? visibleNetworks : undefined}
            iconMode={effIconMode}
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
          {isMain ? (
            <MainLayerControl
              visibleNetworks={visibleNetworks}
              onToggleNetwork={toggleNetwork}
              windVisible={windVisible}
              onToggleWind={toggleWind}
              visibleWmsLayers={visibleWmsLayers}
              onToggleWmsLayer={toggleWmsLayer}
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
            locale={locale}
          />
          <MapUtilityControls onReset={resetView} locale={locale} />
          <MapStatusBar latestDate={latestDate} locale={locale} />
        </PgMap>
      </div>
    </MapSectionLayout>
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
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-foreground"
              style={{ backgroundColor: `${aqColor}26` }}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: aqColor }} aria-hidden="true" />
              {categoryLabel}
              <span className="font-normal text-muted-foreground">·</span>
              <span className="tabular-nums">
                {formatAqmapPm25Localized(pm25, locale)} {unit}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">
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
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
            className="text-[11px] font-semibold leading-snug text-foreground"
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
