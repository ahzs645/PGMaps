import { MapImageLegend, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { AQHI_STOPS } from '../lib/aqMapConstants'
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

const FIRE_DANGER_LEGEND_BANDS = [
  { label: 'Low', color: '#0000ff' },
  { label: 'Moderate', color: '#00b050' },
  { label: 'High', color: '#ffff00' },
  { label: 'Very high', color: '#ff9900' },
  { label: 'Extreme', color: '#ff0000' },
] as const

const MODELLED_PM25_LEGEND_STOPS = [
  { value: 0, color: '#21c5f4' },
  { value: 10, color: '#1899c9' },
  { value: 20, color: '#0d6796' },
  { value: 30, color: '#fefc37' },
  { value: 40, color: '#fecb2e' },
  { value: 50, color: '#fd993f' },
  { value: 60, color: '#fc6769' },
  { value: 70, color: '#fe3b3b' },
  { value: 80, color: '#fe0101' },
  { value: 90, color: '#ca0713' },
  { value: 100, color: '#650205' },
] as const

export function AqMonitorLegend({
  visibleWmsLayers,
  visibleSmokeLayers,
  smokeLayers,
  windVisible,
  vectorWindBarbsVisible,
  locale,
}: {
  visibleWmsLayers: Set<WmsLayerKey>
  visibleSmokeLayers: Set<SmokeLayerKey>
  smokeLayers: SmokeLayerDefinition[]
  windVisible: boolean
  vectorWindBarbsVisible: boolean
  locale: AqmapLocale
}) {
  const visibleWms = WMS_LAYERS.filter((layer) => visibleWmsLayers.has(layer.key) && (layer.legendUrl || layer.key === 'activeFires'))
  const visibleSmoke = smokeLayers.filter((layer) => visibleSmokeLayers.has(layer.key))
  return (
    <MapLegendPanel
      title={translate('map.legend', locale)}
      width="md"
      collapsible
      className="max-h-[min(22rem,calc(100vh-8rem))]"
      contentClassName="max-h-[calc(min(22rem,calc(100vh-8rem))-3rem)] space-y-3 overflow-y-auto pr-1"
    >
      <MapLegendSection title={translate('sidebar.pm25Legend', locale)}>
        <div className="space-y-1">
          {AQHI_STOPS.map((stop) => (
            <div key={stop.labelKey} className="flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
              <span className="size-2.5 shrink-0 rounded-full border border-black/20 shadow-sm" style={{ backgroundColor: stop.color }} />
              <span className="truncate">
                {translate(stop.labelKey, locale)}
                {' '}
                {translate(stop.rangeKey, locale)}
                {' '}
                {translate('aqhi.unit', locale)}
              </span>
            </div>
          ))}
        </div>
      </MapLegendSection>

      <MapLegendSection title={translate('sidebar.iconLegend', locale)} className="border-t border-border pt-3">
        <MonitorIconLegendItem shape="diamond" fill="#3bb54a" stroke="#111827" label={translate('monitorType.fem', locale)} />
        <MonitorIconLegendItem shape="circle" fill="#3bb54a" stroke="#ffffff" label={`${translate('monitorType.pa', locale)} / ${translate('groups.lcm', locale)}`} />
        <MonitorIconLegendItem shape="square" fill="#3bb54a" stroke="#ffffff" label={translate('monitorType.egg', locale)} />
        <MonitorIconLegendItem shape="circle" fill="#94a3b8" stroke="#ffffff" label={translate('monitorType.missing', locale)} muted />
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
          <WmsLegendContent layer={layer} label={localizeWmsLabel(layer.key, locale)} locale={locale} />
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
}: {
  layer: WmsLayerDefinition
  label: string
  locale: AqmapLocale
  className?: string
}) {
  if (layer.key === 'activeFires') {
    return <ActiveFiresLegend label={label} locale={locale} className={className} />
  }

  if (layer.legendRenderer === 'structured') {
    return (
      <div className={cn('rounded-md border border-border bg-secondary/30 p-3 text-xs', className)}>
        <div className="mb-2 font-medium text-foreground">{label}</div>
        <StructuredWmsLegendContent layer={layer} />
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
  locale,
}: {
  layer: WmsLayerDefinition
  label: string
  locale: AqmapLocale
}) {
  if (layer.key === 'activeFires') {
    return <ActiveFiresLegendContent locale={locale} />
  }

  if (layer.legendRenderer === 'structured') {
    return <StructuredWmsLegendContent layer={layer} />
  }

  if (layer.legendUrl) {
    return <img src={layer.legendUrl} alt={`${label} legend`} className="max-w-full rounded bg-white object-contain" style={{ maxHeight: 96 }} />
  }

  return <div className="h-8 rounded bg-gradient-to-r from-emerald-400 via-amber-300 to-red-600" />
}

function StructuredWmsLegendContent({ layer }: { layer: WmsLayerDefinition }) {
  if (layer.key === 'modelledPm25') {
    return <ModelledPm25GradientLegend />
  }

  if (layer.key === 'fireDanger') {
    return (
      <div className="space-y-1.5">
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

  if (layer.legendUrl) {
    return <img src={layer.legendUrl} alt={`${layer.label} legend`} className="max-w-full rounded bg-white object-contain" style={{ maxHeight: 96 }} />
  }

  return <div className="h-8 rounded bg-gradient-to-r from-emerald-400 via-amber-300 to-red-600" />
}

function ModelledPm25GradientLegend() {
  const gradient = `linear-gradient(to right, ${MODELLED_PM25_LEGEND_STOPS.map((stop) => stop.color).join(', ')})`
  return (
    <div className="space-y-1.5">
      <div className="h-3 rounded border border-black/10" style={{ backgroundImage: gradient }} />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100+</span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        PM2.5 µg m<sup>-3</sup>
      </div>
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
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{translate('wind.legend.min', locale)}</span>
        <span>{translate('wind.legend.max', locale)}</span>
      </div>
    </>
  )
}

function VectorWindBarbLegendContent({ locale }: { locale: AqmapLocale }) {
  const items = [
    { speed: 5, label: translate('windBarbs.legend.5kt', locale) },
    { speed: 10, label: translate('windBarbs.legend.10kt', locale) },
    { speed: 50, label: translate('windBarbs.legend.50kt', locale) },
  ] as const

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.speed} className="flex items-center gap-2 text-xs text-muted-foreground">
          <WindBarbLegendIcon speed={item.speed} />
          <span>{item.label}</span>
        </div>
      ))}
      <div className="text-[10px] leading-3 text-muted-foreground">
        {translate('windBarbs.legend.note', locale)}
      </div>
    </div>
  )
}

function WindBarbLegendIcon({ speed }: { speed: 5 | 10 | 50 }) {
  return (
    <svg className="h-6 w-12 shrink-0" viewBox="0 0 48 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        <path d="M8 18 36 6" />
        {speed === 5 && <path d="M34 7 38 14" />}
        {speed === 10 && <path d="M34 7 40 17" />}
        {speed === 50 && <path d="M34 7 42 11 38 16" fill="currentColor" stroke="none" />}
      </g>
    </svg>
  )
}

function SmokeLegendContent({ layer, locale }: { layer: SmokeLayerDefinition; locale: AqmapLocale }) {
  return (
    <div className="space-y-1.5">
      {layer.legend.map((band) => (
        <div key={band.label} className="flex items-center gap-2 text-xs">
          <span
            className="size-4 shrink-0 rounded border border-black/10"
            style={{ backgroundColor: band.color }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">
            {layer.key === 'modelledSmoke'
              ? <ModelledSmokeLegendLabel label={band.label} />
              : localizeSmokeDensity(band.label, locale)}
          </span>
        </div>
      ))}
    </div>
  )
}

function ModelledSmokeLegendLabel({ label }: { label: string }) {
  const range = label.replace(/\s+ug m-3$/i, '')
  return (
    <>
      {range}
      {' '}
      µg m<sup>-3</sup>
    </>
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

function ActiveFiresLegendContent({ locale }: { locale: AqmapLocale }) {
  return (
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
  )
}
