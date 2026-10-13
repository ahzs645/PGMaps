import { fetchBytes, fetchJson } from '@/lib/fetchJson'
import { parseWmsCapabilities, type PortalSource } from '@/lib/nechakoPortal'

export const SHOWCASE_BASE = '/data/nechako-showcase/'
export type CatalogueSource = 'snapshot' | 'live'
export type ShowcaseManifest = {
  schema: 'nechako-showcase-v1'
  captured_at_utc: string
  public_projects_captured_at_utc?: string
  attribution: string
  counts: {
    research_records: number
    location_ids: number
    mapped_locations: number
    unmapped_records: number
    decades: number
    wms_services: number
    named_layers: number
    attachment_links: number
    zotero_top_level_items: number
    public_saved_projects?: number
  }
  research_bytes: number
  snapshot_file_bytes: number
  limitations: string[]
  files: { path: string; source_url: string; kind: string; bytes: number; sha256: string }[]
}
export type ShowcaseAttachment = {
  id: string
  title: string
  content_type: string
  link_mode: string
  url: string
  size_bytes: number | null
}
type SnapshotService = { source: PortalSource; capabilities_file: string; named_layers: number }

export async function loadSnapshotSources(signal?: AbortSignal) {
  const entries = await fetchJson<SnapshotService[]>(`${SHOWCASE_BASE}services.json`, signal)
  return entries.map((entry) => entry.source)
}

export async function loadSnapshotCapabilities(source: PortalSource, signal?: AbortSignal) {
  const entries = await fetchJson<SnapshotService[]>(`${SHOWCASE_BASE}services.json`, signal)
  const entry = entries.find((item) => item.source.resource === source.resource)
  if (!entry) throw new Error('This service is not in the repository snapshot.')
  const { bytes } = await fetchBytes(`${SHOWCASE_BASE}${entry.capabilities_file}`, signal)
  return parseWmsCapabilities(new TextDecoder().decode(bytes))
}
