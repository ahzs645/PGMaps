import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronRight, HeartPulse, LineChart, Users } from 'lucide-react'
import { MapPopup, useMap } from '@/components/ui/map'
import type { AirMonitor } from '@/maps/airquality'
import {
  getAqhiCategory,
  getAqhiColor,
  getMonitorAqhiPm25,
} from '@/maps/airquality/lib/monitorPopup'
import {
  buildObservationRowLabels,
  formatAqhiCategory,
  formatAqmapPm25Localized,
  formatLocalizedDate,
  localizeHealthMessage,
  localizeMonitorType,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import { fetchAqmapPlotSeries, type AqPlotPoint } from '../lib/plotData'
import { buildAbPoints, buildPaFemPoints } from '../lib/comparisonData'
import { MonitorPlotChart } from './MonitorPlotChart'
import { MonitorScatterChart } from './MonitorScatterChart'

export interface NearbyFem {
  monitor: AirMonitor
  distanceKm: number
}

type PlotMode = 'ts' | 'xy' | 'xy_cor'

/** Convert a 6-digit hex color to an rgba() string for subtle tinted backgrounds. */
function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Split a health line like "General Population - message" into label + detail. */
function splitHealthLine(line: string): { label: string; detail: string } {
  const match = line.match(/^(.*?)\s[-—–]\s(.*)$/)
  if (match) return { label: match[1], detail: match[2] }
  return { label: '', detail: line }
}

export function MonitorPopup({ monitor, locale, onClose, nearbyFem }: { monitor: AirMonitor; locale: AqmapLocale; onClose: () => void; nearbyFem?: NearbyFem | null }) {
  const { map } = useMap()
  const contentRef = useRef<HTMLDivElement>(null)
  const [showPlot, setShowPlot] = useState(false)
  const [plotMode, setPlotMode] = useState<PlotMode>('ts')
  const [plotPoints, setPlotPoints] = useState<AqPlotPoint[]>([])
  const [plotSource, setPlotSource] = useState<'endpoint' | 'fallback'>('fallback')
  const pm25 = getMonitorAqhiPm25(monitor)
  const aqhiCategory = getAqhiCategory(pm25)
  const health = localizeHealthMessage(aqhiCategory, locale)
  const monitorTypeLabel = localizeMonitorType(monitor.network, locale)
  const aqColor = getAqhiColor(pm25)
  const categoryLabel = formatAqhiCategory(aqhiCategory, locale)
  const unit = translate('aqhi.unit', locale)
  const isNoData = pm25 === null
  const labelMap = useMemo(() => {
    const map = new Map<string, { label: string; title: string }>()
    for (const entry of buildObservationRowLabels(locale)) {
      map.set(entry.key, { label: entry.label, title: entry.title })
    }
    return map
  }, [locale])
  const supportsComparison = monitor.network === 'PA' || monitor.network === 'EGG'
  const abPoints = useMemo(() => buildAbPoints(monitor, plotPoints), [monitor, plotPoints])
  const paFemPoints = useMemo(() => buildPaFemPoints(monitor, plotPoints), [monitor, plotPoints])
  const isFem = monitor.network === 'FEM' || monitor.network === 'BC ENV'
  const observationValues: Array<{ key: string; value: number | null }> = [
    { key: 'pm25_10min', value: monitor.pm25Recent ?? null },
    { key: 'pm25_1hr', value: monitor.pm25OneHour ?? null },
    { key: 'pm25_3hr', value: monitor.pm25ThreeHour ?? null },
    { key: 'pm25_24hr', value: monitor.pm25TwentyFourHour ?? null },
  ]
  const visibleObservationRows = isFem
    ? observationValues.filter((row) => row.key !== 'pm25_10min')
    : observationValues

  // Center the popup in the map viewport when it opens — and re-center when the
  // timeseries plot expands the card — so the whole card stays in focus. Mirrors
  // the upstream aqmapr `center_on_popup` behaviour: project the anchor point,
  // shift up by half the popup height, then pan that point to the map center.
  useEffect(() => {
    if (!map) return
    const frame = window.requestAnimationFrame(() => {
      const el = contentRef.current
      if (!el) return
      const anchor = map.project([monitor.longitude, monitor.latitude])
      const target = map.unproject([anchor.x, anchor.y - el.offsetHeight / 2])
      map.panTo(target, { duration: 300 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [map, monitor, showPlot])

  useEffect(() => {
    if (!showPlot) return
    const controller = new AbortController()
    fetchAqmapPlotSeries(monitor, controller.signal)
      .then((result) => {
        setPlotPoints(result.points)
        setPlotSource(result.source)
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') {
          setPlotPoints([])
          setPlotSource('fallback')
        }
      })
    return () => controller.abort()
  }, [monitor, showPlot])

  return (
    <MapPopup
      longitude={monitor.longitude}
      latitude={monitor.latitude}
      onClose={onClose}
      closeButton
      closeOnClick={false}
      anchor="bottom"
      offset={[0, -5]}
      maxWidth="540px"
      className={`aqmap-popup overflow-hidden p-0 max-w-[calc(100vw-32px)] ${showPlot ? 'w-[480px]' : 'w-[360px]'}`}
    >
      <div ref={contentRef} className="max-h-[78vh] overflow-y-auto overscroll-contain text-[12px] leading-[1.35] text-gray-700">
        {/* AQHI-colored accent bar keyed to the monitor's current category */}
        <div className="sticky top-0 z-[1] h-1.5 w-full" style={{ backgroundColor: aqColor }} aria-hidden="true" />

        {/* Header */}
        <div className="px-3 pt-2.5 pr-7">
          <div
            className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900"
            title={monitor.name}
          >
            {monitor.name}
          </div>
          <div className="mt-0.5 text-[11px] italic text-gray-500">
            {monitorTypeLabel} {translate('popup.monitor', locale)}
          </div>
          {monitor.forecastZoneName && (
            <div className="mt-1 text-[11px] text-gray-500">
              {translate('popup.forecastZone', locale)}: <span className="font-medium text-gray-700">{monitor.forecastZoneName}</span>
            </div>
          )}
        </div>

        {/* Status chip + observation timestamp */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-gray-800"
            style={{ backgroundColor: hexToRgba(aqColor, 0.16) }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: aqColor }} aria-hidden="true" />
            {categoryLabel}
            <span className="font-normal text-gray-400">·</span>
            <span className="tabular-nums">{formatAqmapPm25Localized(pm25, locale)} {unit}</span>
          </span>
          <span className="text-[11px] text-gray-500">
            {translate('popup.observedAsOf', locale)} {formatLocalizedDate(monitor.dateObserved, locale)}
          </span>
        </div>

        <div className="mx-3 mt-2.5 border-t border-gray-200" />

        {/* PM2.5 averages */}
        <div className="px-3 py-2">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {translate('popup.readings', locale)}
          </div>
          <div className="space-y-1">
            {visibleObservationRows.map((row) => {
              const labels = labelMap.get(row.key)
              return (
                <div key={row.key} className="flex items-center justify-between gap-3" title={labels?.title}>
                  <span className="text-gray-600">{labels?.label}</span>
                  <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-gray-900">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: getAqhiColor(row.value) }}
                      aria-hidden="true"
                    />
                    {formatAqmapPm25Localized(row.value, locale)}
                    <span className="font-normal text-gray-400">{unit}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Health advice keyed to AQHI+ category */}
        <div className="mx-3 mb-2 rounded-md border border-gray-200 bg-gray-50 p-2">
          <div
            className="text-[11px] font-semibold leading-snug text-gray-900"
            title={translate('popup.healthMessage', locale)}
          >
            {health.heading}
          </div>
          <div className="mt-1.5 space-y-1">
            {health.lines.map((line, index) => {
              const { label, detail } = splitHealthLine(line)
              const Icon = isNoData ? AlertCircle : index === 0 ? Users : HeartPulse
              return (
                <div key={line} className="flex items-start gap-1.5">
                  <Icon className="mt-[2px] size-3 shrink-0 text-gray-400" aria-hidden="true" />
                  <span className="text-gray-600">
                    {label && <span className="font-medium text-gray-700">{label}: </span>}
                    {detail}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Timeseries + comparison plots */}
        <div className="px-3 pb-2.5">
          <button
            type="button"
            onClick={() => {
              if (showPlot && plotMode === 'ts') setShowPlot(false)
              else { setPlotMode('ts'); setShowPlot(true) }
            }}
            className={plotButtonClass(showPlot && plotMode === 'ts')}
          >
            <LineChart className="size-3.5" />
            {translate('popup.plotButton', locale)}
          </button>

          {supportsComparison && (
            <details className="group mt-2">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden="true" />
                {translate('popup.compare', locale)}
              </summary>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { setPlotMode('xy'); setShowPlot(true) }}
                  className={plotButtonClass(showPlot && plotMode === 'xy')}
                >
                  {translate('popup.compare.internal', locale)}
                </button>
                <button
                  type="button"
                  disabled={!nearbyFem}
                  title={nearbyFem ? undefined : translate('plot.fem.none', locale)}
                  onClick={() => { if (nearbyFem) { setPlotMode('xy_cor'); setShowPlot(true) } }}
                  className={plotButtonClass(showPlot && plotMode === 'xy_cor', !nearbyFem)}
                >
                  {translate('popup.compare.fem', locale)}
                </button>
              </div>
            </details>
          )}

          {showPlot && (
            <div className="mt-2.5 rounded-md border border-gray-200 bg-gray-50 p-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                <span>
                  {plotMode === 'ts'
                    ? translate('popup.hourlyPm25', locale)
                    : plotMode === 'xy'
                      ? translate('plot.ab.title', locale)
                      : translate('plot.fem.title', locale)}
                </span>
                <span>{plotSource === 'endpoint' ? translate('popup.plotSource.endpoint', locale) : translate('popup.plotSource.fallback', locale)}</span>
              </div>
              {plotMode === 'ts' && (
                <MonitorPlotChart
                  points={plotPoints}
                  locale={locale}
                  highlightColor={aqColor}
                  currentValue={pm25 ?? undefined}
                  height={170}
                />
              )}
              {plotMode === 'xy' && (
                <MonitorScatterChart mode="xy" abPoints={abPoints} locale={locale} height={200} />
              )}
              {plotMode === 'xy_cor' && (
                <>
                  <MonitorScatterChart mode="xy_cor" paFemPoints={paFemPoints} locale={locale} height={200} />
                  {nearbyFem && (
                    <div className="mt-1 text-[10px] text-gray-500">
                      {translate('plot.fem.comparedWith', locale)
                        .replace('{name}', nearbyFem.monitor.name)
                        .replace('{dist}', nearbyFem.distanceKm.toFixed(1))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </MapPopup>
  )
}

function plotButtonClass(active: boolean, disabled = false): string {
  const base = 'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-colors'
  if (disabled) return `${base} cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400`
  if (active) return `${base} border-gray-400 bg-gray-100 text-gray-900`
  return `${base} border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900`
}

export function MonitorTooltip({ monitor, locale }: { monitor: AirMonitor; locale: AqmapLocale }) {
  const monitorTypeLabel = localizeMonitorType(monitor.network, locale)
  const labelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of buildObservationRowLabels(locale)) {
      map.set(entry.key, entry.label)
    }
    return map
  }, [locale])
  const isFem = monitor.network === 'FEM' || monitor.network === 'BC ENV'
  const observations: Array<{ key: string; value: number | null }> = [
    { key: 'pm25_10min', value: monitor.pm25Recent ?? null },
    { key: 'pm25_1hr', value: monitor.pm25OneHour ?? null },
    { key: 'pm25_3hr', value: monitor.pm25ThreeHour ?? null },
    { key: 'pm25_24hr', value: monitor.pm25TwentyFourHour ?? null },
  ]
  const rows = isFem ? observations.filter((row) => row.key !== 'pm25_10min') : observations

  return (
    <MapPopup
      longitude={monitor.longitude}
      latitude={monitor.latitude}
      closeOnClick={false}
      closeButton={false}
      focusAfterOpen={false}
      offset={18}
      maxWidth="280px"
      className="aqmap-tooltip pointer-events-none w-[260px] px-2 py-1.5"
    >
      <div className="text-xs">
        <div className="tooltip_title truncate font-semibold text-foreground">{monitor.name}</div>
        <div className="mt-0.5 text-[11px] italic text-muted-foreground">{monitorTypeLabel} {translate('popup.monitor', locale)}</div>
        {monitor.forecastZoneName && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {translate('popup.forecastZone', locale)}: <span className="font-medium text-foreground">{monitor.forecastZoneName}</span>
          </div>
        )}
        <div className="mt-1 text-[11px] text-muted-foreground">
          <span dangerouslySetInnerHTML={{ __html: translate('popup.observedAsOf', locale) }} />{' '}
          {formatLocalizedDate(monitor.dateObserved, locale)}
        </div>
        <table className="mt-1 w-full text-[11px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="pr-3 text-muted-foreground">{labelMap.get(row.key)}:</td>
                <td className="popup_value text-right font-medium text-foreground">
                  {formatAqmapPm25Localized(row.value, locale)}{' '}
                  <span dangerouslySetInnerHTML={{ __html: '&mu;g m<sup>-3</sup>' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MapPopup>
  )
}
