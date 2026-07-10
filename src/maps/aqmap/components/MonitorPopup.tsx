import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, HeartPulse, Users } from 'lucide-react'
import { MapPopup, useMap } from '@/components/ui/map'
import type { AirMonitor } from '@/maps/airquality'
import { getAqhiCategory, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { getAqhiPlusColor } from '../lib/aqhiScale'
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
import { MonitorPlotPanel, type NearbyFem } from './MonitorPlotPanel'

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

export function MonitorPopup({
  monitor,
  locale,
  onClose,
  nearbyFem,
}: {
  monitor: AirMonitor
  locale: AqmapLocale
  onClose: () => void
  nearbyFem?: NearbyFem | null
}) {
  const { map } = useMap()
  const contentRef = useRef<HTMLDivElement>(null)
  const [plotRevision, setPlotRevision] = useState(0)
  const pm25 = getMonitorAqhiPm25(monitor)
  const aqhiCategory = getAqhiCategory(pm25)
  const health = localizeHealthMessage(aqhiCategory, locale)
  const monitorTypeLabel = localizeMonitorType(monitor.network, locale)
  const aqColor = getAqhiPlusColor(pm25)
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
  const isFem = monitor.network === 'FEM' || monitor.network === 'BC ENV'
  const observationValues: Array<{ key: string; value: number | null }> = [
    { key: 'pm25_10min', value: monitor.pm25Recent ?? null },
    { key: 'pm25_1hr', value: monitor.pm25OneHour ?? null },
    { key: 'pm25_3hr', value: monitor.pm25ThreeHour ?? null },
    { key: 'pm25_24hr', value: monitor.pm25TwentyFourHour ?? null },
  ]
  const visibleObservationRows = isFem ? observationValues.filter((row) => row.key !== 'pm25_10min') : observationValues
  const handlePlotVisibilityChange = useCallback(() => {
    setPlotRevision((current) => current + 1)
  }, [])

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
  }, [map, monitor, plotRevision])

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
      className={`aqmap-popup overflow-hidden p-0 max-w-[calc(100vw-32px)] ${supportsComparison ? 'w-[480px]' : 'w-[360px]'}`}
    >
      <div
        ref={contentRef}
        className="aqmap-popup-scroll max-h-[78vh] overflow-y-auto overscroll-contain text-[12px] leading-[1.35] text-foreground"
      >
        {/* AQHI-colored accent bar keyed to the monitor's current category */}
        <div className="sticky top-0 z-[1] h-1.5 w-full" style={{ backgroundColor: aqColor }} aria-hidden="true" />

        {/* Header */}
        <div className="px-3 pt-2.5 pr-7">
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-foreground" title={monitor.name}>
            {monitor.name}
          </div>
          <div className="mt-0.5 text-xs italic text-muted-foreground">
            {monitorTypeLabel} {translate('popup.monitor', locale)}
          </div>
          {monitor.forecastZoneName && (
            <div className="mt-1 text-xs text-muted-foreground">
              {translate('popup.forecastZone', locale)}:{' '}
              <span className="font-medium text-foreground">{monitor.forecastZoneName}</span>
            </div>
          )}
        </div>

        {/* Status chip + observation timestamp */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-foreground"
            style={{ backgroundColor: hexToRgba(aqColor, 0.16) }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: aqColor }} aria-hidden="true" />
            {categoryLabel}
            <span className="font-normal text-muted-foreground">·</span>
            <span className="tabular-nums">
              {formatAqmapPm25Localized(pm25, locale)} {unit}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {translate('popup.observedAsOf', locale)} {formatLocalizedDate(monitor.dateObserved, locale)}
          </span>
        </div>

        <div className="mx-3 mt-2.5 border-t border-border" />

        {/* PM2.5 averages */}
        <div className="px-3 py-2">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {translate('popup.readings', locale)}
          </div>
          <div className="space-y-1">
            {visibleObservationRows.map((row) => {
              const labels = labelMap.get(row.key)
              return (
                <div key={row.key} className="flex items-center justify-between gap-3" title={labels?.title}>
                  <span className="text-muted-foreground">{labels?.label}</span>
                  <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: getAqhiPlusColor(row.value) }}
                      aria-hidden="true"
                    />
                    {formatAqmapPm25Localized(row.value, locale)}
                    <span className="font-normal text-muted-foreground">{unit}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Health advice keyed to AQHI+ category */}
        <div className="mx-3 mb-2 rounded-md border border-border bg-muted/40 p-2">
          <div
            className="text-xs font-semibold leading-snug text-foreground"
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
                  <Icon className="mt-[2px] size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">
                    {label && <span className="font-medium text-foreground">{label}: </span>}
                    {detail}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Timeseries + comparison plots */}
        <div className="px-3 pb-2.5">
          <MonitorPlotPanel
            monitor={monitor}
            locale={locale}
            nearbyFem={nearbyFem}
            onPlotVisibilityChange={handlePlotVisibilityChange}
          />
        </div>
      </div>
    </MapPopup>
  )
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
        <div className="mt-0.5 text-xs italic text-muted-foreground">
          {monitorTypeLabel} {translate('popup.monitor', locale)}
        </div>
        {monitor.forecastZoneName && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {translate('popup.forecastZone', locale)}:{' '}
            <span className="font-medium text-foreground">{monitor.forecastZoneName}</span>
          </div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          <span dangerouslySetInnerHTML={{ __html: translate('popup.observedAsOf', locale) }} />{' '}
          {formatLocalizedDate(monitor.dateObserved, locale)}
        </div>
        <table className="mt-1 w-full text-xs">
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
