import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows, SearchInput } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink } from '@/components/ui/text-button'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { downloadText } from '@/lib/download'
import { errorText, NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import { normalizeProjectPackage, type ProjectPackage } from '@/lib/projectPackages'
import { importWorkspace, type Workspace } from './data/workspace'
import {
  COLLECTION_FILE_LIMIT,
  EMPTY_COLLECTION_SESSION,
  OBSERVED_PORTAL_PROJECTS,
  collectionBytes,
  collectionStats,
  collectionWorkspaceCandidate,
  exportCollection,
  parseCollectionFiles,
  validateCollectionBudget,
  type CollectionImportKind,
  type CollectionSession,
} from './data/portalCollections'

export type { CollectionSession } from './data/portalCollections'
export { EMPTY_COLLECTION_SESSION } from './data/portalCollections'
type Selection = { fileIndex: number; rowIndex: number } | { observedId: number; title: string }

/** Imported data lives in browser memory. A controlled session survives parent modal changes. */
export function PortalCollections({
  mode = 'all',
  session,
  onSessionChange,
  onWorkspace,
  onProject,
  learningStoryAvailable = false,
  showObservedIndex = true,
}: {
  mode?: 'all' | 'projects' | 'stories'
  session?: CollectionSession
  onSessionChange?: (session: CollectionSession) => void
  onWorkspace?: (workspace: Workspace) => void
  onProject?: (project: ProjectPackage) => void
  learningStoryAvailable?: boolean
  showObservedIndex?: boolean
}) {
  const [localSession, setLocalSession] = useState<CollectionSession>(EMPTY_COLLECTION_SESSION)
  const active = session ?? localSession
  const latest = useRef(active)
  latest.current = active
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<CollectionImportKind>('auto')
  const [selected, setSelected] = useState<Selection>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  const update = (next: CollectionSession) => {
    validateCollectionBudget(next.files)
    if (onSessionChange) onSessionChange(next)
    else setLocalSession(next)
  }
  const stats = useMemo(() => collectionStats(active.files), [active.files])
  const rows = useMemo(
    () =>
      active.files.flatMap((file, fileIndex) =>
        file.records.map((record, rowIndex) => ({ record, fileIndex, rowIndex, fileName: file.name })),
      ),
    [active.files],
  )
  const matching = rows.filter(
    ({ record, fileName }) =>
      (mode !== 'projects' || record.kind === 'project') &&
      (mode !== 'stories' || record.kind === 'story' || record.kind === 'document') &&
      `${record.title} ${record.description} ${record.sourceId ?? ''} ${fileName} ${record.metadata.map((field) => field.value).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  const observed =
    mode === 'stories'
      ? []
      : OBSERVED_PORTAL_PROJECTS.filter(([id, title]) => `${id} ${title}`.toLowerCase().includes(query.toLowerCase()))
  const imported =
    selected && 'fileIndex' in selected ? active.files[selected.fileIndex]?.records[selected.rowIndex] : undefined
  const selectedFile = selected && 'fileIndex' in selected ? active.files[selected.fileIndex] : undefined
  const preview = useMemo(() => {
    if (!imported) return undefined
    const candidate = collectionWorkspaceCandidate(imported.raw)
    if (!candidate) return undefined
    try {
      return { workspace: importWorkspace(candidate) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [imported])
  const rawText = useMemo(() => (imported ? JSON.stringify(imported.raw, null, 2) : ''), [imported])
  const project = useMemo(() => {
    if (!imported) return null
    const raw = imported.raw
    const candidate = raw.workspace ? raw : (raw.project ?? raw.attributes)
    try {
      const normalized = normalizeProjectPackage(candidate)
      return normalized?.workspace && ['story-map', 'map-explorer'].includes(normalized.workspace.type)
        ? normalized
        : null
    } catch {
      return null
    }
  }, [imported])
  const importFiles = async (files: File[]) => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    try {
      if (files.length > 100) throw new Error('Select at most 100 JSON files.')
      if (files.some((file) => file.size > COLLECTION_FILE_LIMIT))
        throw new Error('Each JSON import must be at most 20 MiB.')
      if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024)
        throw new Error('Selected files exceed the 50 MiB collection limit.')
      const parsed = []
      for (const file of files) parsed.push(...parseCollectionFiles(await file.text(), file.name, kind))
      if (request !== generation.current) return
      update({ files: [...latest.current.files, ...parsed] })
      setSelected(undefined)
    } catch (reason) {
      if (request === generation.current) setError(errorText(reason))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }
  const saveCollection = () => {
    try {
      downloadText(exportCollection(active.files), 'nechako-browser-collection.json', 'application/json')
      setError('')
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const title =
    mode === 'stories'
      ? 'Stories and documents'
      : mode === 'projects'
        ? 'People’s projects'
        : 'Projects, stories and collections'
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">
        Browse authorized JSON exports of projects, submissions and stories. Imported text, metadata and references stay
        in browser memory; export your collection before reloading. Linked media opens at its source and requires its
        original access.
      </p>
      {mode !== 'projects' && learningStoryAvailable && (
        <Link to="/dev/projects/nechako-learning-module" className="inline-block text-sm text-primary underline">
          Read watershed learning story
        </Link>
      )}
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">Import portal exports</h3>
        <label className="block text-sm">
          Interpret records as
          <select
            aria-label="Collection import type"
            value={kind}
            onChange={(event) => setKind(event.target.value as CollectionImportKind)}
            disabled={loading}
            className="ml-2 rounded-md border bg-background p-2 text-base"
          >
            <option value="auto">Use export type and list names</option>
            <option value="project">Saved projects</option>
            <option value="submission">Submissions</option>
            <option value="story">Stories</option>
            <option value="document">Documents</option>
          </select>
        </label>
        <label className="block text-sm">
          JSON exports or a saved browser collection (20 MiB per file, 50 MiB of original JSON total)
          <input
            aria-label="Portal collection JSON files"
            type="file"
            accept=".json"
            multiple
            disabled={loading}
            className="mt-2 block w-full text-sm"
            onChange={(event) => {
              const files = Array.from(event.target.files || [])
              event.target.value = ''
              if (files.length) void importFiles(files)
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Supported: record objects, arrays, projects/submissions/stories/documents/records/items/attributes lists,
          native map JSON and Nechako workspace JSON. ZIP project bundles and HTML files use their original files; JSON
          references do not contain the linked media. Review limit: 10,000 records, 100 files.
        </p>
        {loading && <InlineAlert loading>Reading selected exports…</InlineAlert>}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        <StatGroup
          variant="tiles"
          size="sm"
          columns={4}
          items={[
            { label: 'Imported files', value: stats.files },
            { label: 'Imported records', value: stats.records.toLocaleString('en-CA') },
            {
              label: 'Original JSON',
              value: collectionBytes(stats.jsonBytes),
              note: `${stats.jsonBytes.toLocaleString('en-CA')} bytes`,
            },
            { label: 'Source references', value: stats.references },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Declared linked-file sizes:{' '}
          {stats.declaredBytes === undefined ? 'not safely totalable' : collectionBytes(stats.declaredBytes)};{' '}
          {stats.unmeasuredReferences.toLocaleString('en-CA')} references have no consistent explicit byte size. These
          declarations are unverified. Original JSON and declared media sizes measure different things; total portal
          storage remains unknown.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!active.files.length || loading} onClick={saveCollection}>
            Export browser collection
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!active.files.length || loading}
            onClick={() => {
              update({ files: [] })
              setSelected(undefined)
              setError('')
            }}
          >
            Clear imported collection
          </Button>
        </div>
        {!!active.files.length && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Original imports ({active.files.length})</summary>
            <ul className="mt-2 space-y-2">
              {active.files.map((file, index) => (
                <li key={index} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-all">
                    {file.name} · {collectionBytes(file.bytes)} · {file.records.length.toLocaleString('en-CA')} records
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadText(file.sourceText, file.name, 'application/json')}
                  >
                    Download original JSON
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <label className="block text-sm">
        Search titles, IDs and imported metadata
        <SearchInput
          className="mt-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          aria-label="Search portal collections"
        />
      </label>
      <div className="space-y-2">
        <h3 className="font-semibold">
          Imported {mode === 'all' ? 'records' : mode === 'stories' ? 'stories and documents' : 'projects'}
        </h3>
        <ListHeader count={matching.length} noun={['matching record', 'matching records']} sticky={false} />
        <ListState
          empty={!matching.length}
          emptyLabel={
            active.files.length
              ? 'No imported records match this view and search.'
              : 'Import an authorized export to read its content here.'
          }
        />
        {!!matching.length && (
          <div data-map-sidebar-scroll="true" className="h-[400px] overflow-y-auto rounded-lg border">
            <VirtualResultList
              items={matching}
              getKey={(item) => `${item.fileIndex}:${item.rowIndex}`}
              estimateSize={92}
              label="Imported portal records"
            >
              {(item) => (
                <ResultRow
                  title={item.record.title}
                  subtitle={item.fileName}
                  meta={`${item.record.kind} · ID ${item.record.sourceId ?? 'not supplied'} · ${item.record.references.length} references`}
                  selected={
                    !!selected &&
                    'fileIndex' in selected &&
                    selected.fileIndex === item.fileIndex &&
                    selected.rowIndex === item.rowIndex
                  }
                  onClick={() => setSelected({ fileIndex: item.fileIndex, rowIndex: item.rowIndex })}
                />
              )}
            </VirtualResultList>
          </div>
        )}
      </div>
      {showObservedIndex && mode !== 'stories' && (
        <div className="space-y-2">
          <h3 className="font-semibold">Public original saved-project index</h3>
          <p className="text-sm text-muted-foreground">
            Nine projects were visible without login on October 12, 2026. The administrator grid showed 19, including
            restricted and test projects; those extra names and contents are not bundled here. Saved map contents and
            file sizes have not been imported.
          </p>
          <ListHeader
            count={observed.length}
            noun={['matching observed project', 'matching observed projects']}
            sticky={false}
          />
          <ListState empty={!observed.length} />
          <div className="max-h-80 overflow-y-auto rounded-lg border">
            {observed.map(([id, name]) => (
              <ResultRow
                key={id}
                title={name}
                meta={`Portal project ${id} · index only`}
                onClick={() => setSelected({ observedId: id, title: name })}
              />
            ))}
          </div>
        </div>
      )}
      <ExternalLink href={NECHAKO_PORTAL} className="text-sm">
        Original portal: load projects, read stories and obtain authorized exports
      </ExternalLink>
      <RecordDialog
        open={!!selected}
        onClose={() => setSelected(undefined)}
        title={imported?.title || (selected && 'observedId' in selected ? selected.title : 'Portal record')}
        source={
          selectedFile
            ? `Imported file ${selectedFile.name}`
            : 'Original portal project grid, observed October 12, 2026'
        }
        sourceHref={selectedFile ? undefined : NECHAKO_PORTAL}
        sourceLinkLabel="Original portal"
      >
        {imported ? (
          <div className="space-y-4">
            <p className="text-sm">
              {imported.kind} · Source ID: {imported.sourceId ?? 'not supplied'}
            </p>
            {imported.description && (
              <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">
                {imported.description}
              </div>
            )}
            {!!imported.metadata.length && (
              <details>
                <summary className="cursor-pointer font-medium">Exported metadata ({imported.metadata.length})</summary>
                <KeyValueRows
                  rows={imported.metadata}
                  variant="grid"
                  size="sm"
                  className="mt-2"
                  labelClassName="break-words"
                  valueClassName="max-h-48 overflow-auto whitespace-pre-wrap"
                />
              </details>
            )}
            {!!imported.references.length && (
              <details open>
                <summary className="cursor-pointer font-medium">
                  Source and media references ({imported.references.length})
                </summary>
                <ul className="mt-2 max-h-80 space-y-3 overflow-auto text-sm">
                  {imported.references.map((reference) => (
                    <li key={reference.url} className="space-y-1 break-words">
                      {reference.endpoint ? (
                        <span>
                          {reference.label}: {reference.url}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            Portal endpoint reference; use the original authorized download workflow.
                          </span>
                        </span>
                      ) : (
                        <ExternalLink href={reference.url} className="text-sm break-all">
                          {reference.label}: {reference.url}
                        </ExternalLink>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {reference.sizeBytes === undefined
                          ? 'File size not supplied'
                          : `${collectionBytes(reference.sizeBytes)} declared in export; unverified`}
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {preview?.error && <InlineAlert tone="warning">Map conversion: {preview.error}</InlineAlert>}
            {preview?.workspace && (
              <>
                {preview.workspace.warnings.map((warning, index) => (
                  <InlineAlert key={index} tone="warning">
                    {warning}
                  </InlineAlert>
                ))}
                <p className="text-sm">
                  Converted map: {preview.workspace.layers.length} WMS layers, {preview.workspace.vectors.length} vector
                  layers, {preview.workspace.tiles.length} tile layers.
                </p>
                {onWorkspace && (
                  <Button onClick={() => onWorkspace(preview.workspace!)}>Load imported map workspace</Button>
                )}
              </>
            )}
            {imported.kind === 'project' && !preview && !project && (
              <p className="text-sm text-muted-foreground">
                This record contains metadata, without a supported saved-map payload.
              </p>
            )}
            {project && onProject && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This export includes a supported PGMaps{' '}
                  {project.workspace?.type === 'story-map' ? 'story' : 'map explorer'} workspace. The complete original
                  export remains available below.
                </p>
                <Button onClick={() => onProject(project)}>
                  {project.workspace?.type === 'story-map' ? 'Read imported story' : 'Open imported project viewer'}
                </Button>
              </div>
            )}
            {imported.kind === 'story' && !project && (
              <p className="text-sm text-muted-foreground">
                This story’s original structure is available as text and JSON. Its format is not a supported PGMaps
                story workspace.
              </p>
            )}
            <details>
              <summary className="cursor-pointer font-medium">Review original record JSON</summary>
              {rawText.length <= 200_000 ? (
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{rawText}</pre>
              ) : (
                <p className="mt-2 text-sm">
                  Record exceeds the 200,000-character display limit. Download its JSON to review every field.
                </p>
              )}
            </details>
            <Button
              variant="outline"
              onClick={() => downloadText(rawText, `portal-${imported.kind}-record.json`, 'application/json')}
            >
              Export this record JSON
            </Button>
          </div>
        ) : selected && 'observedId' in selected ? (
          <div className="space-y-3 text-sm">
            <p>Saved portal project {selected.observedId}. This index records its name and ID.</p>
            <p className="text-muted-foreground">
              Load the project through Map Tools → Project in the original portal. Import an authorized JSON export here
              to review its metadata, map contents and references. No project file sizes or story content are available
              in this index.
            </p>
          </div>
        ) : null}
      </RecordDialog>
    </div>
  )
}
