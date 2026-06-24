export {
  BOUNDARY_SOURCE_OPTIONS,
  COMMUNITY_BOUNDARY_LEVEL_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS,
  CENSUS_BOUNDARY_LEVEL_OPTIONS,
  REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS,
  CITY_BOUNDARY_LEVEL_OPTIONS,
  WATERSHED_BOUNDARY_LEVEL_OPTIONS,
  NR_ADMIN_BOUNDARY_LEVEL_OPTIONS,
  WALKABILITY_COMMUNITY_BOUNDARY_LEVEL_OPTIONS,
  BOUNDARY_FILE_BY_LEVEL,
  BOUNDARY_INDEX_KEY_BY_LEVEL,
  BOUNDARY_CODE_PROPERTY_BY_LEVEL,
  BOUNDARY_NAME_PROPERTY_BY_LEVEL,
} from '@/lib/studyArea'
import {
  BOUNDARY_SOURCE_OPTIONS as _SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS as _SCORE_BUILDER_HEALTH_BOUNDARY_LEVEL_OPTIONS,
  type BoundarySourceOption,
} from '@/lib/studyArea'

// Backward-compatible alias used by existing imports.
export const BOUNDARY_LEVEL_OPTIONS = _SCORE_BUILDER_HEALTH_BOUNDARY_LEVEL_OPTIONS

/**
 * Boundary sources offered in the Index Lab. The Prince George community
 * walkability geography is exposed here only (not in the shared
 * `BOUNDARY_SOURCE_OPTIONS`) so it stays scoped to the score builder.
 */
export const SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS: BoundarySourceOption[] = [
  ..._SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS,
  {
    value: 'walkabilityCommunity',
    label: 'PG Community (walkability)',
    description: '31 Prince George community areas with precomputed walkability variants',
    group: 'Local',
  },
]
