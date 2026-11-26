import { useCallback, useMemo, useState } from 'react'
import { ChartViewport, TimeSeriesChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { csvRows } from '@pgmaps/geo-toolkit/export'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { fetchJson } from '@/lib/fetchJson'
import { DAY, filterRange, finiteValue, isoDate, normalizeObservations, timestamp, type Station } from './data'
import { dailyWaterFile, waterJson } from './source'
import { useSourceResource } from './useSourceResource'

const GAUGES = [
  { id: '08JC001', name: 'Vanderhoof' },
  { id: '08JC002', name: 'Isle Pierre' },
]
const NECHAKO_MAINSTEM = new Set(['01FW005', '01FW013', '01FW017', '01FW025'])
const HYDAT = 'https://api.weather.gc.ca/collections/hydrometric-daily-mean'
const EXAMPLE = ['2024-06-01', '2024-09-30'] as const

interface GaugeCollection {
  features: {
    properties: {
      STATION_NUMBER: string
      DATE: string
      DISCHARGE: number | null
      DISCHARGE_SYMBOL_EN: string | null
    }
  }[]
}

async function loadFlow(gauge: string, start: string, end: string, signal: AbortSignal) {
  const filter = new URLSearchParams({ f: 'json', STATION_NUMBER: gauge, datetime: `${start}/${end}`, limit: '366' })
  const data = await fetchJson<GaugeCollection>(`${HYDAT}/items?${filter}`, signal)
  return new Map(
    data.features.flatMap(({ properties }) =>
      properties.STATION_NUMBER === gauge
        ? ([
            [properties.DATE, { discharge: finiteValue(properties.DISCHARGE), symbol: properties.DISCHARGE_SYMBOL_EN }],
          ] as const)
        : [],
    ),
  )
}

const chartDates = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function Streamflow({
  stations,
  catalogError,
  retryCatalog,
}: {
  stations: Station[]
  catalogError: string
  retryCatalog: () => void
}) {
  const waterStations = stations.filter((station) => NECHAKO_MAINSTEM.has(station.station_id))
  const [gauge, setGauge] = useState(GAUGES[0].id)
  const [stationId, setStationId] = useState('01FW013')
  const station = waterStations.find((option) => option.station_id === stationId)
  const [draft, setDraft] = useState<readonly [string, string]>(EXAMPLE)
  const [range, setRange] = useState(draft)
  const [zoom, setZoom] = useState<readonly [number, number] | null>(null)
  const start = timestamp(draft[0])
  const end = timestamp(draft[1])
  const valid = Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start < 366 * DAY
  const loadDischarge = useCallback(
    (signal: AbortSignal) => loadFlow(gauge, range[0], range[1], signal),
    [gauge, range],
  )
  const flow = useSourceResource(loadDischarge)
  const water = useDailyWater(station?.filename)
  const rows = useMemo(() => {
    const waterDays = new Map(filterRange(water.data ?? [], range).map((day) => [day.date, day.temp_c]))
    const first = timestamp(range[0])
    const dayCount = Math.round((timestamp(range[1]) - first) / DAY) + 1
    return Array.from({ length: dayCount }, (_, index) => {
      const x = first + index * DAY
      const date = isoDate(x)
      return { x, discharge: flow.data?.get(date)?.discharge ?? null, water: waterDays.get(date) ?? null }
    })
  }, [flow.data, water.data, range])
  const gaugeName = GAUGES.find((option) => option.id === gauge)?.name ?? gauge
  const paired = rows.filter((row) => row.discharge !== null && row.water !== null).length

  return (
    <section className="mx-auto max-w-6xl space-y-4 p-3" aria-label="Streamflow comparison">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Nechako streamflow and water temperature</h2>
        <p className="text-sm text-muted-foreground">
          Compare historical daily discharge from Water Survey of Canada with UNBC water temperatures by date. The gauge
          and temperature station can be on different reaches.
        </p>
      </header>
      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField label="Streamflow gauge" value={gauge} onChange={(event) => setGauge(event.target.value)}>
          {GAUGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.id})
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Water temperature station"
          value={station?.station_id ?? ''}
          onChange={(event) => setStationId(event.target.value)}
        >
          <option value="">No water station</option>
          {waterStations.map((option) => (
            <option key={option.station_id} value={option.station_id}>
              {option.station_description}
            </option>
          ))}
        </SelectField>
        <FormField label="Streamflow from">
          <input
            type="date"
            className={FORM_INPUT_CLASS}
            value={draft[0]}
            onChange={(event) => setDraft([event.target.value, draft[1]])}
          />
        </FormField>
        <FormField label="Streamflow to">
          <input
            type="date"
            className={FORM_INPUT_CLASS}
            value={draft[1]}
            onChange={(event) => setDraft([draft[0], event.target.value])}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          <Button
            size="sm"
            disabled={!valid || draft.join() === range.join()}
            onClick={() => {
              setRange(draft)
              setZoom(null)
            }}
          >
            Apply dates
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={range.join() === EXAMPLE.join() && draft.join() === EXAMPLE.join()}
            onClick={() => {
              setDraft(EXAMPLE)
              setRange(EXAMPLE)
              setZoom(null)
            }}
          >
            Summer 2024 example
          </Button>
          {!valid && (
            <span role="status" className="text-xs text-muted-foreground">
              Enter a date range of up to 366 days.
            </span>
          )}
        </div>
      </div>
      {catalogError && (
        <InlineAlert tone="warning">
          UNBC water station catalog unavailable.{' '}
          <Button variant="outline" size="sm" onClick={retryCatalog}>
            Retry catalog
          </Button>
        </InlineAlert>
      )}
      {flow.data && water.data && (
        <p role="status" className="text-sm text-muted-foreground">
          {paired} paired {paired === 1 ? 'date' : 'dates'} in the applied range.
        </p>
      )}
      {flow.error && (
        <InlineAlert tone="error">
          Discharge unavailable.{' '}
          <Button variant="outline" size="sm" onClick={flow.retry}>
            Retry discharge
          </Button>
        </InlineAlert>
      )}
      {water.error && (
        <InlineAlert tone="error">
          Temperature unavailable.{' '}
          <Button variant="outline" size="sm" onClick={water.retry}>
            Retry temperature
          </Button>
        </InlineAlert>
      )}
      <div className="space-y-3">
        <section className="min-w-0 rounded-xl border bg-card p-3" aria-label="Daily discharge">
          <h3 className="font-semibold">Daily discharge · {gaugeName}</h3>
          {flow.loading ? (
            <InlineAlert loading>Loading historical discharge…</InlineAlert>
          ) : (
            flow.data &&
            (rows.some(({ discharge }) => discharge !== null) ? (
              <ChartViewport className="h-[265px]">
                {(height) => (
                  <TimeSeriesChart
                    rows={rows}
                    height={height}
                    range={zoom}
                    onRange={setZoom}
                    label={`Daily discharge at ${gaugeName}`}
                    series={[{ id: 'discharge', label: gaugeName, color: '#0369a1' }]}
                    xAxis={{ format: (time) => chartDates.format(time) }}
                    formatTooltipX={isoDate}
                    yAxis={{ label: 'm³/s' }}
                    formatValue={(value) => `${value.toFixed(1)} m³/s`}
                  />
                )}
              </ChartViewport>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">No archived discharge for this date range.</p>
            ))
          )}
        </section>
        {station && (
          <section className="min-w-0 rounded-xl border bg-card p-3" aria-label="Daily water temperature comparison">
            <h3 className="font-semibold">{station.station_description} · daily water temperature</h3>
            {water.loading ? (
              <InlineAlert loading>Loading water temperatures…</InlineAlert>
            ) : (
              water.data &&
              (rows.some((row) => row.water !== null) ? (
                <ChartViewport className="h-[265px]">
                  {(height) => (
                    <TimeSeriesChart
                      rows={rows}
                      height={height}
                      range={zoom}
                      onRange={setZoom}
                      label={`Daily water temperature at ${station.station_description}`}
                      series={[{ id: 'water', label: station.station_code, color: '#b45309' }]}
                      xAxis={{ format: (time) => chartDates.format(time) }}
                      formatTooltipX={isoDate}
                      yAxis={{ label: '°C' }}
                      formatValue={(value) => `${value.toFixed(1)} °C`}
                    />
                  )}
                </ChartViewport>
              ) : (
                <p className="py-3 text-sm text-muted-foreground">No water observations for this date range.</p>
              ))
            )}
          </section>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={flow.loading || water.loading || !rows.some((row) => row.discharge !== null || row.water !== null)}
          onClick={() =>
            downloadText(
              csvRows([
                ['date', 'gauge', 'discharge_m3_s', 'discharge_symbol', 'water_station', 'water_temp_c'],
                ...rows.map((row) => [
                  isoDate(row.x),
                  gauge,
                  row.discharge,
                  flow.data?.get(isoDate(row.x))?.symbol,
                  station?.station_id,
                  row.water,
                ]),
              ]),
              `nechako-daily-${gauge}-${range[0]}-to-${range[1]}.csv`,
              'text/csv;charset=utf-8',
            )
          }
        >
          Download daily comparison
        </Button>
        <a className="underline" href={HYDAT} target="_blank" rel="noreferrer">
          Water Survey of Canada archive
        </a>
        <a
          className="underline"
          href={`https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=${gauge}`}
          target="_blank"
          rel="noreferrer"
        >
          Current gauge readings
        </a>
      </div>
    </section>
  )
}

function useDailyWater(filename: string | undefined) {
  const load = useCallback(
    (signal: AbortSignal) =>
      filename ? waterJson(dailyWaterFile(filename), signal).then(normalizeObservations) : Promise.resolve([]),
    [filename],
  )
  return useSourceResource(filename ? load : null)
}
