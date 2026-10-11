import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import packageJson from '../../../public/data/projects/nechako-watershed-research-portal.json'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { RecordDialog } from '@/components/ui/record-dialog'
import { ResultRow } from '@/components/ui/result-list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { normalizeProjectPackage, type ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'
import { useResearchRecordsAdapter } from '@/maps/project-explorer/adapters/useResearchRecordsAdapter'
import type { ResearchRecord } from '@/maps/project-explorer/adapters/researchRecordsTypes'
import { downloadText } from '@/lib/download'
import { csvExport } from './data/monitoring'

const project = normalizeProjectPackage(packageJson)

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

export function PortalResearch() {
  if (project?.workspace?.type !== 'map-explorer')
    return <InlineAlert tone="error">The research project configuration is unavailable.</InlineAlert>
  return <ResearchRecords config={project.workspace} />
}
