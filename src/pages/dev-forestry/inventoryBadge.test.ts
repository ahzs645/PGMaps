import { describe, expect, it } from 'vitest'
import { inventoryBadge, thinPoints, withReadInventory, type BadgeUnit } from './inventoryBadge'

const box = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
})

const WEST: BadgeUnit = {
  id: 'a',
  polygonNumber: '1107',
  vsuNumber: null,
  objectiveId: 'retention',
  vac: 'low',
  vsc: '2',
  evc: 'R',
  geometry: box(0, 0, 1, 1),
}
const EAST: BadgeUnit = {
  id: 'b',
  polygonNumber: '1113',
  vsuNumber: '45',
  objectiveId: 'partial-retention',
  vac: 'medium',
  vsc: '3',
  evc: null,
  geometry: box(1, 0, 2, 1),
}

describe('the inventory circle', () => {
  it('takes the unit under most of the blocks’ visible ground, and says so', () => {
    const badge = inventoryBadge([WEST, EAST], {
      visibleBlockPoints: [
        [1.2, 0.5],
        [1.3, 0.5],
        [0.5, 0.5],
      ],
    })
    expect(badge.unit?.id).toBe('b')
    expect(badge.lines).toEqual(['VSU 45', '3', 'M   /   ?', 'PR'])
    expect(badge.note).toMatch(/^VSU 45: under 67% of the blocks' visible ground \(2 units/)
  })

  it('falls back to the adopted unit, then to the unit holding most of the landform', () => {
    expect(inventoryBadge([WEST, EAST], { visibleBlockPoints: [], landformUnitId: 'a' }).note).toMatch(/adopted from/)
    const held = inventoryBadge([WEST, EAST], { visibleBlockPoints: [], landform: box(0.2, 0.2, 1.1, 0.8) })
    expect(held.unit?.id).toBe('a')
    expect(held.lines).toEqual(['VSU 1107', '2', 'L   /   R', 'R'])
    expect(held.note).toMatch(/holds \d+% of the landform \(2 units\)/)
  })

  it('prints question marks when nothing is known', () => {
    const none = inventoryBadge([], { visibleBlockPoints: [[5, 5]] })
    expect(none.unit).toBeNull()
    expect(none.lines).toEqual(['VSU ?', '?', '?   /   ?', '?'])
  })

  it('says the inventory was not read rather than that no unit is there', () => {
    expect(inventoryBadge([], { visibleBlockPoints: [], read: false }).note).toMatch(/^Visual inventory not read/)
    expect(inventoryBadge([], { visibleBlockPoints: [], read: true }).note).toMatch(/^No visual sensitivity unit/)
  })
})

describe('a view saved before the inventory was read', () => {
  const before = {
    rating: null,
    ratingNote: 'Visual inventory not read: look it up in step 1 to fill the circle.',
    inventoryRead: false,
    inventoryAt: { visibleBlockPoints: [[1.5, 0.5]] as Array<[number, number]>, landformUnitId: null, landform: null },
  }

  it('takes its unit from a later read, by the same rules', () => {
    const filled = withReadInventory(before, [WEST, EAST])
    expect(filled.inventoryRead).toBe(true)
    expect(filled.rating).toEqual({ vsu: '45', vsc: '3', vac: 'M', vqo: 'PR' })
    expect(filled.ratingNote).toBe("VSU 45: under the blocks' visible ground")
  })

  it('keeps a unit chosen at the save, and stays unread without a read', () => {
    const saved = { ...before, inventoryRead: true, rating: { vsu: '1107' } }
    expect(withReadInventory(saved, [WEST, EAST])).toBe(saved)
    expect(withReadInventory(before, null)).toBe(before)
  })

  it('records a read that found nothing as no unit, not as unread', () => {
    expect(withReadInventory(before, [])).toMatchObject({ rating: null, inventoryRead: true })
  })

  it('thins the kept block points evenly', () => {
    const points = Array.from({ length: 2000 }, (_, i) => i)
    const kept = thinPoints(points, 600)
    expect(kept).toHaveLength(600)
    expect(kept[0]).toBe(0)
    expect(kept[599]).toBeGreaterThan(1990)
    expect(thinPoints([1, 2, 3], 600)).toEqual([1, 2, 3])
  })
})
