import { useEffect, useState, type ReactNode } from 'react'
import { Crosshair, RotateCcw } from 'lucide-react'
import { useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { WMS_LAYERS, type WmsLayerKey } from '../lib/wmsLayers'
import type { SmokeLayerDefinition, SmokeLayerKey } from '../lib/smokeLayers'
import type { AqBasemap, AqMonitorGroup } from '../lib/monitorPresentation'
import {
  formatGroupLabel,
  formatLocalizedDate,
  localizeSmokeLabel,
  localizeWmsLabel,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import type { AqMonitorIconMode, FireDangerRenderMode } from '../lib/aqMapTypes'

export function basemapLabel(value: AqBasemap, locale: AqmapLocale): string {
  return value === 'light'
    ? translate('sidebar.basemap.light', locale)
    : translate('sidebar.basemap.dark', locale)
}

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

export function FloatingLayerControl({
  basemap,
  onBasemapChange,
  visibleGroups,
  onToggleGroup,
  iconMode,
  onIconModeChange,
  visibleWmsLayers,
  onToggleWmsLayer,
  visibleSmokeLayers,
  onToggleSmokeLayer,
  fireDangerMode,
  onFireDangerModeChange,
  windVisible,
  onToggleWind,
  smokeLayers,
  locale,
}: {
  basemap: AqBasemap
  onBasemapChange: (basemap: AqBasemap) => void
  visibleGroups: Set<AqMonitorGroup>
  onToggleGroup: (group: AqMonitorGroup) => void
  iconMode: AqMonitorIconMode
  onIconModeChange: (mode: AqMonitorIconMode) => void
  visibleWmsLayers: Set<WmsLayerKey>
  onToggleWmsLayer: (layer: WmsLayerKey) => void
  visibleSmokeLayers: Set<SmokeLayerKey>
  onToggleSmokeLayer: (layer: SmokeLayerKey) => void
  fireDangerMode: FireDangerRenderMode
  onFireDangerModeChange: (mode: FireDangerRenderMode) => void
  windVisible: boolean
  onToggleWind: () => void
  smokeLayers: SmokeLayerDefinition[]
  locale: AqmapLocale
}) {
  return (
    <div
      className="absolute z-10 w-56 rounded border border-border bg-background/95 p-3 text-xs shadow-md backdrop-blur"
      style={{ top: 12, right: 12 }}
    >
      <div className="font-semibold text-foreground">{translate('controls.basemaps', locale)}</div>
      <div className="mt-1 space-y-1">
        {(['light', 'dark'] as AqBasemap[]).map((option) => (
          <label key={option} className="flex items-center gap-2 text-muted-foreground">
            <input type="radio" checked={basemap === option} onChange={() => onBasemapChange(option)} />
            <span>{basemapLabel(option, locale)}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 font-semibold text-foreground">{translate('controls.layers', locale)}</div>
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
          </div>
        ))}
      </div>
    </div>
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
    <div
      className="absolute z-10 flex flex-col overflow-hidden rounded border border-border bg-background shadow-md"
      style={{ top: 12, left: 12 }}
    >
      <button type="button" title={translate('controls.zoomToLocation', locale)} onClick={locate} className="p-2 hover:bg-secondary">
        <Crosshair className="size-4" />
      </button>
      <button type="button" title={translate('controls.resetView', locale)} onClick={onReset} className="border-t border-border p-2 hover:bg-secondary">
        <RotateCcw className="size-4" />
      </button>
    </div>
  )
}

export function MapTimestamp({ latestDate, locale }: { latestDate: string | null | undefined; locale: AqmapLocale }) {
  return (
    <div
      className="absolute z-10 rounded border border-border bg-background/95 px-2 py-1 text-[11px] text-foreground shadow-md"
      style={{ bottom: 12, left: 12 }}
    >
      {translate('app.lastUpdated', locale)} {formatLocalizedDate(latestDate, locale)}
    </div>
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
    <div
      className="absolute z-10 rounded border border-border bg-background/95 px-2 py-1 text-[11px] text-foreground shadow-md"
      style={{ bottom: 12, right: 220 }}
    >
      <div className="h-1 border-x border-b border-foreground" style={{ width: scale.width }} />
      <div className="mt-0.5 text-center">{scale.label}</div>
    </div>
  )
}
