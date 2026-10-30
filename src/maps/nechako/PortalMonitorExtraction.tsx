import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText, PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'
import { extractMonitoring, type ExtractionProgress, type MonitorExtraction } from './data/monitorExtraction'
import { saveLocalWorkbench } from './data/localWorkbench'
import { csvExport } from './data/monitoring'
import { monitorPageTable } from './data/monitoringRelations'
import type { ProjectRead } from './data/projectManager'

export function PortalMonitorExtraction({
  params,
  fields,
  name,
  read,
  onChart,
}: {
  params: Record<string, string>
  fields: string[]
  name: string
  read: ProjectRead
  onChart: (text: string, name: string, raw?: ReturnType<typeof monitorPageTable>) => void
}) {
  const [maxRows, setMaxRows] = useState(100000)
  const [uniqueKey, setUniqueKey] = useState('')
  const [progress, setProgress] = useState<ExtractionProgress>()
  const [result, setResult] = useState<MonitorExtraction>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController>()
  const scope = JSON.stringify(params)
  useEffect(() => {
    const clear = () => {
      controller.current?.abort()
      setResult(undefined)
      setProgress(undefined)
      setBusy(false)
      setMessage('')
      setError('')
    }
    clear()
    window.addEventListener(PORTAL_CONNECTION_EVENT, clear)
    return () => {
      controller.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, clear)
    }
  }, [scope])
  const csv = () =>
    result
      ? csvExport(
          result.fields,
          result.rows.map((row) =>
            result.fields.map((field) => (row[field] === null || row[field] === undefined ? '' : String(row[field]))),
          ),
        )
      : ''
  const start = async () => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setError('')
    setMessage('')
    setResult(undefined)
    try {
      const value = await extractMonitoring({
        params,
        read,
        maxRows,
        uniqueKey: uniqueKey || undefined,
        signal: current.signal,
        onProgress: (next) => {
          if (!current.signal.aborted) setProgress(next)
        },
      })
      if (!current.signal.aborted) setResult(value)
    } catch (reason) {
      if (!current.signal.aborted) setError(errorText(reason))
    } finally {
      if (controller.current === current) setBusy(false)
    }
  }
  return (
    <section className="space-y-3 rounded border p-3" aria-label="Complete monitoring extraction">
      <h4 className="font-semibold">Download and cache all observation pages</h4>
      <p className="text-xs text-muted-foreground">
        Sequential 500-row requests check source totals, columns, repeated pages and final boundaries. Original dates,
        IDs, zero and missing values are retained. The source does not provide an atomic snapshot.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          Maximum rows
          <input
            aria-label="Monitoring download row limit"
            type="number"
            min={1}
            max={1000000}
            step={500}
            className="mt-1 w-full rounded border bg-background p-2"
            value={maxRows}
            disabled={busy}
            onChange={(event) => setMaxRows(Number(event.target.value))}
          />
        </label>
        <label className="text-sm">
          Unique row ID, if the source has one
          <NativeSelect
            aria-label="Monitoring unique row ID"
            className="mt-1 w-full rounded border bg-background p-2"
            value={uniqueKey}
            disabled={busy}
            onChange={(event) => setUniqueKey(event.target.value)}
          >
            <option value="">No verified unique key</option>
            {fields.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void start()}>
          Fetch all observation pages
        </Button>
        {busy && (
          <Button
            variant="outline"
            onClick={() => {
              controller.current?.abort()
              setBusy(false)
              setProgress(undefined)
              setMessage('Download cancelled; no complete extract was saved.')
            }}
          >
            Cancel observation download
          </Button>
        )}
      </div>
      {progress && (
        <p role="status" className="text-sm">
          {progress.phase === 'verify' ? 'Verifying boundaries' : 'Downloading'}: {progress.rows.toLocaleString()} /{' '}
          {progress.total.toLocaleString()} rows · {progress.pages} pages
        </p>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {message && <InlineAlert>{message}</InlineAlert>}
      {result && (
        <>
          <InlineAlert tone={result.status === 'complete' ? 'info' : 'warning'}>
            <strong>
              {result.status === 'complete' ? 'Count-verified complete extract' : 'Partial extract — row limit reached'}
            </strong>
            : {result.downloadedRows.toLocaleString()} / {result.expectedRows.toLocaleString()} rows.
          </InlineAlert>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => downloadText(csv(), `monitoring-${result.status}.csv`, 'text/csv')}
            >
              Download {result.status} CSV
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadText(JSON.stringify(result, null, 2), `monitoring-${result.status}.json`, 'application/json')
              }
            >
              Download extract and verification JSON
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onChart(
                  csv(),
                  `${name} · ${result.status} ${result.downloadedRows.toLocaleString()} rows`,
                  monitorPageTable({
                    fields: result.fields,
                    data: result.rows,
                    recordCount: result.expectedRows,
                    noData: !result.rows.length,
                  }),
                )
              }
            >
              Chart downloaded observations
            </Button>
            <Button
              onClick={() => {
                setError('')
                setMessage('')
                void saveLocalWorkbench({
                  kind: 'monitoring',
                  name: `${name} · ${result.status}`,
                  data: result,
                  source: {
                    portal: 'https://nechakowatershed-portal.ca/',
                    recordId: params.recId,
                    access: 'unknown',
                    notes: 'Explicit browser-local copy; source permissions remain authoritative for subsequent reads.',
                  },
                })
                  .then(() =>
                    setMessage(
                      'Observations and verification saved on this browser. They remain available in Local workbench after disconnecting.',
                    ),
                  )
                  .catch((reason) => setError(errorText(reason)))
              }}
            >
              Save {result.status} extract locally
            </Button>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary>Verification details</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}
