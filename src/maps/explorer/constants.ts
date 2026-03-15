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
    id: 'trails',
    label: 'Trails',
    geometryType: 'line',
    color: '#22c55e',
    description: 'Named trail corridors with use class and maintenance attributes.',
    source: 'City open data'
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
