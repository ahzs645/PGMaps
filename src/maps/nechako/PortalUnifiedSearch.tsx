import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { TabBar } from '@/components/ui/tab-bar'
import { ResultRow } from '@/components/ui/result-list'
import { fetchJson } from '@/lib/fetchJson'
import { normalizeProjectPackage, type ProjectPackage } from '@/lib/projectPackages'
import { downloadText } from '@/lib/download'
import { PortalSearch } from './PortalChecks'
import { PortalPublicProjects, type PublicProjectIndex } from './PortalPublicProjects'
import { SHOWCASE_BASE, loadSnapshotCapabilities } from './data/showcase'
import { filterLocalSearch } from './data/searchBuilder'
import { importWorkspace, type Workspace, type ActiveWms } from './data/workspace'
import {
  collectionWorkspaceCandidate,
  type CollectionFile,
  type CollectionRecord,
  collectionSourceUrl,
} from './data/portalCollections'
import { errorText, type PortalSource } from '@/lib/nechakoPortal'
import learningJson from '../../../public/data/projects/nechako-learning-module.json'

type Kind = 'all' | 'research' | 'project' | 'story' | 'layer' | 'submission' | 'document' | 'live'
type Row = {
  id: string
  title: string
  searchText: string
  kind: Exclude<Kind, 'all' | 'live'>
  record?: Record<string, unknown>
  projectId?: number
  layer?: ActiveWms
  imported?: CollectionRecord
  learning?: boolean
}
const learningProject = normalizeProjectPackage(learningJson)
export function PortalUnifiedSearch({
  files = [],
  workspace,
  mapBounds,
  onWorkspace,
  onProject,
  onResearchMap,
  onMonitoring,
}: {
  files?: CollectionFile[]
  workspace: Workspace
  mapBounds?: [number, number, number, number]
  onWorkspace: (workspace: Workspace) => void
  onProject: (project: ProjectPackage) => void
  onResearchMap: () => void
  onMonitoring?: (context: { submissionId: string; formId: string; layerId?: string; recId?: string }) => void
}) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState<Kind>('all'),
    [rows, setRows] = useState<Row[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Row>(),
    [page, setPage] = useState(0),
    [retry, setRetry] = useState(0),
    [actionError, setActionError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const failures: string[] = []
    const loaded: Row[] = []
    void Promise.allSettled([
      fetchJson<Record<string, unknown>[]>(`${SHOWCASE_BASE}submissions.cleaned.json`, controller.signal).then(
        (records) => {
          if (!Array.isArray(records)) throw new Error('Invalid research collection')
          loaded.push(
            ...records.map((record) => ({
              id: `research:${record.id}`,
              title: String(record.title || 'Untitled research'),
              searchText: JSON.stringify(record),
              kind: 'research' as const,
              record,
            })),
          )
        },
      ),
      fetchJson<PublicProjectIndex>(`${SHOWCASE_BASE}public-projects/index.json`, controller.signal).then((index) => {
        loaded.push(
          ...index.projects.map((project) => ({
            id: `project:${project.id}`,
            title: project.name,
            searchText: `${project.id} ${project.savedAt} ${project.bytes} bytes ${project.layerCount} layers`,
            kind: 'project' as const,
            projectId: project.id,
          })),
        )
      }),
      fetchJson<{ source: PortalSource }[]>(`${SHOWCASE_BASE}services.json`, controller.signal).then(
        async (services) => {
          const results = await Promise.allSettled(
            services.map(async (entry) => {
              const cap = await loadSnapshotCapabilities(entry.source, controller.signal)
              loaded.push(
                ...cap.layers.map((layer) => ({
                  id: `layer:${entry.source.resource}:${layer.name}`,
                  title: layer.title,
                  searchText: `${entry.source.name} ${layer.name}`,
                  kind: 'layer' as const,
                  layer: {
                    id: crypto.randomUUID(),
                    source: entry.source,
                    layer,
                    style: '',
                    opacity: 0.75,
                    visible: true,
                    formats: cap.featureInfoFormats,
                  },
                })),
              )
            }),
          )
          results.forEach((result, i) => {
            if (result.status === 'rejected') failures.push(`${services[i].source.name}: ${String(result.reason)}`)
          })
        },
      ),
    ]).then((results) => {
      results.forEach((result, i) => {
        if (result.status === 'rejected')
          failures.push(`${['Research', 'Public projects', 'Layer catalogue'][i]}: ${String(result.reason)}`)
      })
      if (!controller.signal.aborted) {
        setRows(loaded)
        setErrors(failures)
        setLoading(false)
      }
    })
    return () => controller.abort()
  }, [retry])
  const allRows = useMemo(
    () => [
      ...rows,
      ...(learningProject
        ? [
            {
              id: 'story:nechako-learning-module',
              title: learningProject.title,
              searchText:
                'learning story climate health Prince George Vanderhoof Fraser Lake Burns Lake Fort St James 25 prompts',
              kind: 'story' as const,
              learning: true,
            },
          ]
        : []),
      ...files.flatMap((file) =>
        file.records.map((record, i) => ({
          id: `import:${file.name}:${i}`,
          title: record.title,
          searchText: `${record.sourceId || ''} ${record.description} ${record.metadata.map((item) => `${item.label} ${item.value}`).join(' ')}`,
          kind: record.kind,
          imported: record,
          record: record.raw,
        })),
      ),
    ],
    [rows, files],
  )
  const matching = useMemo(
    () =>
      filterLocalSearch(
        allRows.filter((row) => kind === 'all' || kind === 'live' || row.kind === kind),
        query,
      ),
    [allRows, kind, query],
  )
  const shown = matching.slice(page * 25, (page + 1) * 25)
  const packageCandidate = selected?.imported ? normalizeProjectPackage(selected.imported.raw) : null
  const mapCandidate = selected?.imported ? collectionWorkspaceCandidate(selected.imported.raw) : undefined
  return (
    <div className="space-y-4" data-nechako-unified-search>
      <h2 className="text-xl font-semibold">Search watershed information</h2>
      <TabBar
        label="Watershed search type"
        value={kind}
        onChange={(value) => {
          setKind(value)
          setPage(0)
          setSelected(undefined)
        }}
        options={[
          { value: 'all', label: 'All public content' },
          { value: 'research', label: 'Research' },
          { value: 'project', label: 'Projects' },
          { value: 'story', label: 'Stories' },
          { value: 'layer', label: 'Layers' },
          { value: 'submission', label: 'Imported submissions' },
          { value: 'live', label: 'Live portal submissions' },
        ]}
      />
      {kind === 'live' ? (
        <PortalSearch
          initialQuery={query || 'nechako'}
          vectors={workspace.vectors}
          mapBounds={mapBounds}
          onMonitoring={onMonitoring}
        />
      ) : (
        <>
          <SearchInput
            aria-label="Search all watershed information"
            placeholder="Search titles, authors, project IDs, places and layer names"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            onClear={() => {
              setQuery('')
              setPage(0)
            }}
          />
          <p className="text-xs text-muted-foreground">
            Public research, nine saved map definitions, learning content, advertised layer metadata and your imported
            collections. Live portal submissions have their own expression and geographic search; these source
            identifiers remain separate.
          </p>
          {loading && <InlineAlert loading>Loading searchable public collections…</InlineAlert>}
          {errors.length > 0 && (
            <InlineAlert tone="warning">
              Some collections are unavailable: {errors.join('; ')}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLoading(true)
                  setRetry((value) => value + 1)
                }}
              >
                Retry search collections
              </Button>
            </InlineAlert>
          )}
          <p aria-live="polite" className="text-sm">
            {matching.length.toLocaleString()} matching results · page {page + 1} of{' '}
            {Math.max(1, Math.ceil(matching.length / 25))}
          </p>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
            {shown.map((row) => (
              <ResultRow
                key={row.id}
                title={row.title}
                subtitle={`${row.kind} · ${row.imported ? 'Imported file' : row.id.split(':')[0] === 'research' ? 'nwsviz research' : 'Public portal / PGMaps'}`}
                onClick={() => {
                  setActionError('')
                  setSelected(row)
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage((value) => value - 1)}>
              Previous search results
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * 25 >= matching.length}
              onClick={() => setPage((value) => value + 1)}
            >
              Next search results
            </Button>
          </div>
        </>
      )}
      {selected?.projectId && (
        <PortalPublicProjects
          key={selected.projectId}
          initialProjectId={selected.projectId}
          detailsOnly
          onCloseProject={() => setSelected(undefined)}
          onWorkspace={onWorkspace}
        />
      )}
      <RecordDialog
        open={!!selected && !selected.projectId}
        title={selected?.title || 'Search result'}
        subtitle={selected?.kind}
        onClose={() => setSelected(undefined)}
      >
        {selected && (
          <div className="space-y-3">
            {actionError && <InlineAlert tone="error">{actionError}</InlineAlert>}
            {selected.learning && learningProject && (
              <>
                <p className="text-sm">
                  Seven chapters and 25 reworded prompts exploring the watershed. This is an attributed PGMaps learning
                  adaptation.
                </p>
                <Button onClick={() => onProject(learningProject)}>Read this learning story</Button>
              </>
            )}
            {selected.layer && (
              <>
                <p className="text-sm">
                  {selected.layer.source.name} · {selected.layer.layer.name}. Capabilities are metadata; map imagery
                  loads from the live source.
                </p>
                <Button
                  onClick={() =>
                    onWorkspace({
                      ...workspace,
                      layers: [
                        ...workspace.layers.filter(
                          (layer) =>
                            layer.layer.name !== selected.layer!.layer.name ||
                            layer.source.resource !== selected.layer!.source.resource,
                        ),
                        selected.layer!,
                      ],
                    })
                  }
                >
                  Add this layer to map
                </Button>
              </>
            )}
            {selected.imported?.description && (
              <p className="whitespace-pre-wrap break-words text-sm">{selected.imported.description}</p>
            )}
            {selected.imported?.references.map((ref) => (
              <a
                key={ref.url}
                href={collectionSourceUrl(ref.url)}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-sm text-primary underline"
              >
                {ref.url}
              </a>
            ))}
            {packageCandidate && (
              <Button onClick={() => onProject(packageCandidate)}>Open imported project or story</Button>
            )}
            {!!mapCandidate && (
              <Button
                onClick={() => {
                  try {
                    onWorkspace(importWorkspace(mapCandidate))
                  } catch (reason) {
                    setActionError(errorText(reason))
                  }
                }}
              >
                Load imported map
              </Button>
            )}
            {selected.kind === 'research' && (
              <>
                <p className="text-sm">
                  nwsviz research ID {String(selected.record?.id)}. This is not a portal submission ID; citation URLs
                  are not supplied by this snapshot.
                </p>
                <Button variant="outline" onClick={onResearchMap}>
                  Open research map and timeline
                </Button>
              </>
            )}
            {selected.record && (
              <>
                <dl className="grid gap-2 text-sm">
                  {Object.entries(selected.record)
                    .filter(
                      ([key, value]) =>
                        !['projectDescription', 'description', 'workspace', 'layers'].includes(key) &&
                        (typeof value === 'string' || typeof value === 'number' || Array.isArray(value)),
                    )
                    .map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <dt className="font-medium">{key}</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {(Array.isArray(value) ? value.join(', ') : String(value)).slice(0, 5000)}
                        </dd>
                      </div>
                    ))}
                </dl>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadText(
                      JSON.stringify(selected.record, null, 2),
                      'nechako-search-record.json',
                      'application/json',
                    )
                  }
                >
                  Download source record JSON
                </Button>
              </>
            )}
          </div>
        )}
      </RecordDialog>
    </div>
  )
}
