import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AqPlotPoint } from '../lib/plotData'
import { getAqhiPlusColor } from '../lib/aqhiScale'
import type { AqmapLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'

// AQHI+ risk-category band tints (Low / Moderate / High / Very High).
const AQHI_BANDS: Array<{ from: number; to: number; color: string }> = [
  { from: 0, to: 30, color: 'rgb(24 154 202 / 0.10)' },
  { from: 30, to: 60, color: 'rgb(255 204 46 / 0.12)' },
  { from: 60, to: 100, color: 'rgb(255 59 59 / 0.10)' },
  { from: 100, to: 600, color: 'rgb(101 2 5 / 0.10)' },
]

const AQHI_THRESHOLDS = [30, 60, 100]
const CHART_MARGIN = { top: 12, right: 12, bottom: 14, left: 0 }

interface ChartPoint {
  time: number
  pm25: number
  label: string
  synthetic?: boolean
}

function parseDate(value: string): number | null {
  if (!value) return null
  const direct = Date.parse(value)
  if (Number.isFinite(direct)) return direct
  const replaced = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(replaced) ? replaced : null
}

function formatTickLabel(value: number, locale: AqmapLocale): string {
  const date = new Date(value)
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).format(date)
}

function formatFullLabel(value: number, locale: AqmapLocale): string {
  const date = new Date(value)
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date)
}

function makeFakePlotData(locale: AqmapLocale, currentValue?: number): ChartPoint[] {
  const end = new Date()
  end.setMinutes(0, 0, 0)
  const baseline = Number.isFinite(currentValue) && currentValue !== undefined
    ? Math.max(1.5, currentValue)
    : 8

  return Array.from({ length: 24 }, (_, index) => {
    const time = end.getTime() - (23 - index) * 60 * 60 * 1000
    const wave = Math.sin(index / 2.8) * 2.6
    const commuteBump = Math.exp(-Math.pow(index - 8, 2) / 10) * 5.5
    const eveningBump = Math.exp(-Math.pow(index - 18, 2) / 12) * 3.8
    const smallVariation = ((index * 17) % 7 - 3) * 0.28
    const pm25 = Math.max(0.4, baseline + wave + commuteBump + eveningBump + smallVariation)

    return {
      time,
      pm25: Number(pm25.toFixed(1)),
      label: formatFullLabel(time, locale),
      synthetic: true,
    }
  })
}

function MonitorPlotTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="rounded border border-border bg-background px-2.5 py-2 text-xs shadow-sm">
      <div className="font-medium text-foreground">{point.pm25.toFixed(1)} µg m⁻³</div>
      <div className="text-muted-foreground">{point.label}</div>
    </div>
  )
}

export function MonitorPlotChart({
  points,
  locale,
  highlightColor,
  currentValue,
  height = 220,
}: {
  points: AqPlotPoint[]
  locale: AqmapLocale
  highlightColor?: string
  currentValue?: number
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(0)
  const data = useMemo<ChartPoint[]>(() => {
    const parsedPoints = points
      .map((point) => {
        const time = parseDate(point.date)
        if (time === null) return null
        if (!Number.isFinite(point.pm25)) return null
        return {
          time,
          pm25: point.pm25,
          label: formatFullLabel(time, locale),
        }
      })
      .filter((value): value is ChartPoint => value !== null)
      .sort((left, right) => left.time - right.time)

    return parsedPoints.length > 0 ? parsedPoints : makeFakePlotData(locale, currentValue)
  }, [points, locale, currentValue])

  const yMax = useMemo(() => {
    const maxValue = Math.max(...data.map((point) => point.pm25))
    // Scale the axis to the actual data (with ~15% headroom) instead of always
    // showing the full 0–100 AQHI range, rounding up to a tidy step.
    const padded = Math.max(maxValue * 1.15, 10)
    const step = padded <= 30 ? 5 : padded <= 60 ? 10 : padded <= 150 ? 25 : 50
    return Math.ceil(padded / step) * step
  }, [data])

  const generatedId = useId()
  const gradientId = `monitor-pm25-fill-${generatedId.replace(/:/g, '')}`
  const xMin = data[0].time
  const xMax = data[data.length - 1].time
  const strokeColor = highlightColor ?? '#0ea5e9'
  const latestPoint = data[data.length - 1]

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      setChartWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)))
    }
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="aqmap-plot relative overflow-hidden rounded border border-border bg-background"
      style={{ height }}
      title={`${latestPoint.label}: ${latestPoint.pm25.toFixed(1)} µg m⁻³`}
      role="img"
      aria-label={`${translate('popup.hourlyPm25', locale)} ${latestPoint.pm25.toFixed(1)} ${translate('aqhi.unit', locale)}`}
    >
      {chartWidth > 0 && (
        <AreaChart width={chartWidth} height={height} data={data} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.22} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          {AQHI_BANDS.filter((band) => band.from < yMax).map((band) => (
            <ReferenceArea
              key={`${band.from}-${band.to}`}
              y1={band.from}
              y2={Math.min(band.to, yMax)}
              fill={band.color}
              ifOverflow="hidden"
            />
          ))}
          <CartesianGrid stroke="rgb(15 23 42 / 0.08)" vertical={false} />
          {AQHI_THRESHOLDS.filter((threshold) => threshold < yMax).map((threshold) => (
            <ReferenceLine
              key={threshold}
              y={threshold}
              stroke={getAqhiPlusColor(threshold)}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
            />
          ))}
          <XAxis
            dataKey="time"
            type="number"
            domain={[xMin, xMax]}
            tickFormatter={(value: number) => formatTickLabel(value, locale)}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            domain={[0, yMax]}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            label={{
              value: translate('plot.yAxis', locale),
              angle: -90,
              position: 'insideLeft',
              fill: 'hsl(var(--muted-foreground))',
              fontSize: 10,
              offset: 8,
            }}
            width={40}
          />
          <Tooltip cursor={{ stroke: strokeColor, strokeOpacity: 0.25 }} content={<MonitorPlotTooltip />} />
          <Area
            type="monotone"
            dataKey="pm25"
            stroke={strokeColor}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={{ r: 2.2, fill: strokeColor, strokeWidth: 0, opacity: latestPoint.synthetic ? 0.75 : 0.9 }}
            activeDot={{ r: 4, fill: strokeColor, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
            isAnimationActive={false}
          />
        </AreaChart>
      )}
    </div>
  )
}
