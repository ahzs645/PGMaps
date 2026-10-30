import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { downloadText } from '@/lib/download'
import { errorText, portalRead } from '@/lib/nechakoPortal'
import { checkedCsv } from './data/monitoring'
import { buildDraftReview, parseReviewForm, type ReviewForm } from './data/submissionReview'
import { checkedReviewJson } from './PortalSubmissionReader'
import { uploadSelectedNativeDrafts, type DraftWrite, type NativeDraftResult } from './data/nativeDraftUpload'
import { ExternalLink } from '@/components/ui/text-button'
import { NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'
import { importLocalWorkbench, listLocalWorkbench, saveLocalWorkbench } from './data/localWorkbench'
import { attachmentRecord, mappedDraftRecords } from './data/localIngestion'

export function PortalDraftReview({
  rows: suppliedRows,
  sourceName = 'Imported spatial attributes',
  geometry,
  write,
  canWrite = false,
}: {
  rows?: Record<string, unknown>[]
  sourceName?: string
  geometry?: GeoJSON.FeatureCollection
  write?: DraftWrite
  canWrite?: boolean
}) {
  const [csv, setCsv] = useState<{ name: string; rows: Record<string, unknown>[]; file: File }>()
  const rows = useMemo(() => suppliedRows ?? csv?.rows ?? [], [suppliedRows, csv])
  const name = suppliedRows ? sourceName : (csv?.name ?? 'No CSV selected')
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row)))], [rows])
  const [form, setForm] = useState<ReviewForm>()
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [duplicateColumn, setDuplicateColumn] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [nameColumn, setNameColumn] = useState(''),
    [reviewWrite, setReviewWrite] = useState(false),
    [acknowledged, setAcknowledged] = useState(false)
  const [nativeResults, setNativeResults] = useState<NativeDraftResult[]>([])
  const [reviewedPlan, setReviewedPlan] = useState<{
    review: ReturnType<typeof buildDraftReview>
    selected: string[]
    nameColumn: string
  }>()
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [page, setPage] = useState(0)
  const request = useRef<AbortController>()
  const localSchemas = useLocalWorkbenchRecords('schema')
  const localPresets = useLocalWorkbenchRecords('match-preset')
  const [cacheBusy, setCacheBusy] = useState(false)
  const [cacheNotice, setCacheNotice] = useState('')
  useEffect(() => () => request.current?.abort(), [])
  const review = useMemo(() => {
    if (!form || !rows.length) return undefined
    try {
      return buildDraftReview(form, mapping, rows, name, duplicateColumn)
    } catch {
      return undefined
    }
  }, [form, mapping, rows, name, duplicateColumn])
  const install = (value: ReviewForm) => {
    setForm(value)
    setMapping(
      Object.fromEntries(
        value.fields.map((field) => [
          field.id,
          columns.find((column) => column.toLowerCase() === field.label.toLowerCase()) ?? '',
        ]),
      ),
    )
    setSelected([])
    setPage(0)
    setError('')
  }
  const load = async (schema: boolean) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      if (!/^[1-9]\d*$/.test(sourceId)) throw new Error('Enter an existing positive numeric form or schema ID.')
      const data = await portalRead(
        schema ? 'rest/portal/getSchemaFields.php' : 'rest/portal/getForm.php',
        schema ? { schemaId: sourceId } : { id: sourceId },
        controller.signal,
      )
      if (!controller.signal.aborted) install({ ...parseReviewForm(data), id: sourceId })
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  const pages = Math.max(1, Math.ceil((review?.drafts.length ?? 0) / 25)),
    current = Math.min(page, pages - 1)
  const reviewedPlanValid =
    !!review &&
    reviewedPlan?.review === review &&
    reviewedPlan.selected === selected &&
    reviewedPlan.nameColumn === nameColumn
  const upload = async () => {
    if (!write || !canWrite || !review || !acknowledged || !reviewedPlanValid || nativeResults.length) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      setNativeResults(
        await uploadSelectedNativeDrafts(review, selected, write, {
          nameColumn,
          signal: controller.signal,
          onProgress: setNativeResults,
        }),
      )
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoading(false)
      setAcknowledged(false)
    }
  }
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">Match fields and prepare a local draft review</h3>
      <p className="text-sm text-muted-foreground">
        Match source CSV or spatial attributes to an existing form/schema, preserve all original columns, review
        validation and duplicate identifiers, then choose records. Save mapped drafts and presets in this browser or
        download a review. Local saves keep the originals and do not allocate source submission IDs or publish records.
      </p>
      {!suppliedRows && (
        <label className="block text-sm">
          Source CSV (20 MiB, up to 10,000 review rows)
          <input
            aria-label="Draft review CSV"
            type="file"
            accept=".csv"
            className="mt-1 block max-w-full"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              try {
                if (file.size > 20 * 1024 * 1024) throw new Error('CSV exceeds 20 MiB.')
                const table = checkedCsv(await file.text())
                if (table.records.length > 10_000) throw new Error('Review at most 10,000 CSV rows.')
                setCsv({ name: file.name, rows: table.records, file })
                setForm(undefined)
                setSelected([])
                setPage(0)
                setError('')
              } catch (reason) {
                setError(errorText(reason))
              }
            }}
          />
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {name} · {rows.length.toLocaleString('en-CA')} records · {columns.length} original columns
        {geometry
          ? ' · geometry retained in the artifact; source CRS/display conversion remains with the GIS import'
          : ''}
      </p>
      {!!localSchemas.records.length && (
        <label className="block text-sm">
          Cached local schema
          <NativeSelect
            aria-label="Draft cached schema"
            defaultValue=""
            className="ml-2 max-w-full rounded border bg-background p-2"
            onChange={(event) => {
              const saved = localSchemas.records.find((item) => item.id === event.target.value)
              if (!saved) return
              try {
                install(parseReviewForm(saved.data))
                setCacheNotice(`Using cached schema ${saved.name}.`)
              } catch (reason) {
                setError(errorText(reason))
              }
            }}
          >
            <option value="">Choose a cached field definition</option>
            {localSchemas.records.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Existing form/schema ID{' '}
          <input
            aria-label="Draft target form or schema ID"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            inputMode="numeric"
            className="w-24 rounded border bg-background p-2"
          />
        </label>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(false)}>
          Read source form fields
        </Button>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(true)}>
          Read source schema fields
        </Button>
      </div>
      <label className="block text-sm">
        Or import a source form/schema JSON export
        <input
          aria-label="Draft target schema JSON"
          type="file"
          accept=".json"
          className="mt-1 block max-w-full"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              install(parseReviewForm(await checkedReviewJson(file)))
            } catch (reason) {
              setError(errorText(reason))
            }
          }}
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        disabled={!columns.length}
        onClick={() =>
          install(
            parseReviewForm({
              title: 'Local source-column review',
              fields: columns.map((column) => ({ id: `local:${column}`, label: column, type: 'text' })),
            }),
          )
        }
      >
        Use source columns as a local review form
      </Button>
      {loading && <InlineAlert loading>Reading existing field definitions…</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {(localSchemas.error || localPresets.error) && (
        <InlineAlert tone="warning">{localSchemas.error || localPresets.error}</InlineAlert>
      )}
      {cacheNotice && <InlineAlert tone="success">{cacheNotice}</InlineAlert>}
      {form && (
        <>
          <h4 className="font-medium">
            {form.title} · {form.fields.length} fields
          </h4>
          <p className="text-xs text-muted-foreground">
            Only declared required/type rules are checked. Native form exports do not establish every publishing rule,
            join, unit/time-zone, CRS or uniqueness constraint. Values remain in their original type and precision.
          </p>
          <div className="max-h-80 space-y-2 overflow-auto">
            {form.fields.map((field) => (
              <label key={field.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {field.label}{' '}
                  <span className="text-xs text-muted-foreground">
                    ({field.id}, {field.type}
                    {field.required ? ', required' : ''})
                  </span>
                </span>
                <NativeSelect
                  aria-label={`Match ${field.label}`}
                  value={mapping[field.id] ?? ''}
                  className="max-w-full rounded border bg-background p-2"
                  onChange={(event) => {
                    setMapping((old) => ({ ...old, [field.id]: event.target.value }))
                    setSelected([])
                  }}
                >
                  <option value="">Not mapped</option>
                  {columns.map((column) => (
                    <option key={column}>{column}</option>
                  ))}
                </NativeSelect>
              </label>
            ))}
          </div>
          <label className="block text-sm">
            Duplicate source identifier column{' '}
            <NativeSelect
              aria-label="Draft duplicate identifier"
              value={duplicateColumn}
              onChange={(event) => {
                setDuplicateColumn(event.target.value)
                setSelected([])
              }}
              className="ml-2 max-w-full rounded border bg-background p-2"
            >
              <option value="">No duplicate check</option>
              {columns.map((column) => (
                <option key={column}>{column}</option>
              ))}
            </NativeSelect>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={cacheBusy}
              onClick={async () => {
                setCacheBusy(true)
                setError('')
                setCacheNotice('')
                try {
                  await saveLocalWorkbench({
                    kind: 'match-preset',
                    name: `${form.title} — ${name}`.slice(0, 200),
                    data: {
                      schema: 'nechako-field-match-v1',
                      formId: form.id,
                      fieldIds: form.fields.map((field) => field.id),
                      mapping,
                      duplicateColumn,
                    },
                  })
                  setCacheNotice('Saved this field mapping in the browser cache.')
                } catch (reason) {
                  setError(errorText(reason))
                } finally {
                  setCacheBusy(false)
                }
              }}
            >
              Cache mapping preset
            </Button>
            {!!localPresets.records.length && (
              <label className="text-sm">
                Cached mapping
                <NativeSelect
                  aria-label="Draft cached mapping preset"
                  defaultValue=""
                  className="ml-2 max-w-full rounded border bg-background p-2"
                  onChange={(event) => {
                    const saved = localPresets.records.find((item) => item.id === event.target.value)
                    if (!saved) return
                    const value = saved.data as {
                      schema?: string
                      formId?: string
                      fieldIds?: string[]
                      mapping?: Record<string, string>
                      duplicateColumn?: string
                    }
                    if (
                      value.schema !== 'nechako-field-match-v1' ||
                      value.formId !== form.id ||
                      value.fieldIds?.join('|') !== form.fields.map((field) => field.id).join('|') ||
                      !value.mapping ||
                      Object.values(value.mapping).some((column) => column && !columns.includes(column))
                    ) {
                      setError('Cached mapping target IDs or source columns do not match this review.')
                      return
                    }
                    setMapping(value.mapping)
                    setDuplicateColumn(value.duplicateColumn ?? '')
                    setSelected([])
                    setError('')
                    setCacheNotice(`Loaded ${saved.name}.`)
                  }}
                >
                  <option value="">Choose a saved mapping</option>
                  {localPresets.records.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  JSON.stringify(
                    {
                      schema: 'nechako-field-match-v1',
                      formId: form.id,
                      fieldIds: form.fields.map((field) => field.id),
                      mapping,
                      duplicateColumn,
                    },
                    null,
                    2,
                  ),
                  'field-match-preset.json',
                  'application/json',
                )
              }
            >
              Export mapping preset
            </Button>
            <label className="text-sm">
              Import mapping preset{' '}
              <input
                aria-label="Draft mapping preset"
                type="file"
                accept=".json"
                className="block max-w-full"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  try {
                    const value = (await checkedReviewJson(file)) as {
                      schema?: string
                      formId?: string
                      fieldIds?: unknown[]
                      mapping?: Record<string, string>
                      duplicateColumn?: string
                    }
                    if (
                      value.schema !== 'nechako-field-match-v1' ||
                      value.formId !== form.id ||
                      !value.fieldIds ||
                      value.fieldIds.join('|') !== form.fields.map((field) => field.id).join('|') ||
                      !value.mapping ||
                      Object.values(value.mapping).some((column) => column && !columns.includes(column))
                    )
                      throw new Error('Preset field IDs/form or source columns do not match this review.')
                    setMapping(value.mapping)
                    setDuplicateColumn(value.duplicateColumn ?? '')
                    setSelected([])
                    setError('')
                  } catch (reason) {
                    setError(errorText(reason))
                  }
                }}
              />
            </label>
          </div>
        </>
      )}
      {review && (
        <>
          <p className="text-sm">
            {review.drafts.filter((draft) => draft.issues.length).length} records have review issues · {selected.length}{' '}
            selected · no records merged or uploaded
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelected(review.drafts.filter((draft) => !draft.issues.length).map((draft) => draft.localId))
              }
            >
              Select rows without issues
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
          {review.drafts.slice(current * 25, (current + 1) * 25).map((draft) => (
            <details key={draft.localId} className="rounded border p-3">
              <summary className="cursor-pointer text-sm">
                Row {draft.sourceRow} ·{' '}
                {draft.issues.length ? `${draft.issues.length} issues` : 'No declared-rule issues'}
              </summary>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!!draft.issues.length}
                  checked={selected.includes(draft.localId)}
                  onChange={(event) =>
                    setSelected((old) =>
                      event.target.checked ? [...old, draft.localId] : old.filter((id) => id !== draft.localId),
                    )
                  }
                />
                Select this local draft
              </label>
              {draft.issues.map((issue, index) => (
                <InlineAlert key={index} tone="warning">
                  {issue}
                </InlineAlert>
              ))}
              <KeyValueRows
                className="mt-2"
                variant="grid"
                rows={Object.entries(draft.values).map(([id, value]) => ({
                  label: form?.fields.find((field) => field.id === id)?.label ?? id,
                  value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                }))}
              />
            </details>
          ))}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!current} onClick={() => setPage(current - 1)}>
              Previous review rows
            </Button>
            <span className="text-sm">
              Page {current + 1} of {pages}
            </span>
            <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              Next review rows
            </Button>
          </div>
          <Button
            disabled={cacheBusy || !selected.length}
            onClick={async () => {
              setCacheBusy(true)
              setError('')
              setCacheNotice('')
              try {
                const records = mappedDraftRecords(review, selected, geometry)
                if (csv?.file && !suppliedRows) {
                  const original = await attachmentRecord(csv.file)
                  for (const record of records)
                    (record.data as { relationships: unknown[] }).relationships.push({
                      kind: 'attachment',
                      id: original.id,
                      role: 'original-source',
                    })
                  if (!(await listLocalWorkbench('attachment')).some((item) => item.id === original.id))
                    records.push(original)
                }
                await importLocalWorkbench(records)
                setCacheNotice(
                  `Saved ${selected.length} mapped local drafts with their original values${geometry ? ' and geometry' : ''}.`,
                )
                setSelected([])
              } catch (reason) {
                setError(errorText(reason))
              } finally {
                setCacheBusy(false)
              }
            }}
          >
            Save selected drafts to browser cache
          </Button>
          <Button
            size="sm"
            onClick={() =>
              downloadText(
                JSON.stringify(
                  {
                    ...review,
                    selectedLocalIds: selected,
                    ...(geometry
                      ? { spatialData: geometry, rowToFeature: 'sourceRow minus one indexes spatialData.features' }
                      : {}),
                  },
                  null,
                  2,
                ),
                'local-draft-review.json',
                'application/json',
              )
            }
          >
            Download local draft review with originals and issues
          </Button>
          {!geometry && (
            <div className="space-y-3 rounded border p-3">
              <h4 className="font-semibold">Create reviewed drafts in the original portal</h4>
              <p className="text-xs text-muted-foreground">
                Native CSV flow: recheck current dynamic field IDs → allocate each selected submission → save its mapped
                content as draft → optionally name it → read its actual state. Up to 50 rows per batch is this review's
                limit. No automatic retries or publication; a partial failure can leave an allocated source draft.
              </p>
              <label className="block text-sm">
                Native submission name column{' '}
                <NativeSelect
                  aria-label="Native draft name column"
                  value={nameColumn}
                  onChange={(event) => {
                    setNameColumn(event.target.value)
                    setReviewWrite(false)
                    setAcknowledged(false)
                  }}
                  className="ml-2 rounded border bg-background p-2"
                >
                  <option value="">Do not set a name</option>
                  {columns.map((column) => (
                    <option key={column}>{column}</option>
                  ))}
                </NativeSelect>
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !selected.length ||
                  selected.length > 50 ||
                  !!nativeResults.length ||
                  loading ||
                  !/^[1-9]\d*$/.test(form?.id ?? '')
                }
                onClick={() => {
                  setReviewedPlan({ review, selected, nameColumn })
                  setReviewWrite(true)
                  setAcknowledged(false)
                }}
              >
                Review {selected.length} selected native draft writes
              </Button>
              {reviewWrite && (
                <>
                  <p className="text-sm">
                    Target form {form?.id}; {selected.length} selected rows;{' '}
                    {Object.values(mapping).filter(Boolean).length} mapped fields. Source name column:{' '}
                    {nameColumn || 'none'}.
                  </p>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={loading}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    I reviewed these rows and authorize creating their drafts in the original portal.
                  </label>
                  {!canWrite && (
                    <InlineAlert>
                      Connect an authorized writable portal session before creating native drafts.
                    </InlineAlert>
                  )}
                  {!reviewedPlanValid && (
                    <InlineAlert tone="warning">
                      The selected rows or mapping changed. Review the native writes again before confirmation.
                    </InlineAlert>
                  )}
                  <Button
                    size="sm"
                    disabled={
                      !write || !canWrite || !acknowledged || !reviewedPlanValid || loading || !!nativeResults.length
                    }
                    onClick={() => void upload()}
                  >
                    Create selected native drafts
                  </Button>
                </>
              )}
              {!!nativeResults.length && (
                <>
                  {nativeResults.map((result) => (
                    <div key={result.localId} className="rounded border p-2 text-sm">
                      Source row {result.sourceRow} ·{' '}
                      {result.submissionId ? `Portal submission ${result.submissionId}` : 'Creation state unconfirmed'}{' '}
                      · {result.stage}
                      {result.sourceState ? ` · source state ${result.sourceState}` : ''}
                      {result.error && <InlineAlert tone="error">{result.error}</InlineAlert>}
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadText(
                        JSON.stringify(
                          { schema: 'nechako-native-draft-batch-result-v1', review, results: nativeResults },
                          null,
                          2,
                        ),
                        'native-draft-batch-results.json',
                        'application/json',
                      )
                    }
                  >
                    Download native draft IDs and operation results
                  </Button>
                  <ExternalLink href={NECHAKO_PORTAL}>
                    Open original portal to review allocated IDs, permissions, parent links and final publication
                  </ExternalLink>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
