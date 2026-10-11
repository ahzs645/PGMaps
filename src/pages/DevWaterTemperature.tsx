import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Download, Droplets, Info, Library, LocateFixed, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { DashboardToolbar, RangeControls, SelectedSeriesList, SeriesLegend } from '@pgmaps/geo-toolkit/ui'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { Map, MapControls, MapMarker, MapScaleBar, MarkerContent, MarkerTooltip, useMap } from '@/components/ui/map'
import { InlineAlert, SearchInput, SidebarSection } from '@/components/ui/map-panels'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { FullscreenButton, FullscreenPanel, useElementFullscreen } from '@/components/ui/fullscreen-panel'
import { downloadText } from '@/lib/download'
import { AirWaterChart, ChartArea, SeasonChart, TimeChart } from './dev-water-temperature/Charts'
import {
  filterRange,
  MONTHS,
  observationsCsv,
  SERIES_COLORS,
  timeRows,
  trailingMonthRange,
  type Aggregation,
  type DateRange,
  type Station,
} from './dev-water-temperature/data'
import { useWaterTemperature } from './dev-water-temperature/useWaterTemperature'
import { useStationMapStyles, type StationBasemap } from './dev-water-temperature/mapStyles'

const fieldClass =
  'min-w-0 w-full rounded-md border border-input bg-background px-2 py-2 text-base text-foreground md:text-sm'
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  )
}

function FitStations({ stations }: { stations: Station[] }) {
  const { map, isLoaded } = useMap()
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Fit all stations"
      title="Fit all stations"
      className="absolute right-2 top-24 z-10 size-8"
      disabled={!map || !isLoaded || !stations.length}
      onClick={() =>
        map?.fitBounds(
          [
            [
              Math.min(...stations.map((station) => station.longitude)),
              Math.min(...stations.map((station) => station.latitude)),
            ],
            [
              Math.max(...stations.map((station) => station.longitude)),
              Math.max(...stations.map((station) => station.latitude)),
            ],
          ],
          { padding: 35, maxZoom: 8, duration: 0 },
        )
      }
    >
      <LocateFixed className="size-4" />
    </Button>
  )
}

export default function DevWaterTemperature() {
  const data = useWaterTemperature()
  const {
    ref: dashboardRef,
    fullscreen: dashboardFullscreen,
    toggle: toggleDashboardFullscreen,
  } = useElementFullscreen<HTMLDivElement>()
  const { ref: mapRef, fullscreen: mapFullscreen, toggle: toggleMapFullscreen } = useElementFullscreen<HTMLDivElement>()
  const [collapsed, setCollapsed] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [dialogContainer, setDialogContainer] = useState<HTMLDivElement | null>(null)
  const [basemap, setBasemap] = useState<StationBasemap>('reference')
  const mapStyles = useStationMapStyles(basemap)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState('')
  const [minimumDays, setMinimumDays] = useState('')
  const [coversFrom, setCoversFrom] = useState('')
  const [coversTo, setCoversTo] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [sort, setSort] = useState('code')
  const [aggregation, setAggregation] = useState<Aggregation>('day')
  const [startMonth, setStartMonth] = useState(6)
  const [endMonth, setEndMonth] = useState(8)
  const [range, setRange] = useState<DateRange>(null)
  const [individual, setIndividual] = useState(false)
  const [minimumAir, setMinimumAir] = useState(-10)
  const selectedIds = useMemo(() => new Set(data.selection.items.map((item) => item.id)), [data.selection.items])
  const selectedStations = data.selection.items.flatMap((item) => {
    const station = data.stations.find((station) => station.station_id === item.id)
    return station ? [{ station, color: SERIES_COLORS[item.slot] }] : []
  })
  const filtered = useMemo(
    () =>
      data.stations
        .filter(
          (station) =>
            (!search ||
              `${station.station_code} ${station.waterbody_name} ${station.station_description} ${station.provider_name}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (!minimumDays || station.n >= Number(minimumDays)) &&
            (!coversFrom || station.start <= coversFrom) &&
            (!coversTo || station.end >= coversTo) &&
            (!selectedOnly || selectedIds.has(station.station_id)),
        )
        .sort((a, b) =>
          sort === 'count'
            ? b.n - a.n
            : sort === 'waterbody'
              ? (a.waterbody_name ?? '').localeCompare(b.waterbody_name ?? '')
              : a.station_code.localeCompare(b.station_code),
        ),
    [data.stations, search, minimumDays, coversFrom, coversTo, selectedOnly, selectedIds, sort],
  )
  const visibleSeries = useMemo(
    () => data.series.filter((item) => !hiddenIds.has(item.station.station_id)),
    [data.series, hiddenIds],
  )
  const rows = useMemo(
    () => timeRows(visibleSeries, aggregation, startMonth, endMonth),
    [visibleSeries, aggregation, startMonth, endMonth],
  )
  const filteredSeries = useMemo(
    () => visibleSeries.map((item) => ({ ...item, data: filterRange(item.data, range) })),
    [visibleSeries, range],
  )
  const dailyCount = filteredSeries.reduce(
    (sum, item) => sum + item.data.filter((point) => point.temp_c !== null).length,
    0,
  )
  const pairedCount = filteredSeries.reduce(
    (sum, item) =>
      sum +
      item.data.filter((point) => point.temp_c !== null && point.airtemp_c !== null && point.airtemp_c >= minimumAir)
        .length,
    0,
  )
  const allDates = data.series.flatMap((item) => item.data.map((point) => point.date)).sort()
  const extent: DateRange = allDates.length ? [allDates[0], allDates[allDates.length - 1]] : null
  const activeRange = range ?? extent
  const sourceDate = data.config.updated?.slice(0, 10)
  const sourceDetails = `${import.meta.env.DEV ? 'Local UNBC snapshot' : 'UNBC snapshot from ahzs645/unbcwatertemp-viz on GitHub'}${sourceDate ? ` · updated ${sourceDate}` : ' · update date unavailable'}.${data.config.airYear ? ` Daymet air temperatures available through ${data.config.airYear}.` : ''}`

  const changeRange = (next: DateRange) => {
    if (!next || next[0] <= next[1]) setRange(next)
  }
  const resetFilters = () => {
    setSearch('')
    setMinimumDays('')
    setCoversFrom('')
    setCoversTo('')
    setSelectedOnly(false)
  }
  const exportCsv = () =>
    downloadText(
      observationsCsv(data.series, range, data.config.updated),
      'unbc-water-temperature.csv',
      'text/csv;charset=utf-8',
    )

  const toggleSeries = (id: string) =>
    setHiddenIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const seriesItems = selectedStations.map(({ station, color }) => ({
    id: station.station_id,
    label: station.station_code,
    detail: station.waterbody_name,
    color,
    visible: !hiddenIds.has(station.station_id),
  }))
  const renderSeriesLegend = (compact = false) => (
    <SeriesLegend items={seriesItems} onToggle={toggleSeries} compact={compact} label="Station series" />
  )
  const seriesLegend = renderSeriesLegend()
  const rangeControls = (
    <RangeControls
      testId="range-toolbar"
      presetLabel="Time zoom presets"
      disabled={!extent}
      start={{
        label: 'Plot range starts',
        type: 'date',
        value: activeRange?.[0] ?? '',
        min: extent?.[0],
        max: activeRange?.[1],
      }}
      end={{
        label: 'Plot range ends',
        type: 'date',
        value: activeRange?.[1] ?? '',
        min: activeRange?.[0],
        max: extent?.[1],
      }}
      onChange={(field, value) => {
        if (value && activeRange) changeRange(field === 'start' ? [value, activeRange[1]] : [activeRange[0], value])
      }}
      presets={[
        { id: '1', label: '1m' },
        { id: '3', label: '3m' },
        { id: '6', label: '6m' },
        { id: '12', label: '1y', accessibleLabel: 'Last year', title: 'Last 12 months' },
      ]}
      onPreset={(id) => changeRange(trailingMonthRange(extent, Number(id)))}
      reset={{ label: 'All', accessibleLabel: 'All dates', disabled: !range, onClick: () => setRange(null) }}
    />
  )

  return (
    <div
      ref={dashboardRef}
      data-fullscreen={dashboardFullscreen || undefined}
      className="flex min-h-full flex-col gap-2 bg-background px-3 pb-3 pt-20 md:pt-3 lg:h-full lg:min-h-0 lg:overflow-hidden [&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-[1400] [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:overflow-y-auto [&[data-fullscreen]]:pt-3 max-lg:[&[data-fullscreen]]:block"
    >
      <DashboardToolbar className="rounded-xl border bg-card p-2" title="Nechako water temperature">
        <>
          {rangeControls}
          {collapsed && renderSeriesLegend(true)}
          <div className="flex shrink-0 items-center gap-1">
            <span
              tabIndex={0}
              title={sourceDetails}
              aria-label={sourceDetails}
              className="inline-flex size-7 items-center justify-center text-muted-foreground"
            >
              <Info className="size-4" aria-hidden="true" />
            </span>
            <Button
              variant="outline"
              size="sm"
              className="size-8 px-0"
              aria-label={collapsed ? 'Show stations' : 'Hide stations'}
              title={collapsed ? 'Show stations' : 'Hide stations'}
              aria-expanded={!collapsed}
              aria-controls="water-station-browser"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
            <FullscreenButton
              title="dashboard"
              fullscreen={dashboardFullscreen}
              onClick={toggleDashboardFullscreen}
              compact
            />
            <Button asChild variant="outline" size="sm" className="size-8 px-0">
              <Link to="/dev" aria-label="Dev library" title="Dev library">
                <Library className="size-4" />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2"
              aria-label="Download daily CSV"
              title="Download daily CSV"
              onClick={exportCsv}
              disabled={!data.series.length || data.loading}
            >
              <Download className="size-4" />
              CSV
            </Button>
          </div>
        </>
      </DashboardToolbar>
      <p className="sr-only" role="status" data-testid="range-summary">
        {dailyCount.toLocaleString('en-CA')} water observations
        {activeRange ? ` · ${activeRange[0]} – ${activeRange[1]}` : ''}
      </p>
      {selectedStations.length > 0 && !visibleSeries.length && !data.loading && (
        <p className="text-xs text-muted-foreground">
          All station series are hidden. Use the station colors to show them.
        </p>
      )}
      {data.catalogError && (
        <InlineAlert tone="error" title="Station catalog unavailable">
          {data.catalogError}
          <Button variant="outline" size="sm" className="ml-3" onClick={data.retry}>
            Retry loading
          </Button>
        </InlineAlert>
      )}
      <div
        className={`grid min-h-0 gap-3 lg:flex-1 ${collapsed ? 'grid-cols-1' : 'lg:grid-cols-[clamp(320px,33vw,480px)_minmax(0,1fr)]'}`}
      >
        <section
          id="water-station-browser"
          hidden={collapsed}
          aria-label="Station browser"
          className={`${collapsed ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-col rounded-xl border bg-card lg:h-full`}
        >
          <SidebarSection
            title="Stations"
            className="flex min-h-0 flex-col p-3 lg:flex-1 [&>div:first-child]:shrink-0"
            actions={
              <select
                aria-label="Station basemap"
                className="max-w-[180px] rounded-md border bg-background px-2 py-1 text-xs"
                value={basemap}
                onChange={(event) => setBasemap(event.target.value as StationBasemap)}
              >
                <option value="reference">OpenStreetMap</option>
                <option value="imagery">Esri imagery</option>
                <option value="pgmaps">PGMaps colors</option>
                <option value="none">No basemap</option>
              </select>
            }
          >
            <div
              ref={mapRef}
              data-fullscreen={mapFullscreen || undefined}
              className="relative h-[440px] min-h-[180px] lg:h-auto lg:flex-1 lg:basis-0 overflow-hidden rounded-lg border bg-background [&[data-fullscreen]]:fixed [&[data-fullscreen]]:inset-0 [&[data-fullscreen]]:z-[1401] [&[data-fullscreen]]:h-dvh [&[data-fullscreen]]:rounded-none"
              data-testid="station-map"
            >
              <Map
                center={[-124.5, 54.2]}
                zoom={7}
                styles={mapStyles}
                controls={<MapControls position="top-right" showZoom showCompass={false} />}
              >
                <FitStations stations={data.stations} />
                <MapScaleBar position="bottom-left" />
                {[...filtered]
                  .sort((a, b) => Number(selectedIds.has(a.station_id)) - Number(selectedIds.has(b.station_id)))
                  .map((station) => {
                    const selected = data.selection.items.find((item) => item.id === station.station_id)
                    const color = selected ? SERIES_COLORS[selected.slot] : selectedIds.size ? '#808080' : '#1b9e77'
                    return (
                      <MapMarker
                        key={station.station_id}
                        longitude={station.longitude}
                        latitude={station.latitude}
                        anchor="center"
                      >
                        <MarkerContent style={{ zIndex: selected ? 10 : 0 }}>
                          <button
                            type="button"
                            aria-label={`Map station ${station.station_code}`}
                            aria-pressed={Boolean(selected)}
                            onClick={() => data.toggle(station.station_id)}
                            className="flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                            style={{
                              width: selected ? 25 : 18,
                              height: selected ? 25 : 18,
                            }}
                          >
                            <svg
                              width="100%"
                              height="100%"
                              viewBox={selected ? '0 0 25 25' : '0 0 18 18'}
                              aria-hidden="true"
                            >
                              <circle
                                cx={selected ? 12.5 : 9}
                                cy={selected ? 12.5 : 9}
                                r={selected ? 10 : 8}
                                stroke={color}
                                strokeWidth={selected ? 5 : 2}
                                strokeOpacity={selected || !selectedIds.size ? 1 : 0.5}
                                fill={color}
                                fillOpacity={selected ? 0.2 : 0.25}
                              />
                            </svg>
                          </button>
                        </MarkerContent>
                        <MarkerTooltip>
                          <span className="font-medium">{station.station_code}</span>
                          <br />
                          {station.waterbody_name}
                          <br />
                          {station.provider_name}
                          <br />
                          {station.start} – {station.end} · {station.n.toLocaleString('en-CA')} days
                        </MarkerTooltip>
                      </MapMarker>
                    )
                  })}
              </Map>
              {!selectedIds.size && (
                <div className="pointer-events-none absolute bottom-12 left-2 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs">
                  <svg width="18" height="18" aria-hidden="true">
                    <circle cx="9" cy="9" r="8" stroke="#1b9e77" strokeWidth="2" fill="#1b9e77" fillOpacity="0.25" />
                  </svg>
                  UNBC
                </div>
              )}
              <div className="absolute bottom-8 right-2 rounded-md border bg-background">
                <FullscreenButton title="Station map" fullscreen={mapFullscreen} onClick={toggleMapFullscreen} />
              </div>
            </div>
          </SidebarSection>
          <div className="shrink-0 px-3 pt-3">
            <DialogShell
              title="Find stations"
              open={browserOpen}
              onOpenChange={(open) => {
                if (open) setDialogContainer(dashboardRef.current)
                setBrowserOpen(open)
              }}
              closeLabel="Close station browser"
              portalContainer={dialogContainer}
              size="md"
              trigger={
                <Button variant="outline" size="sm" className="w-full">
                  Browse stations
                </Button>
              }
              bodyClassName="p-0 workspace-sm:p-0"
              footer={
                data.selection.notice ? <InlineAlert tone="warning">{data.selection.notice}</InlineAlert> : undefined
              }
            >
              <SidebarSection
                actions={
                  <Button size="sm" variant="ghost" onClick={resetFilters}>
                    Reset filters
                  </Button>
                }
              >
                <div className="space-y-3">
                  <SearchInput
                    icon
                    aria-label="Search stations"
                    placeholder="Station, waterbody or provider…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onClear={() => setSearch('')}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Starts on or before">
                      <input
                        className={fieldClass}
                        type="date"
                        value={coversFrom}
                        onChange={(event) => setCoversFrom(event.target.value)}
                      />
                    </Field>
                    <Field label="Ends on or after">
                      <input
                        className={fieldClass}
                        type="date"
                        value={coversTo}
                        onChange={(event) => setCoversTo(event.target.value)}
                      />
                    </Field>
                    <Field label="Minimum observed days">
                      <input
                        className={fieldClass}
                        type="number"
                        min={0}
                        value={minimumDays}
                        onChange={(event) => setMinimumDays(event.target.value)}
                      />
                    </Field>
                    <Field label="Sort stations">
                      <select className={fieldClass} value={sort} onChange={(event) => setSort(event.target.value)}>
                        <option value="code">Station code</option>
                        <option value="count">Most observations</option>
                        <option value="waterbody">Waterbody</option>
                      </select>
                    </Field>
                  </div>
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedOnly}
                      onChange={(event) => setSelectedOnly(event.target.checked)}
                    />
                    Selected stations only
                  </label>
                </div>
              </SidebarSection>
              <ListHeader count={filtered.length} noun={['station', 'stations']} sticky={false} />
              <div aria-label="Station list">
                {data.catalogLoading ? (
                  <ListState loading />
                ) : !filtered.length ? (
                  <ListState empty emptyLabel="No stations match these filters." />
                ) : (
                  filtered.map((station) => (
                    <ResultRow
                      key={station.station_id}
                      aria-label={`Select station ${station.station_code}`}
                      title={station.station_code}
                      subtitle={station.waterbody_name}
                      meta={`${station.start} – ${station.end} · ${station.n.toLocaleString('en-CA')} days`}
                      selected={selectedIds.has(station.station_id)}
                      leading={
                        selectedIds.has(station.station_id) ? (
                          <Check className="size-4" />
                        ) : (
                          <Droplets className="size-4 text-muted-foreground" />
                        )
                      }
                      onClick={() => data.toggle(station.station_id)}
                    />
                  ))
                )}
              </div>
            </DialogShell>
          </div>
          <SidebarSection
            title={`Selected (${selectedIds.size}/4)`}
            className="shrink-0 border-b-0 p-3"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  data.clear()
                  setRange(null)
                }}
                disabled={!selectedIds.size}
              >
                Clear
              </Button>
            }
          >
            <div aria-live="polite" className="space-y-2">
              <SelectedSeriesList
                items={seriesItems}
                onToggle={toggleSeries}
                onRemove={data.toggle}
                testId="selected-stations"
                empty="Choose a station to load its observations."
              />
              {!browserOpen && data.selection.notice && (
                <InlineAlert tone="warning">{data.selection.notice}</InlineAlert>
              )}
              {data.loading && <InlineAlert loading>Loading station observations…</InlineAlert>}
              {data.selection.items
                .filter((item) => data.errors[item.id])
                .map((item) => (
                  <InlineAlert key={item.id} tone="error">
                    {item.id}: {data.errors[item.id]}
                    <Button variant="outline" size="sm" className="mt-2" onClick={data.retry}>
                      Retry observations
                    </Button>
                  </InlineAlert>
                ))}
            </div>
          </SidebarSection>
        </section>
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div
            className="grid min-h-0 min-w-0 gap-3 lg:flex-1 lg:grid-rows-[minmax(180px,0.9fr)_minmax(230px,1fr)] lg:overflow-y-auto"
            data-testid="multi-graph-dashboard"
          >
            <FullscreenPanel
              title="Water temperature over time"
              compact
              className="flex min-h-0 flex-col"
              actions={
                <SegmentedControl
                  label="Time aggregation"
                  value={aggregation}
                  onChange={(value) => {
                    setAggregation(value)
                    setRange(null)
                  }}
                  fullWidth={false}
                  size="sm"
                  options={[
                    { value: 'day', label: 'Daily' },
                    {
                      value: 'month',
                      label: 'Monthly',
                      title: 'Monthly means require at least 75% of calendar days. Missing values remain gaps.',
                    },
                    {
                      value: 'season',
                      label: 'Seasonal',
                      title: 'Seasonal means require at least 75% of calendar days. Missing values remain gaps.',
                    },
                  ]}
                />
              }
            >
              {(fullscreen) => (
                <>
                  {fullscreen && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {[1, 3, 6, 12].map((months) => (
                        <Button
                          key={months}
                          variant="outline"
                          size="sm"
                          disabled={!extent}
                          onClick={() => changeRange(trailingMonthRange(extent, months))}
                        >
                          {months === 12 ? '1y' : `${months}m`}
                        </Button>
                      ))}
                      <Button variant="ghost" size="sm" onClick={() => setRange(null)}>
                        All dates
                      </Button>
                    </div>
                  )}
                  {aggregation === 'season' && (
                    <div className="mb-3 grid max-w-sm grid-cols-2 gap-3">
                      <Field label="Season starts">
                        <select
                          className={fieldClass}
                          value={startMonth}
                          onChange={(event) => {
                            setStartMonth(Number(event.target.value))
                            setRange(null)
                          }}
                        >
                          {MONTHS.map((month, index) => (
                            <option key={month} value={index + 1}>
                              {month}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Season ends">
                        <select
                          className={fieldClass}
                          value={endMonth}
                          onChange={(event) => {
                            setEndMonth(Number(event.target.value))
                            setRange(null)
                          }}
                        >
                          {MONTHS.map((month, index) => (
                            <option key={month} value={index + 1}>
                              {month}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  )}
                  {fullscreen && seriesLegend}
                  <ChartArea fullscreen={fullscreen}>
                    {(height) => (
                      <TimeChart
                        height={height}
                        rows={rows}
                        series={visibleSeries}
                        range={range}
                        onRange={changeRange}
                      />
                    )}
                  </ChartArea>
                </>
              )}
            </FullscreenPanel>
            <div className="grid min-h-0 min-w-0 gap-3 lg:grid-cols-2">
              <FullscreenPanel
                title="Seasonality"
                compact
                className="flex min-h-0 flex-col"
                actions={
                  <SegmentedControl
                    label="Seasonality display"
                    value={individual ? 'years' : 'mean'}
                    onChange={(value) => setIndividual(value === 'years')}
                    fullWidth={false}
                    size="sm"
                    options={[
                      {
                        value: 'mean',
                        label: 'Mean & range',
                        title: 'Daily mean and observed minimum–maximum across years; not a confidence interval.',
                      },
                      {
                        value: 'years',
                        label: 'Years',
                        title: 'One line per station and year, aligned by calendar date.',
                      },
                    ]}
                  />
                }
              >
                {(fullscreen) => (
                  <>
                    {fullscreen && seriesLegend}
                    <ChartArea fullscreen={fullscreen}>
                      {(height) => <SeasonChart height={height} series={filteredSeries} individual={individual} />}
                    </ChartArea>
                  </>
                )}
              </FullscreenPanel>
              <FullscreenPanel
                title="Air vs. water"
                compact
                className="flex min-h-0 flex-col"
                actions={
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Min. air °C
                    <input
                      aria-label="Minimum air temperature (°C)"
                      className="h-7 w-16 rounded border bg-background px-2 text-sm text-foreground"
                      type="number"
                      value={minimumAir}
                      onChange={(event) => setMinimumAir(Number(event.target.value))}
                    />
                  </label>
                }
              >
                {(fullscreen) => (
                  <>
                    <span className="sr-only" data-testid="paired-count">
                      {pairedCount.toLocaleString('en-CA')} paired days
                    </span>
                    {fullscreen && seriesLegend}
                    <ChartArea fullscreen={fullscreen}>
                      {(height) => <AirWaterChart height={height} series={filteredSeries} minimum={minimumAir} />}
                    </ChartArea>
                  </>
                )}
              </FullscreenPanel>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
