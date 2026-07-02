import { Search, Ruler, Table2 } from 'lucide-react'
import { formatCompactCurrency } from '@/lib/format'
import type { InteractFeatureProperties, LayerId, LineFeature, PolygonFeature } from './types'

export const CENTER: [number, number] = [-122.7497, 53.9171]
export const YEAR_FILTER_DOMAIN: [number, number] = [2014, 2024]

export const mapDatasetMeta = {
  updated: '2026-05-25T20:40:00-07:00',
  source: 'PGMaps dev sample layers',
}

export const yearHistogramBins = [
  { year: 2014, count: 18 },
  { year: 2015, count: 31 },
  { year: 2016, count: 42 },
  { year: 2017, count: 29 },
  { year: 2018, count: 53 },
  { year: 2019, count: 46 },
  { year: 2020, count: 25 },
  { year: 2021, count: 34 },
  { year: 2022, count: 38 },
  { year: 2023, count: 27 },
  { year: 2024, count: 16 },
]

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
  { label: 'Open table', icon: Table2 },
]

function polygonFeature(
  id: string,
  name: string,
  layer: LayerId,
  description: string,
  ring: [number, number][],
  value: string,
): PolygonFeature {
  const meta = featureMeta(id)
  return {
    type: 'Feature',
    id,
    properties: { id, name, layer, description, value, issuedYear: meta.issuedYear, cost: meta.cost, properties: featureProperties(layer, value, meta) },
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
  const meta = featureMeta(id)
  return {
    type: 'Feature',
    id,
    properties: { id, name, layer, description, value, issuedYear: meta.issuedYear, cost: meta.cost, properties: featureProperties(layer, value, meta) },
    geometry: { type: 'LineString', coordinates },
  }
}

function featureMeta(id: string): { issuedYear: number; cost: number } {
  const meta: Record<string, { issuedYear: number; cost: number }> = {
    cottonwood: { issuedYear: 2016, cost: 820_000 },
    lheidli: { issuedYear: 2020, cost: 1_240_000 },
    downtown: { issuedYear: 2018, cost: 6_600_000 },
    'college-heights': { issuedYear: 2023, cost: 2_180_000 },
    'route-15': { issuedYear: 2015, cost: 430_000 },
    'route-5': { issuedYear: 2024, cost: 375_000 },
  }
  return meta[id] ?? { issuedYear: 2019, cost: 0 }
}

const formatCurrency = formatCompactCurrency

function featureProperties(layer: LayerId, value: string, meta: { issuedYear: number; cost: number }): Array<{ label: string; value: string }> {
  if (layer === 'parks') {
    return [
      { label: 'Category', value },
      { label: 'Year Issued', value: String(meta.issuedYear) },
      { label: 'Estimated Cost', value: formatCurrency(meta.cost) },
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
      { label: 'Year Issued', value: String(meta.issuedYear) },
      { label: 'Estimated Cost', value: formatCurrency(meta.cost) },
      { label: 'Service Status', value: 'Active' },
      { label: 'Primary Corridor', value: 'Yes' },
      { label: 'Stops in View', value: '8' },
    ]
  }
  return [
    { label: 'Area Type', value },
    { label: 'Year Issued', value: String(meta.issuedYear) },
    { label: 'Estimated Cost', value: formatCurrency(meta.cost) },
    { label: 'Profile', value: 'Neighbourhood' },
    { label: 'Map Layer', value: 'Boundary' },
    { label: 'Feature Count', value: '1' },
    { label: 'Selection Status', value: 'Active' },
  ]
}
