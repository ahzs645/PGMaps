import { useMemo } from 'react'
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
import { RevealClusterControls, RingStyleControls, SegmentedControl, ToggleButton } from './AqMapControls'
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
    <aside className="flex h-full flex-col bg-background">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <RadioTower className="size-4 text-primary" />
          <h1 className="text-base font-semibold text-foreground">{translate('app.title', locale)}</h1>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {translate('app.subtitle', locale)}
        </p>
      </div>

      <div className="space-y-5 overflow-y-auto p-4">
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{translate('sidebar.visible', locale)}</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{visibleCount.toLocaleString(numberLocale)}</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{translate('sidebar.pm25Count', locale)}</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{recentCount.toLocaleString(numberLocale)}</div>
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Globe className="size-3.5" />
            {translate('sidebar.language', locale)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['en', 'fr'] as AqmapLocale[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onLocaleChange(option)}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm transition-colors',
                  locale === option
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {option === 'en' ? 'English' : 'Français'}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Bug className="size-3.5" />
            {translate('sidebar.debug', locale)}
          </div>
          <ToggleButton active={debugVisible} onClick={() => onDebugVisibleChange(!debugVisible)}>
            <span>{translate('debug.showMapState', locale)}</span>
            <span className="text-xs font-medium">{debugVisible ? translate('debug.on', locale) : translate('debug.off', locale)}</span>
          </ToggleButton>
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
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MapPin className="size-3.5" />
            {translate('sidebar.monitorLayers', locale)}
          </div>
          <div className="space-y-2">
            {(['agency', 'lcm', 'other'] as AqMonitorGroup[]).map((group) => (
              <ToggleButton key={group} active={visibleGroups.has(group)} onClick={() => onToggleGroup(group)}>
                <span>{formatGroupLabel(group, locale)}</span>
                <span className="text-xs font-medium">{counts[group].toLocaleString(numberLocale)}</span>
              </ToggleButton>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {translate('sidebar.iconMode', locale)}
          </div>
          <SegmentedControl
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
        </section>

        <section className="md:hidden">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {translate('sidebar.featureDisplay', locale)}
          </div>
          <SegmentedControl
            value={mobileFeatureDisplay}
            onChange={onMobileFeatureDisplayChange}
            options={[
              { value: 'card', label: translate('featureDisplay.card', locale) },
              { value: 'popup', label: translate('featureDisplay.popup', locale) },
            ]}
          />
        </section>

        {visibleWmsLayers.size > 0 && (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{translate('sidebar.wmsLegends', locale)}</div>
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
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Layers className="size-3.5" />
            {translate('sidebar.overlays', locale)}
          </div>
          <div className="space-y-2">
            <ToggleButton active={windVisible} onClick={onToggleWind}>
              <span className="flex items-center gap-2">
                <Waves className="size-3.5" />
                {translate('sidebar.wind', locale)}
              </span>
              <span className="text-xs font-medium">{translate('wind.tag', locale)}</span>
            </ToggleButton>
            <ToggleButton active={vectorWindBarbsVisible} onClick={onToggleVectorWindBarbs}>
              <span className="flex items-center gap-2">
                <Wind className="size-3.5" />
                {translate('sidebar.vectorWindBarbs', locale)}
              </span>
              <span className="text-xs font-medium">{translate('overlay.vector', locale)}</span>
            </ToggleButton>
            {smokeLayers.map((layer) => (
              <ToggleButton
                key={layer.key}
                active={visibleSmokeLayers.has(layer.key)}
                onClick={() => onToggleSmokeLayer(layer.key)}
              >
                <span>{localizeSmokeLabel(layer.key, locale)}</span>
                <span className="text-xs font-medium">
                  {layer.key === 'modelledSmoke'
                    ? translate('overlay.vector', locale)
                    : translate('smoke.tag', locale)}
                </span>
              </ToggleButton>
            ))}
            {WMS_LAYERS.map((layer) => {
              const Icon = layer.icon
              return (
                <div key={layer.key} className="space-y-2">
                  <ToggleButton
                    active={visibleWmsLayers.has(layer.key)}
                    onClick={() => onToggleWmsLayer(layer.key)}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-3.5" />
                      {localizeWmsLabel(layer.key, locale)}
                    </span>
                    <span className="text-xs font-medium">
                      {(layer.key === 'activeFires' && activeFiresMode === 'vector')
                        || (layer.key === 'fireDanger' && fireDangerMode === 'vector')
                        || (layer.key === 'firePerimeters' && firePerimetersMode === 'vector')
                        || (layer.key === 'forecastZones' && forecastZonesMode === 'vector')
                        || (layer.key === 'modelledPm25' && modelledSmokeMode === 'vector')
                        ? translate('overlay.vector', locale)
                        : translate('wms.tag', locale)}
                    </span>
                  </ToggleButton>
                  {layer.key === 'fireDanger' && visibleWmsLayers.has('fireDanger') && (
                    <div className="space-y-2">
                      <SegmentedControl
                        value={fireDangerMode}
                        onChange={onFireDangerModeChange}
                        options={[
                          { value: 'raster', label: translate('overlay.raster', locale) },
                          { value: 'vector', label: translate('overlay.vector', locale) },
                        ]}
                      />
                      <div className="space-y-1">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Legend
                        </div>
                        <SegmentedControl
                          value={fireDangerLegendVariant}
                          onChange={onFireDangerLegendVariantChange}
                          options={[
                            { value: 'compact', label: '3 labels' },
                            { value: 'full', label: 'All' },
                            { value: 'tilted', label: 'Tilt' },
                            { value: 'rows', label: 'Rows' },
                          ]}
                        />
                      </div>
                    </div>
                  )}
                  {layer.key === 'activeFires' && visibleWmsLayers.has('activeFires') && (
                    <SegmentedControl
                      value={activeFiresMode}
                      onChange={onActiveFiresModeChange}
                      options={[
                        { value: 'raster', label: translate('overlay.raster', locale) },
                        { value: 'vector', label: translate('overlay.vector', locale) },
                      ]}
                    />
                  )}
                  {layer.key === 'firePerimeters' && visibleWmsLayers.has('firePerimeters') && (
                    <SegmentedControl
                      value={firePerimetersMode}
                      onChange={onFirePerimetersModeChange}
                      options={[
                        { value: 'raster', label: translate('overlay.raster', locale) },
                        { value: 'vector', label: translate('overlay.vector', locale) },
                      ]}
                    />
                  )}
                  {layer.key === 'forecastZones' && visibleWmsLayers.has('forecastZones') && (
                    <SegmentedControl
                      value={forecastZonesMode}
                      onChange={onForecastZonesModeChange}
                      options={[
                        { value: 'raster', label: translate('overlay.raster', locale) },
                        { value: 'vector', label: translate('overlay.vector', locale) },
                      ]}
                    />
                  )}
                  {layer.key === 'modelledPm25' && visibleWmsLayers.has('modelledPm25') && (
                    <SegmentedControl
                      value={modelledSmokeMode}
                      onChange={onModelledSmokeModeChange}
                      options={[
                        { value: 'raster', label: translate('overlay.raster', locale) },
                        { value: 'vector', label: translate('overlay.vector', locale) },
                      ]}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Download className="size-3.5" />
            {translate('sidebar.export', locale)}
          </div>
          <div className="space-y-2">
            {EXPORT_OPTIONS.map(({ format, labelKey, icon: Icon }) => (
              <button
                key={format}
                type="button"
                onClick={() => onExport(format)}
                disabled={exportStatus.format === format}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-60"
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
        </section>

        <section className="rounded-md border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {translate('app.snapshot', locale)}
          </div>
          <div className="mt-1">{translate('app.latestObservation', locale)} {formatLocalizedDate(latestDate, locale)}</div>
          <div>{translate('app.monitorData', locale)} <span className="font-medium text-foreground">{translate('app.endpoints', locale)}</span></div>
        </section>

      </div>
    </aside>
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
