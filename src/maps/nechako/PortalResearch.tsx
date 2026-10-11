import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import packageJson from '../../../public/data/projects/nechako-watershed-research-portal.json'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import {
  normalizeProjectPackage,
  type ProjectMapExplorerWorkspaceDef,
  type ProjectExplorerFeatureDef,
} from '@/lib/projectPackages'
import { useResearchRecordsAdapter } from '@/maps/project-explorer/adapters/useResearchRecordsAdapter'
import type { ResearchRecord } from '@/maps/project-explorer/adapters/researchRecordsTypes'
import { downloadText } from '@/lib/download'
import { csvExport } from './data/monitoring'
import { SHOWCASE_BASE } from './data/showcase'
import { NECHAKO_BOUNDARY_URL } from './data/boundary'
import { ProjectMapExplorer } from '@/maps/project-explorer/ProjectMapExplorer'

const project = normalizeProjectPackage(packageJson)

function researchConfig(source: 'snapshot' | 'live', withBoundary = false): ProjectMapExplorerWorkspaceDef | undefined {
  if (project?.workspace?.type !== 'map-explorer') return undefined
  return source === 'live'
    ? project.workspace
    : {
        ...project.workspace,
        data: { ...project.workspace.data, baseUrl: SHOWCASE_BASE },
        // The workbench snapshot stays self-contained; the native page reuses EchoScreen's built asset.
        features: project.workspace.features.flatMap<ProjectExplorerFeatureDef>((feature) =>
          feature.type !== 'aggregate-boundary'
            ? [feature]
            : withBoundary
              ? [{ ...feature, data: NECHAKO_BOUNDARY_URL, idProperty: 'namedWatershedId', featureId: '8886' }]
              : [],
        ),
      }
}

export function PortalResearchMap({
  onBack,
  fill = false,
  backLabel = 'Showcase',
}: {
  onBack: () => void
  fill?: boolean
  backLabel?: string
}) {
  const config = researchConfig('snapshot', fill)
  if (!config) return <InlineAlert tone="error">The research project configuration is unavailable.</InlineAlert>
  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col gap-3' : 'space-y-3'}>
      <p className="text-sm text-muted-foreground">
        Repository snapshot · location markers are reference points, not study footprints. Basemap tiles use the live
        basemap service.
      </p>
      <div
        className={
          fill
            ? 'relative min-h-0 flex-1 overflow-hidden rounded-lg border'
            : 'relative h-[75vh] min-h-[540px] overflow-hidden rounded-lg border'
        }
        data-nechako-research-map
      >
        <ProjectMapExplorer title="Nechako research showcase" config={config} onBack={onBack} backLabel={backLabel} />
      </div>
    </div>
  )
}

function ResearchRecords({ config }: { config: ProjectMapExplorerWorkspaceDef }) {
  const data = useResearchRecordsAdapter(config)
  const [scope, setScope] = useState<'all' | 'unmapped'>('all')
  const [selected, setSelected] = useState<ResearchRecord | null>(null)
  const records = useMemo(
    () => data.filteredSubmissions.filter((record) => scope === 'all' || record.locationIds.length === 0),
    [data.filteredSubmissions, scope],
  )
  const unmapped = data.submissions.filter((record) => record.locationIds.length === 0).length
  return (
    <div className="max-w-4xl space-y-4">
      <h2 className="text-xl font-semibold">Public research records</h2>
      <p className="text-sm text-muted-foreground">
        Browse every record in the existing nwsviz research dataset, including records without location tags. This
        collection is separate from Stewardship Portal submissions.
      </p>
      <Link
        to="/dev/projects/nechako-watershed-research-portal"
        className="inline-block text-sm text-primary underline"
      >
        Open the existing map and timeline
      </Link>
      {data.loading && <InlineAlert loading>Loading the public research dataset…</InlineAlert>}
      {data.error && (
        <InlineAlert tone="error" title="Research data unavailable">
          {data.error}
          <Button variant="outline" size="sm" className="ml-2" onClick={data.retry}>
            Retry research data
          </Button>
        </InlineAlert>
      )}
      {!data.loading && !data.error && (
        <>
          <p className="text-sm">
            {data.submissions.length.toLocaleString()} total records · {unmapped.toLocaleString()} without location tags
          </p>
          <SegmentedControl
            label="Research record scope"
            value={scope}
            onChange={(value) => {
              setScope(value)
              setSelected(null)
            }}
            options={[
              { value: 'all', label: 'All records' },
              { value: 'unmapped', label: 'Unmapped records' },
            ]}
            fullWidth={false}
          />
          <label className="block text-sm font-medium">
            Search research titles, authors and tags
            <SearchInput
              aria-label="Search research records"
              value={data.searchQuery}
              onChange={(event) => data.setSearchQuery(event.target.value)}
              onClear={() => data.setSearchQuery('')}
              className="mt-1"
            />
          </label>
          <p aria-live="polite" className="text-sm">
            {records.length.toLocaleString()} matching records
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!records.length}
            onClick={() =>
              downloadText(
                csvExport(
                  ['nwsviz_id', 'title', 'author', 'publication_year', 'resource_type', 'tags', 'location_ids'],
                  records.map((record) => [
                    record.id,
                    record.title,
                    record.author,
                    record.publicationYear,
                    record.resourceType,
                    record.tags.join('; '),
                    record.locationIds.join('; '),
                  ]),
                ),
                'nechako-research-filtered.csv',
                'text/csv',
              )
            }
          >
            Export matching research CSV
          </Button>
          {!records.length && <InlineAlert>No research records match these filters.</InlineAlert>}
          <div data-map-sidebar-scroll="true" className="h-[480px] overflow-y-auto rounded-lg border">
            <VirtualResultList
              key={`${scope}:${data.searchQuery}`}
              items={records}
              getKey={(record) => String(record.id)}
              estimateSize={110}
              label="Research records"
            >
              {(record) => (
                <ResultRow
                  title={record.title || 'Untitled research record'}
                  subtitle={record.author || undefined}
                  meta={`${record.publicationYear ?? 'Year not supplied'} · ${data.resourceTypeLabels[record.resourceTypeMain] ?? record.resourceType}`}
                  selected={selected?.id === record.id}
                  onClick={() => setSelected(record)}
                />
              )}
            </VirtualResultList>
          </div>
          <RecordDialog
            open={!!selected}
            onClose={() => setSelected(null)}
            title={selected?.title || 'Research record'}
            subtitle={selected ? `nwsviz record ${selected.id}` : undefined}
            source="nwsviz public research dataset"
            sourceHref={`${config.data.baseUrl}${config.data.files.records}`}
            sourceLinkLabel="Source dataset"
          >
            {selected && (
              <div className="space-y-3 text-sm">
                <p>{selected.author || 'Author not supplied'}</p>
                <p>
                  {selected.publicationYear ?? 'Year not supplied'} ·{' '}
                  {data.resourceTypeLabels[selected.resourceTypeMain] ?? selected.resourceType}
                </p>
                <p>Tags: {selected.tags.join(', ') || 'None supplied'}</p>
                <p>Location IDs: {selected.locationIds.join(', ') || 'No location tags'}</p>
                <p className="text-xs text-muted-foreground">
                  The public dataset does not supply per-record citation links. Its record IDs belong to nwsviz and are
                  not portal submission IDs.
                </p>
              </div>
            )}
          </RecordDialog>
        </>
      )}
    </div>
  )
}

export function PortalResearch({ onMap }: { onMap?: () => void }) {
  const [source, setSource] = useState<'snapshot' | 'live'>('snapshot')
  const config = useMemo(() => researchConfig(source), [source])
  if (!config) return <InlineAlert tone="error">The research project configuration is unavailable.</InlineAlert>
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">
        Research data source
        <select
          aria-label="Research data source"
          value={source}
          onChange={(event) => setSource(event.target.value as 'snapshot' | 'live')}
          className="ml-2 max-w-full rounded-md border bg-background p-2 text-base"
        >
          <option value="snapshot">Repository snapshot</option>
          <option value="live">Live nwsviz data</option>
        </select>
      </label>
      {onMap && (
        <Button variant="outline" onClick={onMap}>
          Open bundled map and timeline
        </Button>
      )}
      <ResearchRecords key={source} config={config} />
    </div>
  )
}
