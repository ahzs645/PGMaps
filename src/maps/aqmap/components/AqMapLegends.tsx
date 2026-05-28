import { MapImageLegend, MapSteppedLegend } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import {
  localizeSmokeDensity,
  localizeSmokeLabel,
  localizeWmsLabel,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import type { SmokeLayerDefinition, SmokeLayerKey } from '../lib/smokeLayers'
import { WMS_LAYERS, type WmsLayerDefinition, type WmsLayerKey } from '../lib/wmsLayers'
import { WIND_LEGEND_COLORS } from './WindCanvasLayer'

export function FloatingLegends({
  visibleWmsLayers,
  visibleSmokeLayers,
  smokeLayers,
  windVisible,
  locale,
}: {
  visibleWmsLayers: Set<WmsLayerKey>
  visibleSmokeLayers: Set<SmokeLayerKey>
  smokeLayers: SmokeLayerDefinition[]
  windVisible: boolean
  locale: AqmapLocale
}) {
  const visibleWms = WMS_LAYERS.filter((layer) => visibleWmsLayers.has(layer.key) && (layer.legendUrl || layer.key === 'activeFires'))
  const visibleSmoke = smokeLayers.filter((layer) => visibleSmokeLayers.has(layer.key))
  if (visibleWms.length === 0 && visibleSmoke.length === 0 && !windVisible) return null

  return (
    <div
      className="absolute z-10 max-w-[260px] space-y-2"
      style={{ bottom: 40, left: 12 }}
    >
      {windVisible && <WindLegend locale={locale} />}
      {visibleWms.map((layer) => (
        <WmsLegend
          key={layer.key}
          layer={layer}
          label={localizeWmsLabel(layer.key, locale)}
          locale={locale}
          className="bg-background/95 p-2 shadow-md"
        />
      ))}
      {visibleSmoke.map((layer) => (
        <SmokeLegend key={layer.key} layer={layer} locale={locale} />
      ))}
    </div>
  )
}

export function WmsLegend({
  layer,
  label,
  locale,
  className,
}: {
  layer: WmsLayerDefinition
  label: string
  locale: AqmapLocale
  className?: string
}) {
  if (layer.key === 'activeFires') {
    return <ActiveFiresLegend label={label} locale={locale} className={className} />
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

function WindLegend({ locale }: { locale: AqmapLocale }) {
  return (
    <div className="rounded border border-border bg-background/95 p-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{translate('wind.legend.title', locale)}</div>
      <div
        className="h-2 w-full rounded"
        style={{ backgroundImage: `linear-gradient(to right, ${WIND_LEGEND_COLORS.join(', ')})` }}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{translate('wind.legend.min', locale)}</span>
        <span>{translate('wind.legend.max', locale)}</span>
      </div>
    </div>
  )
}

function SmokeLegend({ layer, locale }: { layer: SmokeLayerDefinition; locale: AqmapLocale }) {
  return (
    <div className="rounded border border-border bg-background/95 p-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{localizeSmokeLabel(layer.key, locale)}</div>
      <MapSteppedLegend
        bands={layer.legend.map((band) => ({
          ...band,
          label: localizeSmokeDensity(band.label, locale),
        }))}
        variant="rows"
        showBandLabels={false}
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
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span className="absolute size-4 rounded-full bg-red-500/20" />
            <span className="size-2.5 rounded-full border border-white bg-red-600 shadow-sm" />
          </span>
          <span className="text-muted-foreground">{translate('legend.activeFires.current', locale)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span className="absolute size-3.5 rotate-45 rounded-[2px] bg-orange-400/30" />
            <span className="size-2 rotate-45 rounded-[1px] border border-white bg-orange-500 shadow-sm" />
          </span>
          <span className="text-muted-foreground">{translate('legend.activeFires.hotspot', locale)}</span>
        </div>
      </div>
    </div>
  )
}
