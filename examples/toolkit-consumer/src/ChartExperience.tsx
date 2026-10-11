import { useMemo, useState } from 'react'
import {
  ChartViewport,
  TimeSeriesChart,
  LineBandChart,
  ScatterPlot,
  numericExtent,
  type NumericRange,
} from '@pgmaps/geo-toolkit/visualizations/react'
import {
  Button,
  DashboardToolbar,
  FullscreenPanel,
  RangeControls,
  SelectedSeriesList,
  SeriesLegend,
} from '@pgmaps/geo-toolkit/ui'
import './charts.css'

// Independent, synthetic energy observations. No station schema, calendar dates or PG Maps imports.
const catalog = [
  { id: 'solar', label: 'Solar', color: '#d97706', detail: 'Rooftop array', visible: true },
  { id: 'battery', label: 'Battery', color: '#2563eb', detail: 'Stored energy', visible: true },
]
const observations = Array.from({ length: 49 }, (_, hour) => ({
  x: hour,
  solar: hour === 0 ? 0 : hour === 10 ? null : Math.round(Math.sin(hour / 6) * 10),
  battery: Math.round(Math.cos(hour / 9) * 7),
}))
const hourly = (value: number) => `${value} h`
const energy = (value: number) => `${value.toFixed(1)} kWh`

function EnergyWorkspace({ name }: { name: string }) {
  const [range, setRange] = useState<NumericRange>(null)
  const [items, setItems] = useState(catalog)
  const [narrow, setNarrow] = useState(false)
  const visible = items.filter((item) => item.visible)
  const active = range ?? [0, 48]
  const points = useMemo(
    () => observations.filter((point) => !range || (point.x >= range[0] && point.x <= range[1])),
    [range],
  )
  const lines = visible.map((item) => ({
    ...item,
    points: points.map((point) => {
      const y = point[item.id as 'solar' | 'battery']
      return { x: point.x, y, range: y === null ? undefined : ([y - 2, y + 2] as const) }
    }),
  }))
  const scatter = visible.map((item) => ({
    color: item.color,
    points: points.flatMap((point) => {
      const y = point[item.id as 'solar' | 'battery']
      return y === null ? [] : [{ x: point.x, y, hour: point.x, source: item.label }]
    }),
  }))
  const yExtent = numericExtent(
    lines.flatMap((item) => item.points.flatMap((point) => (point.range ? [...point.range] : []))),
    [-1, 1],
  )
  const xExtent = numericExtent(points.map((point) => point.x))
  const extent = [xExtent[0], xExtent[1], yExtent[0], yExtent[1]] as const
  const toggle = (id: string) =>
    setItems((old) => old.map((item) => (item.id === id ? { ...item, visible: !item.visible } : item)))
  return (
    <section aria-label={name} className="energy-workspace geo-toolkit" style={{ width: narrow ? '340px' : '100%' }}>
      <DashboardToolbar title={name} className="energy-toolbar">
        <RangeControls
          start={{ label: `${name} start hour`, value: String(active[0]), min: 0, max: active[1] }}
          end={{ label: `${name} end hour`, value: String(active[1]), min: active[0], max: 48 }}
          onChange={(field, value) => {
            if (value !== '' && Number.isFinite(Number(value)))
              setRange(field === 'start' ? [Number(value), active[1]] : [active[0], Number(value)])
          }}
          presets={[{ id: 'day', label: '24h' }]}
          onPreset={() => setRange([24, 48])}
          reset={{ label: 'All', disabled: !range, onClick: () => setRange(null) }}
        />
        <Button variant="outline" size="sm" onClick={() => setNarrow(!narrow)}>
          {narrow ? 'Expand embed' : 'Narrow embed'}
        </Button>
      </DashboardToolbar>
      <div className="energy-summary">
        <SelectedSeriesList
          items={items}
          onToggle={toggle}
          onRemove={(id) => setItems((old) => old.filter((item) => item.id !== id))}
        />
        <output aria-label={`${name} observations`}>
          {points.length} hours · {scatter.reduce((n, item) => n + item.points.length, 0)} points
        </output>
      </div>
      <div className="energy-charts">
        <FullscreenPanel
          title="Energy timeline"
          compact
          className="energy-panel"
          actions={<SeriesLegend items={items} onToggle={toggle} compact />}
        >
          {(full) => (
            <ChartViewport className={full ? 'energy-chart-full' : 'energy-chart'}>
              {(height) => (
                <TimeSeriesChart
                  rows={observations}
                  series={visible}
                  range={range}
                  onRange={setRange}
                  height={height}
                  label={`${name} linked energy timeline`}
                  xAxis={{ format: hourly }}
                  yAxis={{ label: 'kWh' }}
                  formatValue={energy}
                />
              )}
            </ChartViewport>
          )}
        </FullscreenPanel>
        <FullscreenPanel title="Energy envelope" compact className="energy-panel">
          {(full) => (
            <ChartViewport className={full ? 'energy-chart-full' : 'energy-chart'}>
              {(height) => (
                <LineBandChart
                  series={lines}
                  extent={extent}
                  height={height}
                  label={`${name} energy envelope`}
                  xAxis={{ format: hourly }}
                  yAxis={{ label: 'kWh', format: (value) => value.toFixed(1), width: 80 }}
                  renderTooltip={(point, item) => (
                    <>
                      {item.label}: {hourly(point.x)} · {energy(Number(point.y))}
                    </>
                  )}
                />
              )}
            </ChartViewport>
          )}
        </FullscreenPanel>
        <FullscreenPanel title="Energy observations" compact className="energy-panel">
          {(full) => (
            <ChartViewport className={full ? 'energy-chart-full' : 'energy-chart'}>
              {(height) => (
                <ScatterPlot
                  series={scatter}
                  extent={extent}
                  height={height}
                  label={`${name} energy observations`}
                  xAxis={{ label: 'Elapsed hours', format: hourly }}
                  yAxis={{ label: 'kWh', format: (value) => value.toFixed(1), width: 80 }}
                  renderTooltip={(point) => (
                    <>
                      {point.source} · Hour {point.hour} · {energy(point.y)}
                    </>
                  )}
                />
              )}
            </ChartViewport>
          )}
        </FullscreenPanel>
      </div>
    </section>
  )
}

export function ChartExperience() {
  return (
    <main className="chart-experience">
      <h1>Reusable chart consumer</h1>
      <p>Synthetic energy data, numeric ranges and independent workspace state.</p>
      <EnergyWorkspace name="Energy A" />
      <EnergyWorkspace name="Energy B" />
    </main>
  )
}
