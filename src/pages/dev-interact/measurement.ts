import { closeRing, measurementCanClose } from './geo'
import type { MeasurementMode } from './types'

export function measurementPolygon(points: [number, number][]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (points.length < 3) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'measurement' },
      geometry: { type: 'Polygon', coordinates: [closeRing(points)] },
    }],
  }
}

export function measurementLine(
  points: [number, number][],
  mode: MeasurementMode,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: points.length > 1
      ? [{
          type: 'Feature',
          properties: { id: 'measurement-line' },
          geometry: { type: 'LineString', coordinates: mode === 'complete' ? closeRing(points) : points },
        }]
      : [],
  }
}

export function measurementPreviewLine(
  points: [number, number][],
  cursor: [number, number] | null,
  mode: MeasurementMode,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (mode !== 'drawing' || points.length === 0 || !cursor) return { type: 'FeatureCollection', features: [] }

  const lastPoint = points[points.length - 1]
  const coordinates = measurementCanClose(points)
    ? [lastPoint, cursor, points[0]]
    : [lastPoint, cursor]

  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'measurement-preview-line' },
      geometry: { type: 'LineString', coordinates },
    }],
  }
}
