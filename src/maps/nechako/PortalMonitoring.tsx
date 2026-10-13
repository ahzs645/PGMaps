import { PortalLiveMonitoring, type PortalMonitoringProps } from './PortalLiveMonitoring'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { checkedCsv, csvExport, normalizeMonitoring, summarize, type MonitoringMapping } from './data/monitoring'

const DEFAULT_MAPPING: MonitoringMapping = {
  timestamp: '',
  station: '',
  primary: '',
  secondary: '',
  primaryUnit: '',
  secondaryUnit: '',
  timezone: 'embedded',
  timezoneColumn: '',
  dateFormat: 'iso',
}
const inputClass = 'mt-1 w-full rounded-md border bg-background p-2 text-base'

export function PortalMonitoring(props: PortalMonitoringProps = {}) {
  const [table, setTable] = useState<ReturnType<typeof checkedCsv>>()
  const [filename, setFilename] = useState('')
  const [mapping, setMapping] = useState(DEFAULT_MAPPING)
  const [error, setError] = useState('')
  const [station, setStation] = useState('')
  const [start, setStart] = useState(''),
    [end, setEnd] = useState('')
  const [chart, setChart] = useState<'line' | 'bar'>('line')
  const [page, setPage] = useState(0)
  const [delimiter, setDelimiter] = useState(',')
  const normalized = useMemo(() => {
    if (!table || !mapping.timestamp || !mapping.primary) return null
    try {
      return { ...normalizeMonitoring(table.records, mapping), error: '' }
    } catch (reason) {
      return { observations: [], errors: [], duplicates: 0, error: errorText(reason) }
    }
  }, [table, mapping])
  const stations = [...new Set(normalized?.observations.map((item) => item.station))].sort()
  const filtered = useMemo(
    () =>
      (normalized?.observations || []).filter(
        (item) =>
          (!station || item.station === station) &&
          (!start || item.time >= Date.parse(`${start}T00:00:00Z`)) &&
          (!end || item.time < Date.parse(`${end}T00:00:00Z`) + 86400000),
      ),
    [normalized, station, start, end],
  )
  const summary = [summarize(filtered.map((item) => item.primary)), summarize(filtered.map((item) => item.secondary))]
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pages - 1)
  const canChart = filtered.length > 0 && filtered.length <= 10000 && (station !== '' || stations.length <= 1)
  const plot = (kind: 'line' | 'bar') => {
    const common = (
      <>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(value: number) => new Date(value).toISOString().slice(0, 10)}
        />
        <YAxis yAxisId="left" label={{ value: mapping.primaryUnit, angle: -90, position: 'insideLeft' }} />
        <YAxis
          yAxisId="right"
          orientation="right"
          hide={!mapping.secondary}
          label={{ value: mapping.secondaryUnit, angle: 90, position: 'insideRight' }}
        />
        <Tooltip labelFormatter={(value) => new Date(Number(value)).toISOString()} />
      </>
    )
    return kind === 'line' ? (
      <LineChart data={filtered}>
        {common}
        <Line
          yAxisId="left"
          dataKey="primary"
          name={`${mapping.primary} (${mapping.primaryUnit || 'unit not supplied'})`}
          stroke="#0f766e"
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
        />
        {mapping.secondary && (
          <Line
            yAxisId="right"
            dataKey="secondary"
            name={`${mapping.secondary} (${mapping.secondaryUnit || 'unit not supplied'})`}
            stroke="#c2410c"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        )}
      </LineChart>
    ) : (
      <BarChart data={filtered}>
        {common}
        <Bar yAxisId="left" dataKey="primary" name={mapping.primary} fill="#0f766e" isAnimationActive={false} />
        {mapping.secondary && (
          <Bar yAxisId="right" dataKey="secondary" name={mapping.secondary} fill="#c2410c" isAnimationActive={false} />
        )}
      </BarChart>
    )
  }
  return (
    <div className="space-y-5">
      <PortalLiveMonitoring
        {...props}
        onCsv={(text, name, raw) => {
          setTable(raw ?? checkedCsv(text))
          setFilename(name)
          setMapping(DEFAULT_MAPPING)
          setStation('')
          setStart('')
          setEnd('')
          setPage(0)
          setError('')
          setDelimiter(',')
        }}
      />
      <h2 className="text-xl font-semibold">Monitoring CSV and reports</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Load an exported monitoring CSV, map its columns and review observations, quality checks and statistics. Files
        stay in this browser. Live pages can be brought into this report above; server permissions determine
        station/schema access.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          CSV delimiter
          <select
            aria-label="Monitoring delimiter"
            value={delimiter}
            onChange={(event) => setDelimiter(event.target.value)}
            className={inputClass}
          >
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value="\t">Tab</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Monitoring CSV
          <input
            aria-label="Monitoring CSV"
            type="file"
            accept=".csv,.tsv,.txt"
            className={inputClass}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setError('')
              setTable(undefined)
              setPage(0)
              setStation('')
              setStart('')
              setEnd('')
              try {
                if (file.size > 20 * 1024 * 1024) throw new Error('Choose a CSV under 20 MB.')
                const result = checkedCsv(await file.text(), delimiter)
                setTable(result)
                setFilename(file.name)
                setMapping({
                  ...DEFAULT_MAPPING,
                  timestamp: result.headers.find((key) => /^(timestamp|datetime|date_time|time)$/i.test(key)) || '',
                  station: result.headers.find((key) => /^(station|station_id|site)$/i.test(key)) || '',
                })
              } catch (reason) {
                setError(errorText(reason))
              }
            }}
          />
        </label>
      </div>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {table && (
        <>
          <p className="text-sm">
            {filename}: {table.records.length} source rows · {table.headers.length} columns
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(['timestamp', 'station', 'primary', 'secondary'] as const).map((key) => (
              <label key={key} className="text-sm font-medium">
                {
                  {
                    timestamp: 'Timestamp column',
                    station: 'Station column',
                    primary: 'Primary measurement',
                    secondary: 'Secondary measurement',
                  }[key]
                }
                <select
                  aria-label={
                    key === 'primary'
                      ? 'Primary measurement'
                      : key === 'secondary'
                        ? 'Secondary measurement'
                        : `${key} column`
                  }
                  className={inputClass}
                  value={mapping[key]}
                  onChange={(event) => {
                    setMapping((value) => ({ ...value, [key]: event.target.value }))
                    setPage(0)
                  }}
                >
                  <option value="">
                    {key === 'station' ? 'One station' : key === 'secondary' ? 'None' : 'Choose a column'}
                  </option>
                  {table.headers.map((column) => (
                    <option key={column}>{column}</option>
                  ))}
                </select>
              </label>
            ))}
            {(['primaryUnit', 'secondaryUnit'] as const).map((key) => (
              <label key={key} className="text-sm font-medium">
                {key === 'primaryUnit' ? 'Primary unit' : 'Secondary unit'}
                <input
                  aria-label={key === 'primaryUnit' ? 'Primary unit' : 'Secondary unit'}
                  value={mapping[key]}
                  onChange={(event) => setMapping((value) => ({ ...value, [key]: event.target.value }))}
                  className={inputClass}
                  placeholder="As supplied by the source"
                />
              </label>
            ))}
            <label className="text-sm font-medium">
              Unzoned timestamps
              <input
                aria-label="Timestamp time zone"
                className={inputClass}
                value={mapping.timezone}
                onChange={(event) => setMapping((value) => ({ ...value, timezone: event.target.value }))}
                list="nechako-timezones"
                placeholder="IANA zone, UTC, ±HH:mm or embedded"
              />
              <datalist id="nechako-timezones">
                <option value="embedded">Require offsets in timestamps</option>
                <option value="UTC" />
                <option value="America/Vancouver" />
                <option value="-08:00" />
                <option value="-07:00" />
              </datalist>
            </label>
            <label className="text-sm font-medium">
              Time zone / UTC offset column
              <select
                aria-label="Time zone column"
                className={inputClass}
                value={mapping.timezoneColumn || ''}
                onChange={(event) => setMapping((value) => ({ ...value, timezoneColumn: event.target.value }))}
              >
                <option value="">Use timestamp offset or chosen time zone</option>
                {table.headers.map((key) => (
                  <option key={key}>{key}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium">
            Date format
            <select
              aria-label="Monitoring date format"
              className={inputClass}
              value={mapping.dateFormat ?? 'iso'}
              onChange={(event) => {
                setMapping((value) => ({ ...value, dateFormat: event.target.value as MonitoringMapping['dateFormat'] }))
                setPage(0)
              }}
            >
              <option value="iso">ISO date and time</option>
              <option value="dmy">DD/MM/YYYY · daily date</option>
              <option value="mdy">MM/DD/YYYY · daily date</option>
              <option value="ymd">YYYY-MM-DD · daily date</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Choose the actual source format; dates are never guessed. Daily dates are placed at midnight in the selected
            time zone for charting, with their original values retained. Embedded offsets take precedence. Ambiguous or
            missing local times at daylight-saving changes are rejected. Empty measurements stay missing; duplicate
            station/timestamps are retained and counted. Charts and date filters use UTC.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadText(
                  JSON.stringify({ schema: 'nechako-monitoring-preset-v1', mapping }, null, 2),
                  'monitoring-preset.json',
                  'application/json',
                )
              }
            >
              Export matching preset
            </Button>
            <label className="text-sm">
              Import matching preset
              <input
                aria-label="Import matching preset"
                type="file"
                accept=".json"
                className="ml-2 max-w-full text-sm"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    if (file.size > 100000) throw new Error('Preset file is too large.')
                    const value = JSON.parse(await file.text())
                    if (value.mapping && value.mapping.timezoneColumn === undefined) value.mapping.timezoneColumn = ''
                    if (value.mapping && value.mapping.dateFormat === undefined) value.mapping.dateFormat = 'iso'
                    if (
                      value.schema !== 'nechako-monitoring-preset-v1' ||
                      !value.mapping ||
                      Object.keys(DEFAULT_MAPPING).some((key) => typeof value.mapping[key] !== 'string') ||
                      !['iso', 'dmy', 'mdy', 'ymd'].includes(value.mapping.dateFormat)
                    )
                      throw new Error('Invalid monitoring preset.')
                    for (const key of ['timestamp', 'station', 'primary', 'secondary', 'timezoneColumn'])
                      if (value.mapping[key] && !table.headers.includes(value.mapping[key]))
                        throw new Error(`Preset column ${value.mapping[key]} is missing in this CSV.`)
                    setMapping(value.mapping)
                    setError('')
                    setPage(0)
                  } catch (reason) {
                    setError(errorText(reason))
                  }
                }}
              />
            </label>
          </div>
          {normalized?.error && <InlineAlert tone="error">{normalized.error}</InlineAlert>}
          {normalized && !normalized.error && (
            <>
              <p aria-live="polite" className="text-sm">
                {normalized.observations.length} valid observations · {normalized.errors.length} rejected rows ·{' '}
                {normalized.duplicates} duplicate station/timestamps
              </p>
              {!!normalized.errors.length && (
                <details className="rounded-lg border p-3">
                  <summary>Rejected rows ({normalized.errors.length})</summary>
                  <div className="max-h-48 overflow-auto text-xs">
                    {normalized.errors.map((item) => (
                      <p key={item.row}>
                        CSV row {item.row}: {item.message}
                      </p>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadText(
                        csvExport(
                          ['row', 'error'],
                          normalized.errors.map((item) => [item.row, item.message]),
                        ),
                        'monitoring-errors.csv',
                        'text/csv',
                      )
                    }
                  >
                    Export error report
                  </Button>
                </details>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  Station
                  <select
                    aria-label="Monitoring station"
                    value={station}
                    onChange={(event) => {
                      setStation(event.target.value)
                      setPage(0)
                    }}
                    className={inputClass}
                  >
                    <option value="">All stations (table and statistics)</option>
                    {stations.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  From date (UTC)
                  <input
                    aria-label="Monitoring from date"
                    type="date"
                    value={start}
                    onChange={(event) => {
                      setStart(event.target.value)
                      setPage(0)
                    }}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm">
                  Through date (UTC)
                  <input
                    aria-label="Monitoring through date"
                    type="date"
                    value={end}
                    onChange={(event) => {
                      setEnd(event.target.value)
                      setPage(0)
                    }}
                    className={inputClass}
                  />
                </label>
                <label className="text-sm">
                  Chart type
                  <select
                    aria-label="Monitoring chart type"
                    value={chart}
                    onChange={(event) => setChart(event.target.value as 'line' | 'bar')}
                    className={inputClass}
                  >
                    <option value="line">Line</option>
                    <option value="bar">Bar</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <caption className="p-2 text-left">
                    Statistics for {filtered.length} filtered observations; each variable excludes missing values.
                  </caption>
                  <thead>
                    <tr>
                      {['Variable', 'Unit', 'Count', 'Minimum', 'Maximum', 'Mean'].map((label) => (
                        <th key={label} className="p-2">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((item, index) =>
                      index === 0 || mapping.secondary ? (
                        <tr key={index} className="border-t">
                          <td className="p-2">{index === 0 ? mapping.primary : mapping.secondary}</td>
                          <td className="p-2">{index === 0 ? mapping.primaryUnit : mapping.secondaryUnit}</td>
                          {[item.count, item.min, item.max, item.mean].map((value, i) => (
                            <td key={i} className="p-2">
                              {value === null ? '—' : Number.isInteger(value) ? value : value.toPrecision(6)}
                            </td>
                          ))}
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
              {canChart ? (
                <div className="h-80 min-w-0" aria-label={`${chart} monitoring chart`}>
                  <ResponsiveContainer width="100%" height="100%">
                    {plot(chart)}
                  </ResponsiveContainer>
                </div>
              ) : (
                <InlineAlert>
                  {filtered.length > 10000
                    ? 'Limit the date range to 10,000 observations to draw a chart. Tables and exports include every filtered row.'
                    : filtered.length
                      ? 'Choose one station to chart its measurements.'
                      : 'No observations match the selected filters.'}
                </InlineAlert>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm">
                  {filtered.length} filtered observations · Page {current + 1} of {pages}
                </p>
                <Button size="sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  Previous observations
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={current + 1 >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  Next observations
                </Button>
                <Button
                  size="sm"
                  disabled={!filtered.length}
                  onClick={() =>
                    downloadText(
                      csvExport(
                        [
                          'timestamp_utc',
                          'station',
                          mapping.primary,
                          ...(mapping.secondary ? [mapping.secondary] : []),
                          'source_csv_row',
                        ],
                        filtered.map((item) => [
                          item.timestamp,
                          item.station,
                          item.primary,
                          ...(mapping.secondary ? [item.secondary] : []),
                          item.row,
                        ]),
                      ),
                      'monitoring-filtered.csv',
                      'text/csv',
                    )
                  }
                >
                  Export filtered observations
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        'Timestamp (UTC)',
                        'Station',
                        mapping.primary,
                        ...(mapping.secondary ? [mapping.secondary] : []),
                        'Source row',
                      ].map((label, i) => (
                        <th key={i} className="p-2">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(current * 50, (current + 1) * 50).map((item) => (
                      <tr key={item.row} className="border-t">
                        <td className="p-2">{item.timestamp}</td>
                        <td className="p-2">{item.station}</td>
                        <td className="p-2">{item.primary ?? '—'}</td>
                        {mapping.secondary && <td className="p-2">{item.secondary ?? '—'}</td>}
                        <td className="p-2">{item.row}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
