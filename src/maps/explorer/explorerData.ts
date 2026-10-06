import { EXPLORER_DATASETS } from './constants'
import { boundsIntersect } from './utils'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerFeatureProperties,
  ExplorerGeometryType,
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection,
  SpatialFilter,
} from './types'
import type { SortMode } from './hooks/useExplorerFilters'

export function indexExplorerItems(items: readonly ExplorerItem[]) {
  const totals = new Map<ExplorerDatasetId, { count: number; sum: number; max: number }>()
  const rows = items.map((item) => {
    const total = totals.get(item.datasetId) ?? { count: 0, sum: 0, max: -Infinity }
    total.count++
    total.sum += item.relevance
    total.max = Math.max(total.max, item.relevance)
    totals.set(item.datasetId, total)
    return { item, text: [item.name, item.subtitle, item.summary].join(' ').toLowerCase() }
  })
  const datasetStats: ExplorerDatasetStat[] = EXPLORER_DATASETS.map((dataset) => {
    const total = totals.get(dataset.id)
    return {
      dataset,
      count: total?.count ?? 0,
      averageRelevance: total ? total.sum / total.count : 0,
      maxRelevance: total?.max ?? 0,
    }
  })
  return { rows, datasetStats }
}

type SearchRow = ReturnType<typeof indexExplorerItems>['rows'][number]

export function sortExplorerRows(rows: readonly SearchRow[], mode: SortMode): SearchRow[] {
  return [...rows].sort((a, b) =>
    mode === 'name'
      ? a.item.name.localeCompare(b.item.name) || b.item.relevance - a.item.relevance
      : b.item.relevance - a.item.relevance || a.item.name.localeCompare(b.item.name),
  )
}

export function filterExplorerRows(
  rows: readonly SearchRow[],
  query: string,
  datasets: ReadonlySet<ExplorerDatasetId>,
  geometries: ReadonlySet<ExplorerGeometryType>,
  spatialFilter: SpatialFilter | null,
): ExplorerItem[] {
  const text = query.trim().toLowerCase()
  return rows
    .filter(
      ({ item, text: searchable }) =>
        geometries.has(item.geometryType) &&
        datasets.has(item.datasetId) &&
        (!spatialFilter || boundsIntersect(item.bounds, spatialFilter)) &&
        (!text || searchable.includes(text)),
    )
    .map(({ item }) => item)
}

type Collection = ExplorerPointCollection | ExplorerLineCollection | ExplorerPolygonCollection

function reuseArray<T>(next: T[], previous: T[]): T[] {
  return next.length === previous.length && next.every((entry, index) => entry === previous[index]) ? previous : next
}

/** Cache only the current membership of each dataset; UI order is not map data. */
export function createExplorerMapDataBuilder() {
  const previous = new Map<ExplorerDatasetId, { members: Set<ExplorerItem>; collection: Collection }>()
  const features = new WeakMap<ExplorerItem, GeoJSON.Feature<GeoJSON.Geometry, ExplorerFeatureProperties>>()
  let pointCollections: ExplorerPointCollection[] = []
  let lineCollections: ExplorerLineCollection[] = []
  let polygonCollections: ExplorerPolygonCollection[] = []

  return (
    items: readonly ExplorerItem[],
    datasets: ReadonlySet<ExplorerDatasetId>,
    geometries: ReadonlySet<ExplorerGeometryType>,
  ) => {
    const grouped = new Map<ExplorerDatasetId, ExplorerItem[]>()
    for (const item of items) {
      let group = grouped.get(item.datasetId)
      if (!group) {
        group = []
        grouped.set(item.datasetId, group)
      }
      group.push(item)
    }
    const points: ExplorerPointCollection[] = []
    const lines: ExplorerLineCollection[] = []
    const polygons: ExplorerPolygonCollection[] = []
    const legendDatasets = []
    for (const dataset of EXPLORER_DATASETS) {
      const group = grouped.get(dataset.id) ?? []
      const visible = datasets.has(dataset.id) && geometries.has(dataset.geometryType) && group.length > 0
      const cached = previous.get(dataset.id)
      const unchanged =
        cached && cached.members.size === group.length && group.every((item) => cached.members.has(item))
      let collection: Collection
      if (unchanged) {
        collection = cached.collection.visible === visible ? cached.collection : { ...cached.collection, visible }
      } else {
        const data: GeoJSON.FeatureCollection<GeoJSON.Geometry, ExplorerFeatureProperties> = {
          type: 'FeatureCollection',
          features: group
            .filter((item) =>
              dataset.geometryType === 'point'
                ? item.geometry.type === 'Point'
                : dataset.geometryType === 'line'
                  ? ['LineString', 'MultiLineString'].includes(item.geometry.type)
                  : ['Polygon', 'MultiPolygon'].includes(item.geometry.type),
            )
            .map((item) => {
              let feature = features.get(item)
              if (!feature) {
                feature = {
                  type: 'Feature',
                  geometry: item.geometry,
                  properties: {
                    itemId: item.id,
                    datasetId: item.datasetId,
                    name: item.name,
                    subtitle: item.subtitle,
                    relevance: item.relevance,
                  },
                }
                features.set(item, feature)
              }
              return feature
            }),
        }
        collection = { datasetId: dataset.id, color: dataset.color, visible, data } as Collection
      }
      previous.set(dataset.id, { members: unchanged ? cached.members : new Set(group), collection })
      if (dataset.geometryType === 'point') points.push(collection as ExplorerPointCollection)
      if (dataset.geometryType === 'line') lines.push(collection as ExplorerLineCollection)
      if (dataset.geometryType === 'polygon') polygons.push(collection as ExplorerPolygonCollection)
      if (visible) legendDatasets.push(dataset)
    }
    pointCollections = reuseArray(points, pointCollections)
    lineCollections = reuseArray(lines, lineCollections)
    polygonCollections = reuseArray(polygons, polygonCollections)
    return { pointCollections, lineCollections, polygonCollections, legendDatasets }
  }
}
