import type { CanueVariableSelection } from '../canueV2'
import { resolvePeriodScale, type CanueColorScale } from './timelineScale'

export const CANUE_SCALE_COLORS = ['#67e8f9', '#facc15', '#ef4444'] as const

export const CANUE_BOUNDARY_FILL_OPACITY = 0.74
export const CANUE_GRID_FILL_OPACITY = 0.64

function scaleColor(scale: CanueColorScale, value: unknown) {
  const mid = scale.low + (scale.high - scale.low) / 2
  return [
    'interpolate',
    ['linear'],
    value,
    scale.low,
    CANUE_SCALE_COLORS[0],
    mid,
    CANUE_SCALE_COLORS[1],
    scale.high,
    CANUE_SCALE_COLORS[2],
  ]
}

/**
 * Null is the absence of a value: MapLibre's `['to-number', null]` would read it
 * as 0 and paint a measured-looking colour. Areas and cells without one are
 * transparent, so missing data cannot be taken for a layer still loading.
 *
 * Absence lives in the colour, not in `fill-opacity`, on purpose. MapLibre
 * re-parses a source's tiles whenever a paint value is or was data-driven, so
 * keeping opacity a plain number is what lets a layer appear without a re-parse.
 */
function hasGridValue(property: string) {
  return ['all', ['has', property], ['!=', ['get', property], null]]
}

const boundaryValue = ['feature-state', 'value']
const hasBoundaryValue = ['==', ['typeof', boundaryValue], 'number']

/** Grid cells carry their values in the tiles, so the colour reads their properties. */
export function canueV2Paint(selection: CanueVariableSelection | null, scale?: CanueColorScale | null) {
  if (!selection) return 'transparent'
  const resolved = scale ?? resolvePeriodScale(selection.min, selection.max)
  return [
    'case',
    hasGridValue(selection.property),
    scaleColor(resolved, ['to-number', ['get', selection.property]]),
    'transparent',
  ]
}

/**
 * Boundary values arrive through feature state, so stepping through time only
 * rewrites a number per shape. Colours never depend on a re-tile finishing.
 */
export function canueBoundaryPaint(scale: CanueColorScale) {
  return ['case', hasBoundaryValue, scaleColor(scale, ['number', boundaryValue, scale.low]), 'transparent']
}

/** Per-boundary feature state for one period. A missing value stays null, never 0. */
export function canueBoundaryFeatureState(
  features: readonly GeoJSON.Feature[],
  property: string,
): Record<string, { value: number | null }> {
  const state: Record<string, { value: number | null }> = {}
  for (const feature of features) {
    const id = feature.properties?.boundaryId ?? feature.id
    if (id == null) continue
    const raw = feature.properties?.[property]
    const value = raw == null || raw === '' ? null : Number(raw)
    state[String(id)] = { value: value != null && Number.isFinite(value) ? value : null }
  }
  return state
}
