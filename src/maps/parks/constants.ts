import type { ParkClassification, TrailUserClass, TrailSurfaceClass } from './types'

export const PARK_CLASSIFICATION_COLORS: Record<ParkClassification, string> = {
  Athletic: '#059669',
  Community: '#2563eb',
  Downtown: '#7c3aed',
  'Green Space': '#16a34a',
  Major: '#dc2626',
  Nature: '#15803d',
  Neighbourhood: '#0891b2',
  Public: '#ca8a04',
  'Special Purpose': '#9333ea',
}

export const TRAIL_USER_CLASS_COLORS: Record<TrailUserClass, string> = {
  Walking: '#22c55e',
  Multiuse: '#f59e0b',
  Equine: '#a855f7',
}

export const TRAIL_SURFACE_ICONS: Record<TrailSurfaceClass, string> = {
  'Hard Surface': 'Paved',
  'Soft Surface': 'Natural',
  Granular: 'Gravel',
}

export const ARCGIS_BASE =
  'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/OpenData_ParkData/FeatureServer'

export const LAYER_IDS = {
  parks: 12,
  trails: 7,
  amenities: 3,
  playgrounds: 5,
  sportStructures: 2,
  facilities: 17,
} as const

export function getClassificationColor(classification: ParkClassification | null): string {
  if (!classification) return '#6b7280'
  return PARK_CLASSIFICATION_COLORS[classification] ?? '#6b7280'
}

export function getTrailColor(userClass: TrailUserClass | null): string {
  if (!userClass) return '#6b7280'
  return TRAIL_USER_CLASS_COLORS[userClass] ?? '#6b7280'
}
