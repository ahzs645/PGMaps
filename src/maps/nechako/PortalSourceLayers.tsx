import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { TabBar } from '@/components/ui/tab-bar'
import { errorText, NECHAKO_PORTAL, PORTAL_CONNECTION_EVENT, portalRead } from '@/lib/nechakoPortal'
import { PortalLayerQuery } from './PortalLayerQuery'
import {
  SOURCE_LAYER_CATALOGUES,
  checkedLocalLayer,
  downloadPublicSourceLayer,
  localLayerVector,
  materializeLayer,
  materializeWfs,
  parseLayerCatalogue,
  readGeojsonFile,
  readPublicLayerCatalogue,
  type LocalLayerAsset,
  type SourceLayerKind,
} from './data/localLayers'
import { checkedLocalWorkbenchRecord, importLocalWorkbench, listLocalWorkbench } from './data/localWorkbench'
import { localLayerCacheId as cacheId, saveLayerAsset } from './data/layerCache'
import { applyLocalDefaultStyle } from './data/styleLibrary'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'
import type { VectorData, Workspace } from './data/workspace'

type Picker = Exclude<SourceLayerKind, 'local'> | 'cached'
const OPTIONS = [
  { value: 'schema', label: 'Source schemas' },
  { value: 'submission', label: 'Submission layers' },
  { value: 'shared', label: 'Shared layers' },
  { value: 'cached', label: 'Cached layers' },
] as const
const inputClass = 'mt-1 w-full rounded border bg-background p-2 text-base'

export function PortalSourceLayers({
  workspace,
  onVectors,
  onOpenFiles,
  onOpenWorkbench,
}: {
  workspace: Workspace
  onVectors: (vectors: VectorData[]) => void
  onOpenFiles?: () => void
  onOpenWorkbench?: () => void
}) {
  const [picker, setPicker] = useState<Picker>('schema')
  const [catalogue, setCatalogue] = useState<LocalLayerAsset[]>([])
  const [selected, setSelected] = useState<LocalLayerAsset>()
  const [selectedCacheId, setSelectedCacheId] = useState<string>()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [access, setAccess] = useState<'public' | 'private' | 'unknown'>('unknown')
  const [catalogueAccess, setCatalogueAccess] = useState<'public' | 'unknown'>('unknown')
  const [wfsUrl, setWfsUrl] = useState('')
  const [wfsType, setWfsType] = useState('')
  const [wfsLimit, setWfsLimit] = useState(100000)
  const [progress, setProgress] = useState('')
  const [queryVectorId, setQueryVectorId] = useState('')
  const controller = useRef<AbortController>()
  const cached = useLocalWorkbenchRecords('layer')
  const cachedLayers = useMemo(
    () =>
      cached.records.flatMap((item) => {
        try {
          return [{ asset: checkedLocalLayer(item.data), id: item.id, access: item.source?.access }]
        } catch {
          return []
        }
      }),
    [cached.records],
  )
  const rows = useMemo(
    () =>
      (picker === 'cached' ? cachedLayers.map((item) => item.asset) : catalogue).filter((item) => {
        const original =
          item.original && typeof item.original === 'object' ? (item.original as Record<string, unknown>) : {}
        return [
          item.name,
          item.sourceId,
          item.schemaId,
          item.submissionId,
          original.submission_name,
          original.submission_title,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
      }),
    [picker, cachedLayers, catalogue, query],
  )
  const pages = Math.max(1, Math.ceil(rows.length / 25))
  const current = Math.min(page, pages - 1)
  const queryVector = workspace.vectors.find((vector) => vector.id === queryVectorId) ?? workspace.vectors[0]
  useEffect(() => {
    const clear = () => {
      controller.current?.abort()
      setBusy(false)
      setCatalogue([])
      setSelected(undefined)
      setSelectedCacheId(undefined)
      setMessage('')
      setError('')
      setProgress('')
    }
    window.addEventListener(PORTAL_CONNECTION_EVENT, clear)
    return () => {
      controller.current?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, clear)
    }
  }, [])
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setError('')
    setMessage('')
    setProgress('')
    try {
      await operation(current.signal)
    } catch (reason) {
      if (!current.signal.aborted) setError(errorText(reason))
    } finally {
      if (controller.current === current) setBusy(false)
    }
  }
  const save = async (asset: LocalLayerAsset, id?: string, blob?: Blob, filename?: string, nextAccess = access) => {
    const record = await saveLayerAsset({ asset, id, blob, filename, access: nextAccess })
    const saved = checkedLocalLayer(record.data)
    setSelected(saved)
    setSelectedCacheId(record.id)
    setAccess(record.source?.access ?? 'unknown')
    setMessage(
      `Saved ${saved.name} on this browser. ${saved.data ? `${saved.data.features.length.toLocaleString()} features stored.` : 'Catalogue reference only; import or download features to use offline.'}`,
    )
  }
  const select = (asset: LocalLayerAsset) => {
    const entry = cachedLayers.find(
      (item) => item.asset === asset || (asset.kind !== 'local' && item.id === cacheId(asset)),
    )
    setSelected(entry?.asset ?? asset)
    setSelectedCacheId(entry?.id)
    setMessage('')
    setError('')
    setAccess(entry?.access ?? (picker === 'cached' ? 'unknown' : catalogueAccess))
  }
  return (
    <div className="min-w-0 space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Source layers and local queries</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose source schemas, submission layers or shared layers by their original IDs. Save actual feature geometry
          to work locally; a catalogue entry or WMS image alone does not contain the features.
        </p>
      </div>
      <TabBar
        label="Source layer catalogue"
        value={picker}
        options={OPTIONS}
        onChange={(value) => {
          controller.current?.abort()
          setBusy(false)
          setPicker(value)
          setCatalogue([])
          setSelected(undefined)
          setSelectedCacheId(undefined)
          setPage(0)
          setError('')
          setMessage('')
          setProgress('')
          setQuery('')
        }}
      />
      {picker !== 'cached' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                const items = await readPublicLayerCatalogue(picker, signal)
                if (signal.aborted) return
                setCatalogue(items)
                setCatalogueAccess('public')
                setPage(0)
                setMessage(`${items.length} public ${picker} entries loaded.`)
              })
            }
          >
            Load public catalogue
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async (signal) => {
                const items = parseLayerCatalogue(
                  await portalRead(SOURCE_LAYER_CATALOGUES[picker], undefined, signal),
                  picker,
                )
                if (signal.aborted) return
                setCatalogue(items)
                setCatalogueAccess('unknown')
                setPage(0)
                setMessage(`${items.length} entries loaded through the selected portal connection.`)
              })
            }
          >
            Use selected portal connection
          </Button>
          <label className="cursor-pointer rounded border px-3 py-2 text-sm">
            Import catalogue JSON
            <input
              aria-label="Import source layer catalogue"
              type="file"
              accept=".json"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void run(async (signal) => {
                  if (file.size > 16 * 1024 * 1024) throw new Error('Choose a catalogue smaller than 16 MiB.')
                  const items = parseLayerCatalogue(JSON.parse(await file.text()), picker)
                  if (signal.aborted) return
                  setCatalogue(items)
                  setCatalogueAccess('unknown')
                  setPage(0)
                  setMessage(`${items.length} entries imported. Original IDs are retained.`)
                })
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={busy || !catalogue.length}
            onClick={() =>
              void run(async () => {
                const existing = new Set((await listLocalWorkbench('layer')).map((item) => item.id))
                const now = new Date().toISOString()
                const records = catalogue
                  .filter((asset) => !existing.has(cacheId(asset)!))
                  .map((asset) =>
                    checkedLocalWorkbenchRecord({
                      id: cacheId(asset)!,
                      kind: 'layer',
                      name: asset.name,
                      data: asset,
                      bytes: 0,
                      createdAt: now,
                      updatedAt: now,
                      source: { portal: NECHAKO_PORTAL, recordId: asset.sourceId, access: catalogueAccess },
                    }),
                  )
                if (records.length) await importLocalWorkbench(records)
                setMessage(`${records.length} new catalogue references saved. Existing cached features were retained.`)
              })
            }
          >
            Cache catalogue references
          </Button>
        </div>
      )}
      <label className="block text-sm">
        Find a layer
        <input
          aria-label="Find source layer"
          className={inputClass}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(0)
          }}
          placeholder="Name, schema ID, submission ID or layer ID"
        />
      </label>
      {cached.error && <InlineAlert tone="error">{cached.error}</InlineAlert>}
      {picker === 'cached' && cached.records.length > cachedLayers.length && (
        <InlineAlert>
          Some saved layer records use an older or invalid format. Inspect or export them in Local workbench.
        </InlineAlert>
      )}
      <p className="text-xs text-muted-foreground">
        {rows.length} matching entries · {picker === 'cached' ? 'Saved on this browser' : 'Source catalogue'}
      </p>
      <ul className="max-h-80 space-y-2 overflow-auto" aria-label="Source layer results">
        {rows.slice(current * 25, (current + 1) * 25).map((asset, index) => (
          <li key={`${asset.kind}:${asset.sourceId ?? index}:${asset.name}`}>
            <button
              type="button"
              className={`w-full rounded border p-3 text-left hover:bg-muted ${selected === asset ? 'border-primary bg-primary/5' : ''}`}
              onClick={() => select(asset)}
            >
              <span className="block break-words font-medium">{asset.name}</span>
              <span className="block text-xs text-muted-foreground">
                {asset.kind}
                {asset.sourceId && ` · source ${asset.sourceId}`}
                {asset.schemaId && ` · schema ${asset.schemaId}`}
                {asset.submissionId && ` · submission ${asset.submissionId}`} ·{' '}
                {asset.data ? `${asset.data.features.length.toLocaleString()} cached features` : 'reference only'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!rows.length && (
        <p className="text-sm text-muted-foreground">
          {picker === 'cached'
            ? 'Save or import layers to reopen them here.'
            : 'Load a source catalogue or import an authorized catalogue export. Source permissions determine which entries are available.'}
        </p>
      )}
      {pages > 1 && (
        <PaginationControls page={current} pageCount={pages} onPageChange={setPage} label="Source layer pages" />
      )}
      {selected && (
        <section className="min-w-0 space-y-3 rounded border p-3" aria-label="Selected source layer">
          <h3 className="break-words font-semibold">{selected.name}</h3>
          <p className="text-sm">
            {selected.materialization.status === 'descriptor'
              ? 'Catalogue reference'
              : `${selected.materialization.status === 'partial' ? 'Partial dataset' : 'Materialized features'}: ${selected.data?.features.length.toLocaleString()}${selected.materialization.expectedFeatures === undefined ? '' : ` / ${selected.materialization.expectedFeatures.toLocaleString()}`} features`}
            {selected.materialization.countVerified ? ' · source count verified' : ''}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {selected.materialization.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !selected.data}
              onClick={() =>
                void run(async () => {
                  const vector = localLayerVector(selected)
                  try {
                    onVectors([await applyLocalDefaultStyle(vector, selected.schemaId)])
                  } catch (reason) {
                    onVectors([vector])
                    setMessage(`Layer added. Its default style was unavailable: ${errorText(reason)}`)
                  }
                })
              }
            >
              Add cached features to map
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(async () => save(selected, selectedCacheId))}
            >
              Save selected layer locally
            </Button>
            {selected.kind !== 'local' && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    const result = await downloadPublicSourceLayer(selected, signal)
                    if (signal.aborted) return
                    setSelected(result.asset)
                    await save(result.asset, selectedCacheId, result.blob, `${selected.name}.source-export`, 'public')
                  })
                }
              >
                Try public source export
              </Button>
            )}
            <label className="cursor-pointer rounded border px-3 py-2 text-sm">
              Attach exported GeoJSON
              <input
                aria-label="Materialize selected source layer"
                type="file"
                accept=".json,.geojson,.zip"
                className="sr-only"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void run(async (signal) => {
                    const asset = materializeLayer(selected, await readGeojsonFile(file))
                    if (signal.aborted) return
                    setSelected(asset)
                    await save(asset, selectedCacheId, file, file.name, 'unknown')
                  })
                }}
              />
            </label>
          </div>
        </section>
      )}
      <details className="space-y-3 rounded border p-3">
        <summary className="cursor-pointer font-semibold">Download a complete WFS feature layer</summary>
        <p className="text-xs text-muted-foreground">
          The source must support public CORS, WFS 2.0 JSON, paging and an advertised feature count. This stores the
          feature data for local use. A failed or capped download is never labelled complete.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            WFS service URL
            <input
              aria-label="WFS service URL"
              className={inputClass}
              type="url"
              placeholder="https://example.org/geoserver/wfs"
              value={wfsUrl}
              onChange={(event) => setWfsUrl(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Feature type
            <input
              aria-label="WFS feature type"
              className={inputClass}
              placeholder="workspace:layer"
              value={wfsType}
              onChange={(event) => setWfsType(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Maximum features
            <input
              aria-label="WFS feature limit"
              className={inputClass}
              type="number"
              min={1}
              max={100000}
              value={wfsLimit}
              onChange={(event) => setWfsLimit(Number(event.target.value))}
            />
          </label>
        </div>
        <Button
          disabled={busy || !wfsUrl || !wfsType}
          onClick={() =>
            void run(async (signal) => {
              const asset = await materializeWfs({
                url: wfsUrl,
                typeName: wfsType,
                maxFeatures: wfsLimit,
                signal,
                onProgress: (loaded, total) => {
                  if (!signal.aborted)
                    setProgress(`${loaded.toLocaleString()} / ${total.toLocaleString()} WFS features`)
                },
              })
              if (signal.aborted) return
              setSelected(asset)
              setSelectedCacheId(undefined)
              setAccess('public')
              setMessage('WFS features are ready. Review the count and save the selected layer locally.')
            })
          }
        >
          Download WFS features
        </Button>
      </details>
      {busy && (
        <Button
          variant="outline"
          onClick={() => {
            controller.current?.abort()
            setBusy(false)
            setProgress('')
            setMessage('Operation cancelled. Previously saved layers remain available.')
          }}
        >
          Cancel layer operation
        </Button>
      )}
      {progress && (
        <p role="status" className="text-sm">
          {progress}
        </p>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {message && <InlineAlert>{message}</InlineAlert>}
      {!!workspace.vectors.length && (
        <section className="space-y-3">
          <label className="block text-sm font-medium">
            Map layer to query
            <NativeSelect
              aria-label="Map layer to query"
              className={inputClass}
              value={queryVector?.id ?? ''}
              onChange={(event) => setQueryVectorId(event.target.value)}
            >
              {workspace.vectors.map((vector) => (
                <option key={vector.id} value={vector.id}>
                  {vector.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          {queryVector && <PortalLayerQuery key={queryVector.id} vector={queryVector} onAdd={onVectors} />}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {onOpenFiles && (
          <Button variant="outline" onClick={onOpenFiles}>
            Import GIS files and match a schema
          </Button>
        )}
        {onOpenWorkbench && (
          <Button variant="outline" onClick={onOpenWorkbench}>
            Open local workbench and packages
          </Button>
        )}
      </div>
    </div>
  )
}
