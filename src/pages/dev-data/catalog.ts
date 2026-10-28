import type { AttributeOverride } from '@/lib/featureAttributes'
import catalogJson from './catalog.generated.json'

export type CatalogGeometry = 'fill' | 'line' | 'point'

/** One City of Prince George snapshot, from `scripts/generate-dev-data-catalog.mjs`. */
export interface CatalogEntry {
  id: string
  name: string
  category: string
  path: string
  sourceUrl: string
  geometry: CatalogGeometry
  rowCount: number
  bytes: number
  snapshotDate: string | null
}

export const CATALOG_SOURCE: string = catalogJson.source
export const CATALOG: CatalogEntry[] = catalogJson.layers as CatalogEntry[]
export const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]))

/** Files above this size get a warning in the library before they are added. */
export const LARGE_LAYER_BYTES = 8 * 1024 * 1024

/** How a preset wants the layer styled when it is first added. */
export type StylePreset =
  | { type: 'simple'; color: string }
  | { type: 'categories'; column: string }
  | { type: 'range'; column: string }

/**
 * Curated presentation for layers we know: friendlier names, the attribute used
 * as each feature's title, display names and formats, the popup's key fields and
 * a starting style. Any catalogue layer without a preset still works from the
 * inferred schema.
 */
export interface LayerPreset {
  label?: string
  description?: string
  nameKey?: string
  attributes?: AttributeOverride[]
  /** Attributes shown in popups and tooltips, in order. */
  popupKeys?: string[]
  style?: StylePreset
  opacity?: number
}

export const LAYER_PRESETS: Record<string, LayerPreset> = {
  'community-boundaries': {
    description: 'Named community areas used for city reporting.',
    nameKey: 'CommunityName',
    attributes: [{ key: 'CommunityName', label: 'Community' }],
    popupKeys: ['Shape__Area'],
    style: { type: 'simple', color: '#6366f1' },
    opacity: 0.08,
  },
  'subdivision-boundaries': {
    description: 'Subdivisions nested inside each community.',
    nameKey: 'SubdivisionName',
    attributes: [
      { key: 'SubdivisionName', label: 'Subdivision' },
      { key: 'CommunityName', label: 'Community' },
    ],
    popupKeys: ['CommunityName', 'Shape__Area'],
    style: { type: 'simple', color: '#8b5cf6' },
    opacity: 0.12,
  },
  'civic-facility-buildings': {
    label: 'Civic facilities',
    description: 'City-owned buildings with type, area and expected life.',
    nameKey: 'LongName',
    attributes: [
      { key: 'LongName', label: 'Facility' },
      { key: 'ShortName', label: 'Short name' },
      { key: 'SubType_TEXT', label: 'Facility type' },
      { key: 'Location', label: 'Address' },
      { key: 'BldgArea', label: 'Building area', format: { kind: 'number', digits: 0, suffix: ' m²' } },
      { key: 'ExpectedLife', label: 'Expected life', format: { kind: 'number', digits: 0, suffix: ' yr' } },
      { key: 'InstallDate', label: 'Installed' },
    ],
    popupKeys: ['SubType_TEXT', 'Location', 'BldgArea', 'ExpectedLife', 'InstallDate'],
    style: { type: 'categories', column: 'SubType_TEXT' },
    opacity: 0.6,
  },
  'parks-facilities': {
    label: 'Park facilities',
    description: 'Park structures with construction type and servicing.',
    nameKey: 'Location',
    attributes: [
      { key: 'Location', label: 'Park' },
      { key: 'ConstructionType', label: 'Construction' },
      { key: 'LifeCycleStatus', label: 'Status' },
      { key: 'Height_m', label: 'Height', format: { kind: 'number', digits: 1, suffix: ' m' } },
      { key: 'InstallDate', label: 'Installed' },
    ],
    popupKeys: ['ConstructionType', 'LifeCycleStatus', 'Height_m', 'InstallDate'],
    style: { type: 'simple', color: '#16a34a' },
    opacity: 0.55,
  },
  'active-transportation-cycle-network': {
    label: 'Cycle network',
    description: 'Active-transportation cycling segments.',
    attributes: [
      { key: 'NetworkType', label: 'Network type' },
      { key: 'LifeCycleStatus', label: 'Status' },
    ],
    popupKeys: ['NetworkType', 'LifeCycleStatus', 'Shape__Length'],
    style: { type: 'categories', column: 'NetworkType' },
    opacity: 0.9,
  },
  sidewalks: {
    description: '1,700 sidewalk segments.',
    nameKey: 'Location',
    attributes: [
      { key: 'Location', label: 'Location' },
      { key: 'SurfaceMaterial', label: 'Surface' },
      { key: 'Width', label: 'Width', format: { kind: 'number', digits: 1, suffix: ' m' } },
      { key: 'LifeCycleStatus', label: 'Status' },
      { key: 'InstallDate', label: 'Installed' },
    ],
    popupKeys: ['SurfaceMaterial', 'Width', 'LifeCycleStatus', 'InstallDate'],
    style: { type: 'categories', column: 'SurfaceMaterial' },
    opacity: 0.85,
  },
  'snow-removal': {
    label: 'Snow removal routes',
    description: '5,400 road segments by removal priority.',
    nameKey: 'StrName',
    attributes: [
      { key: 'StrName', label: 'Street' },
      { key: 'StrType', label: 'Type' },
      { key: 'RemovalPriority', label: 'Priority', format: { kind: 'number', digits: 0 } },
      { key: 'RoadClass', label: 'Road class', format: { kind: 'number', digits: 0 } },
      { key: 'LifeCycleStatus', label: 'Status' },
    ],
    popupKeys: ['RemovalPriority', 'RoadClass', 'LifeCycleStatus'],
    style: { type: 'categories', column: 'RemovalPriority' },
    opacity: 0.9,
  },
  'parks-public-art': {
    label: 'Public art',
    description: 'Sculptures, murals and plaques in parks and public places.',
    nameKey: 'Title',
    attributes: [
      { key: 'Title', label: 'Title' },
      { key: 'Artist', label: 'Artist' },
      { key: 'Location', label: 'Location' },
      { key: 'Material', label: 'Material' },
      { key: 'Year', label: 'Year' },
      { key: 'Description', label: 'Description' },
    ],
    popupKeys: ['Artist', 'Location', 'Material', 'Year', 'Description'],
    style: { type: 'simple', color: '#db2777' },
  },
  'transit-bus-stops': {
    style: { type: 'simple', color: '#0ea5e9' },
  },
}

/** What the page opens with, and which of those start switched on. */
export const INITIAL_LAYERS: Array<{ id: string; visible: boolean }> = [
  { id: 'community-boundaries', visible: true },
  { id: 'subdivision-boundaries', visible: false },
  { id: 'civic-facility-buildings', visible: true },
  { id: 'parks-facilities', visible: true },
  { id: 'parks-public-art', visible: true },
  { id: 'active-transportation-cycle-network', visible: true },
  { id: 'sidewalks', visible: false },
  { id: 'snow-removal', visible: false },
]

/** Group display modes on first load. Boundaries overlap, so they show one at a time. */
export const INITIAL_GROUP_MODES: Record<string, 'all' | 'one' | 'swipe'> = {
  Boundaries: 'one',
}

/** Groups a catalogue layer joins; community boundaries get their own group because they overlap. */
export function groupForEntry(entry: CatalogEntry): string {
  if (/boundar/i.test(entry.name)) return 'Boundaries'
  return entry.category
}
