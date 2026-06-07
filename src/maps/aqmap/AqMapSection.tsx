import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { BASEMAP_STYLES, URL_UPDATE_DELAY_MS } from './lib/aqMapConstants'
import type { AqMonitorIconMode, FireDangerRenderMode, MobileFeatureDisplay } from './lib/aqMapTypes'
import { FloatingLayerControl, MapTimestamp, MapUtilityControls, ScaleBar } from './components/AqMapControls'
import { FloatingLegends } from './components/AqMapLegends'
import { AqMapSidebar } from './components/AqMapSidebar'
import { AqMonitorLayer, FireDangerVectorLayer, SmokePolygonLayer, WmsRasterLayer } from './components/AqMapLayers'
import { MonitorPopup, MonitorTooltip } from './components/MonitorPopup'
import { WindCanvasLayer } from './components/WindCanvasLayer'
import type maplibregl from 'maplibre-gl'

export default function AqMapSection() {
  const { monitors, loading, error } = useAirQualityData({ aqmapCompatible: true })
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const { layers: smokeLayers, error: smokeError } = useAqmapSmokeLayers()
  const initialUrlState = useMemo(() => parseAqmapHash(window.location.hash, new URLSearchParams(window.location.search)), [])
  const [showSidebar, setShowSidebar] = useState(false)
  const [visibleGroups, setVisibleGroups] = useState<Set<AqMonitorGroup>>(() => initialUrlState.visibleGroups)
  const [visibleWmsLayers, setVisibleWmsLayers] = useState<Set<WmsLayerKey>>(() => initialUrlState.visibleWmsLayers)
  const [visibleSmokeLayers, setVisibleSmokeLayers] = useState<Set<SmokeLayerKey>>(() => initialUrlState.visibleSmokeLayers)
  const [fireDangerMode, setFireDangerMode] = useState<FireDangerRenderMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('fireDanger') === 'vector' ? 'vector' : 'raster'
  })
  const [iconMode, setIconMode] = useState<AqMonitorIconMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('icons') === 'revealed' ? 'revealed' : 'aqmap'
  })
  const [mobileFeatureDisplay, setMobileFeatureDisplay] = useState<MobileFeatureDisplay>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('feature') === 'popup' ? 'popup' : 'card'
  })
  const [basemap, setBasemap] = useState<AqBasemap>(() => initialUrlState.basemap)
  const [mapView, setMapView] = useState(() => initialUrlState.mapView)
  const [locale, setLocale] = useState<AqmapLocale>(() => initialUrlState.locale)
  const [windVisible, setWindVisible] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('wind') === '1'
  })
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [hoveredMonitor, setHoveredMonitor] = useState<AirMonitor | null>(null)
  const [exportStatus, setExportStatus] = useState<{ format: ExportFormat | null; error: string | null }>({ format: null, error: null })
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const latestDate = monitors
    .map((monitor) => monitor.dateObserved)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search)
      const groups = serializeSet(visibleGroups)
      const wms = serializeSet(visibleWmsLayers)
      const smoke = serializeSet(visibleSmokeLayers)

      if (basemap === 'light') next.delete('basemap')
      else next.set('basemap', basemap)

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

      if (fireDangerMode === 'vector') next.set('fireDanger', 'vector')
      else next.delete('fireDanger')

      if (iconMode === 'revealed') next.set('icons', 'revealed')
      else next.delete('icons')

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
        basemap,
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
  }, [basemap, fireDangerMode, iconMode, locale, mapView, mobileFeatureDisplay, visibleGroups, visibleSmokeLayers, visibleWmsLayers, windVisible])

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

  const sidebar = (
    <AqMapSidebar
      monitors={monitors}
      smokeLayers={smokeLayers}
      visibleGroups={visibleGroups}
      onToggleGroup={toggleGroup}
      iconMode={iconMode}
      onIconModeChange={setIconMode}
      mobileFeatureDisplay={mobileFeatureDisplay}
      onMobileFeatureDisplayChange={setMobileFeatureDisplay}
      visibleWmsLayers={visibleWmsLayers}
      onToggleWmsLayer={toggleWmsLayer}
      visibleSmokeLayers={visibleSmokeLayers}
      onToggleSmokeLayer={toggleSmokeLayer}
      fireDangerMode={fireDangerMode}
      onFireDangerModeChange={setFireDangerMode}
      windVisible={windVisible}
      onToggleWind={toggleWind}
      basemap={basemap}
      onBasemapChange={setBasemap}
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
            <SmokePolygonLayer key={layer.key} definition={layer} visible={visibleSmokeLayers.has(layer.key)} />
          ))}
          {WMS_LAYERS.map((layer) => (
            <WmsRasterLayer
              key={layer.key}
              definition={layer}
              visible={visibleWmsLayers.has(layer.key) && (layer.key !== 'fireDanger' || fireDangerMode === 'raster')}
            />
          ))}
          <FireDangerVectorLayer visible={visibleWmsLayers.has('fireDanger') && fireDangerMode === 'vector'} />
          <WindCanvasLayer visible={windVisible} basemap={basemap} />
          <AqMonitorLayer
            key={iconMode}
            monitors={monitors}
            visibleGroups={visibleGroups}
            iconMode={iconMode}
            onMonitorClick={handleMonitorClick}
            onMonitorHover={setHoveredMonitor}
          />
          {hoveredMonitor && selectedMonitor !== hoveredMonitor && <MonitorTooltip monitor={hoveredMonitor} locale={locale} />}
          {selectedMonitor && (!isMobileViewport || mobileFeatureDisplay === 'popup') && (
            <MonitorPopup monitor={selectedMonitor} locale={locale} onClose={() => setSelectedMonitor(null)} />
          )}
          {selectedMonitor && isMobileViewport && mobileFeatureDisplay === 'card' && (
            <MobileAqMonitorFeatureCard
              monitor={selectedMonitor}
              locale={locale}
              onClose={() => setSelectedMonitor(null)}
            />
          )}
          {!isMobileViewport && (
            <FloatingLayerControl
              basemap={basemap}
              onBasemapChange={setBasemap}
              visibleGroups={visibleGroups}
              onToggleGroup={toggleGroup}
              iconMode={iconMode}
              onIconModeChange={setIconMode}
              visibleWmsLayers={visibleWmsLayers}
              onToggleWmsLayer={toggleWmsLayer}
              visibleSmokeLayers={visibleSmokeLayers}
              onToggleSmokeLayer={toggleSmokeLayer}
              fireDangerMode={fireDangerMode}
              onFireDangerModeChange={setFireDangerMode}
              windVisible={windVisible}
              onToggleWind={toggleWind}
              smokeLayers={smokeLayers}
              locale={locale}
            />
          )}
          <FloatingLegends
            visibleWmsLayers={visibleWmsLayers}
            visibleSmokeLayers={visibleSmokeLayers}
            smokeLayers={smokeLayers}
            windVisible={windVisible}
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
            { label: translate('popup.healthMessage', locale), value: health.heading },
            { label: 'Network', value: monitor.network },
          ].map((row) => (
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
