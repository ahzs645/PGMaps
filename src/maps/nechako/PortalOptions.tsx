import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { Badge } from '@/components/ui/badge'
import { NECHAKO_PORTAL } from '@/lib/nechakoPortal'
import type { InventoryPanel } from './data/portalInventory'

type Capability = {
  name: string
  group: string
  description: string
  panel?: InventoryPanel
  mapPane?: 'tools' | 'layers'
  originalPath?: string
}

const CAPABILITIES: readonly Capability[] = [
  {
    name: 'Stories and learning modules',
    group: 'Read and explore',
    description: 'Read the public watershed learning adaptation or inspect an imported story/document export.',
    panel: 'stories',
  },
  {
    name: 'Community projects and saved maps',
    group: 'Read and explore',
    description:
      'Browse the observed project catalogue, read imported descriptions, and load supported exported map workspaces.',
    panel: 'collections',
  },
  {
    name: 'Research records and citations',
    group: 'Read and explore',
    description: 'Search all bundled literature, including records with no location tags.',
    panel: 'search',
  },
  {
    name: 'Portal submissions and related resources',
    group: 'Read and explore',
    description:
      'Search native metadata/content; inspect known IDs and independent attachment, layer, child and history reads.',
    panel: 'submissions',
  },
  {
    name: 'Map and publication timeline',
    group: 'Read and explore',
    description: 'Explore research by location, resource type and decade.',
    panel: 'research-map',
  },
  {
    name: 'Layers, basemaps, legends and identify',
    group: 'Map tools',
    description: 'Discover the WMS catalogue, control visibility/opacity/order and inspect queryable map layers.',
    mapPane: 'layers',
  },
  {
    name: 'Add a map layer',
    group: 'Map tools',
    description: 'Choose a service, named layer/group and advertised style, then add it to this map.',
    mapPane: 'tools',
  },
  {
    name: 'Draw and inspect vectors',
    group: 'Map tools',
    description: 'Draw points, lines or polygons; select features, inspect attributes, edit GeoJSON and measure.',
    mapPane: 'tools',
  },
  {
    name: 'Buffer, clip, split and overlay',
    group: 'Map tools',
    description: 'Create local outputs using buffer, clip, split, union, intersection or difference, with undo.',
    mapPane: 'tools',
  },
  {
    name: 'Native categorized styles and SLD',
    group: 'Map tools',
    description:
      'Style local vector categories, use advertised WMS styles or HTTPS SLD references, and preserve native map source order. Full SLD symbolizer translation remains outside this PoC.',
    mapPane: 'layers',
  },
  {
    name: 'Import spatial files',
    group: 'Files and uploads',
    description:
      'Review GeoJSON locally; optional GDAL conversion handles Shapefile, GeoPackage, SQLite, GML, GPX and KML/KMZ.',
    panel: 'files',
  },
  {
    name: 'Review bibliographic CSV',
    group: 'Files and uploads',
    description: 'Map title/DOI columns, retain source fields and flag repeated identifiers before publication.',
    panel: 'files',
  },
  {
    name: 'Preview documents and media',
    group: 'Files and uploads',
    description: 'Preview local images, PDFs, audio and video; retain original downloads for other file types.',
    panel: 'files',
  },
  {
    name: 'Import project, submission and story JSON',
    group: 'Files and uploads',
    description:
      'Read exported content in a browser-only collection and inspect source bytes and linked-file size coverage.',
    panel: 'collections',
  },
  {
    name: 'Create or resume a submission',
    group: 'Files and uploads',
    description:
      'Original forms manage drafts, attachments, parent links and publication. Opening a new form immediately creates a draft.',
    originalPath: 'Fill a Form → Start New Submission / Resume a Draft Submission',
  },
  {
    name: 'Bulk CSV upload and field matching',
    group: 'Files and uploads',
    description:
      'Match CSV columns to original form fields, validate and review local drafts, then explicitly create up to 50 source drafts through a signed-in local gateway. Publication remains in the original.',
    panel: 'files',
  },
  {
    name: 'GeoPaparazzi notes, tracks and media',
    group: 'Files and uploads',
    description:
      'The original matches GPAP forms/fields and selects records to submit. PGMaps currently inventories the database.',
    originalPath: 'Fill a Form → Open GeoPaparazzi Loader',
  },
  {
    name: 'Monitoring charts, tables and CSV',
    group: 'Monitoring and reports',
    description:
      'Match station/date/value/unit columns; filter observations, inspect quality, chart and export the complete filtered CSV.',
    panel: 'monitoring',
  },
  {
    name: 'Station and schema-linked monitoring',
    group: 'Monitoring and reports',
    description:
      'Read verified station/schema relationships and original Attributes observations in 500-row pages; chart or download each loaded page.',
    panel: 'monitoring',
  },
  {
    name: 'Form statistics and report presets',
    group: 'Monitoring and reports',
    description:
      'Read original forms and statistics, choose source fields and labels, save local presets, and export CSV, HTML, PDF or ZIP.',
    panel: 'reports',
  },
  {
    name: 'Save, restore and export this workspace',
    group: 'Projects and exports',
    description:
      'Save locally in this browser or download/import workspace JSON, including camera, layers and local vectors.',
    panel: 'projects',
  },
  {
    name: 'Server-saved projects and defaults',
    group: 'Projects and exports',
    description:
      'Browse source-owned projects, history, shares and defaults; review permitted save, rename, sharing and default changes through the local gateway.',
    panel: 'saved-projects',
  },
  {
    name: 'Original project spatial downloads',
    group: 'Projects and exports',
    description:
      'The original Download Project Files dialog exports GIS formats (including GeoJSON and GeoPackage), with a SMASH option. It does not report an archive size before generation. Use Files to inspect an authorized downloaded dataset.',
    originalPath: 'Map Tools → Project → existing project → Download Project Files',
  },
  {
    name: 'Map image composition',
    group: 'Projects and exports',
    description:
      'The original image composer starts at 640 × 480 and offers a title, north arrow, scale bar, legend and attribution. This is a rendered map image, separate from workspace JSON or source GIS files.',
    originalPath: 'Map Tools → Export',
  },
  {
    name: 'Submission PDF, HTML, CSV and file ZIP',
    group: 'Projects and exports',
    description:
      'Download native form content, attachment originals and spatial files from the permitted original submission.',
    originalPath: 'Search → existing submission → Export',
  },
  {
    name: 'Users, groups and permissions',
    group: 'Administration',
    description:
      'Inspect source access and review existing user permission and group membership changes through an administrator gateway session.',
    panel: 'administration',
  },
  {
    name: 'Forms, schemas and shared-layer review',
    group: 'Administration',
    description:
      'Inspect original form/schema definitions and shared-layer queues; review approval or active-state changes. Form editing and retraction use the original.',
    panel: 'administration',
  },
  {
    name: 'Source registry, content and scheduling',
    group: 'Administration',
    description:
      'Read dashboard schedules, status flags, priorities and defaults; review edits to existing help content. Scheduling and source registry writes remain in the original.',
    panel: 'administration',
  },
  {
    name: 'BOSS processing and queue',
    group: 'Administration',
    description:
      'The administrator interface has input layers, processing reports, CSV exports and a queue. Processing behavior has not been verified.',
    originalPath: 'Map Tools → BOSS',
  },
]

export function PortalOptions({
  onOpen,
  onMapPane,
}: {
  onOpen: (panel: InventoryPanel) => void
  onMapPane?: (pane: 'tools' | 'layers') => void
}) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('All options')
  const groups = ['All options', ...new Set(CAPABILITIES.map((item) => item.group))]
  const options = useMemo(
    () =>
      CAPABILITIES.filter(
        (item) =>
          (group === 'All options' || group === item.group) &&
          `${item.name} ${item.description} ${item.group}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, group],
  )
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">
        Find a way to read, map, import or export the watershed information. Tools marked “Original portal” use its
        account and publication workflow; other controls open the implemented PGMaps viewer.
      </p>
      <div className="flex flex-wrap gap-3">
        <SearchInput
          aria-label="Find a portal option"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search tools, formats or workflows"
          className="min-w-0 flex-1"
        />
        <select
          aria-label="Option category"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          className="max-w-full rounded-md border bg-background p-2 text-base"
        >
          {groups.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>
      <p className="text-sm" aria-live="polite">
        {options.length} matching options
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((item) => (
          <article key={item.name} className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold">{item.name}</h3>
              <Badge>{item.originalPath ? 'Original portal' : 'PGMaps'}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{item.group}</p>
            <p className="flex-1 text-sm leading-6">{item.description}</p>
            {item.originalPath && <p className="text-xs text-muted-foreground">{item.originalPath}</p>}
            {item.panel && (
              <Button variant="outline" onClick={() => onOpen(item.panel!)}>
                Open {item.name.toLowerCase()}
              </Button>
            )}
            {item.mapPane &&
              (onMapPane ? (
                <Button variant="outline" onClick={() => onMapPane(item.mapPane!)}>
                  Open {item.mapPane === 'tools' ? 'Map Tools' : 'map layers'}
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <a href="/dev/nechako?view=layers">Open map tools</a>
                </Button>
              ))}
            {item.originalPath && (
              <Button asChild variant="outline">
                <a href={NECHAKO_PORTAL} target="_blank" rel="noreferrer">
                  Open original portal
                </a>
              </Button>
            )}
          </article>
        ))}
      </div>
      {!options.length && <InlineAlert>No options match. Clear the search or choose another category.</InlineAlert>}
    </div>
  )
}
