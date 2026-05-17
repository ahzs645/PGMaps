import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AqPlotPoint } from '../lib/plotData'
import { getAqhiColor } from '@/maps/airquality/lib/monitorPopup'
import type { AqmapLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'

const AQHI_BANDS: Array<{ from: number; to: number; color: string }> = [
  { from: 0, to: 30, color: 'rgba(59, 181, 74, 0.10)' },
  { from: 30, to: 60, color: 'rgba(247, 209, 61, 0.12)' },
  { from: 60, to: 100, color: 'rgba(245, 158, 11, 0.12)' },
  { from: 100, to: 600, color: 'rgba(200, 30, 30, 0.10)' },
]

const AQHI_THRESHOLDS = [30, 60, 100]

interface ChartPoint {
  time: number
  pm25: number
  label: string
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

export function MonitorPlotChart({
  points,
  locale,
  highlightColor,
  height = 220,
}: {
  points: AqPlotPoint[]
  locale: AqmapLocale
  highlightColor?: string
  height?: number
}) {
  const data = useMemo<ChartPoint[]>(() => {
    return points
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
  }, [points, locale])

  const yMax = useMemo(() => {
    if (data.length === 0) return 60
    const maxValue = Math.max(...data.map((point) => point.pm25))
    if (maxValue <= 30) return 35
    if (maxValue <= 60) return 65
    if (maxValue <= 100) return 105
    return Math.ceil((maxValue + 10) / 25) * 25
  }, [data])

  const xMin = data.length > 0 ? data[0].time : Date.now() - 24 * 3600 * 1000
  const xMax = data.length > 0 ? data[data.length - 1].time : Date.now()

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded border border-dashed border-border bg-background text-xs text-muted-foreground">
        {translate('plot.noData', locale)}
      </div>
    )
  }

  const strokeColor = highlightColor ?? '#0ea5e9'

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
        >
          <CartesianGrid stroke="rgba(15, 23, 42, 0.08)" vertical={false} />
          {AQHI_BANDS.map((band, index) => (
            <ReferenceArea
              key={`band-${index}`}
              y1={Math.max(band.from, 0)}
              y2={Math.min(band.to, yMax)}
              fill={band.color}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ))}
          {AQHI_THRESHOLDS.filter((threshold) => threshold <= yMax).map((threshold) => (
            <ReferenceLine
              key={`thr-${threshold}`}
              y={threshold}
              stroke={getAqhiColor(threshold)}
              strokeDasharray="3 3"
              strokeOpacity={0.55}
            />
          ))}
          <XAxis
            dataKey="time"
            type="number"
            domain={[xMin, xMax]}
            scale="time"
            tickFormatter={(value: number) => formatTickLabel(value, locale)}
            stroke="rgba(15, 23, 42, 0.45)"
            tick={{ fontSize: 10 }}
            minTickGap={28}
          />
          <YAxis
            stroke="rgba(15, 23, 42, 0.45)"
            tick={{ fontSize: 10 }}
            domain={[0, yMax]}
            width={32}
            label={{
              value: translate('plot.yAxis', locale),
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 10, fill: 'rgba(15, 23, 42, 0.55)' },
              offset: 8,
            }}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid rgba(15,23,42,0.15)',
            }}
            labelFormatter={(label) => {
              const numeric = typeof label === 'number' ? label : Number(label)
              return Number.isFinite(numeric) ? formatFullLabel(numeric, locale) : ''
            }}
            formatter={(value) => {
              const numeric = typeof value === 'number' ? value : Number(value)
              const display = Number.isFinite(numeric) ? `${numeric.toFixed(1)} µg m⁻³` : String(value)
              return [display, translate('plot.tooltipLabel', locale)]
            }}
          />
          <Line
            type="monotone"
            dataKey="pm25"
            stroke={strokeColor}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
