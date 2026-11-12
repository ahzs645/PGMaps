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
import { pointInPolygon, polygonBounds, type PolygonGeometry } from './visibility'

export type BadgeUnit = Pick<BcSensitivityUnit, 'id' | 'polygonNumber' | 'objectiveId' | 'vac' | 'vsc' | 'geometry'> &
  Partial<Pick<BcSensitivityUnit, 'evc' | 'vsuNumber'>>

export type InventoryBadge = {
  unit: BadgeUnit | null
  /** The four lines the circle prints: VSU, VSC, VAC / EVC, VQO. Unknown values print "?". */
  lines: [string, string, string, string]
  /** The values themselves, for the sheet's rating code. */
  values: { vsu?: string; vsc?: string; vac?: string; evc?: string; vqo?: string }
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

/** The unit holding most of `points`, with its share; null when none holds any. */
function dominant(units: readonly BadgeUnit[], points: ReadonlyArray<readonly [number, number]>) {
  const counts = new Map<BadgeUnit, number>()
  for (const [lng, lat] of points) {
    const unit = units.find((entry) => pointInPolygon(entry.geometry, lng, lat))
    if (unit) counts.set(unit, (counts.get(unit) ?? 0) + 1)
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]
  return best ? { unit: best[0], share: best[1] / Math.max(1, points.length), units: counts.size } : null
}

const label = (unit: BadgeUnit) => unit.vsuNumber || unit.polygonNumber

export function inventoryBadge(
  units: readonly BadgeUnit[],
  input: {
    /** The blocks' sample points the view's station sees. */
    visibleBlockPoints: ReadonlyArray<readonly [number, number]>
    /** The landform's inventory unit id, when it was adopted from one. */
    landformUnitId?: string | null
    landform?: PolygonGeometry | null
  },
): InventoryBadge {
  let unit: BadgeUnit | null = null
  let note = 'No visual sensitivity unit under the landform or the blocks.'
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
  const values: InventoryBadge['values'] = unit
    ? {
        vsu: label(unit),
        ...(unit.vsc ? { vsc: unit.vsc } : {}),
        ...(unit.vac ? { vac: VAC_CODES[unit.vac] } : {}),
        ...(unit.evc ? { evc: unit.evc } : {}),
        ...(unit.objectiveId ? { vqo: visualQualityClass(unit.objectiveId).code } : {}),
      }
    : {}
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
