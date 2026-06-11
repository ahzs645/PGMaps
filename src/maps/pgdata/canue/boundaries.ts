import { CANUE_BOUNDARY_LEVEL_TO_SOURCE } from './constants'
import type {
  BoundaryFeatureCollection,
  BoundaryIndexEntry,
  BoundaryLevelConfig,
  CanueBoundaryLevel,
  CanueBoundarySource,
} from './types'

export function parseCanueBoundaryLevel(value: string | null): CanueBoundaryLevel {
  return value && value in CANUE_BOUNDARY_LEVEL_TO_SOURCE ? (value as CanueBoundaryLevel) : 'chsa'
}

export function getDefaultCanueBoundaryLevel(source: CanueBoundarySource): CanueBoundaryLevel {
  if (source === 'bcHealth') return 'chsa'
  if (source === 'regionalDistrict') return 'regionalDistrict'
  if (source === 'cityPG') return 'elementarySchoolCatchment'
  if (source === 'watershed') return 'watershedGroup'
  if (source === 'nrAdmin') return 'nrArea'
  return 'da'
}

export function buildBoundaryIndex(
  boundaries: BoundaryFeatureCollection,
  config: BoundaryLevelConfig,
): BoundaryIndexEntry[] {
  return boundaries.features
    .filter((feature) => feature.geometry)
    .map((feature, index) => ({
      feature,
      bbox: [0, 0, 0, 0],
      id: String(feature.properties?.[config.idField] ?? feature.id ?? index),
      name: String(feature.properties?.[config.nameField] ?? feature.properties?.name ?? feature.id ?? index),
    }))
}
