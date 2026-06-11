import { useCallback } from 'react'
import type { ExplorerItem } from '../types'
import { downloadBlob } from '../utils'

export type ExplorerExportFormat = 'csv' | 'geojson'

/** Download the currently filtered items as CSV or GeoJSON. */
export function useExplorerExport(filteredItems: ExplorerItem[]) {
  return useCallback(
    (format: ExplorerExportFormat) => {
      if (format === 'csv') {
        const header = ['Name', 'Dataset', 'Geometry', 'Relevance', 'Subtitle', 'Summary']
        const rows = filteredItems.map((item) => [
          item.name,
          item.datasetId,
          item.geometryType,
          Math.round(item.relevance),
          item.subtitle,
          item.summary,
        ])
        const csv = [
          header.join(','),
          ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
        ].join('\n')
        downloadBlob(csv, 'explorer-items.csv', 'text/csv')
      } else {
        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: filteredItems.map((item) => ({
            type: 'Feature',
            geometry: item.geometry,
            properties: {
              id: item.id,
              name: item.name,
              dataset: item.datasetId,
              relevance: item.relevance,
              subtitle: item.subtitle,
              summary: item.summary,
            },
          })),
        }
        downloadBlob(JSON.stringify(fc, null, 2), 'explorer-items.geojson', 'application/geo+json')
      }
    },
    [filteredItems],
  )
}
