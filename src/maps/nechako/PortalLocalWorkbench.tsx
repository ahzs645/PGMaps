import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InlineAlert, KeyValueRows, SearchInput } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { StatGroup } from '@/components/ui/stat-group'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadBlob, downloadText } from '@/lib/download'
import { formatBytes, formatDate } from '@/lib/format'
import {
  clearLocalWorkbench,
  deleteLocalWorkbench,
  importLocalWorkbench,
  localWorkbenchStorage,
  persistLocalWorkbenchStorage,
  saveLocalWorkbench,
  type LocalWorkbenchRecord,
} from './data/localWorkbench'
import {
  createLocalWorkbenchBundle,
  readLocalWorkbenchBundle,
  type LocalBundlePreview,
} from './data/localWorkbenchBundle'
import {
  checkLocalWorkbenchSchema,
  createLocalWorkbenchProject,
  LOCAL_SCHEMA_TEMPLATE,
  openLocalWorkbenchProject,
} from './data/localWorkbenchProjects'
import { useLocalWorkbenchRecords } from './data/useLocalWorkbench'
import type { Workspace } from './data/workspace'
import type { GisExportFormat } from './data/conversion'

type View = 'projects' | 'library' | 'backups' | 'schemas' | 'storage'
const tabs: { value: View; label: string }[] = [
  { value: 'projects', label: 'Projects' },
  { value: 'library', label: 'Saved items' },
  { value: 'backups', label: 'Backups' },
  { value: 'schemas', label: 'Schemas' },
  { value: 'storage', label: 'Storage' },
]
const inputClass = 'mt-1 w-full rounded border bg-background p-2 text-base'
const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
const filename = (name: string) => name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^\.+/, '') || 'local-item'

export function PortalLocalWorkbench({
  workspace,
  onWorkspace,
}: {
  workspace: Workspace
  onWorkspace: (workspace: Workspace) => void
}) {
  const cache = useLocalWorkbenchRecords()
  const [view, setView] = useState<View>('projects')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [progress, setProgress] = useState('')
  const [projectId, setProjectId] = useState('')
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(0)
  const [removeId, setRemoveId] = useState('')
  const [showJson, setShowJson] = useState(false)
  const [preview, setPreview] = useState<LocalBundlePreview>()
  const [overwrite, setOverwrite] = useState(false)
  const [includeMap, setIncludeMap] = useState(true)
  const [restoreMap, setRestoreMap] = useState(true)
  const [gisFormat, setGisFormat] = useState<GisExportFormat>('gpkg')
  const [gisScope, setGisScope] = useState<'workspace' | 'all'>('workspace')
  const [schemaId, setSchemaId] = useState('')
  const [schemaName, setSchemaName] = useState(LOCAL_SCHEMA_TEMPLATE.name)
  const [schemaText, setSchemaText] = useState(JSON.stringify(LOCAL_SCHEMA_TEMPLATE, null, 2))
  const [clearText, setClearText] = useState('')
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof localWorkbenchStorage>>>({})
  const projects = cache.records.filter((record) => record.kind === 'project')
  const schemas = cache.records.filter((record) => record.kind === 'schema')
  const selected = cache.records.find((record) => record.id === selectedId)
  const filtered = useMemo(
    () =>
      cache.records.filter(
        (record) =>
          (!kind || record.kind === kind) &&
          `${record.name} ${record.id} ${record.kind} ${record.filename ?? ''}`
            .toLocaleLowerCase('en-CA')
            .includes(query.toLocaleLowerCase('en-CA')),
      ),
    [cache.records, kind, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(page, pageCount - 1)
  const totalBytes = cache.records.reduce((sum, record) => sum + record.bytes, 0)
  const privateCount = cache.records.filter((record) => record.source?.access === 'private').length
  const conflicts =
    preview?.records.filter((record) => cache.records.some((existing) => existing.id === record.id)) ?? []
  const schemaCheck = useMemo(() => {
    try {
      return { form: checkLocalWorkbenchSchema(JSON.parse(schemaText)) }
    } catch (reason) {
      return { error: message(reason) }
    }
  }, [schemaText])
  useEffect(() => {
    let active = true
    void localWorkbenchStorage().then((value) => {
      if (active) setStorage(value)
    })
    return () => {
      active = false
    }
  }, [cache.records])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    setProgress('')
    try {
      await operation()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }
  const editSchema = (record?: LocalWorkbenchRecord) => {
    setSchemaId(record?.id ?? '')
    setSchemaName(record?.name ?? LOCAL_SCHEMA_TEMPLATE.name)
    setSchemaText(JSON.stringify(record?.data ?? LOCAL_SCHEMA_TEMPLATE, null, 2))
    setView('schemas')
  }
  const downloadRecord = (record: LocalWorkbenchRecord) => {
    const metadata = { ...record, blob: undefined }
    downloadText(JSON.stringify(metadata, null, 2), `${filename(record.name)}.json`, 'application/json')
  }
  return (
    <div className="min-w-0 space-y-4" data-nechako-local-workbench>
      <p className="text-sm text-muted-foreground">
        Save projects, data, styles and original files on this browser. Saves survive page reloads on this device. Use a
        backup ZIP to move them to another browser or keep a separate copy.
      </p>
      <InlineAlert title="Device-local work">
        Only items you explicitly save are stored. Private imports stay on this device after source logout until you
        delete them. Browser storage can be cleared by browser settings; keep an exported backup.
      </InlineAlert>
      <StatGroup
        variant="tiles"
        size="sm"
        columns={3}
        items={[
          { label: 'Saved items', value: cache.records.length },
          { label: 'Saved payloads', value: formatBytes(totalBytes) },
          { label: 'Private items', value: privateCount },
        ]}
      />
      {cache.error && (
        <InlineAlert tone="error" title="Local storage unavailable">
          {cache.error}{' '}
          <Button size="sm" variant="outline" onClick={cache.reload}>
            Retry storage
          </Button>
        </InlineAlert>
      )}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {notice && <InlineAlert title="Local workbench updated">{notice}</InlineAlert>}
      {busy && <InlineAlert loading>{progress || 'Preparing local work…'}</InlineAlert>}
      <TabBar value={view} options={tabs} onChange={setView} label="Local workbench views" idPrefix="local-workbench" />
      {view === 'projects' && (
        <section role="tabpanel" id="local-workbench-panel-projects" className="space-y-4">
          <h3 className="font-semibold">Named projects on this device</h3>
          <p className="text-sm text-muted-foreground">
            A project preserves the map, loaded vector features, styles and up to 20 previous saves. WMS and tile layers
            keep their service URLs; their imagery still needs the remote service.
          </p>
          <label className="block text-sm">
            Local project
            <NativeSelect
              aria-label="Local project"
              className={inputClass}
              value={projectId}
              disabled={busy}
              onChange={(event) => {
                setProjectId(event.target.value)
                setName(projects.find((record) => record.id === event.target.value)?.name ?? '')
              }}
            >
              <option value="">New local project</option>
              {projects.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block text-sm">
            Project name
            <input
              aria-label="Local project name"
              className={inputClass}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {workspace.sessionBound && (
            <InlineAlert tone="warning">
              The current map includes source content loaded under a login. Saving creates an explicitly retained
              private copy on this device.
            </InlineAlert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || cache.loading || !name.trim()}
              onClick={() =>
                void run(async () => {
                  const previous = projects.find((record) => record.id === projectId)
                  const record = await saveLocalWorkbench({
                    id: projectId || undefined,
                    kind: 'project',
                    name,
                    data: createLocalWorkbenchProject(workspace, previous),
                    source: {
                      ...previous?.source,
                      access:
                        workspace.sessionBound || previous?.source?.access === 'private'
                          ? 'private'
                          : (previous?.source?.access ?? 'unknown'),
                    },
                  })
                  setProjectId(record.id)
                  setNotice(`Saved “${record.name}” on this device.`)
                })
              }
            >
              Save current map locally
            </Button>
            <Button
              variant="outline"
              disabled={busy || !projectId}
              onClick={() =>
                void run(async () => {
                  const record = projects.find((item) => item.id === projectId)
                  if (record) {
                    onWorkspace(openLocalWorkbenchProject(record))
                    setNotice(`Opened “${record.name}” from this device.`)
                  }
                })
              }
            >
              Open local project
            </Button>
            <Button variant="outline" onClick={() => setView('backups')}>
              Export portable project ZIP
            </Button>
          </div>
          {projectId && (
            <ProjectHistory record={projects.find((record) => record.id === projectId)} onWorkspace={onWorkspace} />
          )}
          <p className="text-xs text-muted-foreground">
            Native SMASH/Geopaparazzi originals remain available in Saved items. Backups also offers actual GIS files
            and a new native SMASH point-note project with companion map layers.
          </p>
        </section>
      )}
      {view === 'library' && (
        <section role="tabpanel" id="local-workbench-panel-library" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">
              Find saved items
              <SearchInput
                aria-label="Find saved items"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
                onClear={() => {
                  setQuery('')
                  setPage(0)
                }}
                data-map-search-input="false"
              />
            </label>
            <label className="text-sm">
              Item kind
              <NativeSelect
                className={inputClass}
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value)
                  setPage(0)
                }}
              >
                <option value="">All kinds</option>
                {[...new Set(cache.records.map((record) => record.kind))].sort().map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </NativeSelect>
            </label>
          </div>
          <p className="text-sm" role="status">
            {filtered.length} matching saved items · {Math.min(25, Math.max(0, filtered.length - currentPage * 25))} on
            this page
          </p>
          {cache.loading && <InlineAlert loading>Reading saved items…</InlineAlert>}
          {!cache.loading && !filtered.length && (
            <InlineAlert>
              No saved items match. Save a project or import files, layers, styles or a backup to populate this library.
            </InlineAlert>
          )}
          <div className="space-y-2" aria-label="Saved local items">
            {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((record) => (
              <button
                key={record.id}
                className="flex w-full items-start justify-between gap-3 rounded border p-3 text-left hover:bg-muted/40"
                aria-pressed={record.id === selectedId}
                onClick={() => {
                  setSelectedId(record.id)
                  setRemoveId('')
                  setShowJson(false)
                }}
              >
                <span className="min-w-0">
                  <strong className="block break-words text-sm">{record.name}</strong>
                  <span className="text-xs text-muted-foreground">
                    {record.kind} · {formatDate(record.updatedAt)} ·{' '}
                    {record.blob ? 'original file retained' : 'saved data'}
                  </span>
                </span>
                <span className="shrink-0 text-xs">
                  {formatBytes(record.bytes)}
                  {record.source?.access === 'private' && (
                    <Badge tone="warning" className="mt-1 block">
                      Private copy
                    </Badge>
                  )}
                </span>
              </button>
            ))}
          </div>
          {pageCount > 1 && (
            <PaginationControls
              page={currentPage}
              pageCount={pageCount}
              onPageChange={setPage}
              label="Saved item pages"
            />
          )}
          {selected && (
            <section className="space-y-3 rounded border p-3" aria-label="Selected local item">
              <h3 className="font-semibold break-words">{selected.name}</h3>
              <KeyValueRows
                size="sm"
                variant="divided"
                rows={[
                  { label: 'Kind', value: selected.kind },
                  { label: 'Local ID', value: selected.id },
                  { label: 'Source record ID', value: selected.source?.recordId },
                  { label: 'Original filename', value: selected.filename },
                  {
                    label: 'Original bytes',
                    value: selected.blob ? formatBytes(selected.blob.size) : 'No original file',
                  },
                  { label: 'Source access', value: selected.source?.access ?? 'Unknown' },
                  { label: 'Source notes', value: selected.source?.notes },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadRecord(selected)}>
                  Download item JSON
                </Button>
                {selected.blob && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadBlob(selected.blob!, selected.filename ?? `${filename(selected.name)}.bin`)}
                  >
                    Download original file
                  </Button>
                )}
                {selected.kind === 'schema' && (
                  <Button size="sm" variant="outline" onClick={() => editSchema(selected)}>
                    Edit local schema
                  </Button>
                )}
                {selected.kind === 'project' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(async () => {
                        onWorkspace(openLocalWorkbenchProject(selected))
                        setNotice(`Opened “${selected.name}”.`)
                      })
                    }
                  >
                    Open saved map
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoveId(selected.id)}>
                  Remove local item
                </Button>
              </div>
              {removeId === selected.id && (
                <InlineAlert tone="warning" title="Remove this saved item?">
                  Other saved records may still reference it. Export a backup if you need to retain this copy.
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          if (selected.kind === 'style') {
                            const { deleteLocalStyle } = await import('./data/styleLibrary')
                            await deleteLocalStyle(selected.id)
                          } else await deleteLocalWorkbench(selected.id)
                          setSelectedId('')
                          setRemoveId('')
                          setNotice('Removed the selected item from this device.')
                        })
                      }
                    >
                      Confirm remove item
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRemoveId('')}>
                      Keep item
                    </Button>
                  </div>
                </InlineAlert>
              )}
              <details onToggle={(event) => setShowJson(event.currentTarget.open)}>
                <summary className="cursor-pointer text-sm">Inspect saved data</summary>
                {showJson && (
                  <>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
                      {JSON.stringify(selected.data, null, 2).slice(0, 20000)}
                    </pre>
                    <p className="text-xs text-muted-foreground">
                      Preview shows up to 20,000 characters. Download item JSON for the complete record.
                    </p>
                  </>
                )}
              </details>
            </section>
          )}
        </section>
      )}
      {view === 'backups' && (
        <section role="tabpanel" id="local-workbench-panel-backups" className="space-y-4">
          <h3 className="font-semibold">Portable project backup</h3>
          <p className="text-sm text-muted-foreground">
            The ZIP includes all {cache.records.length} saved items, original attachments and GPAP files, relationships,
            monitoring rows, styles and materialized GeoJSON. Every file has a SHA-256 checksum. Remote WMS and tile
            URLs remain remote.
          </p>
          {(privateCount > 0 || workspace.sessionBound) && (
            <InlineAlert tone="warning">
              This backup includes explicitly saved private content. Anyone with the downloaded file can read that copy.
            </InlineAlert>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeMap} onChange={(event) => setIncludeMap(event.target.checked)} />
            Include the current map workspace and loaded vector features
          </label>
          <Button
            disabled={busy || cache.loading}
            onClick={() =>
              void run(async () => {
                const bundle = await createLocalWorkbenchBundle({
                  name: name || 'Nechako workbench backup',
                  records: cache.records,
                  workspace: includeMap ? workspace : undefined,
                  onProgress: setProgress,
                })
                downloadBlob(bundle.blob, 'nechako-workbench.zip')
                setNotice(
                  `Downloaded ${bundle.manifest.completeness.recordCount} saved items and ${bundle.manifest.completeness.materializedLayerCount} GeoJSON layers. ${bundle.manifest.remoteResources.length} resource references still require their source service.`,
                )
              })
            }
          >
            Download workbench ZIP
          </Button>
          <div className="space-y-3 rounded border p-3">
            <h4 className="font-medium">GIS and native SMASH project packages</h4>
            <p className="text-sm text-muted-foreground">
              Add actual GIS files converted in this browser, alongside the full backup, styles and source provenance.
              The SMASH package also contains a native .gpap point-note project, compatible maps and form definitions.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                GIS output format
                <NativeSelect
                  aria-label="Workbench GIS output format"
                  className={inputClass}
                  value={gisFormat}
                  disabled={busy}
                  onChange={(event) => setGisFormat(event.target.value as GisExportFormat)}
                >
                  <option value="gpkg">GeoPackage (.gpkg)</option>
                  <option value="shp">Shapefile and companion files</option>
                  <option value="kml">KML (.kml)</option>
                  <option value="gpx">GPX points and tracks (.gpx)</option>
                  <option value="geojson">GeoJSON (.geojson)</option>
                </NativeSelect>
              </label>
              <label className="text-sm">
                Convert these layers
                <NativeSelect
                  aria-label="Workbench GIS export scope"
                  className={inputClass}
                  value={gisScope}
                  disabled={busy}
                  onChange={(event) => setGisScope(event.target.value as 'workspace' | 'all')}
                >
                  <option value="workspace">Current map vector layers</option>
                  <option value="all">Current map and all saved materialized layers/projects</option>
                </NativeSelect>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Native point-note timestamps record export creation, while original observation attributes remain
              unchanged. Lines and polygons stay in GIS layers. Missing elevations use SMASH’s documented -1 fallback
              and are labelled as unknown. Existing GPAP originals and staged attachments remain intact in the backup.
            </p>
            {gisFormat === 'gpx' && (
              <InlineAlert tone="warning">
                GPX supports points and lines. Choose GeoPackage for polygon or mixed unsupported geometry.
              </InlineAlert>
            )}
            {gisFormat === 'kml' && (
              <InlineAlert>
                KML is available for general GIS packages. Choose GeoPackage, GeoJSON, Shapefile or GPX for SMASH.
              </InlineAlert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || cache.loading}
                onClick={() =>
                  void run(async () => {
                    const bundle = await createLocalWorkbenchBundle({
                      name: name || 'Nechako GIS project',
                      records: cache.records,
                      workspace,
                      gisFormat,
                      gisScope,
                      onProgress: setProgress,
                    })
                    downloadBlob(bundle.blob, 'nechako-gis-project.zip')
                    setNotice(
                      `Downloaded ${bundle.manifest.gisExports?.length ?? 0} actual GIS datasets with source features, styles, provenance and the local workbench backup.`,
                    )
                  })
                }
              >
                Download GIS project ZIP
              </Button>
              <Button
                variant="outline"
                disabled={busy || cache.loading || gisFormat === 'kml'}
                onClick={() =>
                  void run(async () => {
                    const bundle = await createLocalWorkbenchBundle({
                      name: name || 'Nechako SMASH project',
                      records: cache.records,
                      workspace,
                      gisFormat,
                      gisScope,
                      smash: true,
                      onProgress: setProgress,
                    })
                    downloadBlob(bundle.blob, 'nechako-smash-project.zip')
                    setNotice(
                      `Downloaded a native .gpap project with ${bundle.manifest.smash?.noteCount ?? 0} point notes and ${bundle.manifest.gisExports?.length ?? 0} GIS layers. Extract the ZIP and follow smash/OPEN-IN-SMASH.txt. Review the manifest for style and remote-resource limits.`,
                    )
                  })
                }
              >
                Download SMASH project ZIP
              </Button>
            </div>
          </div>
          <div className="space-y-3 rounded border p-3">
            <h4 className="font-medium">Review and restore a backup</h4>
            <label className="block text-sm">
              Backup ZIP
              <input
                aria-label="Local workbench backup ZIP"
                className={inputClass}
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  setPreview(undefined)
                  setOverwrite(false)
                  if (file)
                    void run(async () => {
                      const result = await readLocalWorkbenchBundle(file, setProgress)
                      setPreview(result)
                      setNotice('All declared files passed checksum and CRC verification. Review before restoring.')
                    })
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Maximum 128 MiB ZIP, 128 MiB per file and 256 MiB unpacked. Inspection does not change local items or
              contact source services.
            </p>
            {preview && (
              <div className="space-y-3" aria-label="Backup restore review">
                <h4 className="font-semibold">{preview.manifest.name}</h4>
                <StatGroup
                  variant="tiles"
                  size="sm"
                  columns={3}
                  items={[
                    { label: 'Saved items', value: preview.records.length },
                    { label: 'Original files', value: preview.manifest.completeness.originalFileCount },
                    { label: 'Remote resources', value: preview.manifest.remoteResources.length },
                  ]}
                />
                <p className="text-sm">
                  Created {formatDate(preview.manifest.exportedAt)}. Local IDs, source IDs and relationships will be
                  preserved.
                </p>
                {preview.records.some((record) => record.source?.access === 'private') && (
                  <InlineAlert tone="warning">
                    This backup contains private source copies. Restoring explicitly retains them on this device after
                    source logout until you delete them.
                  </InlineAlert>
                )}
                <details>
                  <summary className="cursor-pointer text-sm">Included content and completeness notes</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                    {preview.manifest.completeness.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </details>
                {conflicts.length > 0 && (
                  <InlineAlert tone="warning">
                    {conflicts.length} item IDs already exist.{' '}
                    <details className="mt-2">
                      <summary className="cursor-pointer">Review matching items</summary>
                      <ul className="mt-1 max-h-40 list-disc overflow-auto break-words pl-5 text-xs">
                        {conflicts.map((record) => (
                          <li key={record.id}>
                            {record.name} · {record.kind} · {record.id}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={overwrite}
                        onChange={(event) => setOverwrite(event.target.checked)}
                      />
                      Replace matching IDs with the backup versions
                    </label>
                  </InlineAlert>
                )}
                {preview.workspace && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={restoreMap}
                      onChange={(event) => setRestoreMap(event.target.checked)}
                    />
                    Save and open the bundled map as a local project
                  </label>
                )}
                <Button
                  disabled={busy || (conflicts.length > 0 && !overwrite)}
                  onClick={() =>
                    void run(async () => {
                      const incoming = [...preview.records]
                      if (restoreMap && preview.workspace) {
                        const now = new Date().toISOString()
                        incoming.push({
                          id: crypto.randomUUID(),
                          kind: 'project',
                          name: preview.manifest.name,
                          data: createLocalWorkbenchProject(preview.workspace),
                          createdAt: now,
                          updatedAt: now,
                          bytes: 0,
                          source: {
                            access: preview.workspace.sessionBound ? 'private' : 'unknown',
                            notes: 'Restored bundled map workspace.',
                          },
                        })
                      }
                      await importLocalWorkbench(incoming, { overwrite })
                      if (restoreMap && preview.workspace) onWorkspace({ ...preview.workspace, sessionBound: false })
                      setNotice(
                        `Restored ${incoming.length} local items after verifying every file. Source IDs and original files were retained.`,
                      )
                      setPreview(undefined)
                      setOverwrite(false)
                    })
                  }
                >
                  Restore reviewed backup
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
      {view === 'schemas' && (
        <section role="tabpanel" id="local-workbench-panel-schemas" className="space-y-3">
          <h3 className="font-semibold">Local schema editor</h3>
          <p className="text-sm text-muted-foreground">
            Create a local field definition for mapping and validation, or edit a saved copy. Original portal IDs and
            field metadata are retained. Local changes apply only on this device.
          </p>
          <label className="block text-sm">
            Saved schema
            <NativeSelect
              aria-label="Saved schema"
              className={inputClass}
              value={schemaId}
              onChange={(event) => editSchema(schemas.find((record) => record.id === event.target.value))}
            >
              <option value="">New local schema</option>
              {schemas.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block text-sm">
            Schema name
            <input
              aria-label="Local schema name"
              className={inputClass}
              value={schemaName}
              maxLength={200}
              onChange={(event) => setSchemaName(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Schema JSON
            <textarea
              aria-label="Local schema JSON"
              className={`${inputClass} min-h-72 font-mono text-sm`}
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              spellCheck={false}
            />
          </label>
          {schemaCheck.error ? (
            <InlineAlert tone="warning">{schemaCheck.error}</InlineAlert>
          ) : (
            <InlineAlert>
              {schemaCheck.form!.fields.length} validated fields. Field IDs are unique; unsupported native field details
              remain preserved for review.
            </InlineAlert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !!schemaCheck.error || !schemaName.trim()}
              onClick={() =>
                void run(async () => {
                  const data: unknown = JSON.parse(schemaText)
                  checkLocalWorkbenchSchema(data)
                  const saved = await saveLocalWorkbench({
                    id: schemaId || undefined,
                    kind: 'schema',
                    name: schemaName,
                    data,
                  })
                  setSchemaId(saved.id)
                  setNotice(`Saved local schema “${saved.name}”.`)
                })
              }
            >
              Save local schema
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => editSchema()}>
              New schema from template
            </Button>
          </div>
        </section>
      )}
      {view === 'storage' && (
        <section role="tabpanel" id="local-workbench-panel-storage" className="space-y-4">
          <h3 className="font-semibold">Storage on this device</h3>
          <KeyValueRows
            variant="divided"
            rows={[
              { label: 'Workbench payloads', value: formatBytes(totalBytes) },
              { label: 'Original binary files', value: String(cache.records.filter((record) => record.blob).length) },
              {
                label: 'Site storage used',
                value: formatBytes(storage.usage, { fallback: 'Not reported by this browser' }),
              },
              {
                label: 'Site storage allowance',
                value: formatBytes(storage.quota, { fallback: 'Not reported by this browser' }),
              },
              {
                label: 'Storage retention',
                value:
                  storage.persisted === true
                    ? 'Persistent storage granted'
                    : storage.persisted === false
                      ? 'Browser may reclaim storage'
                      : 'Not reported by this browser',
              },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Site usage includes other PGMaps data and browser overhead. The workbench payload count includes saved JSON
            and original bytes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || storage.persisted === true}
              onClick={() =>
                void run(async () => {
                  const kept = await persistLocalWorkbenchStorage()
                  setStorage(await localWorkbenchStorage())
                  setNotice(
                    kept
                      ? 'The browser granted persistent storage. Keep a separate backup as well.'
                      : 'The browser did not grant persistent storage. Download a backup to retain another copy.',
                  )
                })
              }
            >
              Request persistent storage
            </Button>
            <Button variant="outline" onClick={() => setView('backups')}>
              Back up saved items
            </Button>
          </div>
          <div className="space-y-3 rounded border p-3">
            <h4 className="font-medium">Clear local workbench</h4>
            <p className="text-sm">
              This removes all {cache.records.length} saved workbench items and original files from this device. It
              leaves portal records and downloaded backups intact. The current map remains open until you replace or
              close it.
            </p>
            <label className="block text-sm">
              Type CLEAR to remove all saved workbench items
              <input
                aria-label="Confirm clear local workbench"
                className={inputClass}
                value={clearText}
                onChange={(event) => setClearText(event.target.value)}
                autoComplete="off"
              />
            </label>
            <Button
              disabled={busy || clearText !== 'CLEAR' || !cache.records.length}
              onClick={() =>
                void run(async () => {
                  await clearLocalWorkbench()
                  setClearText('')
                  setSelectedId('')
                  setProjectId('')
                  setSchemaId('')
                  setPreview(undefined)
                  setNotice('Cleared the local workbench on this device.')
                })
              }
            >
              Clear saved workbench items
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function ProjectHistory({
  record,
  onWorkspace,
}: {
  record?: LocalWorkbenchRecord
  onWorkspace: (workspace: Workspace) => void
}) {
  const data = record?.data as { history?: unknown[] } | undefined
  if (!record || !Array.isArray(data?.history) || !data.history.length) return null
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer text-sm">{data.history.length} previous local saves</summary>
      <div className="mt-2 space-y-2">
        {data.history.map((value, index) => {
          const item =
            value && typeof value === 'object' && !Array.isArray(value)
              ? (value as { savedAt?: unknown; workspace?: unknown })
              : undefined
          let workspace: Workspace
          try {
            workspace = openLocalWorkbenchProject({ ...record, data: { workspace: item?.workspace } })
          } catch {
            return (
              <InlineAlert key={index} tone="warning">
                Save {data.history!.length - index} cannot be opened because it does not contain a valid map
                workspace. Its original entry is retained in Saved items and backups.
              </InlineAlert>
            )
          }
          const date =
            typeof item?.savedAt === 'string' && Number.isFinite(Date.parse(item.savedAt))
              ? formatDate(item.savedAt, { hour: '2-digit', minute: '2-digit' })
              : 'Save date unavailable'
          return (
            <Button
              key={index}
              size="sm"
              variant="outline"
              className="mr-2"
              onClick={() => onWorkspace(workspace)}
            >
              Open save {data.history!.length - index} · {date}
            </Button>
          )
        })}
      </div>
    </details>
  )
}
