import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText, portalLayerAttributes, portalRead, PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'
import { nativeId } from './data/monitoringRelations'
export type MonitoringContext = { submissionId: string; formId: string; layerId?: string; recId?: string }
function checkedLayers(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) throw new Error('The source did not return a submission layer list.')
  return value.map((layer) => {
    const id = nativeId(layer?.layer_id)
    if (Number(id) <= 0 || typeof layer.layer_name !== 'string') throw new Error('Invalid source submission layer.')
    return { id, name: layer.layer_name }
  })
}
function checkedTable(value: unknown) {
  const table = value as { attributes: string[]; rows: unknown[][] }
  if (
    !table ||
    !Array.isArray(table.attributes) ||
    !Array.isArray(table.rows) ||
    table.attributes.length > 200 ||
    table.rows.length > 1000 ||
    table.attributes.some((field) => typeof field !== 'string') ||
    new Set(table.attributes).size !== table.attributes.length ||
    table.rows.some((row) => !Array.isArray(row) || row.length !== table.attributes.length)
  )
    throw new Error('Source Attributes requires matching columns/rows, at most 200 columns and 1,000 rows.')
  return table
}
const cell = (value: unknown) =>
  value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
export function PortalLayerRecords({
  submissionId,
  layers,
  onMonitoring,
}: {
  submissionId: string
  layers: unknown
  onMonitoring?: (context: MonitoringContext) => void
}) {
  const [selected, setSelected] = useState(''),
    [data, setData] = useState<ReturnType<typeof checkedTable>>(),
    [original, setOriginal] = useState<unknown>(),
    [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const request = useRef<AbortController>()
  useEffect(() => {
    const clear = () => {
      request.current?.abort()
      setSelected('')
      setData(undefined)
      setOriginal(undefined)
      setPage(0)
      setBusy(false)
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, clear)
    return () => {
      request.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, clear)
    }
  }, [])
  let available: ReturnType<typeof checkedLayers>
  try {
    available = checkedLayers(layers)
  } catch (reason) {
    return <InlineAlert tone="error">{errorText(reason)}</InlineAlert>
  }
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      await operation(controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason))
    } finally {
      if (request.current === controller) setBusy(false)
    }
  }
  const idColumn = data?.attributes.indexOf('schema_rec_seq_id') ?? -1,
    statusColumn = data?.attributes.indexOf('monitor_status') ?? -1
  return (
    <section className="space-y-3 rounded border p-3">
      <h4 className="font-semibold">Original layer attribute records</h4>
      <p className="text-xs text-muted-foreground">
        Read a layer listed by this submission. The local gateway rechecks that association and obtains the native
        descriptor. The source attribute endpoint has no pagination; this viewer limits its selector to 1,000 returned
        rows. Display pages show 50 rows. Observation reads use the selected actual record ID.
      </p>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {!available.length ? (
        <InlineAlert>No spatial layers were returned for this submission.</InlineAlert>
      ) : (
        <label className="block">
          Submission spatial layer
          <select
            aria-label="Submission attribute layer"
            className="mt-1 w-full rounded border bg-background p-2"
            value={selected}
            onChange={(event) => {
              request.current?.abort()
              setSelected(event.target.value)
              setData(undefined)
              setOriginal(undefined)
              setPage(0)
              setBusy(false)
            }}
          >
            <option value="">Choose a source layer</option>
            {available.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name} · layer {layer.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        variant="outline"
        disabled={!selected || busy}
        onClick={() =>
          void run(async (signal) => {
            const value = await portalLayerAttributes(
              Number(nativeId(submissionId)),
              Number(nativeId(selected)),
              signal,
            )
            const table = checkedTable(value)
            if (!signal.aborted) {
              setData(table)
              setOriginal(value)
              setPage(0)
            }
          })
        }
      >
        Read source layer attributes
      </Button>
      {data && (
        <>
          <p className="text-sm">{data.rows.length} returned source records · columns retain their native labels</p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {data.attributes.map((field) => (
                    <th key={field} className="border p-2 text-left">
                      {field}
                    </th>
                  ))}
                  {onMonitoring && idColumn >= 0 && statusColumn >= 0 && <th className="border p-2">Monitoring</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(page * 50, (page + 1) * 50).map((row, index) => {
                  let recId: string | undefined
                  if (idColumn >= 0 && statusColumn >= 0 && row[statusColumn] === 'ENABLED') {
                    try {
                      recId = nativeId(row[idColumn])
                    } catch {
                      /* Keep the source row; do not invent an invalid sequence ID. */
                    }
                  }
                  return (
                    <tr key={page * 50 + index}>
                      {row.map((value, column) => (
                        <td key={column} className="border p-2">
                          <span title={cell(value)} className="block max-w-80 truncate">
                            {cell(value)}
                          </span>
                        </td>
                      ))}
                      {onMonitoring && idColumn >= 0 && statusColumn >= 0 && (
                        <td className="border p-2">
                          {recId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void run(async (signal) => {
                                  const form = await portalRead(
                                    'rest/portal/getSubmissionForm.php',
                                    { submissionId },
                                    signal,
                                  )
                                  const formId = nativeId(form)
                                  if (Number(formId) <= 0) throw new Error('The source returned no form ID.')
                                  if (!signal.aborted) onMonitoring({ submissionId, formId, layerId: selected, recId })
                                })
                              }
                            >
                              Monitor record {recId}
                            </Button>
                          ) : (
                            'No enabled monitoring'
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous attribute page
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * 50 >= data.rows.length}
              onClick={() => setPage(page + 1)}
            >
              Next attribute page
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadText(
                  JSON.stringify(original, null, 2),
                  `submission-${submissionId}-layer-${selected}-attributes.json`,
                  'application/json',
                )
              }
            >
              Download source attributes JSON
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
