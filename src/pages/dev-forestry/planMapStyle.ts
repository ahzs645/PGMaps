import type { AssessmentMaskKind } from './types'

/**
 * The plan map's colours, read by both the layers in `DevForestryVisuals.tsx`
 * and `PlanMapLegend.tsx`, so a layer and its legend row cannot drift apart.
 */

/** Ground the road can see, and the hot end of the road ramp. */
export const VISIBLE_COLOR = '#ef4444'
/** Ground hidden from the road, or past the analysis range. */
export const SCREENED_COLOR = '#0f766e'
/** No terrain or canopy data to decide. */
export const UNKNOWN_COLOR = '#71717a'
export const ASSESSMENT_VIEWPOINT_COLOR = '#facc15'
export const ROAD_COLOR = '#1d4ed8'

/**
 * Exposure along a road, by the share of the block in view from it (%), cold
 * to hot. One hue family from slate through amber to the visible-ground red, so
 * a hot road and red ground read as the same thing.
 */
export const EXPOSURE_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#94a3b8'],
  [1, '#fcd34d'],
  [15, '#f59e0b'],
  [40, '#ea580c'],
  [70, VISIBLE_COLOR],
]
export const EXPOSURE_RAMP = ['interpolate', ['linear'], ['get', 'visiblePercent'], ...EXPOSURE_STOPS.flat()] as const

/** Visual sensitivity units from the inventory snapshot. */
export const SENSITIVITY_UNIT_COLORS = { fill: '#0ea5e9', rated: '#0284c7', unrated: '#94a3b8' } as const
/** A landform read from the terrain, and the other ridge layers it found. */
export const TERRAIN_CANDIDATE_COLOR = '#15803d'
export const OTHER_RIDGE_LAYER_COLOR = '#7c3aed'
/** Landform clues from the run: ridges, hollows and the rest. */
export const LANDFORM_CLUE_COLORS = { ridge: '#ea580c', hollow: '#0284c7', other: '#9333ea' } as const

/** BC's Visual Landscape Inventory viewpoints and their arrows, rec sites and screenings. */
export const INVENTORY_COLORS = {
  viewpoint: '#db2777',
  arrowOutline: '#be185d',
  recSite: '#16a34a',
  screening: '#0f766e',
} as const

/** Assessment masks by kind; their labels are `MASK_LABELS` in `assessmentMasks.ts`. */
export const MASK_COLORS: Record<AssessmentMaskKind, string> = {
  natural: '#64748b',
  private: '#a855f7',
  permanent: '#eab308',
  retained: '#16a34a',
}
