import type { ShowcaseManifest } from './showcase'
import learningSource from '../../../../public/data/projects/nechako-learning-module.json?raw'

export const LEARNING_PACKAGE_BYTES = new TextEncoder().encode(learningSource).byteLength

export const PORTAL_AUDIT_DATE = '2026-10-12'
export const ORIGINAL_PORTAL_URL = 'https://nechakowatershed-portal.ca/'

export type InventoryPanel =
  | 'source-layers'
  | 'local-workbench'
  | 'inventory'
  | 'map-export'
  | 'search'
  | 'submissions'
  | 'reports'
  | 'monitoring'
  | 'projects'
  | 'files'
  | 'research-map'
  | 'links'
  | 'account'
  | 'saved-projects'
  | 'collections'
  | 'stories'
  | 'administration'
export type InventoryFacet = 'all' | 'bundled' | 'original'
export type InventoryMeasure = { label: string; value: number | null; unit: string; evidence: string }
export type InventoryEntry = {
  id: string
  title: string
  source: string
  description: string
  measures: InventoryMeasure[]
  availability: 'bundled' | 'original' | 'partial'
  coverage: string
  sourceBytes: number | null
  bundledBytes: number | null
  panel?: InventoryPanel
  actionLabel?: string
  workbenchView?: 'research' | 'layers' | 'monitoring' | 'formats'
}

const observed = (label: string, value: number | null, unit: string): InventoryMeasure => ({
  label,
  value,
  unit,
  evidence: `Original portal interface audit · ${PORTAL_AUDIT_DATE}`,
})
const captured = (
  manifest: ShowcaseManifest | undefined,
  label: string,
  value: number | undefined,
  unit: string,
): InventoryMeasure => ({
  label,
  value: value ?? null,
  unit,
  evidence: manifest ? `Public snapshot · ${manifest.captured_at_utc.slice(0, 10)}` : 'Snapshot manifest pending',
})

/** Byte counts measure listed snapshot files, never remote datasets behind a service. */
export function bundledBytesForKinds(manifest: ShowcaseManifest | undefined, kinds: readonly string[]): number | null {
  if (!manifest) return null
  return manifest.files.filter((file) => kinds.includes(file.kind)).reduce((sum, file) => sum + file.bytes, 0)
}

export function buildPortalInventory(manifest?: ShowcaseManifest): InventoryEntry[] {
  return [
    {
      id: 'submissions',
      title: 'Submission catalogue',
      source: 'Stewardship Portal submission search',
      description: 'The original catalogue brings contributed records together across forms and subject areas.',
      measures: [observed('Historical authenticated search', 1585, 'submissions')],
      availability: 'original',
      coverage:
        'The historical authenticated audit search {Submission ID} >= 0 reported 1,585 submissions. This is separate from the new anonymous capture shown above when available, which includes searchable public form content. Drafts and private records are outside that public capture. Literature, project and event matches are subsets; this audit count is not a database-wide total.',
      sourceBytes: null,
      bundledBytes: null,
      panel: 'submissions',
      actionLabel: 'Search portal submissions',
    },
    {
      id: 'stories',
      title: 'Stories and learning',
      source: 'Stewardship Portal content / Learning Module',
      description: 'Welcome material, learning modules, how-to videos and interpretive content.',
      measures: [
        observed('Story / learning collection', null, 'items'),
        observed('Verified Learning Module', 5, 'place cases'),
        observed('Verified Learning Module questions', 25, 'questions'),
        observed('Content editor registry', 23, 'documents and templates'),
        {
          label: 'PGMaps learning adaptation',
          value: 1,
          unit: 'playable story',
          evidence: 'Public source adaptation · 2026-10-12',
        },
      ],
      availability: 'partial',
      coverage:
        'A seven-chapter PGMaps adaptation of one public Learning Module is playable here, with five place cases and 25 reworded prompts. The 23 original content entries include help/email templates; neither is a total story count. The adaptation is separate from the October 11 snapshot.',
      sourceBytes: null,
      bundledBytes: LEARNING_PACKAGE_BYTES,
      panel: 'stories',
      actionLabel: 'Explore stories and learning',
    },
    {
      id: 'projects',
      title: 'People’s projects and submissions',
      source: 'Stewardship Portal Project form',
      description: 'Contributed project records, their descriptions, locations, attachments and review workflow.',
      measures: [observed('Title matches: nechako_projects', 8, 'submissions')],
      availability: 'original',
      coverage:
        'Eight submissions matched the project-form title search during the historical authenticated audit; this is not a global project-submission total. Anonymously visible Project-form descriptions can be read and searched in the captured submissions shown above when available. Attachment references are separate from file bodies, which remain at the original source.',
      sourceBytes: null,
      bundledBytes: null,
      panel: 'collections',
      actionLabel: 'Browse contributed collections',
    },
    {
      id: 'saved-maps',
      title: 'Saved maps and workspaces',
      source: 'Stewardship Portal saved projects',
      description: 'Saved map state, selected layers, notes and reusable map workspaces.',
      measures: [
        observed('Administrator Project grid', 19, 'saved map projects'),
        observed('Anonymous Project grid', 9, 'visible projects'),
      ],
      availability: 'partial',
      coverage:
        'The administrator grid listed 19 saved maps; nine were also visible without login. Their original public map-definition JSON is bundled for descriptions and map loading. It holds cameras and layer references; external imagery and source GIS files are not copied. Full source-file storage is unknown.',
      sourceBytes: null,
      bundledBytes: bundledBytesForKinds(manifest, ['public_saved_project', 'public_project_catalogue']),
      panel: 'collections',
      actionLabel: 'Open public project workspaces',
    },
    {
      id: 'research',
      title: 'Literature and research',
      source: 'UNBC IWRG / nwsviz, public Zotero group 5510344 and original portal literature matches',
      description: 'Research titles, authors, resource types, publication dates and location tags.',
      measures: [
        captured(manifest, 'nwsviz research', manifest?.counts.research_records, 'records'),
        captured(manifest, 'Zotero collection', manifest?.counts.zotero_top_level_items, 'top-level items'),
        captured(manifest, 'Location references', manifest?.counts.location_ids, 'IDs'),
        observed('Portal literature title matches', 1411, 'submissions'),
      ],
      availability: 'bundled',
      coverage:
        'The portal title search reported 1,411 literature matches; this is a separate catalogue from nwsviz. nwsviz record IDs, Zotero keys and portal submission IDs have no verified crosswalk. These counts describe different collections and must not be added together.',
      sourceBytes: null,
      bundledBytes: bundledBytesForKinds(manifest, ['research']),
      panel: 'search',
      actionLabel: 'Search bundled research',
      workbenchView: 'research',
    },
    {
      id: 'monitoring',
      title: 'Monitoring and observations',
      source: 'Upper_Nechako ERA5 table · layer 386 / linked portal submission 1477',
      description: 'Station-linked measurements and observation series for time-series exploration.',
      measures: [
        observed('Earlier native table view', 77799, 'observations'),
        observed('Layer 386 / record 1 live read', 25933, 'observations'),
        observed('Loaded live page', 500, 'rows'),
        observed('Decoded page response', 197276, 'bytes'),
        observed('Whole monitoring collection', null, 'observations'),
      ],
      availability: 'partial',
      coverage:
        'The verified layer 386/record 1 gateway read reports 25,933 observations, with 500-row pages. Its measured page response was 197,276 decoded bytes. An earlier native table view reported 77,799 observations in a different scope. Neither count is the portal-wide total; full export and storage size remain unknown.',
      sourceBytes: null,
      bundledBytes: null,
      panel: 'monitoring',
      actionLabel: 'Open monitoring tools',
      workbenchView: 'monitoring',
    },
    {
      id: 'spatial',
      title: 'Spatial layers and shared places',
      source: 'Stewardship Portal, local QGIS Server and DataBC',
      description:
        'Water, boundaries, Nations and communities, forestry, wildlife, climate, disturbance and sampling locations.',
      measures: [
        observed('Original source registry', 37, 'entries'),
        observed('Approved shared places', 72, 'layers'),
        captured(manifest, 'Snapshot WMS catalogues', manifest?.counts.wms_services, 'services'),
        captured(manifest, 'Snapshot layer names', manifest?.counts.named_layers, 'layers / groups'),
      ],
      availability: 'partial',
      coverage:
        'The 37 registry entries include 30 capabilities catalogs, four direct WMS, two XYZ and one OSM. Sublayers and shared places are distinct measures. Bundled capabilities contain metadata; rendered maps still use live services.',
      sourceBytes: null,
      bundledBytes: bundledBytesForKinds(manifest, ['wms_catalogue', 'wms_capabilities']),
      workbenchView: 'layers',
    },
    {
      id: 'media',
      title: 'Attachments, photos, video and documents',
      source: 'Portal submission attachments / public Zotero links',
      description: 'Linked articles and downloadable material supporting research and contributed submissions.',
      measures: [
        captured(manifest, 'Earlier Zotero snapshot references', manifest?.counts.attachment_links, 'links'),
        observed('Original attachment collection', null, 'files'),
      ],
      availability: 'partial',
      coverage:
        'This earlier Zotero snapshot counts link metadata separately from the new anonymous submission attachment and media references shown above when available. Neither reference inventory includes PDF, photo, video or other file bodies. Full attachment-file counts and remote storage remain unknown.',
      sourceBytes: null,
      bundledBytes: bundledBytesForKinds(manifest, ['attachment_links']),
      panel: 'files',
      actionLabel: 'Open file previews',
    },
    {
      id: 'events',
      title: 'Events, tasks and notifications',
      source: 'Stewardship Portal Action Center and schedule',
      description: 'Calendar dates, assigned tasks, notifications, monitoring workflow and priorities.',
      measures: [
        observed('Title matches: event_or_activity', 5, 'submissions'),
        observed('Whole event / task collection', null, 'items'),
      ],
      availability: 'original',
      coverage:
        'The audited account showed no current notifications or tasks for the selected day; this does not establish an empty portal-wide collection.',
      sourceBytes: null,
      bundledBytes: null,
    },
    {
      id: 'administration',
      title: 'Forms, schemas and administration',
      source: 'Stewardship Portal administration',
      description:
        'Upload forms, schema definitions, accounts, groups, permissions, moderation and managed map sources.',
      measures: [
        observed('Form registry', 31, 'forms'),
        observed('Schema registry', 13, 'schemas'),
        observed('Accounts', 77, 'accounts'),
        observed('Groups', 5, 'groups'),
      ],
      availability: 'original',
      coverage:
        'Aggregate audit counts only. Account details and credentials are not included. The original configuration lists five GeoPackage-tool uploads per day and 40 project-history records; enforcement was not tested.',
      sourceBytes: null,
      bundledBytes: null,
      panel: 'account',
      actionLabel: 'View account access information',
      workbenchView: 'formats',
    },
  ]
}

export function filterPortalInventory(
  entries: readonly InventoryEntry[],
  query: string,
  facet: InventoryFacet,
): InventoryEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    const matchesFacet =
      facet === 'all' || (facet === 'bundled' ? entry.bundledBytes !== null : entry.availability !== 'bundled')
    const text = [
      entry.title,
      entry.source,
      entry.description,
      entry.coverage,
      ...entry.measures.map((m) => `${m.label} ${m.unit}`),
    ]
      .join(' ')
      .toLowerCase()
    return matchesFacet && words.every((word) => text.includes(word))
  })
}
