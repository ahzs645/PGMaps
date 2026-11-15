/**
 * Fills the analysis sheet's red visual inventory circle (VSU # / VSC / VAC / EVC / VQO) from the
 * page's live visual inventory read, and says which rule chose the unit, since a landform often
 * spans several:
 *
 * 1. the unit under the blocks' visible ground at the view's station, dominant by visible samples;
 * 2. else the unit the landform was adopted from;
 * 3. else the unit holding most of the landform's ground.
 *
 * Ported from the VIA figure-style prototype's `vsuBadge.ts` (November 2026), which read the units
 * a VIA document printed; here they come from `REC_VISUAL_LANDSCAPE_INVENTORY`. No DOM or network
 * access.
 */
import type { BcSensitivityUnit } from './bcVisualInventory'
import { visualQualityClass } from './vqo'
import { pointInPolygon, polygonBounds, preparePolygons, type PolygonGeometry } from './visibility'

export type BadgeUnit = Pick<BcSensitivityUnit, 'id' | 'polygonNumber' | 'objectiveId' | 'vac' | 'vsc' | 'geometry'> &
  Partial<Pick<BcSensitivityUnit, 'evc' | 'vsuNumber' | 'updated'>>

/**
 * What chose a view's unit, kept with the saved view (`SavedFigure.inventoryAt`), so a read made after the view was
 * saved fills its unit by the same rules.
 */
export type InventoryBadgeInput = {
  /** The blocks' sample points the view's station sees, thinned to `BADGE_POINTS_KEPT`. */
  visibleBlockPoints: ReadonlyArray<readonly [number, number]>
  landformUnitId?: string | null
  landform?: PolygonGeometry | null
}

/** Visible block points kept with a saved view: enough for the dominant unit's share to the percent. */
export const BADGE_POINTS_KEPT = 600

/** Every n-th point, so at most `max` stay, spread over the whole list. */
export function thinPoints<T>(points: readonly T[], max = BADGE_POINTS_KEPT): T[] {
  if (points.length <= max) return [...points]
  const step = points.length / max
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)])
}

export type InventoryBadge = {
  unit: BadgeUnit | null
  /** The four lines the circle prints: VSU, VSC, VAC / EVC, VQO. Unknown values print "?". */
  lines: [string, string, string, string]
  /** The values themselves, for the sheet's rating code. */
  values: { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string; date?: string }
  /** Which rule chose the unit, printed small under the circle. */
  note: string
}

const VAC_CODES = { low: 'L', medium: 'M', high: 'H' } as const

/** Grid points inside a polygon, about `count` of them, for reading which unit holds it. */
function pointsInside(geometry: PolygonGeometry, count = 400): Array<[number, number]> {
  const [w, s, e, n] = polygonBounds(geometry)
  const side = Math.max(2, Math.ceil(Math.sqrt(count * 2)))
  const out: Array<[number, number]> = []
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const lng = w + ((i + 0.5) / side) * (e - w),
        lat = s + ((j + 0.5) / side) * (n - s)
      if (pointInPolygon(geometry, lng, lat)) out.push([lng, lat])
    }
  return out
}

/**
 * The unit holding most of `points`, with its share; null when none holds any. The units are prepared once
 * (`preparePolygons`): the WFS keeps full-resolution coasts, 657,000 vertices in 118 units around Captain Island, and
 * a `pointInPolygon` loop over them took 15 s for 20,000 points.
 */
function dominant(units: readonly BadgeUnit[], points: ReadonlyArray<readonly [number, number]>) {
  const counts = new Map<BadgeUnit, number>()
  const prepared = preparePolygons(units.map((unit) => unit.geometry))
  for (const [lng, lat] of points) {
    const unit = units[prepared.indexAt(lng, lat)]
    if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1)
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]
  return best ? { unit: best[0], share: best[1] / Math.max(1, points.length), units: counts.size } : null
}

const label = (unit: BadgeUnit) => unit.vsuNumber || unit.polygonNumber

/** A unit's codes as the circle, the sheets and the reports print them: VSU (else the VLI polygon), VAC as L/M/H. */
export function unitValues(unit: BadgeUnit): InventoryBadge['values'] & { vsu: string } {
  return {
    vsu: label(unit),
    ...(unit.vsc ? { vsc: unit.vsc } : {}),
    ...(unit.vac ? { vac: VAC_CODES[unit.vac] } : {}),
    ...(unit.evc ? { evc: unit.evc } : {}),
    ...(unit.objectiveId ? { vqo: visualQualityClass(unit.objectiveId).code } : {}),
    ...(unit.updated ? { date: unit.updated } : {}),
  }
}

export function inventoryBadge(
  units: readonly BadgeUnit[],
  input: {
    /** The blocks' sample points the view's station sees. */
    visibleBlockPoints: ReadonlyArray<readonly [number, number]>
    /** The landform's inventory unit id, when it was adopted from one. */
    landformUnitId?: string | null
    landform?: PolygonGeometry | null
    /**
     * Whether the visual inventory was read for this area. Unread, the circle says so rather than "no unit": no unit
     * is a finding only after a read.
     */
    read?: boolean
  },
): InventoryBadge {
  let unit: BadgeUnit | null = null
  let note =
    input.read === false
      ? 'Visual inventory not read: look it up in step 1 to fill the circle.'
      : 'No visual sensitivity unit under the landform or the blocks.'
  const underBlocks = input.visibleBlockPoints.length ? dominant(units, input.visibleBlockPoints) : null
  const adopted = input.landformUnitId ? (units.find((entry) => entry.id === input.landformUnitId) ?? null) : null
  if (underBlocks) {
    unit = underBlocks.unit
    note =
      underBlocks.units > 1
        ? `VSU ${label(unit)}: under ${Math.round(underBlocks.share * 100)}% of the blocks' visible ground (${underBlocks.units} units under it)`
        : `VSU ${label(unit)}: under the blocks' visible ground`
  } else if (adopted) {
    unit = adopted
    note = `VSU ${label(unit)}: the unit the landform was adopted from (no block ground in view)`
  } else if (input.landform) {
    const held = dominant(units, pointsInside(input.landform))
    if (held) {
      unit = held.unit
      note = `VSU ${label(unit)}: holds ${Math.round(held.share * 100)}% of the landform${held.units > 1 ? ` (${held.units} units)` : ''}`
    }
  }
  const values: InventoryBadge['values'] = unit ? unitValues(unit) : {}
  return {
    unit,
    values,
    lines: [
      unit ? `VSU ${values.vsu}` : 'VSU ?',
      values.vsc ?? '?',
      `${values.vac ?? '?'}   /   ${values.evc ?? '?'}`,
      values.vqo ?? '?',
    ],
    note,
  }
}

/** The part of a saved view (`SavedFigure`) its inventory unit is kept in. */
export type ViewInventory = {
  rating: InventoryBadge['values'] | null
  ratingNote?: string
  inventoryRead?: boolean
  inventoryAt?: InventoryBadgeInput
}

/**
 * A saved view's inventory unit, filled from a read the page made after the view was saved (Save & export reads the
 * inventory itself). A view saved after a read keeps its own unit, which is what its sheet printed; one saved before
 * any read takes the unit the same rules choose from `units`. Unchanged when nothing was read or the view kept no
 * badge input (saved before the input was kept).
 */
export function withReadInventory<F extends ViewInventory>(figure: F, units: readonly BadgeUnit[] | null): F {
  if (figure.inventoryRead || !units || !figure.inventoryAt) return figure
  const badge = inventoryBadge(units, { ...figure.inventoryAt, read: true })
  return { ...figure, rating: badge.unit ? badge.values : null, ratingNote: badge.note, inventoryRead: true }
}
