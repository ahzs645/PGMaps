import { useCallback, useMemo, useState } from 'react'
import { ChartViewport, TimeSeriesChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import {
  Map as StationMap,
  MapControls,
  MapMarker,
  MapScaleBar,
  MarkerContent,
  MarkerTooltip,
} from '@/components/ui/map'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { downloadText } from '@/lib/download'
import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource, MapTableBridge, useMapTable, useMapTableState } from '@/components/map/useMapTable'
import { FitStations } from './FitStations'
import { inNechako, NechakoOutline, NechakoScope, type useNechakoBoundary } from './NechakoScope'
import { WEATHER_EXPLORER_URL } from './source'
import type { DateRange } from './data'
import { useSourceResource } from './useSourceResource'
import { MeasuredComparison } from './MeasuredComparison'
import {
  latestWeatherRange,
  loadWeatherRange,
  loadWeatherStations,
  QC_MEANINGS,
  variableLabel,
  weatherChartRows,
  weatherCodes,
  weatherCsv,
  weatherRangeError,
  weatherShown,
  weatherValue,
  type WeatherFilter,
  type WeatherStation,
} from './weatherData'

const dateFormat = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const number = (value: number) => value.toLocaleString('en-CA')
const PAGE_SIZE = 10
const WEATHER_COLUMNS = [
  textColumn<WeatherStation>('code', 'Station', (station) => station.id),
  textColumn<WeatherStation>('name', 'Name', (station) => station.name),
  dateColumn<WeatherStation>('start', 'First day', (station) => station.range?.[0] ?? ''),
  dateColumn<WeatherStation>('end', 'Last day', (station) => station.range?.[1] ?? ''),
  numberColumn<WeatherStation>('records', 'Readings', (station) => station.records),
]

export function WeatherStations({
  boundary,
  nechakoOnly,
  setNechakoOnly,
}: {
  boundary: ReturnType<typeof useNechakoBoundary>
  nechakoOnly: boolean
  setNechakoOnly: (active: boolean) => void
}) {
  const catalog = useSourceResource(loadWeatherStations)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const outline = boundary.boundary
  const scoped = useMemo(
    () => catalog.data?.filter((station) => !nechakoOnly || !outline || inNechako(outline, station)) ?? [],
    [catalog.data, nechakoOnly, outline],
  )
  const filtered = useMemo(
    () =>
      scoped.filter((station) => `${station.id} ${station.name}`.toLowerCase().includes(search.trim().toLowerCase())),
    [scoped, search],
  )
  const station =
    scoped.find((item) => item.id === selectedId) ??
    scoped.find((item) => item.id === '02FW005') ??
    scoped.find((item) => item.range) ??
    scoped[0]

  const tableState = useMapTableState({ url: false, initialHeight: 180 })
  const sources = useMemo(
    () => [
      defineTableSource<WeatherStation>({
        id: 'weather-stations',
        label: 'Weather stations',
        color: '#0284c7',
        shape: 'point',
        rows: filtered,
        columns: WEATHER_COLUMNS,
        getRowId: (item) => item.id,
        getRowCenter: (item) => [item.longitude, item.latitude],
        flyZoom: 9,
        exportFileName: 'unbc-weather-stations',
      }),
    ],
    [filtered],
  )
  const table = useMapTable({
    sources,
    state: tableState,
    selectedRowId: station?.id ?? null,
    onSelectRow: (item: WeatherStation) => setSelectedId(item.id),
    inlineButton: true,
  })

  return (
    <div className="grid items-start gap-3 p-3 lg:grid-cols-[clamp(320px,33vw,480px)_minmax(0,1fr)]">
      <section aria-label="Weather station browser" className="min-w-0 space-y-2 rounded-xl border bg-card p-3">
        <h2 className="text-base font-semibold">Weather stations</h2>
        <div className="relative h-72 overflow-hidden rounded-lg border lg:h-[340px]">
          <StationMap
            center={[-123.8, 54.1]}
            zoom={5.4}
            controls={<MapControls position="top-right" showZoom showCompass={false} />}
            deferResize={table.deferResize}
          >
            <MapTableBridge table={table} />
            <FitStations stations={scoped} />
            <MapScaleBar position="bottom-left" />
            <NechakoOutline boundary={boundary.boundary} />
            {filtered.map((item) => (
              <MapMarker key={item.id} longitude={item.longitude} latitude={item.latitude} anchor="center">
                <MarkerContent>
                  <button
                    type="button"
                    aria-label={`Map weather station ${item.name}`}
                    aria-pressed={item.id === station?.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`size-4 rounded-full border-2 border-white shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${item.id === station?.id ? 'bg-sky-600' : item.range ? 'bg-emerald-600' : 'bg-slate-500'}`}
                  />
                </MarkerContent>
                <MarkerTooltip>
                  {item.name} · {item.id}
                </MarkerTooltip>
              </MapMarker>
            ))}
          </StationMap>
          {table.button && <div className="absolute left-2 top-2 z-10">{table.button}</div>}
          {table.layout.bottomPane}
        </div>
        <NechakoScope {...boundary} active={nechakoOnly} onChange={setNechakoOnly} />
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search weather stations"
          aria-label="Search weather stations"
        />
        {catalog.error && (
          <InlineAlert tone="error" title="Weather station catalog unavailable">
            {catalog.error}
            <Button variant="outline" size="sm" className="ml-2" onClick={catalog.retry}>
              Retry
            </Button>
          </InlineAlert>
        )}
        <ListHeader count={filtered.length} noun={['station', 'stations']} sticky={false} />
        {catalog.loading ? (
          <ListState loading />
        ) : !catalog.error && !filtered.length ? (
          <ListState empty emptyLabel="No weather stations match this search." />
        ) : (
          filtered.map((item) => (
            <ResultRow
              key={item.id}
              title={item.name}
              subtitle={item.id}
              meta={item.range ? `Through ${item.range[1]}` : 'Awaiting processed data'}
              selected={item.id === station?.id}
              onClick={() => setSelectedId(item.id)}
            />
          ))
        )}
      </section>
      {station && <WeatherStationDetail key={station.id} station={station} />}
    </div>
  )
}

function WeatherStationDetail({ station }: { station: WeatherStation }) {
  const [variable, setVariable] = useState(station.variables[0] ?? '')
  const [filter, setFilter] = useState<WeatherFilter>('all')
  const [draft, setDraft] = useState(() => latestWeatherRange(station))
  const [range, setRange] = useState(draft)
  const rangeError = weatherRangeError(draft, station.range)
  const load = useCallback(
    (signal: AbortSignal) => (range ? loadWeatherRange(station, range, signal) : Promise.resolve(null)),
    [station, range],
  )
  const source = useSourceResource(range ? load : null)
  const sourceLink = (
    <a className="underline" href={WEATHER_EXPLORER_URL} target="_blank" rel="noreferrer">
      UNBC weather explorer
    </a>
  )

  return (
    <section aria-label="Weather observations" className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{station.name}</h2>
          <p className="text-sm text-muted-foreground">
            {station.id} · {station.latitude.toFixed(5)}°, {station.longitude.toFixed(5)}°
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {station.files.map((file) => (
            <Button asChild key={file.url} variant="outline" size="sm">
              <a href={file.url} title={file.name}>
                Original {file.url.endsWith('.zip') ? 'ZIP' : 'CSV'}
              </a>
            </Button>
          ))}
          {station.metadataUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={station.metadataUrl}>Station metadata</a>
            </Button>
          )}
        </div>
      </header>
      {station.range ? (
        <>
          <p className="text-sm text-muted-foreground">
            {station.range[0]} to {station.range[1]} · {number(station.records)} published readings
            {station.offsets.length
              ? ` · ${station.offsets.map((offset) => 'UTC' + offset).join(', ')} as supplied`
              : ''}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SelectField
              label="Weather variable"
              value={variable}
              onChange={(event) => setVariable(event.target.value)}
            >
              {station.variables.map((key) => (
                <option key={key} value={key}>
                  {variableLabel(key)}
                </option>
              ))}
            </SelectField>
            <FormField label="From (source date)">
              <input
                type="date"
                className={FORM_INPUT_CLASS}
                min={station.range[0]}
                max={station.range[1]}
                value={draft?.[0] ?? ''}
                onChange={(event) => setDraft([event.target.value, draft?.[1] ?? ''])}
              />
            </FormField>
            <FormField label="To (source date)">
              <input
                type="date"
                className={FORM_INPUT_CLASS}
                min={station.range[0]}
                max={station.range[1]}
                value={draft?.[1] ?? ''}
                onChange={(event) => setDraft([draft?.[0] ?? '', event.target.value])}
              />
            </FormField>
            <SelectField
              label="Quality codes"
              value={filter}
              onChange={(event) => setFilter(event.target.value as WeatherFilter)}
            >
              <option value="all">All observations</option>
              <option value="pass">Pass only (P)</option>
              <option value="flagged">Other supplied codes</option>
            </SelectField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={Boolean(rangeError) || draft?.join() === range?.join()}
              onClick={() => setRange(draft)}
            >
              Apply dates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const latest = latestWeatherRange(station)
                setDraft(latest)
                if (latest?.join() !== range?.join()) setRange(latest)
              }}
            >
              Latest month in record
            </Button>
            {rangeError && (
              <span role="status" className="text-sm text-muted-foreground">
                {rangeError}
              </span>
            )}
          </div>
          {source.loading && <InlineAlert loading>Loading weather observations…</InlineAlert>}
          {source.error && (
            <InlineAlert tone="error" title="Could not load observations">
              {source.error}
              <Button variant="outline" size="sm" className="ml-2" onClick={source.retry}>
                Retry
              </Button>
            </InlineAlert>
          )}
          {source.data && variable && (
            <WeatherObservations
              key={`${range?.join()}/${variable}/${filter}`}
              data={source.data}
              station={station}
              variable={variable}
              filter={filter}
              range={range}
            />
          )}
          {range && source.data && (
            <MeasuredComparison station={station} range={range} weatherRows={source.data.rows} />
          )}
        </>
      ) : (
        <InlineAlert title="Awaiting processed data">UNBC has published this station’s metadata.</InlineAlert>
      )}
      <footer className="border-t pt-3 text-xs text-muted-foreground">
        Source {sourceLink}
        {station.coordinateSource && <span> · Location from {station.coordinateSource}</span>}
        <span> · </span>
        <a
          className="underline"
          href="https://api.weather.gc.ca/collections/climate-stations/items/1096454?f=html"
          target="_blank"
          rel="noreferrer"
        >
          ECCC Prince George Massey observations
        </a>
      </footer>
    </section>
  )
}

function WeatherObservations({
  data,
  station,
  variable,
  filter,
  range,
}: {
  data: Awaited<ReturnType<typeof loadWeatherRange>>
  station: WeatherStation
  variable: string
  filter: WeatherFilter
  range: DateRange
}) {
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState<readonly [number, number] | null>(null)
  const assessed = useMemo(
    () =>
      data.rows.map((row) => ({
        row,
        codes: weatherCodes(row, variable),
        value: weatherValue(row, variable),
      })),
    [data.rows, variable],
  )
  const shown = assessed.filter(({ codes }) => weatherShown(codes, filter))
  const points = useMemo(() => weatherChartRows(data.rows, variable, filter), [data.rows, variable, filter])
  const summary = new Map<string, number>()
  for (const { codes } of assessed) for (const code of new Set(codes)) summary.set(code, (summary.get(code) ?? 0) + 1)
  const units = data.units[variable] || station.units[variable]
  const unit = units && units.toLowerCase() !== 'nan' ? units : undefined
  const label = variableLabel(variable)
  const offsetMinutes = (offset: string) =>
    (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)))
  const axisOffset = station.offsets.length === 1 ? offsetMinutes(station.offsets[0]) * 60_000 : 0
  const axisZone = station.offsets.length === 1 ? `UTC${station.offsets[0]}` : 'UTC'
  const displayStamps = useMemo(
    () => new Map(data.rows.map((row) => [row.time, `${row.stamp} UTC${row.offset}`])),
    [data.rows],
  )

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {label}
            {unit && ` (${unit})`}
          </h3>
          <p role="status" className="text-xs text-muted-foreground">
            {number(shown.length)} of {number(assessed.length)} readings ·{' '}
            {number(assessed.filter(({ value }) => value === null).length)} missing or nonnumeric before filtering
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!shown.length}
          onClick={() =>
            downloadText(
              weatherCsv(
                data.fields,
                data.units,
                shown.map(({ row }) => row),
              ),
              `unbc-weather-${station.id}-${range?.[0]}-to-${range?.[1]}-${filter}.csv`,
              'text/csv;charset=utf-8',
            )
          }
        >
          Download selection
        </Button>
      </div>
      {points.some((point) => point.reading !== null) ? (
        <ChartViewport className="h-[325px]">
          {(height) => (
            <TimeSeriesChart
              height={height}
              rows={points}
              series={[{ id: 'reading', label, color: '#0284c7' }]}
              range={zoom}
              onRange={setZoom}
              label={`${station.name} ${label} time series at the original interval`}
              xAxis={{ format: (time) => dateFormat.format(time + axisOffset), label: axisZone }}
              yAxis={{ label: unit }}
              showPoints={filter !== 'all' || points.length <= 100}
              formatTooltipX={(time) => displayStamps.get(time) ?? new Date(time).toISOString()}
              formatValue={(value) => (unit ? `${value} ${unit}` : String(value))}
            />
          )}
        </ChartViewport>
      ) : (
        <ListState empty emptyLabel="No numeric values match the selected dates and quality filter." />
      )}
      <details className="rounded-md border p-2 text-sm">
        <summary className="cursor-pointer font-medium">Quality code summary</summary>
        <p className="my-2 text-xs text-muted-foreground">
          UNBC’s supplied codes describe quality or conditions such as visits or nighttime. Counts include all readings
          in the date range.
        </p>
        {summary.size ? (
          <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1">
            {[...summary]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([code, count]) => (
                <div key={code} className="contents">
                  <dt className="font-mono">{code}</dt>
                  <dd>{QC_MEANINGS[code] ?? 'Supplied code'}</dd>
                  <dd>{number(count)}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">No quality codes supplied for these readings.</p>
        )}
      </details>
      {shown.length > 0 && (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <caption className="sr-only">Weather observations</caption>
              <thead>
                <tr className="border-b">
                  {['Timestamp as supplied', 'Value', 'QC codes', 'Data ID'].map((heading) => (
                    <th key={heading} scope="col" className="px-2 py-1.5 font-semibold">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(({ row, codes, value }, index) => (
                  <tr key={`${row.time}-${index}`} className="border-b last:border-0">
                    <td className="px-2 py-1.5 font-mono">
                      {row.stamp} {row.offset}
                    </td>
                    <td className="px-2 py-1.5">{value ?? 'Missing'}</td>
                    <td className="px-2 py-1.5">{codes.join(', ') || '—'}</td>
                    <td className="px-2 py-1.5">{row.values.Data_ID || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>
              {number(page * PAGE_SIZE + 1)}–{number(Math.min((page + 1) * PAGE_SIZE, shown.length))} of{' '}
              {number(shown.length)}
            </span>
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * PAGE_SIZE >= shown.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
