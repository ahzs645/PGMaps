import { describe, expect, it } from 'vitest'
import { createExplorerMapDataBuilder, filterExplorerRows, indexExplorerItems, sortExplorerRows } from './explorerData'
import type { ExplorerDatasetId, ExplorerGeometryType, ExplorerItem } from './types'

const datasets = new Set<ExplorerDatasetId>(['restaurants', 'transitStops'])
const geometries = new Set<ExplorerGeometryType>(['point'])
function item(id: string, datasetId: ExplorerDatasetId, relevance = 5): ExplorerItem {
  return {
    id,
    datasetId,
    relevance,
    name: id,
    subtitle: 'Prince George',
    summary: 'North',
    geometryType: 'point',
    geometry: { type: 'Point', coordinates: [-123, 54] },
    bounds: { minLng: -123, minLat: 54, maxLng: -123, maxLat: 54 },
    details: [],
    relevanceBreakdown: [],
  }
}

describe('Explorer data preparation', () => {
  it('preserves filtering, ordering, and statistics with precomputed search text', () => {
    const a = item('Alpha', 'restaurants', 4)
    const b = item('Beta', 'restaurants', 8)
    const c = item('Bus', 'transitStops', 6)
    const index = indexExplorerItems([a, b, c])
    const rows = sortExplorerRows(index.rows, 'relevance')
    expect(filterExplorerRows(rows, ' NORTH ', datasets, geometries, null)).toEqual([b, c, a])
    expect(filterExplorerRows(rows, 'alpha', datasets, geometries, null)).toEqual([a])
    expect(filterExplorerRows(rows, '', new Set(['restaurants']), geometries, null)).toEqual([b, a])
    expect(filterExplorerRows(rows, '', datasets, geometries, { minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 })).toEqual(
      [],
    )
    expect(filterExplorerRows(sortExplorerRows(index.rows, 'name'), '', datasets, geometries, null)).toEqual([a, b, c])
    expect(index.datasetStats.find((stat) => stat.dataset.id === 'restaurants')).toMatchObject({
      count: 2,
      averageRelevance: 6,
      maxRelevance: 8,
    })
  })

  it('does not replace map sources for list reordering or unchanged dataset matches', () => {
    const build = createExplorerMapDataBuilder()
    const a = item('Alpha', 'restaurants')
    const b = item('Beta', 'restaurants')
    const c = item('Bus', 'transitStops')
    const first = build([a, b, c], datasets, geometries)
    const reordered = build([c, b, a], datasets, geometries)
    expect(reordered.pointCollections).toBe(first.pointCollections)
    expect(reordered.lineCollections).toBe(first.lineCollections)
    const restaurant = first.pointCollections.find((collection) => collection.datasetId === 'restaurants')!
    const bus = first.pointCollections.find((collection) => collection.datasetId === 'transitStops')!
    const filtered = build([a, c], datasets, geometries)
    expect(filtered.pointCollections.find((collection) => collection.datasetId === 'transitStops')).toBe(bus)
    expect(filtered.pointCollections.find((collection) => collection.datasetId === 'restaurants')!.data).not.toBe(
      restaurant.data,
    )
    const hidden = build([a, c], new Set(['restaurants']), geometries)
    expect(hidden.pointCollections.find((collection) => collection.datasetId === 'transitStops')!.data).toBe(bus.data)
    expect(hidden.legendDatasets.map((dataset) => dataset.id)).toEqual(['restaurants'])
    const changed = build([a, { ...c, subtitle: 'Updated' }], datasets, geometries)
    expect(
      changed.pointCollections.find((collection) => collection.datasetId === 'transitStops')!.data.features[0]
        .properties.subtitle,
    ).toBe('Updated')
  })
})
