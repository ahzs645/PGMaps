import type { ExplorerDatasetDefinition, ExplorerDatasetId, ExplorerGeometryType } from './types'

export const EXPLORER_DATASETS: ExplorerDatasetDefinition[] = [
  {
    id: 'airMonitors',
    label: 'Air Monitors',
    geometryType: 'point',
    color: '#0ea5e9',
    description: 'Nationwide regulatory and community air quality sensors.',
    source: 'Air quality monitor feed'
  },
  {
    id: 'crime',
    label: 'Property Crime',
    geometryType: 'point',
    color: '#ef4444',
    description: 'Prince George property crime incidents with type, date, and community attributes.',
    source: 'City of Prince George / RCMP open data'
  },
  {
    id: 'restaurants',
    label: 'Food Inspections',
    geometryType: 'point',
    color: '#f97316',
    description: 'Restaurant and food facility locations with inspection history.',
    source: 'Northern Health inspections'
  },
  {
    id: 'parkAmenities',
    label: 'Park Amenities',
    geometryType: 'point',
    color: '#f59e0b',
    description: 'Amenities and facilities within parks and open spaces.',
    source: 'City open data'
  },
  {
    id: 'transitStops',
    label: 'Transit Stops',
    geometryType: 'point',
    color: '#2563eb',
    description: 'BC Transit bus stops with shelter, accessibility, and service-frequency attributes.',
    source: 'City open data + GTFS'
  },
  {
    id: 'icbcCrashes',
    label: 'ICBC Crashes',
    geometryType: 'point',
    color: '#dc2626',
    description: 'ICBC reported crash locations aggregated by intersection.',
    source: 'ICBC open data'
  },
  {
    id: 'wildlifeAccidents',
    label: 'Wildlife Accidents',
    geometryType: 'point',
    color: '#a16207',
    description: 'Wildlife-vehicle collisions reported via WARS across the Ministry Northern Region.',
    source: 'BC WARS'
  },
  {
    id: 'trails',
    label: 'Trails',
    geometryType: 'line',
    color: '#22c55e',
    description: 'Named trail corridors with use class and maintenance attributes.',
    source: 'City open data'
  },
  {
    id: 'transitRoutes',
    label: 'Transit Routes',
    geometryType: 'line',
    color: '#1d4ed8',
    description: 'BC Transit GTFS route shapes (bus lines).',
    source: 'BC Transit GTFS'
  },
  {
    id: 'parks',
    label: 'Parks',
    geometryType: 'polygon',
    color: '#15803d',
    description: 'Parks and open-space boundaries with classification metadata.',
    source: 'City open data'
  },
  {
    id: 'bcAssessment',
    label: 'BC Assessment Parcels',
    geometryType: 'polygon',
    color: '#9333ea',
    description: 'Property parcels with assessed values and category. Loads on first activation.',
    source: 'BC Assessment'
  },
  {
    id: 'censusDa',
    label: 'Census DAs',
    geometryType: 'polygon',
    color: '#b45309',
    description: 'Dissemination area boundaries with population attributes.',
    source: 'Statistics Canada 2021'
  },
  {
    id: 'censusCt',
    label: 'Census Tracts',
    geometryType: 'polygon',
    color: '#7c3aed',
    description: 'Census tract boundaries with aggregated population data.',
    source: 'Statistics Canada 2021'
  },
  {
    id: 'censusCsd',
    label: 'Census Subdivisions',
    geometryType: 'polygon',
    color: '#0d9488',
    description: 'Census subdivision (municipal) boundaries with population data.',
    source: 'Statistics Canada 2021'
  },
  {
    id: 'censusCd',
    label: 'Census Divisions',
    geometryType: 'polygon',
    color: '#be123c',
    description: 'Regional district / census division boundaries with population data.',
    source: 'Statistics Canada 2021'
  },
  {
    id: 'censusDb',
    label: 'Census Blocks',
    geometryType: 'polygon',
    color: '#475569',
    description: 'Smallest census geography (dissemination blocks) with population data.',
    source: 'Statistics Canada 2021'
  }
]

export const GEOMETRY_TYPE_LABEL: Record<ExplorerGeometryType, string> = {
  point: 'Point',
  line: 'Line',
  polygon: 'Polygon'
}

export const RELEVANCE_DESCRIPTION =
  'Relevance ranks features using available attributes such as activity, density, coverage, and data richness. Hover the score to see a breakdown.'

export const LOW_COST_NETWORKS = new Set(['PA', 'EGG'])

export function datasetById(datasetId: ExplorerDatasetId): ExplorerDatasetDefinition {
  return EXPLORER_DATASETS.find((dataset) => dataset.id === datasetId) || EXPLORER_DATASETS[0]
}
