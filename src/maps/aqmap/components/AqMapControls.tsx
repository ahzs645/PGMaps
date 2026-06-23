import { useEffect, useState, type ReactNode } from 'react'
import { Crosshair, Info, Layers as LayersIcon, Loader2, Maximize, Minus, Plus, RotateCcw } from 'lucide-react'
import { useMap } from '@/components/ui/map'
import { MapFloatingPanel } from '@/components/ui/map-overlays'
import { cn } from '@/lib/utils'
import { WMS_LAYERS, type WmsLayerKey } from '../lib/wmsLayers'
import type { SmokeLayerDefinition, SmokeLayerKey } from '../lib/smokeLayers'
import { AQ_OBSERVATION_NETWORKS, type AqBasemap, type AqMonitorGroup, type AqNetworkSlug } from '../lib/monitorPresentation'
import {
  formatGroupLabel,
  formatLocalizedDate,
  formatNetworkLabel,
  localizeSmokeLabel,
  localizeWmsLabel,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import type { ActiveFiresRenderMode, AqClusterColorScheme, AqMonitorIconMode, FireDangerRenderMode, FirePerimetersRenderMode, ForecastZonesRenderMode, ModelledSmokeRenderMode } from '../lib/aqMapTypes'
import { REVEAL_CLUSTER_BOUNDS, REVEAL_CLUSTER_DEFAULTS } from '../lib/aqMapConstants'
import { CANADA_CENTER, DEFAULT_ZOOM } from '../lib/urlState'
import type { FireDangerLegendVariant } from './AqMapLegends'

export function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div
      className="grid overflow-hidden rounded-md border border-border bg-background"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2 py-1.5 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  unit?: string
}) {
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">{value}{unit ? `� ${unit}` : ''}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-primary"
      />
    </label>
  )
}

export function RevealClusterControls({
  clusterColorScheme,
  onClusterColorSchemeChange,
  clusterRadius,
  onClusterRadiusChange,
  clusterMaxZoom,
  onClusterMaxZoomChange,
  tightClusters,
  onTightClustersChange,
  locale,
}: {
  clusterColorScheme: AqClusterColorScheme
  onClusterColorSchemeChange: (scheme: AqClusterColorScheme) => void
  clusterRadius: number
  onClusterRadiusChange: (value: number) => void
  clusterMaxZoom: number
  onClusterMaxZoomChange: (value: number) => void
  tightClusters: boolean
  onTightClustersChange: (value: boolean) => void
  locale: AqmapLocale
}) {
  const isDefault =
    clusterRadius === REVEAL_CLUSTER_DEFAULTS.radius && clusterMaxZoom === REVEAL_CLUSTER_DEFAULTS.maxZoom
  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">{translate('reveal.tuning', locale)}</span>
        <button
          type="button"
          onClick={() => {
            onClusterRadiusChange(REVEAL_CLUSTER_DEFAULTS.radius)
            onClusterMaxZoomChange(REVEAL_CLUSTER_DEFAULTS.maxZoom)
          }}
          disabled={isDefault}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {translate('reveal.reset', locale)}
        </button>
      </div>
      <div className="space-y-1">
        <span className="text-[11px] text-muted-foreground">{translate('reveal.clusterColors', locale)}</span>
        <SegmentedControl
          value={clusterColorScheme}
          onChange={onClusterColorSchemeChange}
          options={[
            { value: 'classic', label: translate('clusterColors.classic', locale) },
            { value: 'slate', label: translate('clusterColors.slate', locale) },
          ]}
        />
      </div>
      <RangeField
        label={translate('reveal.clusterRadius', locale)}
        value={clusterRadius}
        min={REVEAL_CLUSTER_BOUNDS.radius.min}
        max={REVEAL_CLUSTER_BOUNDS.radius.max}
        step={REVEAL_CLUSTER_BOUNDS.radius.step}
        onChange={onClusterRadiusChange}
        unit="px"
      />
      <RangeField
        label={translate('reveal.clusterMaxZoom', locale)}
        value={clusterMaxZoom}
        min={REVEAL_CLUSTER_BOUNDS.maxZoom.min}
        max={REVEAL_CLUSTER_BOUNDS.maxZoom.max}
        step={REVEAL_CLUSTER_BOUNDS.maxZoom.step}
        onChange={onClusterMaxZoomChange}
      />
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={tightClusters}
          onChange={(event) => onTightClustersChange(event.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>{translate('reveal.tightPacking', locale)}</span>
      </label>
    </div>
  )
}

export function FloatingLayerControl({
  visibleGroups,
  onToggleGroup,
  iconMode,
  onIconModeChange,
  clusterColorScheme,
  onClusterColorSchemeChange,
  clusterRadius,
  onClusterRadiusChange,
  clusterMaxZoom,
  onClusterMaxZoomChange,
  tightClusters,
  onTightClustersChange,
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
  smokeLayers,
  locale,
}: {
  visibleGroups: Set<AqMonitorGroup>
  onToggleGroup: (group: AqMonitorGroup) => void
  iconMode: AqMonitorIconMode
  onIconModeChange: (mode: AqMonitorIconMode) => void
  clusterColorScheme: AqClusterColorScheme
  onClusterColorSchemeChange: (scheme: AqClusterColorScheme) => void
  clusterRadius: number
  onClusterRadiusChange: (value: number) => void
  clusterMaxZoom: number
  onClusterMaxZoomChange: (value: number) => void
  tightClusters: boolean
  onTightClustersChange: (value: boolean) => void
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
  smokeLayers: SmokeLayerDefinition[]
  locale: AqmapLocale
}) {
  return (
    <MapFloatingPanel position="top-right" className="w-56 rounded border border-border bg-background/95 p-3 text-xs shadow-md backdrop-blur">
      <div className="font-semibold text-foreground">{translate('controls.layers', locale)}</div>
      <div className="mt-1 max-h-72 space-y-1 overflow-y-auto">
        {(['agency', 'lcm', 'other'] as AqMonitorGroup[]).map((group) => (
          <label key={group} className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={visibleGroups.has(group)} onChange={() => onToggleGroup(group)} />
            <span>{formatGroupLabel(group, locale)}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={windVisible} onChange={onToggleWind} />
          <span>{translate('sidebar.wind', locale)}</span>
        </label>
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={vectorWindBarbsVisible} onChange={onToggleVectorWindBarbs} />
          <span>{translate('sidebar.vectorWindBarbs', locale)}</span>
        </label>
        <div className="space-y-1">
          <div className="font-medium text-foreground">{translate('sidebar.iconMode', locale)}</div>
          <SegmentedControl
            value={iconMode}
            onChange={onIconModeChange}
            options={[
              { value: 'aqmap', label: translate('icons.aqmap', locale) },
              { value: 'revealed', label: translate('icons.revealed', locale) },
            ]}
          />
          {iconMode === 'revealed' && (
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
          )}
        </div>
        {smokeLayers.map((layer) => (
          <label key={layer.key} className="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={visibleSmokeLayers.has(layer.key)} onChange={() => onToggleSmokeLayer(layer.key)} />
            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{localizeSmokeLabel(layer.key, locale)}</span>
              {layer.key === 'modelledSmoke' && (
                <span className="shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
                  {translate('overlay.vector', locale)}
                </span>
              )}
            </span>
          </label>
        ))}
        {WMS_LAYERS.map((layer) => (
          <div key={layer.key} className="space-y-1">
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="checkbox" checked={visibleWmsLayers.has(layer.key)} onChange={() => onToggleWmsLayer(layer.key)} />
              <span>{localizeWmsLabel(layer.key, locale)}</span>
            </label>
            {layer.key === 'fireDanger' && visibleWmsLayers.has('fireDanger') && (
              <div className="space-y-1">
                <SegmentedControl
                  value={fireDangerMode}
                  onChange={onFireDangerModeChange}
                  options={[
                    { value: 'raster', label: translate('overlay.raster', locale) },
                    { value: 'vector', label: translate('overlay.vector', locale) },
                    { value: 'deckgl', label: translate('overlay.deckgl', locale) },
                  ]}
                />
                <div className="pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
            )}
            {layer.key === 'activeFires' && visibleWmsLayers.has('activeFires') && (
              <SegmentedControl
                value={activeFiresMode}
                onChange={onActiveFiresModeChange}
                options={[
                  { value: 'raster', label: translate('overlay.raster', locale) },
                  { value: 'vector', label: translate('overlay.vector', locale) },
                  { value: 'deckgl', label: translate('overlay.deckgl', locale) },
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
                  { value: 'deckgl', label: translate('overlay.deckgl', locale) },
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
                  { value: 'deckgl', label: translate('overlay.deckgl', locale) },
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
                  { value: 'deckgl', label: translate('overlay.deckgl', locale) },
                ]}
              />
            )}
          </div>
        ))}
      </div>
    </MapFloatingPanel>
  )
}

/**
 * Simplified floating layer control for the locked-down /dev/aqmap/main page.
 *
 * Shows only what should be configurable there: the Observation Data networks
 * (Agency/FEM, PurpleAir/PA, AQ Egg/EGG), the AQmap overlay list, and every
 * raster/vector segmented control (fire and forecast overlays render as vector here).
 */
export function MainLayerControl({
  basemap,
  onBasemapChange,
  visibleNetworks,
  onToggleNetwork,
  visibleWmsLayers,
  onToggleWmsLayer,
  surfaceWindVisible,
  onToggleSurfaceWind,
  visibleSmokeLayers,
  onToggleSmokeLayer,
  smokeLayers,
  locale,
}: {
  basemap: AqBasemap
  onBasemapChange: (basemap: AqBasemap) => void
  visibleNetworks: Set<AqNetworkSlug>
  onToggleNetwork: (network: AqNetworkSlug) => void
  visibleWmsLayers: Set<WmsLayerKey>
  onToggleWmsLayer: (layer: WmsLayerKey) => void
  surfaceWindVisible: boolean
  onToggleSurfaceWind: () => void
  visibleSmokeLayers: Set<SmokeLayerKey>
  onToggleSmokeLayer: (layer: SmokeLayerKey) => void
  smokeLayers: SmokeLayerDefinition[]
  locale: AqmapLocale
}) {
  const wmsLayerByKey = new Map(WMS_LAYERS.map((layer) => [layer.key, layer]))
  const smokeLayerByKey = new Map(smokeLayers.map((layer) => [layer.key, layer]))
  const sourceLinks = getAqmapSourceLinks()

  return (
    <MapFloatingPanel position="top-right" className="group top-[calc(env(safe-area-inset-top)+3.75rem)] md:top-3">
      <button
        type="button"
        title={translate('controls.layers', locale)}
        aria-label={translate('controls.layers', locale)}
        aria-haspopup="true"
        className="flex size-9 items-center justify-center rounded border border-border bg-background text-foreground shadow-md transition-colors hover:bg-secondary"
      >
        <LayersIcon className="size-4" />
      </button>
      <div className="pointer-events-none absolute right-0 top-0 hidden w-max min-w-44 max-w-[calc(100vw-1.5rem)] rounded border border-border bg-background/95 p-3 text-xs shadow-md backdrop-blur group-hover:pointer-events-auto group-hover:block group-focus-within:pointer-events-auto group-focus-within:block">
        <div className="max-h-[min(30rem,calc(100vh-6rem))] space-y-3 overflow-y-auto pr-1">
          <div>
            <LayerControlHeading>{translate('sidebar.basemap', locale)}</LayerControlHeading>
            <div className="mt-1 space-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  name="aqmap-basemap"
                  checked={basemap === 'topographic'}
                  onChange={() => onBasemapChange(basemap === 'topographic' ? 'light' : 'topographic')}
                />
                <span>{translate('sidebar.basemap.topographic', locale)}</span>
              </label>
            </div>
          </div>

          <div>
            <LayerControlHeading>{translate('controls.layers', locale)}</LayerControlHeading>
            <div className="mt-1 space-y-3">
              <div className="space-y-1">
                <LayerControlSubheading>{translate('sidebar.observationData', locale)}</LayerControlSubheading>
                {AQ_OBSERVATION_NETWORKS.map((network) => (
                  <SourceToggle
                    key={network}
                    checked={visibleNetworks.has(network)}
                    label={formatNetworkLabel(network, locale)}
                    sourceUrl={sourceLinks[network]}
                    onChange={() => onToggleNetwork(network)}
                  />
                ))}
                <SourceToggle
                  checked={visibleWmsLayers.has('forecastZones')}
                  label={localizeWmsLabel('forecastZones', locale)}
                  sourceUrl={sourceLinks.forecastZones}
                  onChange={() => onToggleWmsLayer('forecastZones')}
                />
              </div>

              <div className="space-y-1">
                <LayerControlSubheading>{translate('sidebar.modelEstimates', locale)}</LayerControlSubheading>
                {wmsLayerByKey.has('surfaceWinds') && (
                  <SourceToggle
                    checked={surfaceWindVisible}
                    label={translate('layer.surfaceWind', locale)}
                    sourceUrl={sourceLinks.surfaceWinds}
                    onChange={onToggleSurfaceWind}
                  />
                )}
                {wmsLayerByKey.has('modelledPm25') && (
                  <SourceToggle
                    checked={visibleWmsLayers.has('modelledPm25')}
                    label={translate('layer.surfacePm25', locale)}
                    sourceUrl={sourceLinks.modelledPm25}
                    onChange={() => onToggleWmsLayer('modelledPm25')}
                  />
                )}
                {smokeLayerByKey.has('modelledSmoke') && (
                  <SourceToggle
                    checked={visibleSmokeLayers.has('modelledSmoke')}
                    label={translate('layer.surfaceSmoke', locale)}
                    sourceUrl={sourceLinks.modelledSmoke}
                    onChange={() => onToggleSmokeLayer('modelledSmoke')}
                  />
                )}
              </div>

              <div className="space-y-1">
                <LayerControlSubheading>{translate('sidebar.satelliteData', locale)}</LayerControlSubheading>
                {wmsLayerByKey.has('activeFires') && (
                  <SourceToggle
                    checked={visibleWmsLayers.has('activeFires')}
                    label={localizeWmsLabel('activeFires', locale)}
                    sourceUrl={sourceLinks.activeFires}
                    onChange={() => onToggleWmsLayer('activeFires')}
                  />
                )}
                {wmsLayerByKey.has('firePerimeters') && (
                  <SourceToggle
                    checked={visibleWmsLayers.has('firePerimeters')}
                    label={localizeWmsLabel('firePerimeters', locale)}
                    sourceUrl={sourceLinks.firePerimeters}
                    onChange={() => onToggleWmsLayer('firePerimeters')}
                  />
                )}
                {wmsLayerByKey.has('fireDanger') && (
                  <SourceToggle
                    checked={visibleWmsLayers.has('fireDanger')}
                    label={localizeWmsLabel('fireDanger', locale)}
                    sourceUrl={sourceLinks.fireDanger}
                    onChange={() => onToggleWmsLayer('fireDanger')}
                  />
                )}
                {smokeLayerByKey.has('visibleSmoke') && (
                  <SourceToggle
                    checked={visibleSmokeLayers.has('visibleSmoke')}
                    label={localizeSmokeLabel('visibleSmoke', locale)}
                    sourceUrl={sourceLinks.visibleSmoke}
                    onChange={() => onToggleSmokeLayer('visibleSmoke')}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </MapFloatingPanel>
  )
}

function LayerControlHeading({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
      {children}
    </div>
  )
}

function LayerControlSubheading({ children }: { children: ReactNode }) {
  return (
    <div className="pt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function SourceToggle({
  checked,
  label,
  sourceUrl,
  onChange,
}: {
  checked: boolean
  label: string
  sourceUrl: string
  onChange: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 truncate underline-offset-2 hover:text-foreground hover:underline"
        title={label}
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </a>
    </div>
  )
}

function getAqmapSourceLinks() {
  return {
    agency: 'https://fire.airnow.gov/',
    purpleair: 'https://www2.purpleair.com/',
    aqegg: 'https://airqualityegg.com/',
    forecastZones: 'https://weather.gc.ca/?layers=alert',
    surfaceWinds: 'https://open.canada.ca/data/en/dataset/5b401fa0-6c29-57f0-b3d5-749f301d829d',
    modelledPm25: 'https://weather.gc.ca/firework/index_e.html',
    modelledSmoke: 'https://eer.cmc.ec.gc.ca/mandats/AutoSim/Fire/',
    activeFires: 'https://cwfis.cfs.nrcan.gc.ca/datamart/metadata/activefires',
    firePerimeters: 'https://cwfis.cfs.nrcan.gc.ca/datamart/metadata/fm3buffered',
    fireDanger: 'https://cwfis.cfs.nrcan.gc.ca/datamart/metadata/fdr',
    visibleSmoke: 'https://www.ospo.noaa.gov/Products/land/hms.html#maps',
  } satisfies Record<Exclude<AqNetworkSlug, 'other'> | WmsLayerKey | SmokeLayerKey, string>
}

export function MapUtilityControls({ onReset, locale }: { onReset: () => void; locale: AqmapLocale }) {
  const { map } = useMap()
  const [waitingForLocation, setWaitingForLocation] = useState(false)
  const geolocationAvailable = typeof navigator !== 'undefined' && 'geolocation' in navigator

  const zoomIn = () => {
    map?.zoomTo(map.getZoom() + 1, { duration: 300 })
  }

  const zoomOut = () => {
    map?.zoomTo(map.getZoom() - 1, { duration: 300 })
  }

  const locate = () => {
    if (!geolocationAvailable || !map) return
    setWaitingForLocation(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.easeTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 15,
          duration: 650,
        })
        setWaitingForLocation(false)
      },
      () => {
        setWaitingForLocation(false)
      },
    )
  }

  const reset = () => {
    onReset()
    map?.easeTo({
      center: CANADA_CENTER,
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 450,
    })
  }

  const toggleFullscreen = () => {
    const container = map?.getContainer()
    if (!container || !document.fullscreenEnabled) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void container.requestFullscreen()
    }
  }

  return (
    <MapFloatingPanel position="top-left" className="top-[calc(env(safe-area-inset-top)+3.75rem)] flex flex-col overflow-hidden rounded border border-border bg-background shadow-md md:top-3">
      <button type="button" aria-label="Zoom in" onClick={zoomIn} className="p-2 hover:bg-secondary">
        <Plus className="size-4" />
      </button>
      <button type="button" aria-label="Zoom out" onClick={zoomOut} className="border-t border-border p-2 hover:bg-secondary">
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label={translate('controls.zoomToLocation', locale)}
        title={translate('controls.zoomToLocation', locale)}
        onClick={locate}
        disabled={!geolocationAvailable || waitingForLocation}
        className="border-t border-border p-2 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {waitingForLocation ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
      </button>
      <button
        type="button"
        aria-label={translate('controls.resetView', locale)}
        title={translate('controls.resetView', locale)}
        onClick={reset}
        className="border-t border-border p-2 hover:bg-secondary"
      >
        <RotateCcw className="size-4" />
      </button>
      <button type="button" aria-label="Toggle fullscreen" onClick={toggleFullscreen} className="hidden border-t border-border p-2 hover:bg-secondary md:block">
        <Maximize className="size-4" />
      </button>
    </MapFloatingPanel>
  )
}

export function MapStatusBar({ latestDate, locale }: { latestDate: string | null | undefined; locale: AqmapLocale }) {
  const { map } = useMap()
  const [scale, setScale] = useState({ width: 80, label: '500 km' })

  useEffect(() => {
    if (!map) return

    const updateScale = () => {
      const center = map.getCenter()
      const metersPerPixel = (
        Math.cos(center.lat * Math.PI / 180)
        * 2
        * Math.PI
        * 6378137
      ) / (512 * (2 ** map.getZoom()))
      const maxWidth = window.innerWidth < 768 ? 72 : 100
      const rawDistanceMeters = metersPerPixel * maxWidth
      const niceDistances = [
        1, 2, 5, 10, 20, 50, 100, 200, 500,
        1000, 2000, 5000, 10000, 20000, 50000,
        100000, 200000, 500000, 1000000,
      ]
      const distance = [...niceDistances].reverse().find((value) => value <= rawDistanceMeters) ?? 1
      const width = Math.max(36, Math.round(distance / metersPerPixel))
      setScale({
        width,
        label: distance >= 1000 ? `${distance / 1000} km` : `${distance} m`,
      })
    }

    updateScale()
    map.on('move', updateScale)
    return () => {
      map.off('move', updateScale)
    }
  }, [map])

  return (
    <MapFloatingPanel reserveLegendSpace={false} position="bottom-left" className="flex max-w-[calc(100vw-1.5rem)] items-end gap-2 md:max-w-[calc(100vw-16rem)]">
      <details data-aqmap-status-info="true" className="group relative md:hidden">
        <summary
          aria-label="Map information"
          className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md transition-colors hover:bg-secondary [&::-webkit-details-marker]:hidden"
        >
          <Info className="size-4" />
        </summary>
        <div className="absolute bottom-full left-0 mb-2 w-64 max-w-[calc(100vw-1.5rem)] rounded border border-border bg-background/95 px-2 py-1.5 text-[11px] leading-snug text-foreground shadow-md">
          <div>{translate('app.lastUpdated', locale)} {formatLocalizedDate(latestDate, locale)}</div>
          <div className="mt-1 text-muted-foreground">
            ©{' '}
            <a href="https://carto.com/about-carto/" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
              CARTO
            </a>
            , ©{' '}
            <a href="http://www.openstreetmap.org/about/" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
              OpenStreetMap
            </a>
            {' '}
            contributors
          </div>
        </div>
      </details>
      <details
        data-aqmap-status-time="true"
        className="group hidden min-w-0 rounded border border-border bg-background/95 text-[11px] text-foreground shadow-md md:block"
      >
        <summary
          aria-label="Toggle map information"
          title="Toggle map information"
          className="flex size-[30px] cursor-pointer list-none items-center justify-center transition-colors hover:bg-secondary [&::-webkit-details-marker]:hidden"
        >
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
        </summary>
        <div className="max-w-[calc(100vw-18rem)] border-t border-border/70 px-2 py-1 leading-snug">
          <div>{translate('app.lastUpdated', locale)} {formatLocalizedDate(latestDate, locale)}</div>
          <div className="mt-0.5 text-muted-foreground">
            ©{' '}
            <a href="https://carto.com/about-carto/" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
              CARTO
            </a>
            , ©{' '}
            <a href="http://www.openstreetmap.org/about/" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
              OpenStreetMap
            </a>
            {' '}
            contributors
          </div>
        </div>
      </details>
      <div data-aqmap-scale-bar="true" className="flex h-8 shrink-0 flex-col justify-center rounded border border-border bg-background/95 px-2 text-[11px] leading-none text-foreground shadow-md">
        <div className="h-1 border-x border-b border-foreground" style={{ width: scale.width }} />
        <div className="mt-1 text-center">{scale.label}</div>
      </div>
    </MapFloatingPanel>
  )
}
