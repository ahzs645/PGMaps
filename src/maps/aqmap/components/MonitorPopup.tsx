import { useEffect, useMemo, useRef, useState } from 'react'
import { LineChart } from 'lucide-react'
import { MapPopup, useMap } from '@/components/ui/map'
import type { AirMonitor } from '@/maps/airquality'
import {
  getAqhiCategory,
  getAqhiColor,
  getMonitorAqhiPm25,
} from '@/maps/airquality/lib/monitorPopup'
import {
  buildObservationRowLabels,
  formatAqmapPm25Localized,
  formatLocalizedDate,
  localizeHealthMessage,
  localizeMonitorType,
  translate,
  type AqmapLocale,
} from '../lib/i18n'
import { fetchAqmapPlotSeries, type AqPlotPoint } from '../lib/plotData'
import { MonitorPlotChart } from './MonitorPlotChart'

export function MonitorPopup({ monitor, locale, onClose }: { monitor: AirMonitor; locale: AqmapLocale; onClose: () => void }) {
  const { map } = useMap()
  const contentRef = useRef<HTMLDivElement>(null)
  const [showPlot, setShowPlot] = useState(false)
  const [plotPoints, setPlotPoints] = useState<AqPlotPoint[]>([])
  const [plotSource, setPlotSource] = useState<'endpoint' | 'fallback'>('fallback')
  const pm25 = getMonitorAqhiPm25(monitor)
  const aqhiCategory = getAqhiCategory(pm25)
  const health = localizeHealthMessage(aqhiCategory, locale)
  const monitorTypeLabel = localizeMonitorType(monitor.network, locale)
  const labelMap = useMemo(() => {
    const map = new Map<string, { label: string; title: string }>()
    for (const entry of buildObservationRowLabels(locale)) {
      map.set(entry.key, { label: entry.label, title: entry.title })
    }
    return map
  }, [locale])
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

  useEffect(() => {
    if (!map) return
    const frame = window.requestAnimationFrame(() => {
      const popupHeight = contentRef.current?.offsetHeight ?? 0
      if (popupHeight > 0) {
        map.panBy([0, -(popupHeight / 2 + 12)], { duration: 300 })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [map, monitor])

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
      offset={[0, -5]}
      maxWidth="540px"
      className="aqmap-popup w-[520px] max-w-[calc(100vw-32px)] p-0"
    >
      <div ref={contentRef} className="p-2 pr-6 text-[12px] leading-[1.35] text-black">
        <div className="popup_title" style={{ verticalAlign: 'middle' }}>
          <span title={monitor.name}>
            <big><strong>{monitor.name}</strong></big>
          </span>
        </div>
        <div className="text-[12px] italic">{monitorTypeLabel} {translate('popup.monitor', locale)}</div>
        <div className="text-[12px]">
          <span dangerouslySetInnerHTML={{ __html: translate('popup.observedAsOf', locale) }} />{' '}
          {formatLocalizedDate(monitor.dateObserved, locale)}
        </div>
        <table className="mt-1">
          <tbody>
            {visibleObservationRows.map((row) => {
              const labels = labelMap.get(row.key)
              return (
                <tr key={row.key}>
                  <td className="popup_value pr-3" title={labels?.title}>
                    <b>{labels?.label}:</b>
                  </td>
                  <td className="popup_value">
                    {formatAqmapPm25Localized(row.value, locale)}{' '}
                    <span dangerouslySetInnerHTML={{ __html: '&mu;g m<sup>-3</sup>' }} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <table className="mt-1">
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'middle' }}>
                <span title={translate('popup.healthMessage', locale)}>
                  <b>{health.heading}</b>
                </span>
                <br />
                {health.lines.map((line) => (
                  <span key={line}>{line}<br /></span>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setShowPlot((value) => !value)}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
          >
            <LineChart className="size-3.5" />
            {translate('popup.plotButton', locale)}
          </button>
        </div>
        {showPlot && (
          <div className="mt-3 rounded-md border border-border bg-secondary/20 p-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{translate('popup.hourlyPm25', locale)}</span>
              <span>{plotSource === 'endpoint' ? translate('popup.plotSource.endpoint', locale) : translate('popup.plotSource.fallback', locale)}</span>
            </div>
            <MonitorPlotChart
              points={plotPoints}
              locale={locale}
              highlightColor={getAqhiColor(pm25)}
              currentValue={pm25 ?? undefined}
              height={220}
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              {translate('popup.now', locale)}: {formatAqmapPm25Localized(pm25, locale)} {translate('aqhi.unit', locale)}
            </div>
          </div>
        )}
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
        <div className="mt-0.5 text-[11px] italic text-muted-foreground">{monitorTypeLabel} {translate('popup.monitor', locale)}</div>
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
