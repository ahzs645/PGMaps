import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText, portalRead, portalLayerAttributes, PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'
import { csvExport } from './data/monitoring'
import {
  checkedMonitorPage,
  checkedMonitorRelations,
  monitorPageRequest,
  monitorAttributePageRequest,
  monitorPageTable,
  monitorAttributeRecordIds,
  monitoringSourceContext,
  nativeId,
  type MonitorPage,
  type MonitorRelation,
} from './data/monitoringRelations'
import type { ProjectRead } from './data/projectManager'
import { PortalMonitorExtraction } from './PortalMonitorExtraction'
export type PortalMonitoringProps = {
  submissionId?: string | number
  formId?: string | number
  layerId?: string
  recId?: string
  read?: ProjectRead
}
export function PortalLiveMonitoring({
  submissionId,
  formId,
  layerId,
  recId,
  read = portalRead,
  onCsv,
}: PortalMonitoringProps & { onCsv: (text: string, name: string, raw?: ReturnType<typeof monitorPageTable>) => void }) {
  const initialContext = monitoringSourceContext({ layerId, recId })
  const [mode, setMode] = useState<'submission' | 'layer' | 'schema'>(initialContext.mode)
  const [sourceId, setSourceId] = useState(initialContext.sourceId)
  const [recordId, setRecordId] = useState(initialContext.recordId)
  const [attributeRecordIds, setAttributeRecordIds] = useState<string[]>([])
  const [attributeIdsRead, setAttributeIdsRead] = useState(false)
  const [submission, setSubmission] = useState(String(submissionId ?? ''))
  const [form, setForm] = useState(String(formId ?? ''))
  const [relations, setRelations] = useState<MonitorRelation[]>([])
  const [selected, setSelected] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<MonitorPage>()
  const [schema, setSchema] = useState<unknown>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [linksRead, setLinksRead] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const context = monitoringSourceContext({ layerId, recId })
    setMode(context.mode)
    setSourceId(context.sourceId)
    setRecordId(context.recordId)
    setAttributeRecordIds([])
    setAttributeIdsRead(false)
    setSubmission(String(submissionId ?? ''))
    setForm(String(formId ?? ''))
    controller.current?.abort()
    setRelations([])
    setData(undefined)
    setSchema(undefined)
    setSelected('')
  }, [submissionId, formId, layerId, recId])
  useEffect(() => {
    const clearProtectedReads = () => {
      controller.current?.abort()
      setRelations([])
      setSelected('')
      setData(undefined)
      setSchema(undefined)
      setLinksRead(false)
      setBusy(false)
      setAttributeRecordIds([])
      setAttributeIdsRead(false)
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, clearProtectedReads)
    return () => {
      controller.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, clearProtectedReads)
    }
  }, [])
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true)
    setError('')
    try {
      await operation(next.signal)
    } catch (reason) {
      if (!next.signal.aborted) setError(errorText(reason))
    } finally {
      if (controller.current === next) setBusy(false)
    }
  }
  const relation = relations[Number(selected)]
  const load = (nextPage: number) =>
    void run(async (signal) => {
      if (mode === 'submission' && !relation) return
      const params =
        mode === 'submission'
          ? monitorPageRequest(relation, submission, nextPage, 500)
          : monitorAttributePageRequest(mode, sourceId, recordId, nextPage, 500)
      const result = checkedMonitorPage(await read('rest/portal/getMonitorData.php', params, signal), 500)
      if (!signal.aborted) {
        setData(result)
        setPage(nextPage)
      }
    })
  const csv = () =>
    data
      ? csvExport(
          data.fields,
          data.data.map((row) =>
            data.fields.map((field) => (row[field] === null || row[field] === undefined ? '' : String(row[field]))),
          ),
        )
      : ''
  return (
    <section className="space-y-3 rounded border p-3">
      <h3 className="font-semibold">Live monitoring stations and schemas</h3>
      <p className="text-xs text-muted-foreground">
        Read the observations available to the current portal connection, 500 rows at a time. The original request
        includes accessible draft observations for form-node reads; layer/schema reads follow the original Attributes
        tool. Preview controls use the loaded page. Fetch all observation pages below for a verified complete extract or
        an explicitly limited partial extract; dates and units retain source values.
      </p>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      <label className="block">
        Monitoring source
        <NativeSelect
          aria-label="Monitoring source mode"
          className="mt-1 w-full rounded border bg-background p-2"
          value={mode}
          onChange={(event) => {
            controller.current?.abort()
            setMode(event.target.value as typeof mode)
            setSourceId('')
            setRecordId('')
            setAttributeRecordIds([])
            setAttributeIdsRead(false)
            setData(undefined)
            setSchema(undefined)
            setBusy(false)
            setError('')
          }}
        >
          <option value="submission">Submission form node</option>
          <option value="layer">Portal layer Attributes</option>
          <option value="schema">Portal schema Attributes</option>
        </NativeSelect>
      </label>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          controller.current?.abort()
          setMode('layer')
          setSourceId('386')
          setRecordId('1')
          setSubmission('1477')
          setData(undefined)
          setSchema(undefined)
          setAttributeRecordIds([])
          setAttributeIdsRead(false)
          setBusy(false)
          setError('')
        }}
      >
        Use verified Upper_Nechako example
      </Button>
      <p className="text-xs text-muted-foreground">
        Example IDs were verified from the original Attributes row on October 12, 2026. Its anonymous layer read
        reported 25,933 observations; Load observations makes a fresh bounded request. Other schema-wide counts refer to
        a different scope.
      </p>
      {mode === 'submission' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              Submission ID
              <input
                aria-label="Monitoring submission ID"
                className="mt-1 w-full rounded border bg-background p-2"
                value={submission}
                onChange={(event) => {
                  controller.current?.abort()
                  setSubmission(event.target.value)
                  setRelations([])
                  setSelected('')
                  setData(undefined)
                  setSchema(undefined)
                }}
              />
            </label>
            <label>
              Form ID
              <input
                aria-label="Monitoring form ID"
                className="mt-1 w-full rounded border bg-background p-2"
                value={form}
                onChange={(event) => {
                  controller.current?.abort()
                  setForm(event.target.value)
                  setRelations([])
                  setSelected('')
                  setData(undefined)
                  setSchema(undefined)
                }}
              />
            </label>
          </div>
          <Button
            variant="outline"
            disabled={busy || !submission || !form}
            onClick={() =>
              void run(async (signal) => {
                const rows = checkedMonitorRelations(
                  await read(
                    'rest/portal/getSubmissionMonitorSchemaLayers.php',
                    { formId: nativeId(form), submissionId: nativeId(submission) },
                    signal,
                  ),
                )
                if (!signal.aborted) {
                  setLinksRead(true)
                  setRelations(rows)
                  setSelected('')
                  setData(undefined)
                  setSchema(undefined)
                }
              })
            }
          >
            Read station/schema links
          </Button>
          {linksRead && !relations.length && (
            <InlineAlert>No accessible monitoring links were returned for this submission and form.</InlineAlert>
          )}
          {relations.length > 0 && (
            <label className="block">
              Station / schema
              <NativeSelect
                aria-label="Monitoring station schema"
                className="mt-1 w-full rounded border bg-background p-2"
                value={selected}
                onChange={(event) => {
                  controller.current?.abort()
                  setSelected(event.target.value)
                  setPage(0)
                  setData(undefined)
                  setSchema(undefined)
                }}
              >
                <option value="">Choose a linked station</option>
                {relations.map((row, index) => (
                  <option key={`${row.layerId}-${row.recId}`} value={index}>
                    {row.layerName} · {row.schemaName} · record {row.recId}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
        </>
      ) : (
        <>
          <p className="text-xs">
            Use the actual layer/schema ID and schema_rec_seq_id from an original Attributes row whose monitor_status is
            ENABLED. Form-node links may be empty even when that spatial layer has monitoring records. IDs are not
            inferred from names.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              {mode === 'layer' ? 'Layer ID' : 'Schema ID'}
              <input
                aria-label="Monitoring layer or schema ID"
                className="mt-1 w-full rounded border bg-background p-2"
                value={sourceId}
                onChange={(event) => {
                  controller.current?.abort()
                  setSourceId(event.target.value)
                  setAttributeRecordIds([])
                  setAttributeIdsRead(false)
                  setData(undefined)
                  setSchema(undefined)
                }}
              />
            </label>
            <label>
              Record sequence ID (schema_rec_seq_id)
              <input
                aria-label="Monitoring record sequence ID"
                className="mt-1 w-full rounded border bg-background p-2"
                value={recordId}
                onChange={(event) => {
                  controller.current?.abort()
                  setRecordId(event.target.value)
                  setData(undefined)
                  setSchema(undefined)
                }}
              />
            </label>
          </div>
        </>
      )}
      {mode === 'layer' && (
        <div className="space-y-2">
          <label className="block">
            Source submission ID for permitted layer lookup
            <input
              aria-label="Monitoring attribute submission ID"
              className="mt-1 w-full rounded border bg-background p-2"
              value={submission}
              onChange={(event) => {
                controller.current?.abort()
                setSubmission(event.target.value)
                setAttributeRecordIds([])
                setAttributeIdsRead(false)
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={busy || !submission || !sourceId}
            onClick={() =>
              void run(async (signal) => {
                const value = await portalLayerAttributes(
                  Number(nativeId(submission)),
                  Number(nativeId(sourceId)),
                  signal,
                )
                if (!signal.aborted) {
                  setAttributeRecordIds(monitorAttributeRecordIds(value))
                  setAttributeIdsRead(true)
                }
              })
            }
          >
            Read permitted source record IDs
          </Button>
          {attributeIdsRead && !attributeRecordIds.length && (
            <InlineAlert>No ENABLED monitoring records were returned in this source attribute table.</InlineAlert>
          )}
          {attributeRecordIds.length > 0 && (
            <label className="block">
              Enabled source record
              <NativeSelect
                aria-label="Enabled monitoring attribute record"
                className="mt-1 w-full rounded border bg-background p-2"
                value={attributeRecordIds.includes(recordId) ? recordId : ''}
                onChange={(event) => {
                  controller.current?.abort()
                  setRecordId(event.target.value)
                  setData(undefined)
                }}
              >
                <option value="">Choose an actual record ID</option>
                {attributeRecordIds.map((id) => (
                  <option key={id} value={id}>
                    Record {id}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || (mode === 'submission' ? selected === '' : !sourceId || !recordId)}
          onClick={() => load(0)}
        >
          Load observations
        </Button>
        <Button
          variant="outline"
          disabled={busy || (mode === 'submission' ? selected === '' : mode !== 'schema' || !sourceId)}
          onClick={() =>
            void run(async (signal) => {
              const result = await read(
                'rest/portal/getSchemaFields.php',
                { schemaId: mode === 'submission' ? relation.schemaId : nativeId(sourceId) },
                signal,
              )
              if (!signal.aborted) setSchema(result)
            })
          }
        >
          Read schema fields
        </Button>
      </div>
      {schema !== undefined && (
        <details>
          <summary>Original schema field definitions</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </details>
      )}
      {data && (
        <>
          <PortalMonitorExtraction
            params={
              mode === 'submission'
                ? monitorPageRequest(relation, submission, 0, 500)
                : monitorAttributePageRequest(mode, sourceId, recordId, 0, 500)
            }
            fields={data.fields}
            name={mode === 'submission' ? relation.layerName : `${mode} ${sourceId}, record ${recordId}`}
            read={read}
            onChart={onCsv}
          />
          <p className="text-sm">
            {data.noData
              ? 'No accessible observations.'
              : `Rows ${data.data.length ? page * 500 + 1 : 0}–${page * 500 + data.data.length} of ${data.recordCount.toLocaleString()} · page ${page + 1} of ${Math.max(1, Math.ceil(data.recordCount / 500))}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || page === 0} onClick={() => load(page - 1)}>
              Previous observation page
            </Button>
            <Button
              variant="outline"
              disabled={busy || (page + 1) * 500 >= data.recordCount}
              onClick={() => load(page + 1)}
            >
              Next observation page
            </Button>
            <Button
              variant="outline"
              disabled={!data.data.length}
              onClick={() =>
                downloadText(
                  csv(),
                  `monitor-${mode}-${mode === 'submission' ? submission : sourceId}-page-${page + 1}.csv`,
                  'text/csv',
                )
              }
            >
              Download this page
            </Button>
            <Button
              variant="outline"
              disabled={!data.data.length}
              onClick={() =>
                downloadText(
                  JSON.stringify(data, null, 2),
                  `monitor-${mode}-${mode === 'submission' ? submission : sourceId}-page-${page + 1}.json`,
                  'application/json',
                )
              }
            >
              Download this page JSON
            </Button>
            <Button
              variant="outline"
              disabled={!data.data.length}
              onClick={() =>
                onCsv(
                  csv(),
                  `Live ${mode === 'submission' ? relation.layerName : `${mode} ${sourceId}, record ${recordId}`} · page ${page + 1} only`,
                  monitorPageTable(data),
                )
              }
            >
              Chart and report this page
            </Button>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {data.fields.map((field) => (
                    <th key={field} className="border p-2 text-left">
                      {field}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.map((row, index) => (
                  <tr key={index}>
                    {data.fields.map((field) => (
                      <td key={field} className="border p-2">
                        {row[field] === null || row[field] === undefined ? '—' : String(row[field])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
