import { useMemo } from 'react'
import { MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import { InlineAlert, MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { ToggleRow } from '@/components/ui/toggle-row'
import { Bug, Download, Globe, Layers, MapPin, RadioTower, RefreshCw, Waves, Wind } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import type { AirMonitor } from '@/maps/airquality'
import type { AqMapDebugInfo } from '../AqMapSection'
import { WMS_LAYERS, type WmsLayerKey } from '../lib/wmsLayers'
import type { SmokeLayerDefinition, SmokeLayerKey } from '../lib/smokeLayers'
import {
  getMonitorGroup,
  type AqMonitorGroup,
} from '../lib/monitorPresentation'
import {
  formatGroupLabel,
  formatLocalizedDate,
  localizeSmokeLabel,
  localizeWmsLabel,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import type { ExportFormat } from '../lib/exportMap'
import { EXPORT_OPTIONS } from '../lib/aqMapConstants'
import type { ActiveFiresRenderMode, AqClusterColorScheme, AqMonitorIconMode, AqRingStyle, FireDangerRenderMode, FirePerimetersRenderMode, ForecastZonesRenderMode, MobileFeatureDisplay, ModelledSmokeRenderMode } from '../lib/aqMapTypes'
import { FireDangerLegendVariantControl, OverlayModeControl, RevealClusterControls, RingStyleControls } from './AqMapControls'
import { WmsLegend, type FireDangerLegendVariant } from './AqMapLegends'

export function AqMapSidebar({
  monitors,
  smokeLayers,
  visibleGroups,
  onToggleGroup,
  iconMode,
  onIconModeChange,
  ringStyle,
  onRingStyleChange,
  clusterColorScheme,
  onClusterColorSchemeChange,
  clusterRadius,
  onClusterRadiusChange,
  clusterMaxZoom,
  onClusterMaxZoomChange,
  tightClusters,
  onTightClustersChange,
  mobileFeatureDisplay,
  onMobileFeatureDisplayChange,
  visibleWmsLayers,
  onToggleWmsLayer,
  visibleSmokeLayers,
  onToggleSmokeLayer,
  activeFiresMode,
  onActiveFiresModeChange,
  fireDangerMode,
  onFireDangerModeChange,
  fireDangerLegendVariant,
  onFireDangerLegendVariantChange,
  firePerimetersMode,
  onFirePerimetersModeChange,
  forecastZonesMode,
  onForecastZonesModeChange,
  modelledSmokeMode,
  onModelledSmokeModeChange,
  windVisible,
  onToggleWind,
  vectorWindBarbsVisible,
  onToggleVectorWindBarbs,
  debugVisible,
  onDebugVisibleChange,
  debugInfo,
  locale,
  onLocaleChange,
  onExport,
  exportStatus,
  loading,
  error,
}: {
  monitors: AirMonitor[]
  visibleGroups: Set<AqMonitorGroup>
  onToggleGroup: (group: AqMonitorGroup) => void
  iconMode: AqMonitorIconMode
  onIconModeChange: (mode: AqMonitorIconMode) => void
  ringStyle: AqRingStyle
  onRingStyleChange: (style: AqRingStyle) => void
  clusterColorScheme: AqClusterColorScheme
  onClusterColorSchemeChange: (scheme: AqClusterColorScheme) => void
  clusterRadius: number
  onClusterRadiusChange: (value: number) => void
  clusterMaxZoom: number
  onClusterMaxZoomChange: (value: number) => void
  tightClusters: boolean
  onTightClustersChange: (value: boolean) => void
  mobileFeatureDisplay: MobileFeatureDisplay
  onMobileFeatureDisplayChange: (mode: MobileFeatureDisplay) => void
  visibleWmsLayers: Set<WmsLayerKey>
  onToggleWmsLayer: (layer: WmsLayerKey) => void
  visibleSmokeLayers: Set<SmokeLayerKey>
  onToggleSmokeLayer: (layer: SmokeLayerKey) => void
  activeFiresMode: ActiveFiresRenderMode
  onActiveFiresModeChange: (mode: ActiveFiresRenderMode) => void
  fireDangerMode: FireDangerRenderMode
  onFireDangerModeChange: (mode: FireDangerRenderMode) => void
  fireDangerLegendVariant: FireDangerLegendVariant
  onFireDangerLegendVariantChange: (variant: FireDangerLegendVariant) => void
  firePerimetersMode: FirePerimetersRenderMode
  onFirePerimetersModeChange: (mode: FirePerimetersRenderMode) => void
  forecastZonesMode: ForecastZonesRenderMode
  onForecastZonesModeChange: (mode: ForecastZonesRenderMode) => void
  modelledSmokeMode: ModelledSmokeRenderMode
  onModelledSmokeModeChange: (mode: ModelledSmokeRenderMode) => void
  windVisible: boolean
  onToggleWind: () => void
  vectorWindBarbsVisible: boolean
  onToggleVectorWindBarbs: () => void
  debugVisible: boolean
  onDebugVisibleChange: (visible: boolean) => void
  debugInfo: AqMapDebugInfo
  locale: AqmapLocale
  onLocaleChange: (locale: AqmapLocale) => void
  onExport: (format: ExportFormat) => void
  exportStatus: { format: ExportFormat | null; error: string | null }
  loading: boolean
  error: string | null
  smokeLayers: SmokeLayerDefinition[]
}) {
  const counts = useMemo(() => {
    return monitors.reduce<Record<AqMonitorGroup, number>>(
      (acc, monitor) => {
        acc[getMonitorGroup(monitor.network)] += 1
        return acc
      },
      { agency: 0, lcm: 0, other: 0 },
    )
  }, [monitors])

  const visibleCount = monitors.filter((monitor) => visibleGroups.has(getMonitorGroup(monitor.network))).length
  const recentCount = monitors.filter((monitor) => getMonitorAqhiPm25(monitor) !== null).length
  const latestDate = monitors
    .map((monitor) => monitor.dateObserved)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1)

  const numberLocale = locale === 'fr' ? 'fr-CA' : 'en-CA'

  return (
    <MapSidebarShell
      className={MAP_SIDEBAR_CLASS}
      title={translate('app.title', locale)}
      subtitle={translate('app.subtitle', locale)}
      icon={RadioTower}
    >
      <SidebarSection className="space-y-3">
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { key: 'visible', label: translate('sidebar.visible', locale), value: visibleCount.toLocaleString(numberLocale) },
            { key: 'pm25', label: translate('sidebar.pm25Count', locale), value: recentCount.toLocaleString(numberLocale) },
          ]}
        />
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </SidebarSection>

      <SidebarSection title={translate('sidebar.language', locale)} icon={Globe}>
        <SegmentedControl
          label={translate('sidebar.language', locale)}
          variant="solid"
          value={locale}
          onChange={onLocaleChange}
          options={[
            { value: 'en', label: 'English' },
            { value: 'fr', label: 'Français' },
          ]}
        />
      </SidebarSection>

      <SidebarSection title={translate('sidebar.debug', locale)} icon={Bug}>
        <ToggleRow
          tone="primary"
          active={debugVisible}
          onClick={() => onDebugVisibleChange(!debugVisible)}
          label={translate('debug.showMapState', locale)}
          trailing={debugVisible ? translate('debug.on', locale) : translate('debug.off', locale)}
        />
        {debugVisible && (
          <div className="mt-2 space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <DebugValue label={translate('debug.zoom', locale)} value={debugInfo.zoom.toFixed(2)} />
              <DebugValue label={translate('debug.layers', locale)} value={String(debugInfo.mapLayerCount)} />
              <DebugValue label={translate('debug.lng', locale)} value={debugInfo.center[0].toFixed(4)} />
              <DebugValue label={translate('debug.sources', locale)} value={String(debugInfo.mapSourceCount)} />
              <DebugValue label={translate('debug.lat', locale)} value={debugInfo.center[1].toFixed(4)} />
              <DebugValue label={translate('debug.selected', locale)} value={debugInfo.selectedFeature} />
            </div>
            <DebugList label={translate('debug.renderModes', locale)} values={Object.entries(debugInfo.renderModes).map(([key, value]) => `${key}:${value}`)} />
            <DebugList label={translate('debug.wms', locale)} values={debugInfo.visibleWmsLayers} />
            <DebugList label={translate('debug.smoke', locale)} values={debugInfo.visibleSmokeLayers} />
            <DebugList
              label={translate('debug.deck', locale)}
              values={[...debugInfo.deckTileKeys, ...(debugInfo.fireDangerDeck ? ['fireDanger:deckgl'] : [])]}
            />
          </div>
        )}
      </SidebarSection>

      <SidebarSection title={translate('sidebar.monitorLayers', locale)} icon={MapPin}>
        <div className="space-y-2">
          {(['agency', 'lcm', 'other'] as AqMonitorGroup[]).map((group) => (
            <ToggleRow
              key={group}
              tone="primary"
              active={visibleGroups.has(group)}
              onClick={() => onToggleGroup(group)}
              label={formatGroupLabel(group, locale)}
              trailing={counts[group].toLocaleString(numberLocale)}
            />
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title={translate('sidebar.iconMode', locale)}>
        <SegmentedControl
          label={translate('sidebar.iconMode', locale)}
          variant="solid"
          value={iconMode}
          onChange={onIconModeChange}
          options={[
            { value: 'aqmap', label: translate('icons.aqmap', locale) },
            { value: 'revealed', label: translate('icons.revealed', locale) },
            { value: 'ring', label: translate('icons.ring', locale) },
          ]}
        />
        {iconMode === 'revealed' && (
          <div className="mt-2">
            <RevealClusterControls
              clusterColorScheme={clusterColorScheme}
              onClusterColorSchemeChange={onClusterColorSchemeChange}
              clusterRadius={clusterRadius}
              onClusterRadiusChange={onClusterRadiusChange}
              clusterMaxZoom={clusterMaxZoom}
              onClusterMaxZoomChange={onClusterMaxZoomChange}
              tightClusters={tightClusters}
              onTightClustersChange={onTightClustersChange}
              locale={locale}
            />
          </div>
        )}
        {iconMode === 'ring' && (
          <div className="mt-2">
            <RingStyleControls ringStyle={ringStyle} onRingStyleChange={onRingStyleChange} locale={locale} />
          </div>
        )}
      </SidebarSection>

      <SidebarSection title={translate('sidebar.featureDisplay', locale)} className="md:hidden">
        <SegmentedControl
          label={translate('sidebar.featureDisplay', locale)}
          variant="solid"
          value={mobileFeatureDisplay}
          onChange={onMobileFeatureDisplayChange}
          options={[
            { value: 'card', label: translate('featureDisplay.card', locale) },
            { value: 'popup', label: translate('featureDisplay.popup', locale) },
          ]}
        />
      </SidebarSection>

      {visibleWmsLayers.size > 0 && (
        <SidebarSection title={translate('sidebar.wmsLegends', locale)}>
          <div className="space-y-3">
            {WMS_LAYERS.filter((layer) => layer.key !== 'forecastZones' && visibleWmsLayers.has(layer.key) && (layer.key !== 'modelledPm25' || modelledSmokeMode === 'raster')).map((layer) => {
              const label = localizeWmsLabel(layer.key, locale)
              return (
                <div key={layer.key}>
                  <WmsLegend
                    layer={layer}
                    label={label}
                    locale={locale}
                    fireDangerLegendVariant={fireDangerLegendVariant}
                  />
                </div>
              )
            })}
          </div>
        </SidebarSection>
      )}

      <SidebarSection title={translate('sidebar.overlays', locale)} icon={Layers}>
        <div className="space-y-2">
          <ToggleRow
            tone="primary"
            active={windVisible}
            onClick={onToggleWind}
            icon={Waves}
            label={translate('sidebar.wind', locale)}
            trailing={translate('wind.tag', locale)}
          />
          <ToggleRow
            tone="primary"
            active={vectorWindBarbsVisible}
            onClick={onToggleVectorWindBarbs}
            icon={Wind}
            label={translate('sidebar.vectorWindBarbs', locale)}
            trailing={translate('overlay.vector', locale)}
          />
          {smokeLayers.map((layer) => (
            <ToggleRow
              key={layer.key}
              tone="primary"
              active={visibleSmokeLayers.has(layer.key)}
              onClick={() => onToggleSmokeLayer(layer.key)}
              label={localizeSmokeLabel(layer.key, locale)}
              trailing={layer.key === 'modelledSmoke' ? translate('overlay.vector', locale) : translate('smoke.tag', locale)}
            />
          ))}
          {WMS_LAYERS.map((layer) => (
            <div key={layer.key} className="space-y-2">
              <ToggleRow
                tone="primary"
                active={visibleWmsLayers.has(layer.key)}
                onClick={() => onToggleWmsLayer(layer.key)}
                icon={layer.icon}
                label={localizeWmsLabel(layer.key, locale)}
                trailing={
                  (layer.key === 'activeFires' && activeFiresMode === 'vector')
                  || (layer.key === 'fireDanger' && fireDangerMode === 'vector')
                  || (layer.key === 'firePerimeters' && firePerimetersMode === 'vector')
                  || (layer.key === 'forecastZones' && forecastZonesMode === 'vector')
                  || (layer.key === 'modelledPm25' && modelledSmokeMode === 'vector')
                    ? translate('overlay.vector', locale)
                    : translate('wms.tag', locale)
                }
              />
              {layer.key === 'fireDanger' && visibleWmsLayers.has('fireDanger') && (
                <div className="space-y-2">
                  <OverlayModeControl layerKey="fireDanger" value={fireDangerMode} onChange={onFireDangerModeChange} locale={locale} />
                  <FireDangerLegendVariantControl
                    value={fireDangerLegendVariant}
                    onChange={onFireDangerLegendVariantChange}
                    locale={locale}
                  />
                </div>
              )}
              {layer.key === 'activeFires' && visibleWmsLayers.has('activeFires') && (
                <OverlayModeControl layerKey="activeFires" value={activeFiresMode} onChange={onActiveFiresModeChange} locale={locale} />
              )}
              {layer.key === 'firePerimeters' && visibleWmsLayers.has('firePerimeters') && (
                <OverlayModeControl layerKey="firePerimeters" value={firePerimetersMode} onChange={onFirePerimetersModeChange} locale={locale} />
              )}
              {layer.key === 'forecastZones' && visibleWmsLayers.has('forecastZones') && (
                <OverlayModeControl layerKey="forecastZones" value={forecastZonesMode} onChange={onForecastZonesModeChange} locale={locale} />
              )}
              {layer.key === 'modelledPm25' && visibleWmsLayers.has('modelledPm25') && (
                <OverlayModeControl layerKey="modelledPm25" value={modelledSmokeMode} onChange={onModelledSmokeModeChange} locale={locale} />
              )}
            </div>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title={translate('sidebar.export', locale)} icon={Download}>
        <div className="space-y-2">
          {EXPORT_OPTIONS.map(({ format, labelKey, icon: Icon }) => (
            <button
              key={format}
              type="button"
              onClick={() => onExport(format)}
              disabled={exportStatus.format === format}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-60 touch:min-h-10"
            >
              <span className="flex items-center gap-2">
                <Icon className="size-3.5" />
                {translate(labelKey, locale)}
              </span>
              {exportStatus.format === format && (
                <span className="text-xs text-muted-foreground">{translate('export.preparing', locale)}</span>
              )}
            </button>
          ))}
          {exportStatus.error && (
            <div className="text-xs text-destructive">{exportStatus.error}</div>
          )}
        </div>
      </SidebarSection>

      <SidebarSection className="border-b-0">
        <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {translate('app.snapshot', locale)}
          </div>
          <div className="mt-1">{translate('app.latestObservation', locale)} {formatLocalizedDate(latestDate, locale)}</div>
          <div>{translate('app.monitorData', locale)} <span className="font-medium text-foreground">{translate('app.endpoints', locale)}</span></div>
        </div>
      </SidebarSection>
    </MapSidebarShell>
  )
}

function DebugValue({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className="truncate text-right font-medium text-foreground" title={value}>{value}</div>
    </>
  )
}

function DebugList({ label, values }: { label: string; values: string[] }) {
  const text = values.length > 0 ? values.join(', ') : 'none'
  return (
    <div>
      <div className="mb-0.5 text-muted-foreground">{label}</div>
      <div className="break-words font-medium text-foreground">{text}</div>
    </div>
  )
}
