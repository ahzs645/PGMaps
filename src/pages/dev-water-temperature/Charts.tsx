import { useMemo, type ReactNode } from 'react'
import { ticks } from 'd3'
import {
  ChartViewport,
  TimeSeriesChart,
  LineBandChart,
  ScatterPlot,
  type XYDomain,
  type LineBandPoint,
  type LineBandSeries,
} from '@pgmaps/geo-toolkit/visualizations/react'
import { EmptyHint } from '@/components/ui/result-list'
import { isoDate, seasonalPoints, timestamp, type ChartRow, type DateRange, type Series } from './data'

const temperatureTick = (value: number) => value.toLocaleString('en-CA', { maximumFractionDigits: 3 })
const dateLabel = (time: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(time)
const monthLabel = (time: number) => new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(time)
const dateTick = (time: number) =>
  new Intl.DateTimeFormat('en-CA', { year: '2-digit', month: 'short', timeZone: 'UTC' }).format(time)

/** PG Maps owns dashboard sizing; the toolkit measures the available slot. */
export function ChartArea({ children, fullscreen }: { children: (height: number) => ReactNode; fullscreen: boolean }) {
  return (
    <ChartViewport
      className={
        fullscreen
          ? 'water-chart-area min-h-[100px] flex-1 basis-0'
          : 'water-chart-area h-[300px] min-h-[100px] lg:h-auto lg:flex-1 lg:basis-0'
      }
    >
      {children}
    </ChartViewport>
  )
}

export function TimeChart({
  rows,
  series,
  range,
  onRange,
  height = 330,
}: {
  rows: ChartRow[]
  series: Series[]
  range: DateRange
  onRange: (range: DateRange) => void
  height?: number
}) {
  const points = useMemo(() => rows.map(({ time, ...values }) => ({ ...values, x: time })), [rows])
  const yDomain = useMemo(() => {
    let min = 0,
      max = 0
    const start = range ? timestamp(range[0]) : -Infinity
    const end = range ? timestamp(range[1]) : Infinity
    for (const row of rows) {
      if (row.time < start || row.time > end) continue
      for (const item of series) {
        const value = row[item.station.station_id]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
    }
    return [Math.floor(min / 5) * 5, Math.max(5, Math.ceil(max / 5) * 5)] as const
  }, [rows, series, range])
  return (
    <TimeSeriesChart
      rows={points}
      series={series.map((item) => ({
        id: item.station.station_id,
        label: item.station.station_code,
        color: item.color,
      }))}
      range={range ? [timestamp(range[0]), timestamp(range[1])] : null}
      onRange={(value) => onRange(value ? [isoDate(value[0]), isoDate(value[1])] : null)}
      height={height}
      label={`Water temperature time series for ${series.length} stations; drag the chart or navigator to filter all plots`}
      xAxis={{ format: dateTick }}
      yDomain={yDomain}
      yAxis={{
        label: 'Water °C',
        width: 72,
        format: temperatureTick,
        ticks: ticks(yDomain[0], yDomain[1], Math.max(2, Math.min(4, Math.floor((height - 76) / 30)))),
      }}
      formatTooltipX={dateLabel}
      formatNavigatorX={isoDate}
      formatValue={(value) => `${value.toFixed(1)} °C`}
      empty={
        <EmptyHint>
          {series.length
            ? 'No observations in the selected season.'
            : 'Select a station on the map or in the list to compare temperatures.'}
        </EmptyHint>
      }
    />
  )
}

interface SeasonalPoint extends LineBandPoint {
  date?: string
}
export function SeasonChart({
  series,
  individual,
  height = 270,
}: {
  series: Series[]
  individual: boolean
  height?: number
}) {
  const { lines, extent } = useMemo(() => {
    const lines: LineBandSeries<SeasonalPoint>[] = []
    let lower = 0,
      upper = 1
    for (const item of series) {
      const seasonal = seasonalPoints(item.data)
      for (const point of seasonal) {
        lower = Math.min(lower, Math.floor(point.range[0]))
        upper = Math.max(upper, Math.ceil(point.range[1]))
      }
      if (individual) {
        const years = new Map<string, SeasonalPoint[]>()
        for (const point of item.data) {
          const year = point.date.slice(0, 4),
            points = years.get(year) ?? []
          points.push({ x: timestamp(`2000${point.date.slice(4)}`), y: point.temp_c, date: point.date })
          years.set(year, points)
        }
        for (const [year, points] of years)
          lines.push({
            id: `${item.station.station_id}-${year}`,
            label: `${item.station.station_code} · ${year}`,
            color: item.color,
            points,
            strokeOpacity: 0.8,
            strokeWidth: 1,
          })
      } else
        lines.push({
          id: item.station.station_id,
          label: `${item.station.station_code} mean`,
          color: item.color,
          points: seasonal.map((point) => ({
            x: point.time,
            y: point.mean,
            range: [point.range[0], point.range[1]] as const,
          })),
        })
    }
    return { lines, extent: [Date.UTC(2000, 0, 1), Date.UTC(2000, 11, 31), lower, upper] as XYDomain }
  }, [series, individual])
  return (
    <LineBandChart
      series={lines}
      highlightOnHover={individual}
      height={height}
      extent={extent}
      label={
        individual
          ? 'Water temperatures aligned by calendar date for individual years'
          : 'Calendar-day mean water temperature with observed minimum and maximum range'
      }
      xAxis={{ ticks: Array.from({ length: 12 }, (_, month) => Date.UTC(2000, month, 1)), format: monthLabel }}
      yAxis={{ label: '°C', format: temperatureTick }}
      empty={<EmptyHint>No water-temperature observations in this date range.</EmptyHint>}
      renderTooltip={(point, item) => (
        <>
          <div className="font-medium">{item.label}</div>
          <div>
            {point.date ??
              new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(point.x)}
          </div>
          <div>{Number(point.y).toFixed(1)} °C</div>
          {point.range && <div>Range {point.range.map((v) => v.toFixed(1)).join('–')} °C</div>}
        </>
      )}
    />
  )
}

export function AirWaterChart({
  series,
  minimum,
  height = 250,
}: {
  series: Series[]
  minimum: number
  height?: number
}) {
  const { points, extent } = useMemo(() => {
    let xmin = Infinity,
      xmax = -Infinity,
      ymin = Infinity,
      ymax = -Infinity
    const points = series.map((item) => ({
      color: item.color,
      points: item.data.flatMap((point) => {
        if (point.temp_c === null || point.airtemp_c === null || point.airtemp_c < minimum) return []
        return [{ x: point.airtemp_c, y: point.temp_c, date: point.date, station: item.station.station_code }]
      }),
    }))
    for (const item of points)
      for (const point of item.points) {
        xmin = Math.min(xmin, point.x)
        xmax = Math.max(xmax, point.x)
        ymin = Math.min(ymin, point.y)
        ymax = Math.max(ymax, point.y)
      }
    const lowerX = Math.floor(xmin),
      lowerY = Math.floor(ymin)
    return {
      points,
      extent: [
        lowerX,
        Math.max(lowerX + 1, Math.ceil(xmax)),
        lowerY,
        Math.max(lowerY + 1, Math.ceil(ymax)),
      ] as XYDomain,
    }
  }, [series, minimum])
  return (
    <ScatterPlot
      series={points}
      extent={extent}
      height={height}
      identityLine
      label="Daily mean air temperature versus water temperature, with a one-to-one reference line"
      xAxis={{ label: 'Air temperature (°C)', format: temperatureTick }}
      yAxis={{ label: 'Water °C', format: temperatureTick }}
      empty={<EmptyHint>No paired air/water observations match this date range and minimum air temperature.</EmptyHint>}
      renderTooltip={(point) => (
        <>
          <div className="font-medium">
            {point.station} · {point.date}
          </div>
          <div>
            Air {point.x.toFixed(1)} °C · Water {point.y.toFixed(1)} °C
          </div>
        </>
      )}
    />
  )
}
