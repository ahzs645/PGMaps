import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY, MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { Map as PgMap, MapControls } from '@/components/ui/map'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAirQualityData, type AirMonitor } from '@/maps/airquality'
import { getAqhiCategory, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import {
  type AqBasemap,
  type AqMonitorGroup,
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
import type { ActiveFiresRenderMode, AqClusterColorScheme, AqMonitorIconMode, FireDangerRenderMode, FirePerimetersRenderMode, ForecastZoneFeatureProperties, ForecastZonesRenderMode, MobileFeatureDisplay, ModelledSmokeRenderMode } from './lib/aqMapTypes'
import { FloatingLayerControl, MapTimestamp, MapUtilityControls, ScaleBar } from './components/AqMapControls'
import { AqMonitorLegend } from './components/AqMapLegends'
import { AqMapSidebar } from './components/AqMapSidebar'
import { ActiveFiresVectorLayer, AqMonitorLayer, FireDangerVectorLayer, FirePerimetersVectorLayer, ForecastZonesVectorLayer, ModelledPm25VectorLayer, SmokePolygonLayer, WmsRasterLayer } from './components/AqMapLayers'
import { MonitorPopup, MonitorTooltip } from './components/MonitorPopup'
import { WindCanvasLayer } from './components/WindCanvasLayer'
import { VectorWindBarbLayer } from './components/VectorWindBarbLayer'
import type maplibregl from 'maplibre-gl'

type ForecastZoneFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>
type ForecastZoneCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ForecastZoneFeatureProperties>

function pointInRing(lng: number, lat: number, ring: GeoJSON.Position[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const xi = Number(ring[index][0])
    const yi = Number(ring[index][1])
    const xj = Number(ring[previous][0])
    const yj = Number(ring[previous][1])
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
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

export default function AqMapSection() {
  const { resolvedTheme } = useTheme()
  const { monitors, loading, error } = useAirQualityData({ aqmapCompatible: true })
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const { layers: smokeLayers, error: smokeError } = useAqmapSmokeLayers()
  const initialUrlState = useMemo(() => parseAqmapHash(window.location.hash, new URLSearchParams(window.location.search)), [])
  const [showSidebar, setShowSidebar] = useState(false)
  const [visibleGroups, setVisibleGroups] = useState<Set<AqMonitorGroup>>(() => initialUrlState.visibleGroups)
  const [visibleWmsLayers, setVisibleWmsLayers] = useState<Set<WmsLayerKey>>(() => initialUrlState.visibleWmsLayers)
  const [visibleSmokeLayers, setVisibleSmokeLayers] = useState<Set<SmokeLayerKey>>(() => initialUrlState.visibleSmokeLayers)
  const [activeFiresMode, setActiveFiresMode] = useState<ActiveFiresRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
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
  const [exportStatus, setExportStatus] = useState<{ format: ExportFormat | null; error: string | null }>({ format: null, error: null })
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
    if (modelledSmokeMode === 'vector') {
      next.delete('modelledPm25')
    }
    return next
  }, [modelledSmokeMode, visibleWmsLayers])

  useEffect(() => {
    if (!visibleWmsLayers.has('forecastZones') || forecastZoneData || forecastZoneError) return
    const controller = new AbortController()

    fetch(FORECAST_ZONES_VECTOR_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load forecast zones: ${response.status}`)
        return response.json()
      })
      .then((payload) => setForecastZoneData(payload as ForecastZoneCollection))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          console.error('Forecast zone monitor join failed', err)
          setForecastZoneError((err as Error).message)
        }
      })

    return () => controller.abort()
  }, [forecastZoneData, forecastZoneError, visibleWmsLayers])

  useEffect(() => {
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

      if (iconMode === 'revealed' && clusterRadius !== REVEAL_CLUSTER_DEFAULTS.radius) next.set('clusterRadius', String(clusterRadius))
      else next.delete('clusterRadius')

      if (iconMode === 'revealed' && clusterMaxZoom !== REVEAL_CLUSTER_DEFAULTS.maxZoom) next.set('clusterMaxZoom', String(clusterMaxZoom))
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
  }, [activeFiresMode, basemap, clusterColorScheme, clusterMaxZoom, clusterRadius, fireDangerMode, firePerimetersMode, forecastZonesMode, iconMode, locale, mapView, mobileFeatureDisplay, modelledSmokeMode, tightClusters, vectorWindBarbsVisible, visibleGroups, visibleSmokeLayers, visibleWmsLayers, windVisible])

  const toggleGroup = useCallback((group: AqMonitorGroup) => {
    setVisibleGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
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
    setSelectedMonitor((current) => current?.id === monitor.id ? null : monitor)
  }, [])

  const handleExport = useCallback(async (format: ExportFormat) => {
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
  }, [locale])

  const toggleWind = useCallback(() => setWindVisible((value) => !value), [])
  const toggleVectorWindBarbs = useCallback(() => setVectorWindBarbsVisible((value) => !value), [])
  const selectedMonitorWithZone = useMemo(() => {
    if (!selectedMonitor) return null
    return enrichedMonitors.find((monitor) => (
      monitor.id === selectedMonitor.id
      && monitor.network === selectedMonitor.network
      && monitor.latitude === selectedMonitor.latitude
      && monitor.longitude === selectedMonitor.longitude
    )) ?? selectedMonitor
  }, [enrichedMonitors, selectedMonitor])

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
      sidebar={sidebar}
      showDesktopSidebar={showSidebar}
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
              visible={layer.key === 'modelledSmoke'
                ? visibleSmokeLayers.has('modelledSmoke')
                : visibleSmokeLayers.has(layer.key)}
            />
          ))}
          {WMS_LAYERS.map((layer) => (
            <WmsRasterLayer
              key={layer.key}
              definition={layer}
              visible={visibleWmsLayers.has(layer.key)
                && (layer.key !== 'activeFires' || activeFiresMode === 'raster')
                && (layer.key !== 'fireDanger' || fireDangerMode === 'raster')
                && (layer.key !== 'firePerimeters' || firePerimetersMode === 'raster')
                && (layer.key !== 'forecastZones' || forecastZonesMode === 'raster')
                && (layer.key !== 'modelledPm25' || modelledSmokeMode === 'raster')}
            />
          ))}
          <ActiveFiresVectorLayer visible={visibleWmsLayers.has('activeFires') && activeFiresMode === 'vector'} />
          <ModelledPm25VectorLayer visible={visibleWmsLayers.has('modelledPm25') && modelledSmokeMode === 'vector'} />
          <FireDangerVectorLayer visible={visibleWmsLayers.has('fireDanger') && fireDangerMode === 'vector'} />
          <FirePerimetersVectorLayer visible={visibleWmsLayers.has('firePerimeters') && firePerimetersMode === 'vector'} />
          <ForecastZonesVectorLayer visible={visibleWmsLayers.has('forecastZones') && forecastZonesMode === 'vector'} />
          <WindCanvasLayer visible={windVisible} basemap={basemap} />
          <VectorWindBarbLayer visible={vectorWindBarbsVisible} basemap={basemap} />
          <AqMonitorLayer
            key={iconMode}
            monitors={enrichedMonitors}
            visibleGroups={visibleGroups}
            iconMode={iconMode}
            clusterColorScheme={clusterColorScheme}
            clusterRadius={clusterRadius}
            clusterMaxZoom={clusterMaxZoom}
            tightClusters={tightClusters}
            onMonitorClick={handleMonitorClick}
            onMonitorHover={setHoveredMonitor}
          />
          {hoveredMonitor && selectedMonitorWithZone !== hoveredMonitor && <MonitorTooltip monitor={hoveredMonitor} locale={locale} />}
          {selectedMonitorWithZone && (!isMobileViewport || mobileFeatureDisplay === 'popup') && (
            <MonitorPopup monitor={selectedMonitorWithZone} locale={locale} onClose={() => setSelectedMonitor(null)} />
          )}
          {selectedMonitorWithZone && isMobileViewport && mobileFeatureDisplay === 'card' && (
            <MobileAqMonitorFeatureCard
              monitor={selectedMonitorWithZone}
              locale={locale}
              onClose={() => setSelectedMonitor(null)}
            />
          )}
          {!isMobileViewport && (
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
          <MapTimestamp latestDate={latestDate} locale={locale} />
          <ScaleBar />
          <MapControls showFullscreen />
        </PgMap>
      </div>
    </MapSectionLayout>
  )
}

function MobileAqMonitorFeatureCard({
  monitor,
  locale,
  onClose,
}: {
  monitor: AirMonitor
  locale: AqmapLocale
  onClose: () => void
}) {
  const pm25 = getMonitorAqhiPm25(monitor)
  const aqhiCategory = getAqhiCategory(pm25)
  const health = localizeHealthMessage(aqhiCategory, locale)
  const monitorTypeLabel = localizeMonitorType(monitor.network, locale)

  return (
    <MobileFeatureCard
      title={monitor.name}
      subtitle={`${monitorTypeLabel} ${translate('popup.monitor', locale)}`}
      cardKey={monitor.id}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-background p-3 text-xs text-foreground">
        <div className="space-y-1">
          {[
            { label: 'Observed', value: formatLocalizedDate(monitor.dateObserved, locale) },
            { label: 'PM2.5', value: `${formatAqmapPm25Localized(pm25, locale)} ${translate('aqhi.unit', locale)}` },
            monitor.forecastZoneName ? { label: translate('popup.forecastZone', locale), value: monitor.forecastZoneName } : null,
            { label: translate('popup.healthMessage', locale), value: health.heading },
            { label: 'Network', value: monitor.network },
          ].filter((row): row is { label: string; value: string } => row !== null).map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="max-w-[12rem] text-right font-medium text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </MobileFeatureCard>
  )
}
