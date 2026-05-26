import { closeRing, lineLengthKm, measurementCanClose } from './geo'
import type { MeasurementMode } from './types'

const EARTH_RADIUS_KM = 6371.0088

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

export function measurementCircle(
  center: [number, number] | null,
  edge: [number, number] | null,
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!center || !edge) return { type: 'FeatureCollection', features: [] }
  const radiusKm = lineLengthKm([center, edge])
  if (radiusKm === 0) return { type: 'FeatureCollection', features: [] }
  const coordinates = circleCoordinates(center, radiusKm)
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id: 'measurement-circle' },
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    }],
  }
}

function circleCoordinates(center: [number, number], radiusKm: number, steps = 96): [number, number][] {
  const [lng, lat] = center
  const centerLat = lat * Math.PI / 180
  const centerLng = lng * Math.PI / 180
  const angularDistance = radiusKm / EARTH_RADIUS_KM

  const points = Array.from({ length: steps }, (_, index): [number, number] => {
    const bearing = (index / steps) * Math.PI * 2
    const pointLat = Math.asin(
      Math.sin(centerLat) * Math.cos(angularDistance) +
        Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing),
    )
    const pointLng = centerLng + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
      Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(pointLat),
    )

    return [
      ((pointLng * 180 / Math.PI + 540) % 360) - 180,
      pointLat * 180 / Math.PI,
    ]
  })

  return closeRing(points)
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
