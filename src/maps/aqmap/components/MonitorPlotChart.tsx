import { useMemo } from 'react'
import * as d3 from 'd3'
import type { AqPlotPoint } from '../lib/plotData'
import { getAqhiColor } from '@/maps/airquality/lib/monitorPopup'
import type { AqmapLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'

const AQHI_BANDS: Array<{ from: number; to: number; color: string }> = [
  { from: 0, to: 30, color: 'rgb(59 181 74 / 0.10)' },
  { from: 30, to: 60, color: 'rgb(247 209 61 / 0.12)' },
  { from: 60, to: 100, color: 'rgb(245 158 11 / 0.12)' },
  { from: 100, to: 600, color: 'rgb(200 30 30 / 0.10)' },
]

const AQHI_THRESHOLDS = [30, 60, 100]
const CHART_WIDTH = 520
const CHART_HEIGHT = 220
const CHART_MARGIN = { top: 12, right: 12, bottom: 28, left: 40 }

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
    if (maxValue <= 30) return 35
    if (maxValue <= 60) return 65
    if (maxValue <= 100) return 105
    return Math.ceil((maxValue + 10) / 25) * 25
  }, [data])

  const xMin = data[0].time
  const xMax = data[data.length - 1].time
  const strokeColor = highlightColor ?? '#0ea5e9'
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom
  const xScale = d3.scaleTime()
    .domain([new Date(xMin), new Date(xMax)])
    .range([CHART_MARGIN.left, CHART_MARGIN.left + plotWidth])
  const yScale = d3.scaleLinear()
    .domain([0, yMax])
    .nice()
    .range([CHART_MARGIN.top + plotHeight, CHART_MARGIN.top])
  const linePath = d3.line<ChartPoint>()
    .x((point) => xScale(new Date(point.time)))
    .y((point) => yScale(point.pm25))
    .curve(d3.curveMonotoneX)(data)
  const areaPath = d3.area<ChartPoint>()
    .x((point) => xScale(new Date(point.time)))
    .y0(yScale(0))
    .y1((point) => yScale(point.pm25))
    .curve(d3.curveMonotoneX)(data)
  const xTicks = xScale.ticks(4)
  const yTicks = yScale.ticks(4).filter((tick) => tick >= 0)
  const latestPoint = data[data.length - 1]

  return (
    <div
      className="relative overflow-hidden rounded border border-border bg-background"
      style={{ height }}
      title={`${latestPoint.label}: ${latestPoint.pm25.toFixed(1)} µg m⁻³`}
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${translate('popup.hourlyPm25', locale)} ${latestPoint.pm25.toFixed(1)} ${translate('aqhi.unit', locale)}`}
        preserveAspectRatio="none"
      >
        {AQHI_BANDS.map((band, index) => {
          const y1 = yScale(Math.min(band.to, yMax))
          const y2 = yScale(Math.max(band.from, 0))
          return (
            <rect
              key={`band-${index}`}
              x={CHART_MARGIN.left}
              y={y1}
              width={plotWidth}
              height={Math.max(0, y2 - y1)}
              fill={band.color}
            />
          )
        })}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={CHART_MARGIN.left}
              x2={CHART_MARGIN.left + plotWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke="rgb(15 23 42 / 0.08)"
            />
            <text
              x={CHART_MARGIN.left - 8}
              y={yScale(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tick}
            </text>
          </g>
        ))}
        {AQHI_THRESHOLDS.filter((threshold) => threshold <= yMax).map((threshold) => (
          <line
            key={`thr-${threshold}`}
            x1={CHART_MARGIN.left}
            x2={CHART_MARGIN.left + plotWidth}
            y1={yScale(threshold)}
            y2={yScale(threshold)}
            stroke={getAqhiColor(threshold)}
            strokeDasharray="4 4"
            strokeOpacity={0.55}
          />
        ))}
        {areaPath && (
          <path d={areaPath} fill={strokeColor} opacity={0.12} />
        )}
        {linePath && (
          <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
        )}
        {data.map((point) => (
          <circle
            key={point.time}
            cx={xScale(new Date(point.time))}
            cy={yScale(point.pm25)}
            r={2.2}
            fill={strokeColor}
            opacity={point.synthetic ? 0.75 : 0.9}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${point.label}: ${point.pm25.toFixed(1)} µg m⁻³`}</title>
          </circle>
        ))}
        {xTicks.map((tick) => (
          <text
            key={tick.getTime()}
            x={xScale(tick)}
            y={CHART_HEIGHT - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {formatTickLabel(tick.getTime(), locale)}
          </text>
        ))}
        <text
          x={14}
          y={CHART_HEIGHT / 2}
          transform={`rotate(-90 14 ${CHART_HEIGHT / 2})`}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {translate('plot.yAxis', locale)}
        </text>
      </svg>
    </div>
  )
}
