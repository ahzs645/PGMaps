import { useMemo } from 'react'
import { EXPLORER_DATASETS } from '../constants'
import type {
  ExplorerDatasetId,
  ExplorerGeometryType,
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection,
} from '../types'

/**
 * Group the filtered items into per-dataset point/line/polygon
 * FeatureCollections for the map, and list the datasets shown in the legend.
 */
export function useExplorerMapData(
  filteredItems: ExplorerItem[],
  datasetSet: Set<ExplorerDatasetId>,
  geometrySet: Set<ExplorerGeometryType>,
) {
  const mapCollections = useMemo(() => {
    const pointCollections: ExplorerPointCollection[] = []
    const lineCollections: ExplorerLineCollection[] = []
    const polygonCollections: ExplorerPolygonCollection[] = []

    EXPLORER_DATASETS.forEach((dataset) => {
      const datasetItems = filteredItems.filter((item) => item.datasetId === dataset.id)
      if (dataset.geometryType === 'point') {
        pointCollections.push({
          datasetId: dataset.id,
          color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('point') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'Point')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.Point,
                properties: {
                  itemId: item.id,
                  datasetId: item.datasetId,
                  name: item.name,
                  subtitle: item.subtitle,
                  relevance: item.relevance,
                },
              })),
          },
        })
      }
      if (dataset.geometryType === 'line') {
        lineCollections.push({
          datasetId: dataset.id,
          color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('line') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'LineString' || item.geometry.type === 'MultiLineString')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.LineString | GeoJSON.MultiLineString,
                properties: {
                  itemId: item.id,
                  datasetId: item.datasetId,
                  name: item.name,
                  subtitle: item.subtitle,
                  relevance: item.relevance,
                },
              })),
          },
        })
      }
      if (dataset.geometryType === 'polygon') {
        polygonCollections.push({
          datasetId: dataset.id,
          color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('polygon') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'Polygon' || item.geometry.type === 'MultiPolygon')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
                properties: {
                  itemId: item.id,
                  datasetId: item.datasetId,
                  name: item.name,
                  subtitle: item.subtitle,
                  relevance: item.relevance,
                },
              })),
          },
        })
      }
    })
    return { pointCollections, lineCollections, polygonCollections }
  }, [datasetSet, filteredItems, geometrySet])

  const legendDatasets = useMemo(() => {
    return EXPLORER_DATASETS.filter(
      (dataset) =>
        datasetSet.has(dataset.id) &&
        geometrySet.has(dataset.geometryType) &&
        filteredItems.some((item) => item.datasetId === dataset.id),
    )
  }, [datasetSet, filteredItems, geometrySet])

  return {
    pointCollections: mapCollections.pointCollections,
    lineCollections: mapCollections.lineCollections,
    polygonCollections: mapCollections.polygonCollections,
    legendDatasets,
  }
}
