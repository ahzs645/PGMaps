import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import {
  checkedCsv,
  normalizeMonitoring,
  csvExport,
  type MonitoringMapping,
  type MonitoringDateFormat,
} from './data/monitoring'
import { cacheMonitoringCsv } from './data/localIngestion'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'

const EMPTY_MAPPING: MonitoringMapping = {
  timestamp: '',
  station: '',
  primary: '',
  secondary: '',
  primaryUnit: '',
  secondaryUnit: '',
  timezone: 'embedded',
  dateFormat: 'iso',
}
export function PortalMonitoringImport() {
  const [file, setFile] = useState<File>()
  const [table, setTable] = useState<ReturnType<typeof checkedCsv>>()
  const [mapping, setMapping] = useState<MonitoringMapping>(EMPTY_MAPPING)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [page, setPage] = useState(0)
  const readGeneration = useRef(0)
  const cache = useLocalWorkbenchRecords('monitoring')
  const normalized = useMemo(() => {
    if (!table || !mapping.timestamp || !mapping.primary) return undefined
    try {
      return { value: normalizeMonitoring(table.records, mapping) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [table, mapping])
  const update = (next: Partial<MonitoringMapping>) => {
    setMapping((old) => ({ ...old, ...next }))
    setAcknowledged(false)
    setNotice('')
  }
  const saved = cache.records.filter(
    (record) => (record.data as { schema?: string })?.schema === 'nechako-local-monitoring-v1',
  )
  const pages = Math.max(1, Math.ceil((table?.records.length ?? 0) / 25)),
    current = Math.min(page, pages - 1)
  const save = async () => {
    if (!file || !table || !normalized?.value) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await cacheMonitoringCsv(file, table.headers, table.records, mapping)
      setNotice(
        `Saved ${table.records.length} original CSV rows with ${normalized.value.observations.length} validated observations and ${normalized.value.errors.length} row issues in this browser.`,
      )
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="monitoring-import-title">
      <h3 id="monitoring-import-title" className="font-semibold">
        Monitoring CSV ingestion
      </h3>
      <p className="text-sm text-muted-foreground">
        Map timestamps, station IDs, measurements and units. Choose the source date format and timezone explicitly. The
        cached dataset includes every original column, the original CSV, valid observations, duplicate counts and row
        errors; nothing is submitted to the portal.
      </p>
      <label className="block text-sm">
        Monitoring CSV (up to 20 MiB and 50,000 rows)
        <input
          aria-label="Monitoring ingestion CSV"
          type="file"
          accept=".csv"
          disabled={busy}
          className="mt-1 block max-w-full"
          onChange={async (event) => {
            const next = event.target.files?.[0]
            if (!next) return
            const generation = ++readGeneration.current
            setFile(undefined)
            setTable(undefined)
            setNotice('')
            setError('')
            setAcknowledged(false)
            try {
              if (next.size > 20 * 1024 * 1024) throw new Error('Choose a monitoring CSV up to 20 MiB.')
              const value = checkedCsv(await next.text())
              if (generation !== readGeneration.current) return
              setFile(next)
              setTable(value)
              setPage(0)
              setMapping({
                ...EMPTY_MAPPING,
                timestamp: value.headers.find((key) => /^(timestamp|datetime|date|time)$/i.test(key)) ?? '',
                station: value.headers.find((key) => /^(station|station_id|site)$/i.test(key)) ?? '',
              })
            } catch (reason) {
              if (generation === readGeneration.current) setError(errorText(reason))
            }
          }}
        />
      </label>
      {(error || cache.error || normalized?.error) && (
        <InlineAlert tone="error">{error || cache.error || normalized?.error}</InlineAlert>
      )}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {table && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['timestamp', 'Timestamp column'],
                ['station', 'Station column'],
                ['primary', 'Primary measurement column'],
                ['secondary', 'Secondary measurement column'],
                ['timezoneColumn', 'Timezone / UTC offset column'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm">
                {label}
                <select
                  aria-label={`Ingestion ${label}`}
                  value={mapping[key] ?? ''}
                  className="mt-1 block w-full rounded border bg-background p-2"
                  onChange={(event) => update({ [key]: event.target.value })}
                >
                  <option value="">{key === 'timezoneColumn' ? 'Use timezone below' : 'Not mapped'}</option>
                  {table.headers.map((header) => (
                    <option key={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="block text-sm">
              Date format
              <select
                aria-label="Ingestion date format"
                value={mapping.dateFormat}
                className="mt-1 block w-full rounded border bg-background p-2"
                onChange={(event) => update({ dateFormat: event.target.value as MonitoringDateFormat })}
              >
                <option value="iso">ISO timestamp YYYY-MM-DD HH:mm:ss</option>
                <option value="ymd">Daily YYYY-MM-DD</option>
                <option value="dmy">Daily DD/MM/YYYY</option>
                <option value="mdy">Daily MM/DD/YYYY</option>
              </select>
            </label>
            <label className="block text-sm">
              Timezone / UTC offset
              <input
                aria-label="Ingestion timezone"
                value={mapping.timezone}
                className="mt-1 block w-full rounded border bg-background p-2"
                onChange={(event) => update({ timezone: event.target.value })}
                placeholder="embedded, UTC, -07:00 or America/Vancouver"
              />
              <span className="text-xs text-muted-foreground">
                embedded requires an offset in every timestamp. Named zones reject ambiguous daylight-saving times.
              </span>
            </label>
            {(['primaryUnit', 'secondaryUnit'] as const).map((key) => (
              <label key={key} className="block text-sm">
                {key === 'primaryUnit' ? 'Primary unit' : 'Secondary unit'}
                <input
                  aria-label={`Ingestion ${key}`}
                  value={mapping[key]}
                  className="mt-1 block w-full rounded border bg-background p-2"
                  onChange={(event) => update({ [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          {normalized?.value && (
            <>
              <p className="text-sm">
                {table.records.length} original rows · {normalized.value.observations.length} valid observations ·{' '}
                {normalized.value.errors.length} rows with issues · {normalized.value.duplicates} repeated
                station/timestamp pairs. Zero measurements are retained.
              </p>
              {!!normalized.value.errors.length && (
                <details>
                  <summary className="cursor-pointer text-sm">Review all row issues</summary>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(normalized.value.errors, null, 2)}
                  </pre>
                </details>
              )}
              {!!(normalized.value.errors.length || normalized.value.duplicates) && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    aria-label="Keep monitoring rows with issues"
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  Keep all original rows with these issues and duplicate flags in the local cache. No rows will be
                  merged.
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy || (!!(normalized.value.errors.length || normalized.value.duplicates) && !acknowledged)
                  }
                  onClick={() => void save()}
                >
                  Cache monitoring CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadText(
                      csvExport(
                        [
                          'Source row',
                          'Timestamp UTC',
                          'Station',
                          `Primary (${mapping.primaryUnit})`,
                          `Secondary (${mapping.secondaryUnit})`,
                        ],
                        normalized.value!.observations.map((row) => [
                          row.row,
                          row.timestamp,
                          row.station,
                          row.primary,
                          row.secondary,
                        ]),
                      ),
                      'validated-monitoring.csv',
                      'text/csv',
                    )
                  }
                >
                  Export validated observations
                </Button>
              </div>
            </>
          )}
          {file && (
            <Button size="sm" variant="outline" onClick={() => downloadBlob(file, file.name)}>
              Download original monitoring CSV
            </Button>
          )}
          <p className="text-sm">
            Original rows {current * 25 + (table.records.length ? 1 : 0)}–
            {Math.min((current + 1) * 25, table.records.length)} of {table.records.length}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(table.records.slice(current * 25, (current + 1) * 25), null, 2)}
          </pre>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!current} onClick={() => setPage(current - 1)}>
              Previous ingestion rows
            </Button>
            <span className="text-sm">
              Page {current + 1} of {pages}
            </span>
            <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              Next ingestion rows
            </Button>
          </div>
        </>
      )}
      {!!saved.length && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Cached monitoring imports ({saved.length})</summary>
          <div className="mt-2 space-y-2">
            {saved.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <span className="text-sm">{record.name}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const data = record.data as {
                        headers: string[]
                        records: Record<string, string>[]
                        mapping: MonitoringMapping
                      }
                      setTable({ headers: data.headers, records: data.records })
                      setMapping(data.mapping)
                      setFile(
                        record.blob
                          ? new File([record.blob], record.filename ?? record.name, { type: 'text/csv' })
                          : undefined,
                      )
                      setPage(0)
                      setError('')
                      setNotice('Restored the cached CSV and its mapping.')
                      setAcknowledged(false)
                    }}
                  >
                    Open cached CSV
                  </Button>
                  {record.blob && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadBlob(record.blob!, record.filename ?? record.name)}
                    >
                      Download source CSV
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
