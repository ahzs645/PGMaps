import { NativeSelect } from '@/components/ui/form-field'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { downloadBlob, downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'
import {
  getLocalWorkbench,
  importLocalWorkbench,
  deleteLocalWorkbench,
  type LocalWorkbenchRecord,
} from './data/localWorkbench'
import {
  blankLocalDraft,
  draftValueEditor,
  editedLocalDraft,
  localDraftData,
  localDraftGeometry,
  type DraftValueEditor,
  type LocalDraftData,
} from './data/localDrafts'
import type { VectorData } from './data/workspace'

export function PortalLocalDrafts({ onVectors }: { onVectors: (layers: VectorData[]) => void }) {
  const cache = useLocalWorkbenchRecords('submission')
  const attachments = useLocalWorkbenchRecords('attachment')
  const schemas = useLocalWorkbenchRecords('schema')
  const [schemaId, setSchemaId] = useState('')
  const [selected, setSelected] = useState<LocalWorkbenchRecord>()
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<LocalDraftData['status']>('draft')
  const [editors, setEditors] = useState<Record<string, DraftValueEditor>>({})
  const [geometry, setGeometry] = useState('null')
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const [newField, setNewField] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const records = useMemo(
    () =>
      cache.records.filter(
        (record) =>
          (record.data as { schema?: string })?.schema === 'nechako-local-submission-v1' &&
          record.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [cache.records, filter],
  )
  const pages = Math.max(1, Math.ceil(records.length / 25)),
    current = Math.min(page, pages - 1)
  const open = (record: LocalWorkbenchRecord) => {
    try {
      const data = localDraftData(record.data)
      setSelected(record)
      setTitle(record.name)
      setStatus(data.status)
      setEditors(Object.fromEntries(Object.entries(data.values).map(([key, value]) => [key, draftValueEditor(value)])))
      setGeometry(JSON.stringify(localDraftGeometry(data), null, 2))
      const reverse = attachments.records
        .filter((item) =>
          ((item.data as { relationships?: { id: string }[] })?.relationships ?? []).some(
            (relation) => relation.id === record.id,
          ),
        )
        .map((item) => item.id)
      setAttachmentIds([...new Set([...(data.attachmentIds ?? []), ...reverse])])
      setError('')
      setNotice('')
      setNewField('')
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const save = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const current = await getLocalWorkbench(selected.id)
      if (!current || current.updatedAt !== selected.updatedAt)
        throw new Error(
          'This draft changed or was removed in another view. Reopen the current cached version before saving.',
        )
      const next = editedLocalDraft(selected, { name: title, status, editors, geometryText: geometry, attachmentIds })
      await importLocalWorkbench([next], { overwrite: true })
      setSelected(next)
      setNotice('Saved local draft edits. Original values and files are retained; the portal was not changed.')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const preview = useMemo(() => {
    if (!selected) return undefined
    try {
      return editedLocalDraft(selected, { name: title, status, editors, geometryText: geometry, attachmentIds })
    } catch {
      return undefined
    }
  }, [selected, title, status, editors, geometry, attachmentIds])
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="local-drafts-title">
      <h3 id="local-drafts-title" className="font-semibold">
        Saved local submission drafts
      </h3>
      <p className="text-sm text-muted-foreground">
        Reopen imported CSV, GIS and GPAP drafts, edit their values and geometry, link cached attachments and track a
        local review status, or start a new draft from a cached schema. Original source values and the last 20 saved
        revisions remain attached. These statuses apply only to this browser; they do not publish or modify portal
        submissions.
      </p>
      {(error || cache.error || attachments.error || schemas.error) && (
        <InlineAlert tone="error">{error || cache.error || attachments.error || schemas.error}</InlineAlert>
      )}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      <div className="space-y-2 rounded border p-3">
        <label className="block text-sm">
          Cached schema for a new draft
          <NativeSelect
            aria-label="New local draft schema"
            className="mt-1 block w-full rounded border bg-background p-2"
            value={schemaId}
            onChange={(event) => setSchemaId(event.target.value)}
          >
            <option value="">Choose a cached schema</option>
            {schemas.records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="text-xs text-muted-foreground">
          New fields start as missing (null), with no geometry. Edit them below. Cache a schema in the Local workbench
          to use it here.
        </p>
        <Button
          size="sm"
          disabled={!schemaId || busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            setNotice('')
            try {
              const schema = await getLocalWorkbench(schemaId)
              if (!schema) throw new Error('This schema was removed. Choose another cached schema.')
              const record = blankLocalDraft(schema)
              await importLocalWorkbench([record])
              open(record)
              setNotice('Created a blank draft in this browser from the cached schema.')
            } catch (reason) {
              setError(errorText(reason))
            } finally {
              setBusy(false)
            }
          }}
        >
          Create local draft
        </Button>
      </div>
      <label className="block text-sm">
        Find a local draft
        <input
          aria-label="Find local draft"
          className="mt-1 block w-full rounded border bg-background p-2"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value)
            setPage(0)
          }}
        />
      </label>
      <p className="text-sm">{records.length} saved local drafts</p>
      {records.slice(current * 25, (current + 1) * 25).map((record) => (
        <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
          <span className="min-w-0 break-words text-sm">
            {record.name} · {String((record.data as { status?: string }).status)}
          </span>
          <Button size="sm" variant="outline" onClick={() => open(record)} disabled={busy}>
            Edit {record.name}
          </Button>
        </div>
      ))}
      {records.length > 25 && (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!current} onClick={() => setPage(current - 1)}>
            Previous local drafts
          </Button>
          <span className="text-sm">
            Page {current + 1} of {pages}
          </span>
          <Button size="sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            Next local drafts
          </Button>
        </div>
      )}
      {selected && (
        <div className="space-y-3 rounded border p-3" aria-label="Local draft editor">
          <label className="block text-sm">
            Local draft title
            <input
              aria-label="Local draft title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              className="mt-1 block w-full rounded border bg-background p-2"
            />
          </label>
          <label className="block text-sm">
            Local review status
            <NativeSelect
              aria-label="Local draft review status"
              value={status}
              onChange={(event) => setStatus(event.target.value as LocalDraftData['status'])}
              className="ml-2 rounded border bg-background p-2"
            >
              <option value="draft">Draft</option>
              <option value="reviewed">Reviewed locally</option>
              <option value="archived">Archived locally</option>
            </NativeSelect>
          </label>
          <div className="max-h-96 space-y-3 overflow-auto">
            {Object.entries(editors).map(([key, editor]) => (
              <div key={key} className="space-y-1 rounded border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`draft-field-${encodeURIComponent(key)}`} className="break-all text-sm">
                    {key}
                  </label>
                  <NativeSelect
                    aria-label={`Local draft type ${key}`}
                    value={editor.type}
                    onChange={(event) => {
                      const type = event.target.value as DraftValueEditor['type']
                      setEditors((old) => ({
                        ...old,
                        [key]: { type, text: type === 'boolean' ? 'false' : type === 'null' ? '' : old[key].text },
                      }))
                    }}
                    className="rounded border bg-background p-1 text-sm"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">True / false</option>
                    <option value="null">Missing (null)</option>
                    <option value="json">Structured JSON</option>
                  </NativeSelect>
                </div>
                {editor.type === 'boolean' ? (
                  <NativeSelect
                    id={`draft-field-${encodeURIComponent(key)}`}
                    aria-label={`Local draft value ${key}`}
                    value={editor.text}
                    onChange={(event) =>
                      setEditors((old) => ({ ...old, [key]: { ...old[key], text: event.target.value } }))
                    }
                    className="w-full rounded border bg-background p-2"
                  >
                    <option value="false">False</option>
                    <option value="true">True</option>
                  </NativeSelect>
                ) : (
                  editor.type !== 'null' && (
                    <textarea
                      id={`draft-field-${encodeURIComponent(key)}`}
                      aria-label={`Local draft value ${key}`}
                      value={editor.text}
                      onChange={(event) =>
                        setEditors((old) => ({ ...old, [key]: { ...old[key], text: event.target.value } }))
                      }
                      className={`block w-full rounded border bg-background p-2 text-base ${editor.type === 'json' ? 'min-h-24 font-mono' : 'min-h-10'}`}
                      rows={editor.type === 'json' ? 4 : 1}
                    />
                  )
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm">
              Additional local field
              <input
                aria-label="New local draft field"
                value={newField}
                onChange={(event) => setNewField(event.target.value)}
                className="mt-1 block w-full rounded border bg-background p-2"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!newField.trim()}
              onClick={() => {
                const key = `local:${newField.trim()}`
                if (Object.prototype.hasOwnProperty.call(editors, key)) {
                  setError('This local field already exists.')
                  return
                }
                setEditors((old) => ({ ...old, [key]: { type: 'text', text: '' } }))
                setNewField('')
              }}
            >
              Add local field
            </Button>
          </div>
          <details className="rounded border p-2">
            <summary className="cursor-pointer text-sm">Edit WGS84 geometry</summary>
            <p className="my-2 text-xs text-muted-foreground">
              Use a GeoJSON geometry object with longitude then latitude, or null for no geometry. The original source
              geometry remains preserved.
            </p>
            <textarea
              aria-label="Local draft geometry"
              value={geometry}
              onChange={(event) => setGeometry(event.target.value)}
              className="min-h-36 w-full rounded border bg-background p-2 font-mono text-sm"
            />
          </details>
          <details className="rounded border p-2">
            <summary className="cursor-pointer text-sm">Linked attachments ({attachmentIds.length})</summary>
            <div className="mt-2 max-h-64 space-y-2 overflow-auto">
              {attachments.records.map((item) => (
                <label key={item.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attachmentIds.includes(item.id)}
                    onChange={(event) =>
                      setAttachmentIds((old) =>
                        event.target.checked ? [...old, item.id] : old.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.name}
                </label>
              ))}
              {attachmentIds
                .filter((id) => !attachments.records.some((record) => record.id === id))
                .map((id) => (
                  <InlineAlert key={id} tone="warning">
                    Linked file {id} is not in this browser cache. Its reference remains retained.
                  </InlineAlert>
                ))}
            </div>
          </details>
          {!!preview?.data.localValidation?.length && (
            <InlineAlert tone="warning">
              Declared field issues: {preview.data.localValidation.join('; ')}. These issues remain recorded with the
              local draft.
            </InlineAlert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !preview} onClick={() => void save()}>
              Save local draft edits
            </Button>
            <Button
              variant="outline"
              disabled={!preview}
              onClick={() =>
                preview &&
                downloadText(JSON.stringify(preview, null, 2), 'local-submission-draft.json', 'application/json')
              }
            >
              Download local draft with originals
            </Button>
            <Button
              variant="outline"
              disabled={!preview?.data.geometry}
              onClick={() => {
                if (!preview?.data.geometry) return
                const sourceFeature = preview.data.sourceFeature
                onVectors([
                  {
                    id: crypto.randomUUID(),
                    name: preview.name,
                    data: {
                      type: 'FeatureCollection',
                      features: [
                        {
                          type: 'Feature',
                          ...(sourceFeature?.id === undefined ? {} : { id: sourceFeature.id }),
                          geometry: preview.data.geometry,
                          properties: { ...sourceFeature?.properties, localDraftValues: preview.data.values },
                        },
                      ],
                    },
                    color: '#0f766e',
                    visible: true,
                    original: preview.data,
                  },
                ])
              }}
            >
              Add edited draft geometry to map
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await deleteLocalWorkbench(selected.id)
                  setSelected(undefined)
                  setNotice('Removed this local draft. Its original source files and portal records remain unchanged.')
                } catch (reason) {
                  setError(errorText(reason))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Remove local draft
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Original values, source IDs and previous local saves</summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(selected.data, null, 2)}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              {(localDraftData(selected.data).relationships ?? [])
                .filter((relation) => relation.role === 'original-source')
                .map((relation) => attachments.records.find((record) => record.id === relation.id))
                .filter((record): record is LocalWorkbenchRecord => !!record?.blob)
                .map((record) => (
                  <Button
                    key={record.id}
                    size="sm"
                    variant="outline"
                    onClick={() => downloadBlob(record.blob!, record.filename ?? record.name)}
                  >
                    Download original {record.name}
                  </Button>
                ))}
            </div>
          </details>
        </div>
      )}
    </section>
  )
}
