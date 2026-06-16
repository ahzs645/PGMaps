import { useEffect, useState, type ReactNode } from 'react'
import { Crosshair, RotateCcw } from 'lucide-react'
import { useMap } from '@/components/ui/map'
import { MapFloatingPanel } from '@/components/ui/map-overlays'
import { cn } from '@/lib/utils'
import { WMS_LAYERS, type WmsLayerKey } from '../lib/wmsLayers'
import type { SmokeLayerDefinition, SmokeLayerKey } from '../lib/smokeLayers'
import type { AqMonitorGroup } from '../lib/monitorPresentation'
import {
  formatGroupLabel,
  formatLocalizedDate,
  localizeSmokeLabel,
  localizeWmsLabel,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import type { ActiveFiresRenderMode, AqClusterColorScheme, AqMonitorIconMode, FireDangerRenderMode, FirePerimetersRenderMode, ForecastZonesRenderMode } from '../lib/aqMapTypes'
import { REVEAL_CLUSTER_BOUNDS, REVEAL_CLUSTER_DEFAULTS } from '../lib/aqMapConstants'

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
    <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-background">
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
  firePerimetersMode,
  onFirePerimetersModeChange,
  forecastZonesMode,
  onForecastZonesModeChange,
  windVisible,
  onToggleWind,
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
  firePerimetersMode: FirePerimetersRenderMode
  onFirePerimetersModeChange: (mode: FirePerimetersRenderMode) => void
  forecastZonesMode: ForecastZonesRenderMode
  onForecastZonesModeChange: (mode: ForecastZonesRenderMode) => void
  windVisible: boolean
  onToggleWind: () => void
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
            <span>{localizeSmokeLabel(layer.key, locale)}</span>
          </label>
        ))}
        {WMS_LAYERS.map((layer) => (
          <div key={layer.key} className="space-y-1">
            <label className="flex items-center gap-2 text-muted-foreground">
              <input type="checkbox" checked={visibleWmsLayers.has(layer.key)} onChange={() => onToggleWmsLayer(layer.key)} />
              <span>{localizeWmsLabel(layer.key, locale)}</span>
            </label>
            {layer.key === 'fireDanger' && visibleWmsLayers.has('fireDanger') && (
              <SegmentedControl
                value={fireDangerMode}
                onChange={onFireDangerModeChange}
                options={[
                  { value: 'raster', label: translate('overlay.raster', locale) },
                  { value: 'vector', label: translate('overlay.vector', locale) },
                ]}
              />
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
          </div>
        ))}
      </div>
    </MapFloatingPanel>
  )
}

export function MapUtilityControls({ onReset, locale }: { onReset: () => void; locale: AqmapLocale }) {
  const { map } = useMap()

  const locate = () => {
    if (!navigator.geolocation || !map) return
    navigator.geolocation.getCurrentPosition((position) => {
      map.easeTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: 15,
        duration: 650,
      })
    })
  }

  return (
    <MapFloatingPanel position="top-left" className="flex flex-col overflow-hidden rounded border border-border bg-background shadow-md">
      <button type="button" title={translate('controls.zoomToLocation', locale)} onClick={locate} className="p-2 hover:bg-secondary">
        <Crosshair className="size-4" />
      </button>
      <button type="button" title={translate('controls.resetView', locale)} onClick={onReset} className="border-t border-border p-2 hover:bg-secondary">
        <RotateCcw className="size-4" />
      </button>
    </MapFloatingPanel>
  )
}

export function MapTimestamp({ latestDate, locale }: { latestDate: string | null | undefined; locale: AqmapLocale }) {
  return (
    <MapFloatingPanel position="bottom-left" className="rounded border border-border bg-background/95 px-2 py-1 text-[11px] text-foreground shadow-md">
      {translate('app.lastUpdated', locale)} {formatLocalizedDate(latestDate, locale)}
    </MapFloatingPanel>
  )
}

export function ScaleBar() {
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
      const maxWidth = 100
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
    <MapFloatingPanel position="bottom-right" className="rounded border border-border bg-background/95 px-2 py-1 text-[11px] text-foreground shadow-md md:mr-52">
      <div className="h-1 border-x border-b border-foreground" style={{ width: scale.width }} />
      <div className="mt-0.5 text-center">{scale.label}</div>
    </MapFloatingPanel>
  )
}
