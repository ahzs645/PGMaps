import { useState } from 'react'
import { MapImageLegend, MapLegendPanel, MapLegendSection, MapSteppedLegend } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { AQHI_LEVELS, AQHI_NO_DATA_COLOR } from '../lib/aqhiScale'
import {
  localizeSmokeDensity,
  localizeSmokeLabel,
  localizeWmsLabel,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import { FIRE_DANGER_LEGEND_BANDS } from '../lib/fireDangerGrid'
import type { SmokeLayerDefinition, SmokeLayerKey } from '../lib/smokeLayers'
import { WIND_BARB_ICON_DEFINITIONS } from '../lib/windBarbIcons'
import { WMS_LAYERS, type WmsLayerDefinition, type WmsLayerKey } from '../lib/wmsLayers'
import { WIND_LEGEND_COLORS } from './WindCanvasLayer'

export type FireDangerLegendVariant = 'compact' | 'full' | 'tilted' | 'rows'

export const DEFAULT_FIRE_DANGER_LEGEND_VARIANT: FireDangerLegendVariant = 'compact'

export function AqMonitorLegend({
  visibleWmsLayers,
  visibleSmokeLayers,
  smokeLayers,
  windVisible,
  vectorWindBarbsVisible,
  fireDangerLegendVariant = DEFAULT_FIRE_DANGER_LEGEND_VARIANT,
  locale,
}: {
  visibleWmsLayers: Set<WmsLayerKey>
  visibleSmokeLayers: Set<SmokeLayerKey>
  smokeLayers: SmokeLayerDefinition[]
  windVisible: boolean
  vectorWindBarbsVisible: boolean
  fireDangerLegendVariant?: FireDangerLegendVariant
  locale: AqmapLocale
}) {
  const visibleWms = WMS_LAYERS.filter((layer) =>
    layer.key !== 'forecastZones'
    && layer.key !== 'modelledPm25'
    && visibleWmsLayers.has(layer.key)
    && (layer.legendUrl || layer.key === 'activeFires')
  )
  const visibleSmoke = smokeLayers.filter((layer) => visibleSmokeLayers.has(layer.key))
  return (
    <MapLegendPanel
      title={translate('map.legend', locale)}
      width="md"
      collapsible
      className="aqmap-monitor-legend max-h-[min(22rem,calc(100vh-8rem))] max-md:w-[min(14rem,calc(100vw-1.5rem))]"
      contentClassName="max-h-[calc(min(22rem,calc(100vh-8rem))-3rem)] space-y-3 overflow-y-auto pr-1"
    >
      <MapLegendSection>
        <Pm25AqhiLegend locale={locale} />
      </MapLegendSection>

      <MapLegendSection title={translate('sidebar.iconLegend', locale)} className="border-t border-border pt-3">
        <MonitorIconLegendItem shape="diamond" fill="#189aca" stroke="#111827" label={translate('monitorType.fem', locale)} />
        <MonitorIconLegendItem shape="circle" fill="#189aca" stroke="#ffffff" label={`${translate('monitorType.pa', locale)} / ${translate('groups.lcm', locale)}`} />
        <MonitorIconLegendItem shape="square" fill="#189aca" stroke="#ffffff" label={translate('monitorType.egg', locale)} />
        <MonitorIconLegendItem shape="circle" fill={AQHI_NO_DATA_COLOR} stroke="#ffffff" label={translate('monitorType.missing', locale)} muted />
      </MapLegendSection>

      {windVisible && (
        <MapLegendSection title={translate('wind.legend.title', locale)} className="border-t border-border pt-3">
          <WindLegendContent locale={locale} />
        </MapLegendSection>
      )}

      {vectorWindBarbsVisible && (
        <MapLegendSection title={translate('windBarbs.legend.title', locale)} className="border-t border-border pt-3">
          <VectorWindBarbLegendContent locale={locale} />
        </MapLegendSection>
      )}

      {visibleWms.map((layer) => (
        <MapLegendSection key={layer.key} title={localizeWmsLabel(layer.key, locale)} className="border-t border-border pt-3">
          <WmsLegendContent
            layer={layer}
            label={localizeWmsLabel(layer.key, locale)}
            fireDangerLegendVariant={fireDangerLegendVariant}
            locale={locale}
          />
        </MapLegendSection>
      ))}

      {visibleSmoke.map((layer) => (
        <MapLegendSection key={layer.key} title={localizeSmokeLabel(layer.key, locale)} className="border-t border-border pt-3">
          <SmokeLegendContent layer={layer} locale={locale} />
        </MapLegendSection>
      ))}
    </MapLegendPanel>
  )
}

function MonitorIconLegendItem({
  shape,
  fill,
  stroke,
  label,
  muted = false,
}: {
  shape: 'circle' | 'diamond' | 'square'
  fill: string
  stroke: string
  label: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center">
        <svg className={cn(muted ? 'size-3' : 'size-3.5')} viewBox="0 0 30 30" aria-hidden="true">
          {shape === 'diamond' ? (
            <path d="M15 2.5 27.5 15 15 27.5 2.5 15Z" fill={fill} stroke={stroke} strokeWidth="2.5" />
          ) : shape === 'square' ? (
            <rect x="3" y="3" width="24" height="24" rx="4" fill={fill} stroke={stroke} strokeWidth="2.5" />
          ) : (
            <circle cx="15" cy="15" r="12" fill={fill} stroke={stroke} strokeWidth="2.5" />
          )}
        </svg>
      </span>
      <span className="truncate">{label}</span>
    </div>
  )
}

export function WmsLegend({
  layer,
  label,
  locale,
  className,
  fireDangerLegendVariant = DEFAULT_FIRE_DANGER_LEGEND_VARIANT,
}: {
  layer: WmsLayerDefinition
  label: string
  locale: AqmapLocale
  className?: string
  fireDangerLegendVariant?: FireDangerLegendVariant
}) {
  if (layer.key === 'activeFires') {
    return <ActiveFiresLegend label={label} locale={locale} className={className} />
  }

  if (layer.legendRenderer === 'structured') {
    return (
      <div className={cn('rounded-md border border-border bg-secondary/30 p-3 text-xs', className)}>
        <div className="mb-2 font-medium text-foreground">{label}</div>
        <StructuredWmsLegendContent layer={layer} fireDangerLegendVariant={fireDangerLegendVariant} locale={locale} />
      </div>
    )
  }

  if (layer.legendUrl) {
    return (
      <MapImageLegend
        className={className}
        src={layer.legendUrl}
        alt={`${label} legend`}
        label={label}
      />
    )
  }

  return (
    <div className={cn('rounded-md border border-border bg-secondary/30 p-3 text-xs', className)}>
      <div className="mb-2 font-medium text-foreground">{label}</div>
      <div className="h-8 rounded bg-gradient-to-r from-emerald-400 via-amber-300 to-red-600" />
    </div>
  )
}

function WmsLegendContent({
  layer,
  label,
  fireDangerLegendVariant = DEFAULT_FIRE_DANGER_LEGEND_VARIANT,
  locale,
}: {
  layer: WmsLayerDefinition
  label: string
  fireDangerLegendVariant?: FireDangerLegendVariant
  locale: AqmapLocale
}) {
  if (layer.key === 'activeFires') {
    return <ActiveFiresLegendContent locale={locale} />
  }

  if (layer.legendRenderer === 'structured') {
    return <StructuredWmsLegendContent layer={layer} fireDangerLegendVariant={fireDangerLegendVariant} locale={locale} />
  }

  if (layer.legendUrl) {
    return <img src={layer.legendUrl} alt={`${label} legend`} className="max-w-full rounded bg-white object-contain" style={{ maxHeight: 96 }} />
  }

  return <div className="h-8 rounded bg-gradient-to-r from-emerald-400 via-amber-300 to-red-600" />
}

function StructuredWmsLegendContent({
  layer,
  fireDangerLegendVariant = DEFAULT_FIRE_DANGER_LEGEND_VARIANT,
  locale,
}: {
  layer: WmsLayerDefinition
  fireDangerLegendVariant?: FireDangerLegendVariant
  locale: AqmapLocale
}) {
  if (layer.key === 'modelledPm25') {
    return <Pm25AqhiLegend locale={locale} />
  }

  if (layer.key === 'fireDanger') {
    return <FireDangerLegendContent variant={fireDangerLegendVariant} />
  }

  if (layer.legendUrl) {
    return <img src={layer.legendUrl} alt={`${layer.label} legend`} className="max-w-full rounded bg-white object-contain" style={{ maxHeight: 96 }} />
  }

  return <div className="h-8 rounded bg-gradient-to-r from-emerald-400 via-amber-300 to-red-600" />
}

function FireDangerLegendContent({ variant = 'compact' }: { variant?: FireDangerLegendVariant }) {
  if (variant === 'rows') {
    return (
      <div className="space-y-0.5 md:space-y-1.5">
        {FIRE_DANGER_LEGEND_BANDS.map((band) => (
          <div key={band.label} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="h-3 w-5 shrink-0 rounded-sm border border-black/20"
              style={{ backgroundColor: band.color }}
              aria-hidden="true"
            />
            <span>{band.label}</span>
          </div>
        ))}
      </div>
    )
  }

  if (variant === 'full') {
    return (
      <MapSteppedLegend
        variant="strip"
        bands={FIRE_DANGER_LEGEND_BANDS}
        labels={FIRE_DANGER_LEGEND_BANDS.map((band) => band.label)}
      />
    )
  }

  if (variant === 'tilted') {
    return <FireDangerTiltedStripLegend />
  }

  return <FireDangerCompactStripLegend />
}

function FireDangerCompactStripLegend() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const activeIndex = hoveredIndex ?? selectedIndex
  const activeBand = activeIndex === null ? null : FIRE_DANGER_LEGEND_BANDS[activeIndex]

  return (
    <div className="space-y-1">
      <div
        className="grid overflow-hidden rounded-sm border border-border"
        style={{ gridTemplateColumns: `repeat(${FIRE_DANGER_LEGEND_BANDS.length}, minmax(0, 1fr))` }}
      >
        {FIRE_DANGER_LEGEND_BANDS.map((band, index) => (
          <button
            key={band.label}
            type="button"
            title={`Fire Danger: ${band.label}`}
            aria-label={`Fire Danger: ${band.label}`}
            aria-pressed={selectedIndex === index}
            className="block h-11 min-w-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            style={{ backgroundColor: band.color }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            onClick={() => setSelectedIndex((current) => (current === index ? null : index))}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground sm:text-xs">
        <span>Low</span>
        <span className="text-center">High</span>
        <span className="text-right">Extreme</span>
      </div>
      <div className="min-h-4 text-xs font-medium text-foreground" aria-live="polite">
        {activeBand ? `Fire Danger: ${activeBand.label}` : null}
      </div>
    </div>
  )
}

function FireDangerTiltedStripLegend() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const activeIndex = hoveredIndex ?? selectedIndex
  const activeBand = activeIndex === null ? null : FIRE_DANGER_LEGEND_BANDS[activeIndex]

  return (
    <div className="space-y-1">
      <div
        className="grid overflow-hidden rounded-sm border border-border"
        style={{ gridTemplateColumns: `repeat(${FIRE_DANGER_LEGEND_BANDS.length}, minmax(0, 1fr))` }}
      >
        {FIRE_DANGER_LEGEND_BANDS.map((band, index) => (
          <button
            key={band.label}
            type="button"
            title={`Fire Danger: ${band.label}`}
            aria-label={`Fire Danger: ${band.label}`}
            aria-pressed={selectedIndex === index}
            className="block h-11 min-w-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            style={{ backgroundColor: band.color }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onBlur={() => setHoveredIndex(null)}
            onClick={() => setSelectedIndex((current) => (current === index ? null : index))}
          />
        ))}
      </div>
      <div className="relative mt-1 min-h-14 overflow-visible text-xs leading-none text-muted-foreground sm:text-xs">
        {FIRE_DANGER_LEGEND_BANDS.map((band, index) => (
          <span
            key={band.label}
            className="absolute top-0"
            style={{ left: `${((index + 0.5) / FIRE_DANGER_LEGEND_BANDS.length) * 100}%` }}
          >
            <span className="block -translate-x-full origin-top-right -rotate-45 whitespace-nowrap text-right">
              {band.label}
            </span>
          </span>
        ))}
      </div>
      <div className="min-h-4 text-xs font-medium text-foreground" aria-live="polite">
        {activeBand ? `Fire Danger: ${activeBand.label}` : null}
      </div>
    </div>
  )
}

function Pm25AqhiLegend({ locale }: { locale: AqmapLocale }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        AQHI+ · PM2.5 {translate('aqhi.unit', locale)}
      </div>
      <MapSteppedLegend
        variant="strip"
        bands={AQHI_LEVELS.map((level) => ({
          label: level.id === '+' ? '100+' : String(level.min),
          color: level.color,
        }))}
        labels={['0', '30', '60', '100+']}
      />
    </div>
  )
}

function WindLegendContent({ locale }: { locale: AqmapLocale }) {
  return (
    <>
      <div
        className="h-2 w-full rounded"
        style={{ backgroundImage: `linear-gradient(to right, ${WIND_LEGEND_COLORS.join(', ')})` }}
      />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{translate('wind.legend.min', locale)}</span>
        <span>{translate('wind.legend.max', locale)}</span>
      </div>
    </>
  )
}

function VectorWindBarbLegendContent({ locale }: { locale: AqmapLocale }) {
  return (
    <div className="space-y-1.5">
      {WIND_BARB_ICON_DEFINITIONS.map((item) => (
        <div key={item.key} className="flex items-center gap-2 text-xs text-muted-foreground">
          <img src={item.src} alt="" className="h-5 w-10 shrink-0 object-contain" aria-hidden="true" />
          <span>{translate(item.labelKey, locale)}</span>
        </div>
      ))}
      <div className="text-xs leading-3 text-muted-foreground">
        {translate('windBarbs.legend.note', locale)}
      </div>
    </div>
  )
}

function SmokeLegendContent({ layer, locale }: { layer: SmokeLayerDefinition; locale: AqmapLocale }) {
  if (layer.key === 'modelledSmoke') {
    return <ModelledSmokeStripLegend layer={layer} />
  }

  return (
    <div className="space-y-0.5 md:space-y-1.5">
      {layer.legend.map((band) => (
        <div key={band.label} className="flex items-center gap-2 text-xs">
          <span
            className="size-4 shrink-0 rounded border border-black/10"
            style={{ backgroundColor: band.color }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{localizeSmokeDensity(band.label, locale)}</span>
        </div>
      ))}
    </div>
  )
}

function ModelledSmokeStripLegend({ layer }: { layer: SmokeLayerDefinition }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        PM2.5 µg m<sup>-3</sup>
      </div>
      <MapSteppedLegend
        variant="strip"
        bands={layer.legend.map((band) => ({
          label: band.label.replace(/\s+ug m-3$/i, ''),
          color: band.color,
        }))}
        labels={['5', '35', '100', '500+']}
      />
    </div>
  )
}

function ActiveFiresLegend({
  label,
  locale,
  className,
}: {
  label: string
  locale: AqmapLocale
  className?: string
}) {
  return (
    <div className={cn('rounded-md border border-border bg-secondary/30 p-3 text-xs', className)}>
      <div className="mb-2 font-medium text-foreground">{label}</div>
      <ActiveFiresLegendContent locale={locale} />
    </div>
  )
}

function ActiveFiresLegendContent({ locale: _locale }: { locale: AqmapLocale }) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5 md:space-y-1">
        <div className="text-xs font-medium text-foreground">Stage of Control</div>
        <ActiveFireStageLegendItem color="#ef4444" label="Out of Control" />
        <ActiveFireStageLegendItem color="#facc15" label="Being Held" />
        <ActiveFireStageLegendItem color="#0ea5e9" label="Under Control" />
        <ActiveFireStageLegendItem color="#d946ef" label="Out of Control (Monitored)" />
      </div>
      <div className="space-y-0.5 md:space-y-1">
        <div className="text-xs font-medium text-foreground">Fire Size</div>
        <ActiveFireSizeLegendItem size="size-2" label="0 - 100ha" />
        <ActiveFireSizeLegendItem size="size-3" label="100 - 1000ha" />
        <ActiveFireSizeLegendItem size="size-4" label="> 1000ha" />
      </div>
    </div>
  )
}

function ActiveFireStageLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        className="size-2.5 shrink-0 rounded-full border border-black/70"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  )
}

function ActiveFireSizeLegendItem({ size, label }: { size: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
        <span className={cn('rounded-full border border-black bg-white', size)} />
      </span>
      <span>{label}</span>
    </div>
  )
}
