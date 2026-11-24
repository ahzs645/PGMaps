/**
 * What the plan map draws of an old forest calculation for one schedule and year: the shapes come
 * from the worker's own run of the calculation (`unitYears`'s `drawYear` in `oldForest.ts`), never
 * from the page, and are simplified for display only (`MAP_SIMPLIFY_METRES`). No figure is read
 * from a drawn shape. Kept for the session only: never in the plan file or the record.
 *
 * DOM- and network-free.
 */
import type { LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'
import type { InteriorMethod, YearFigures } from './oldForest'

/**
 * The shapes are simplified by this in BC Albers before they reach the map (JSTS's topology-
 * preserving simplifier). Display only: every figure is measured on the unsimplified ground.
 */
export const MAP_SIMPLIFY_METRES = 10

/** Kinds in the order they are drawn, bottom first. */
export const DRAWN_KINDS = [
  'excluded',
  'edge-band',
  'old-edge',
  'old-narrow',
  'interior',
  'younger',
  'counted',
  'corridor',
] as const
export type DrawnKind = (typeof DRAWN_KINDS)[number]

/** Legend labels, short enough for the legend's row; the legend's note says what an edge is. */
export const DRAWN_LABELS: Record<DrawnKind, string> = {
  excluded: 'Off the order’s land base',
  'edge-band': '200 m from an edge',
  'old-edge': 'Old, by an edge',
  'old-narrow': 'Old, too narrow',
  interior: 'Old interior',
  younger: 'Younger, by D.4',
  counted: 'D.1, not old by age',
  corridor: 'Corridor (2005 method)',
}

export interface DrawnFeature {
  kind: DrawnKind
  /** The pooled unit it belongs to. */
  unit: string
  geometry: Polygon | MultiPolygon | LineString | MultiLineString
}

/** One unit's shapes for one year, with the hectares drawn (measured before simplifying, unscaled). */
export interface DrawnGround {
  year: number
  features: DrawnFeature[]
  drawnHa: Partial<Record<DrawnKind, number>>
}

/** The worker's answer for the map: every unit's shapes and the figures the same run gave. */
export interface OldForestDrawing {
  /** The record key the run was made for, and the schedule and year drawn. */
  key: string
  schedule: string
  year: number
  /** The interior method the edges were drawn by. */
  method: InteriorMethod
  /** When the stands drawn were read: the record's read, or this session's. */
  readOn: string
  units: { unit: string; figures: YearFigures; drawnHa: DrawnGround['drawnHa'] }[]
  features: DrawnFeature[]
}

/**
 * Where the drawing's figures differ from the record's for the same schedule and year (a read made
 * on another day, say), the words to say so; null when they agree to the hectare.
 */
export function drawingDisagrees(
  drawing: Pick<OldForestDrawing, 'readOn' | 'units'>,
  recordReadOn: string,
  recordYears: (unit: string) => YearFigures | undefined,
): string | null {
  const off: string[] = []
  for (const u of drawing.units) {
    const r = recordYears(u.unit)
    if (!r) continue
    const pairs: [string, number | null, number | null][] = [
      ['old', u.figures.oldHa, r.oldHa],
      ['interior', u.figures.interiorHa, r.interiorHa],
    ]
    for (const [what, drawn, kept] of pairs)
      if (drawn !== null && kept !== null && Math.round(drawn) !== Math.round(kept))
        off.push(`${u.unit} ${what} ${Math.round(drawn)} ha drawn, ${Math.round(kept)} ha in the record`)
  }
  if (!off.length) return null
  return `The map was drawn from stands read ${drawing.readOn}; the record was read ${recordReadOn}, and they differ (${off.join('; ')}). Calculate again before relying on either.`
}
