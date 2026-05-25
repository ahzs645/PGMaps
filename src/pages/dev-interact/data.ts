import { Search, Ruler } from 'lucide-react'
import type { InteractFeatureProperties, LayerId, LineFeature, PolygonFeature } from './types'

export const CENTER: [number, number] = [-122.7497, 53.9171]

export const parkFeatures: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: [
    polygonFeature('cottonwood', 'Cottonwood Island Park', 'parks', 'Riverfront park and trail access.', [
      [-122.757, 53.923],
      [-122.746, 53.925],
      [-122.742, 53.919],
      [-122.751, 53.915],
      [-122.761, 53.918],
      [-122.757, 53.923],
    ], 'Large natural park'),
    polygonFeature('lheidli', 'Lheidli T\'enneh Memorial Park', 'parks', 'Central gathering space near downtown.', [
      [-122.753, 53.910],
      [-122.743, 53.912],
      [-122.740, 53.906],
      [-122.748, 53.902],
      [-122.757, 53.905],
      [-122.753, 53.910],
    ], 'Civic park'),
  ],
}

export const neighbourhoodFeatures: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: [
    polygonFeature('downtown', 'Downtown', 'neighbourhoods', 'Mixed-use core with civic destinations.', [
      [-122.762, 53.919],
      [-122.740, 53.921],
      [-122.735, 53.906],
      [-122.754, 53.899],
      [-122.770, 53.908],
      [-122.762, 53.919],
    ], 'Core area'),
    polygonFeature('college-heights', 'College Heights', 'neighbourhoods', 'Residential area with ridge views.', [
      [-122.820, 53.902],
      [-122.785, 53.908],
      [-122.774, 53.887],
      [-122.802, 53.875],
      [-122.830, 53.884],
      [-122.820, 53.902],
    ], 'Residential'),
  ],
}

export const routeFeatures: GeoJSON.FeatureCollection<GeoJSON.LineString, InteractFeatureProperties> = {
  type: 'FeatureCollection',
  features: [
    lineFeature('route-15', 'Route 15', 'routes', 'East-west transit spine through the city centre.', [
      [-122.815, 53.894],
      [-122.790, 53.902],
      [-122.760, 53.911],
      [-122.733, 53.918],
      [-122.704, 53.928],
    ], '15 min'),
    lineFeature('route-5', 'Route 5', 'routes', 'North-south route connecting parks and downtown.', [
      [-122.777, 53.940],
      [-122.761, 53.923],
      [-122.749, 53.909],
      [-122.740, 53.891],
      [-122.728, 53.874],
    ], '30 min'),
  ],
}

export const actionRows = [
  { label: 'Search locations', icon: Search },
  { label: 'Measure areas', icon: Ruler },
]

function polygonFeature(
  id: string,
  name: string,
  layer: LayerId,
  description: string,
  ring: [number, number][],
  value: string,
): PolygonFeature {
  return {
    type: 'Feature',
    id,
    properties: { id, name, layer, description, value, properties: featureProperties(layer, value) },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

function lineFeature(
  id: string,
  name: string,
  layer: LayerId,
  description: string,
  coordinates: [number, number][],
  value: string,
): LineFeature {
  return {
    type: 'Feature',
    id,
    properties: { id, name, layer, description, value, properties: featureProperties(layer, value) },
    geometry: { type: 'LineString', coordinates },
  }
}

function featureProperties(layer: LayerId, value: string): Array<{ label: string; value: string }> {
  if (layer === 'parks') {
    return [
      { label: 'Category', value },
      { label: 'Access', value: 'Public' },
      { label: 'Trail Connection', value: 'Yes' },
      { label: 'Maintained By', value: 'City of Prince George' },
      { label: 'Inspection Status', value: 'Active' },
    ]
  }
  if (layer === 'routes') {
    return [
      { label: 'Route Type', value: 'Transit' },
      { label: 'Frequency', value },
      { label: 'Service Status', value: 'Active' },
      { label: 'Primary Corridor', value: 'Yes' },
      { label: 'Stops in View', value: '8' },
    ]
  }
  return [
    { label: 'Area Type', value },
    { label: 'Profile', value: 'Neighbourhood' },
    { label: 'Map Layer', value: 'Boundary' },
    { label: 'Feature Count', value: '1' },
    { label: 'Selection Status', value: 'Active' },
  ]
}
