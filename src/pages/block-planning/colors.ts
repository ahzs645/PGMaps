import { bins, type Bin } from '../forest-patches/project'
import type { DrawnKind } from './oldForest/drawing'

/**
 * The planner's colours, checked with the dataviz validator (categorical: every adjacent pair
 * clears the CVD and normal-vision floors in both modes; classes: one hue, light to dark).
 * Light-mode slots 3–5 sit under 3:1 on the surface, so the chart always has its legend and the
 * period table beside it.
 */
const SCHEDULE_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const SCHEDULE_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767']
export const MAX_COLOURED_SCHEDULES = SCHEDULE_LIGHT.length
const OVERFLOW = '#8a8a86'

/** A schedule's colour follows its place in the plan, never its rank in a chart. */
export function scheduleColour(index: number, dark: boolean) {
  return (dark ? SCHEDULE_DARK : SCHEDULE_LIGHT)[index] ?? OVERFLOW
}

/** Patch size classes, smallest lightest. */
export const CLASS_COLOURS: Record<Bin, string> = Object.fromEntries(
  bins.map((bin, i) => [bin, ['#86b6ef', '#5598e7', '#256abf', '#104281'][i]]),
) as Record<Bin, string>
export const UNCLASSIFIED_COLOUR = '#a3a3a0'

/**
 * Old and interior forest on the map (`oldForest/drawing.ts`), defined once for the layers and the
 * legend. Old forest is one green ramp, light to dark, from ground within 200 m of an edge to
 * interior. The other kinds differ by mark as well as hue (validator: the dashed D.1 outline and
 * the grey excluded fill fall under the CVD floor against each other, so they are told apart by
 * mark: an outline against a fill).
 */
export const OLD_FOREST_COLOURS: Record<DrawnKind, string> = {
  excluded: '#78716c',
  'edge-band': '#d4a017',
  'old-edge': '#9fd49a',
  'old-narrow': '#4f9a4a',
  interior: '#14532d',
  younger: '#7c3aed',
  counted: '#be185d',
  corridor: '#292524',
}

/**
 * Stream crossings on the map by standing (`crossings/standing.ts`), worst warmest; a crossing read
 * but not added is drawn smaller and faded in the candidate grey, so it never reads as a standing.
 */
export const CROSSING_COLOURS = {
  error: '#7f1d1d',
  raised: '#dc2626',
  undated: '#9333ea',
  open: '#d97706',
  unreviewed: '#2563eb',
  clear: '#15803d',
  candidate: '#a3a3a0',
} as const

/** Map ink: blocks, past disturbances and riparian zones. */
export const MAP_COLOURS = {
  block: '#c2410c',
  blockLater: '#c2410c',
  blockUncut: '#78716c',
  disturbance: '#7c5c3b',
  zone: '#0e7490',
  unit: '#334155',
  selected: '#111827',
}
