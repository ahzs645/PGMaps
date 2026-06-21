import { useEffect, useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import type { AirMonitor } from '@/maps/airquality'
import { getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { cn } from '@/lib/utils'
import { buildAbPoints, buildPaFemPoints } from '../lib/comparisonData'
import { getAqhiPlusColor } from '../lib/aqhiScale'
import { translate, type AqmapLocale } from '../lib/i18n'
import { fetchAqmapPlotSeries, type AqPlotPoint } from '../lib/plotData'
import { MonitorPlotChart } from './MonitorPlotChart'
import { MonitorScatterChart } from './MonitorScatterChart'

export interface NearbyFem {
  monitor: AirMonitor
  distanceKm: number
}

type PlotMode = 'ts' | 'xy' | 'xy_cor'

function plotButtonClass(active: boolean, disabled = false): string {
  const base =
    'inline-flex whitespace-nowrap items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium shadow-sm transition-colors'
  if (disabled) return `${base} cursor-not-allowed border-border bg-muted/40 text-muted-foreground/60`
  if (active) return `${base} border-border bg-muted text-foreground`
  return `${base} border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground`
}

export function MonitorPlotPanel({
  monitor,
  locale,
  nearbyFem,
  className,
  panelClassName,
  onPlotVisibilityChange,
}: {
  monitor: AirMonitor
  locale: AqmapLocale
  nearbyFem?: NearbyFem | null
  className?: string
  panelClassName?: string
  onPlotVisibilityChange?: () => void
}) {
  const [showPlot, setShowPlot] = useState(false)
  const [plotMode, setPlotMode] = useState<PlotMode>('ts')
  const [plotPoints, setPlotPoints] = useState<AqPlotPoint[]>([])
  const [plotSource, setPlotSource] = useState<'endpoint' | 'fallback'>('fallback')
  const [plotLoading, setPlotLoading] = useState(false)
  const pm25 = getMonitorAqhiPm25(monitor)
  const aqColor = getAqhiPlusColor(pm25)
  const supportsComparison = monitor.network === 'PA' || monitor.network === 'EGG'
  const abPoints = useMemo(() => buildAbPoints(monitor, plotPoints), [monitor, plotPoints])
  const paFemPoints = useMemo(() => buildPaFemPoints(monitor, plotPoints), [monitor, plotPoints])

  useEffect(() => {
    onPlotVisibilityChange?.()
  }, [onPlotVisibilityChange, plotMode, showPlot])

  useEffect(() => {
    if (!showPlot) return
    const controller = new AbortController()
    window.queueMicrotask(() => {
      if (!controller.signal.aborted) setPlotLoading(true)
    })
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
      .finally(() => {
        if (!controller.signal.aborted) setPlotLoading(false)
      })
    return () => controller.abort()
  }, [monitor, showPlot])

  return (
    <div className={cn('pb-0.5', className)}>
      <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
        <button
          type="button"
          title={translate('popup.hourlyPm25', locale)}
          onClick={() => {
            if (showPlot && plotMode === 'ts') setShowPlot(false)
            else {
              setPlotMode('ts')
              setShowPlot(true)
            }
          }}
          className={plotButtonClass(showPlot && plotMode === 'ts')}
        >
          <LineChart className="size-3.5" />
          {translate('popup.plotButton', locale)}
        </button>

        {supportsComparison && (
          <>
            <button
              type="button"
              title={translate('plot.ab.title', locale)}
              onClick={() => {
                setPlotMode('xy')
                setShowPlot(true)
              }}
              className={plotButtonClass(showPlot && plotMode === 'xy')}
            >
              {translate('popup.compare.internal', locale)}
            </button>
            <span
              className="inline-flex"
              title={nearbyFem ? translate('plot.fem.title', locale) : translate('plot.fem.none', locale)}
            >
              <button
                type="button"
                disabled={!nearbyFem}
                onClick={() => {
                  if (nearbyFem) {
                    setPlotMode('xy_cor')
                    setShowPlot(true)
                  }
                }}
                className={plotButtonClass(showPlot && plotMode === 'xy_cor', !nearbyFem)}
              >
                {translate('popup.compare.fem', locale)}
              </button>
            </span>
          </>
        )}
      </div>

      {showPlot && (
        <div className={cn('mt-2.5 rounded-md border border-border bg-muted/40 p-2', panelClassName)}>
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate font-semibold text-foreground">
              {plotMode === 'ts'
                ? translate('popup.hourlyPm25', locale)
                : plotMode === 'xy'
                  ? translate('plot.ab.title', locale)
                  : translate('plot.fem.title', locale)}
            </span>
            <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {plotSource === 'endpoint'
                ? translate('popup.plotSource.endpoint', locale)
                : translate('popup.plotSource.fallback', locale)}
            </span>
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
            <MonitorScatterChart mode="xy" abPoints={abPoints} locale={locale} height={200} loading={plotLoading} />
          )}
          {plotMode === 'xy_cor' && (
            <>
              <MonitorScatterChart
                mode="xy_cor"
                paFemPoints={paFemPoints}
                locale={locale}
                height={200}
                loading={plotLoading}
              />
              {nearbyFem && (
                <div className="mt-1 text-[10px] text-muted-foreground">
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
  )
}
