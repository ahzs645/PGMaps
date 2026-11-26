import { useCallback, useMemo, useRef, useState } from 'react'
import { Download, Info, Loader2 } from 'lucide-react'
import { ChartViewport, TimeSeriesChart } from '@pgmaps/geo-toolkit/visualizations/react'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { HoverTip } from '@/components/ui/info-tip'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import {
  Map as StationMap,
  MapControls,
  MapMarker,
  MapScaleBar,
  MarkerContent,
  MarkerTooltip,
} from '@/components/ui/map'
import { InlineAlert, LegendItem, SearchInput } from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { downloadText } from '@/lib/download'
import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource, MapTableBridge, useMapTable, useMapTableState } from '@/components/map/useMapTable'
import { cn } from '@/lib/utils'
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
  displayUnit,
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
/** One colour per marker state, read by the markers, the legend and the table. */
const MARKER_COLORS = { selected: '#0284c7', published: '#059669', metadata: '#64748b' } as const
const NECHAKO_COLOR = '#168888'
const CHART_HEIGHT = 'h-[325px]'
const WEATHER_COLUMNS = [
  textColumn<WeatherStation>('code', 'Station', (station) => station.id),
  textColumn<WeatherStation>('name', 'Name', (station) => station.name),
  dateColumn<WeatherStation>('start', 'First day', (station) => station.range?.[0] ?? ''),
  dateColumn<WeatherStation>('end', 'Last day', (station) => station.range?.[1] ?? ''),
  numberColumn<WeatherStation>('records', 'Readings', (station) => station.records),
]

const coverage = (station: WeatherStation) =>
  station.range ? `Through ${station.range[1]}` : 'Awaiting processed data'

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
        color: MARKER_COLORS.selected,
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
            controls={
              <MapControls position="top-right" showZoom showCompass={false}>
                <FitStations stations={scoped} fitOnLoad />
              </MapControls>
            }
            deferResize={table.deferResize}
          >
            <MapTableBridge table={table} />
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
                    className="size-4 rounded-full border-2 border-white shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    style={{
                      backgroundColor:
                        MARKER_COLORS[item.id === station?.id ? 'selected' : item.range ? 'published' : 'metadata'],
                    }}
                  />
                </MarkerContent>
                <MarkerTooltip>
                  <div className="font-semibold leading-5">{item.name}</div>
                  <div className="mt-1 text-muted-foreground">
                    {item.id} · {coverage(item)}
                  </div>
                </MarkerTooltip>
              </MapMarker>
            ))}
          </StationMap>
          {table.button && <div className="absolute left-2 top-2 z-10">{table.button}</div>}
          {table.layout.bottomPane}
        </div>
        <div
          aria-label="Map legend"
          role="group"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          <LegendItem color={MARKER_COLORS.selected} label="Selected" />
          <LegendItem color={MARKER_COLORS.published} label="Readings published" />
          <LegendItem color={MARKER_COLORS.metadata} label="Metadata only" />
          {boundary.boundary && (
            <LegendItem color={NECHAKO_COLOR} label="Nechako watershed" swatchShape="dashed-line" />
          )}
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
        {/* Phones stack the readings under this list: keep it short so they are a scroll away, not eight rows. */}
        <div aria-label="Weather station list" className="max-lg:max-h-64 max-lg:overflow-y-auto">
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
                meta={coverage(item)}
                selected={item.id === station?.id}
                onClick={() => setSelectedId(item.id)}
              />
            ))
          )}
        </div>
      </section>
      {station && <WeatherStationDetail key={station.id} station={station} />}
    </div>
  )
}

type WeatherData = Awaited<ReturnType<typeof loadWeatherRange>>
type AssessedReading = { row: WeatherData['rows'][number]; codes: string[]; value: number | null }

function WeatherStationDetail({ station }: { station: WeatherStation }) {
  const [variable, setVariable] = useState(station.variables[0] ?? '')
  const [filter, setFilter] = useState<WeatherFilter>('all')
  const [draft, setDraft] = useState(() => latestWeatherRange(station))
  const [range, setRange] = useState(draft)
  const rangeError = weatherRangeError(draft, station.range)
  const latest = latestWeatherRange(station)
  // A date input reports only whole dates, and a read covers at most a few monthly files, so a
  // valid range is read as soon as it is entered: no separate Apply step.
  const chooseRange = (next: DateRange) => {
    setDraft(next)
    if (!weatherRangeError(next, station.range) && next?.join() !== range?.join()) setRange(next)
  }
  const load = useCallback(
    (signal: AbortSignal) => (range ? loadWeatherRange(station, range, signal) : Promise.resolve(null)),
    [station, range],
  )
  const source = useSourceResource(range ? load : null)
  // The last readings loaded stay up, faded, while the next date range loads, so the card does not
  // collapse to a loading line and grow back.
  const [held, setHeld] = useState<{ data: WeatherData; range: DateRange } | null>(null)
  if (source.data && held?.data !== source.data) setHeld({ data: source.data, range })
  const shown = source.error ? null : held
  const assessed = useMemo<AssessedReading[]>(
    () =>
      shown?.data.rows.map((row) => ({
        row,
        codes: weatherCodes(row, variable),
        value: weatherValue(row, variable),
      })) ?? [],
    [shown, variable],
  )
  const selection = useMemo(() => assessed.filter(({ codes }) => weatherShown(codes, filter)), [assessed, filter])
  const codeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { codes } of assessed) for (const code of new Set(codes)) counts.set(code, (counts.get(code) ?? 0) + 1)
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [assessed])
  const zones = station.offsets.map((offset) => `UTC${offset}`).join(', ')

  return (
    <section aria-label="Weather observations" className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="min-w-0 text-lg font-semibold leading-tight">{station.name}</h2>
          <div role="group" aria-label="Downloads" className="flex flex-wrap gap-2">
            {station.range && (
              <Button
                variant="outline"
                size="sm"
                disabled={!shown || !selection.length}
                onClick={() =>
                  shown &&
                  downloadText(
                    weatherCsv(
                      shown.data.fields,
                      shown.data.units,
                      selection.map(({ row }) => row),
                    ),
                    `unbc-weather-${station.id}-${shown.range?.[0]}-to-${shown.range?.[1]}-${filter}.csv`,
                    'text/csv;charset=utf-8',
                  )
                }
              >
                <Download className="size-4" aria-hidden="true" />
                Download selection
              </Button>
            )}
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
        </div>
        <p className="text-xs text-muted-foreground">
          {station.id} · {station.latitude.toFixed(5)}°, {station.longitude.toFixed(5)}°
          {station.range && (
            <>
              {' '}
              · {station.range[0]} to {station.range[1]} · {number(station.records)} published readings
              {zones && ` · ${zones} as supplied`}
            </>
          )}
        </p>
      </header>
      {station.range ? (
        <>
          {/* Phones: the variable, then the two dates side by side, then Latest month beside the quality filter. Wide cards: one row. */}
          <div className="grid grid-cols-2 items-end gap-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <SelectField
              label="Weather variable"
              fieldClassName="col-span-2 xl:col-span-1"
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
                aria-invalid={Boolean(rangeError)}
                onChange={(event) => chooseRange([event.target.value, draft?.[1] ?? ''])}
              />
            </FormField>
            <FormField label="To (source date)">
              <input
                type="date"
                className={FORM_INPUT_CLASS}
                min={station.range[0]}
                max={station.range[1]}
                value={draft?.[1] ?? ''}
                aria-invalid={Boolean(rangeError)}
                onChange={(event) => chooseRange([draft?.[0] ?? '', event.target.value])}
              />
            </FormField>
            <HoverTip content="The last month of this station's record">
              <Button variant="outline" size="sm" className="w-full" onClick={() => chooseRange(latest)}>
                Latest month
              </Button>
            </HoverTip>
            <SelectField
              label="Quality codes"
              value={filter}
              onChange={(event) => setFilter(event.target.value as WeatherFilter)}
              hintAction={<QualityCodeSummary counts={codeCounts} disabled={!shown} />}
            >
              <option value="all">All observations</option>
              <option value="pass">Pass only (P)</option>
              <option value="flagged">Other supplied codes</option>
            </SelectField>
          </div>
          {rangeError && (
            <p role="status" className="text-xs text-destructive">
              {rangeError}
            </p>
          )}
          {source.loading && !shown && (
            <div className={`flex items-center justify-center ${CHART_HEIGHT}`}>
              <InlineAlert loading>Loading weather observations…</InlineAlert>
            </div>
          )}
          {source.error && (
            <InlineAlert tone="error" title="Could not load observations">
              {source.error}
              <Button variant="outline" size="sm" className="ml-2" onClick={source.retry}>
                Retry
              </Button>
            </InlineAlert>
          )}
          {shown && variable && (
            <div aria-busy={source.loading} className={cn('space-y-3', source.loading && 'opacity-60')}>
              <WeatherObservations
                key={`${shown.range?.join()}/${variable}/${filter}`}
                data={shown.data}
                station={station}
                variable={variable}
                filter={filter}
                assessed={assessed}
                selection={selection}
                loading={source.loading}
              />
              {shown.range && (
                <MeasuredComparison station={station} range={shown.range} weatherRows={shown.data.rows} />
              )}
            </div>
          )}
        </>
      ) : (
        <InlineAlert title="Awaiting processed data">UNBC has published this station’s metadata.</InlineAlert>
      )}
      <footer className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <p>
          Source:{' '}
          <a className="underline" href={WEATHER_EXPLORER_URL} target="_blank" rel="noreferrer">
            UNBC weather explorer
          </a>
          {station.coordinateSource && <span> · Location from {station.coordinateSource}</span>}
        </p>
        <p>
          Regional reference, not this station:{' '}
          <a
            className="underline"
            href="https://api.weather.gc.ca/collections/climate-stations/items/1096454?f=html"
            target="_blank"
            rel="noreferrer"
          >
            ECCC Prince George Massey climate station
          </a>
        </p>
      </footer>
    </section>
  )
}

/** What the supplied quality codes mean and how often each appears, beside the filter they explain. */
function QualityCodeSummary({ counts, disabled }: { counts: [string, number][]; disabled: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label="Quality code summary"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="absolute -top-0.5 right-0 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 touch:after:absolute touch:after:-inset-3 touch:after:content-['']"
      >
        <Info className="size-4" aria-hidden="true" />
      </button>
      <AnchoredPopover
        anchorRef={anchor}
        open={open}
        onClose={() => setOpen(false)}
        align="end"
        width={300}
        role="dialog"
        ariaLabel="Quality code summary"
        className="space-y-2 p-3 text-xs"
      >
        <p className="font-semibold">Quality codes in this date range</p>
        <p className="text-muted-foreground">
          UNBC’s supplied codes describe quality or conditions such as visits or nighttime. Counts include every reading
          in the date range, whatever the filter shows.
        </p>
        {counts.length ? (
          <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1">
            {counts.map(([code, count]) => (
              <div key={code} className="contents">
                <dt className="font-mono">{code}</dt>
                <dd>{QC_MEANINGS[code] ?? 'Supplied code'}</dd>
                <dd className="text-right tabular-nums">{number(count)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground">No quality codes supplied for these readings.</p>
        )}
      </AnchoredPopover>
    </>
  )
}

function WeatherObservations({
  data,
  station,
  variable,
  filter,
  assessed,
  selection,
  loading,
}: {
  data: WeatherData
  station: WeatherStation
  variable: string
  filter: WeatherFilter
  assessed: AssessedReading[]
  selection: AssessedReading[]
  loading: boolean
}) {
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState<readonly [number, number] | null>(null)
  const points = useMemo(() => weatherChartRows(data.rows, variable, filter), [data.rows, variable, filter])
  const unit = displayUnit(data.units[variable] || station.units[variable])
  const missing = assessed.filter(({ value }) => value === null).length
  const label = variableLabel(variable)
  const offsetMinutes = (offset: string) =>
    (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4)))
  const axisOffset = station.offsets.length === 1 ? offsetMinutes(station.offsets[0]) * 60_000 : 0
  const axisZone = station.offsets.length === 1 ? `UTC${station.offsets[0]}` : 'UTC'
  const displayStamps = useMemo(
    () => new Map(data.rows.map((row) => [row.time, `${row.stamp} UTC${row.offset}`])),
    [data.rows],
  )
  const pageCount = Math.ceil(selection.length / PAGE_SIZE)

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">
          {label}
          {unit && ` (${unit})`}
        </h3>
        <p role="status" className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span>
            {selection.length === assessed.length
              ? `${number(assessed.length)} readings`
              : `${number(selection.length)} of ${number(assessed.length)} readings`}
            {missing > 0 && ` · ${number(missing)} missing or non-numeric`} · times in {axisZone}
          </span>
          {loading && (
            <span className="inline-flex items-center gap-1">
              · <Loader2 className="size-3 animate-spin" aria-hidden="true" /> loading the new dates…
            </span>
          )}
        </p>
      </div>
      {points.some((point) => point.reading !== null) ? (
        <ChartViewport className={CHART_HEIGHT}>
          {(height) => (
            <TimeSeriesChart
              height={height}
              rows={points}
              series={[{ id: 'reading', label, color: MARKER_COLORS.selected }]}
              range={zoom}
              onRange={setZoom}
              label={`${station.name} ${label} time series at the original interval`}
              // The zone is printed above the chart: an axis label here sits under the navigator.
              xAxis={{ format: (time) => dateFormat.format(time + axisOffset) }}
              yAxis={{ label: unit }}
              showPoints={filter !== 'all' || points.length <= 100}
              formatTooltipX={(time) => displayStamps.get(time) ?? new Date(time).toISOString()}
              formatValue={(value) => (unit ? `${value} ${unit}` : String(value))}
            />
          )}
        </ChartViewport>
      ) : (
        <div className={`flex items-center justify-center ${CHART_HEIGHT}`}>
          <ListState empty emptyLabel="No numeric values match the selected dates and quality filter." />
        </div>
      )}
      {selection.length > 0 && (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <EngineeringTable rowHeaders>
              <caption className="sr-only">Weather observations</caption>
              <thead>
                <tr>
                  <ColumnHeader label="Timestamp as supplied" className="text-left" />
                  <ColumnHeader label="Value" unit={unit} />
                  <ColumnHeader label="QC codes" className="text-left" />
                  <ColumnHeader label="Data ID" className="text-left" />
                </tr>
              </thead>
              <tbody>
                {selection.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(({ row, codes, value }, index) => (
                  <tr key={`${row.time}-${index}`}>
                    <th scope="row" className="font-mono">
                      {row.stamp} {row.offset}
                    </th>
                    <td>{value ?? 'Missing'}</td>
                    <td className="text-left">{codes.join(', ') || '—'}</td>
                    <td className="text-left">{row.values.Data_ID || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
          <PaginationControls
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
            label="Weather observation pages"
            layout="summary-first"
            className="border-0 bg-transparent p-0"
            formatPage={(current) =>
              `${number(current * PAGE_SIZE + 1)}–${number(Math.min((current + 1) * PAGE_SIZE, selection.length))} of ${number(selection.length)}`
            }
          />
        </div>
      )}
    </>
  )
}
