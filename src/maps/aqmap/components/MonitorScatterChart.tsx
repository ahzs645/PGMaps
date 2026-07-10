import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { AbPoint, PaFemPoint } from '../lib/comparisonData'
import { translate, type AqmapLocale } from '../lib/i18n'

const CHART_MARGIN = { top: 6, right: 8, bottom: 12, left: 0 }
const VALID_COLOR = '#16a34a'
const INVALID_COLOR = '#dc2626'
const RAW_COLOR = '#f59e0b'
const CORRECTED_COLOR = '#16a34a'

function niceMax(value: number): number {
  const padded = Math.max(value * 1.1, 10)
  const step = padded <= 30 ? 5 : padded <= 60 ? 10 : padded <= 150 ? 25 : 50
  return Math.ceil(padded / step) * step
}

function formatAxisTick(value: number): string {
  if (Math.abs(value) >= 1000) return `${Number((value / 1000).toFixed(1))}k`
  return `${Math.round(value)}`
}

function ScatterTooltip({
  active,
  payload,
  locale,
  xLabel,
  yLabel,
}: {
  active?: boolean
  payload?: Array<{ payload: { x: number; y: number; series?: string } }>
  locale: AqmapLocale
  xLabel: string
  yLabel: string
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const unit = translate('aqhi.unit', locale)
  return (
    <div className="rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      {point.series && <div className="font-medium text-gray-900">{point.series}</div>}
      <div className="text-gray-600">
        {xLabel}: <b className="text-gray-900">{point.x.toFixed(1)}</b> {unit}
      </div>
      <div className="text-gray-600">
        {yLabel}: <b className="text-gray-900">{point.y.toFixed(1)}</b> {unit}
      </div>
    </div>
  )
}

export function MonitorScatterLegend({ mode, locale }: { mode: 'xy' | 'xy_cor'; locale: AqmapLocale }) {
  const items = mode === 'xy'
    ? [
        { name: translate('plot.ab.valid', locale), color: VALID_COLOR },
        { name: translate('plot.ab.invalid', locale), color: INVALID_COLOR },
      ]
    : [
        { name: translate('plot.fem.raw', locale), color: RAW_COLOR },
        { name: translate('plot.fem.corrected', locale), color: CORRECTED_COLOR },
      ]

  return (
    <div className="flex h-[22px] shrink-0 items-center justify-end gap-3 text-xs leading-none text-muted-foreground">
      {items.map((entry) => (
        <span key={entry.name} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
          {entry.name}
        </span>
      ))}
    </div>
  )
}

export function MonitorScatterChart({
  mode,
  abPoints,
  paFemPoints,
  locale,
  height = 200,
  loading = false,
}: {
  mode: 'xy' | 'xy_cor'
  abPoints?: AbPoint[]
  paFemPoints?: PaFemPoint[]
  locale: AqmapLocale
  height?: number
  loading?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const updateWidth = () => setChartWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)))
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const xLabel = mode === 'xy' ? translate('plot.ab.x', locale) : translate('plot.fem.x', locale)
  const yLabel = mode === 'xy' ? translate('plot.ab.y', locale) : translate('plot.fem.y', locale)

  const { axisMax, series } = useMemo(() => {
    if (mode === 'xy') {
      const points = abPoints ?? []
      const max = niceMax(Math.max(1, ...points.flatMap((point) => [point.a, point.b])))
      const valid = points
        .filter((point) => point.valid)
        .map((point) => ({ x: point.b, y: point.a, series: translate('plot.ab.valid', locale) }))
      const invalid = points
        .filter((point) => !point.valid)
        .map((point) => ({ x: point.b, y: point.a, series: translate('plot.ab.invalid', locale) }))
      return {
        axisMax: max,
        series: [
          { name: translate('plot.ab.valid', locale), color: VALID_COLOR, data: valid },
          { name: translate('plot.ab.invalid', locale), color: INVALID_COLOR, data: invalid },
        ],
      }
    }
    const points = paFemPoints ?? []
    const max = niceMax(Math.max(1, ...points.flatMap((point) => [point.raw, point.corrected, point.fem])))
    const raw = points.map((point) => ({ x: point.raw, y: point.fem, series: translate('plot.fem.raw', locale) }))
    const corrected = points.map((point) => ({
      x: point.corrected,
      y: point.fem,
      series: translate('plot.fem.corrected', locale),
    }))
    return {
      axisMax: max,
      series: [
        { name: translate('plot.fem.raw', locale), color: RAW_COLOR, data: raw },
        { name: translate('plot.fem.corrected', locale), color: CORRECTED_COLOR, data: corrected },
      ],
    }
  }, [mode, abPoints, paFemPoints, locale])
  const hasData = series.some((entry) => entry.data.length > 0)
  const chartHeight = Math.max(140, height)

  return (
    <div
      ref={containerRef}
      className="aqmap-plot relative overflow-hidden rounded border border-border bg-background"
      style={{ height }}
      role="img"
      aria-label={mode === 'xy' ? translate('plot.ab.title', locale) : translate('plot.fem.title', locale)}
    >
      {loading || !hasData ? (
        <div className="flex h-full items-center justify-center px-3 text-center text-xs text-gray-500">
          {loading ? translate('plot.loading', locale) : translate('plot.noData', locale)}
        </div>
      ) : (
        chartWidth > 0 && (
          <div className="h-full min-h-0">
            <ScatterChart width={chartWidth} height={chartHeight} margin={CHART_MARGIN}>
              <CartesianGrid stroke="rgb(15 23 42 / 0.08)" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, axisMax]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                tickFormatter={formatAxisTick}
                axisLine={false}
                tickLine={false}
                height={34}
                tickMargin={3}
                label={{
                  value: xLabel,
                  position: 'insideBottom',
                  offset: 0,
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[0, axisMax]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                tickFormatter={formatAxisTick}
                axisLine={false}
                tickLine={false}
                width={56}
                label={{
                  value: yLabel,
                  angle: -90,
                  position: 'insideLeft',
                  offset: 14,
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 10,
                  fontWeight: 600,
                  // Center the rotated title on the axis; without this recharts
                  // anchors it at 'start', so a long label grows off the top of
                  // the (short) SVG and gets clipped.
                  style: { textAnchor: 'middle' },
                }}
              />
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: axisMax, y: axisMax },
                ]}
                stroke="#6b7280"
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                ifOverflow="hidden"
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3', stroke: '#9ca3af' }}
                content={<ScatterTooltip locale={locale} xLabel={xLabel} yLabel={yLabel} />}
              />
              {series.map((entry) => (
                <Scatter
                  key={entry.name}
                  name={entry.name}
                  data={entry.data}
                  fill={entry.color}
                  fillOpacity={0.7}
                  line={false}
                  shape="circle"
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </div>
        )
      )}
    </div>
  )
}
