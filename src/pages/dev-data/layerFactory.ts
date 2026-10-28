import type { ImportedCollection } from '@/lib/geoFileImport'
import {
  CATALOG_BY_ID,
  INITIAL_GROUP_MODES,
  INITIAL_LAYERS,
  LAYER_PRESETS,
  groupForEntry,
  type CatalogEntry,
} from './catalog'
import { fallbackColor } from './layerData'
import type { DataLayer, WorkspaceState } from './model'

export const UPLOADS_GROUP = 'Your uploads'

const DEFAULT_OPACITY = { fill: 0.45, line: 0.9, point: 0.9 } as const

/** A catalogue snapshot as a map layer, with its preset when there is one. */
export function layerFromCatalog(entry: CatalogEntry, visible = true): DataLayer {
  const preset = LAYER_PRESETS[entry.id] ?? {}
  return {
    id: entry.id,
    label: preset.label ?? entry.name,
    description: preset.description,
    geometry: entry.geometry,
    group: groupForEntry(entry),
    source: { kind: 'catalog', entry },
    nameKey: preset.nameKey,
    attributes: preset.attributes ?? [],
    popupKeys: preset.popupKeys,
    style: null,
    stylePreset: preset.style ?? { type: 'simple', color: fallbackColor(entry.id) },
    opacity: preset.opacity ?? DEFAULT_OPACITY[entry.geometry],
    visible,
    showInLegend: true,
    filter: null,
  }
}

/** Most features decide how an uploaded layer is drawn. */
function dominantGeometry(collection: GeoJSON.FeatureCollection): DataLayer['geometry'] {
  const counts = { fill: 0, line: 0, point: 0 }
  for (const feature of collection.features) {
    const type = feature.geometry?.type ?? ''
    if (type.includes('Polygon')) counts.fill += 1
    else if (type.includes('LineString')) counts.line += 1
    else if (type.includes('Point')) counts.point += 1
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as DataLayer['geometry']) ?? 'fill'
}

export function layerFromUpload(id: string, fileName: string, imported: ImportedCollection): DataLayer {
  const geometry = dominantGeometry(imported.collection)
  return {
    id,
    label: imported.name,
    geometry,
    group: UPLOADS_GROUP,
    source: { kind: 'upload', fileName, rowCount: imported.collection.features.length, skipped: imported.skipped },
    attributes: [],
    style: null,
    stylePreset: { type: 'simple', color: fallbackColor(id) },
    opacity: DEFAULT_OPACITY[geometry],
    visible: true,
    showInLegend: true,
    filter: null,
  }
}

export function initialWorkspace(): WorkspaceState {
  return {
    groups: Object.entries(INITIAL_GROUP_MODES).map(([id, mode]) => ({ id, mode })),
    layers: INITIAL_LAYERS.flatMap(({ id, visible }) => {
      const entry = CATALOG_BY_ID.get(id)
      return entry ? [layerFromCatalog(entry, visible)] : []
    }),
  }
}
