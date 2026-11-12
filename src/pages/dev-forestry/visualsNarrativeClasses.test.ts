import { describe, expect, it } from 'vitest'

import { pointInPolygon, type PolygonGeometry } from './visibility'
import { visibilityShares, type EvqoCode, type EvqoUnit } from './visualsNarrative'

const STRICT: Record<EvqoCode, number> = { P: 0, R: 1, PR: 2, M: 3, MM: 4 }

const square = (west: number, south: number, size: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
})

/** The answer before units were prepared: every unit tested, the strictest containing one kept. */
function bruteForce(positions: Float64Array, visible: Uint8Array, count: number, units: EvqoUnit[]) {
  const tally = new Map<EvqoCode, { seen: number; all: number }>()
  for (let i = 0; i < count; i += 1) {
    let code: EvqoCode | null = null
    for (const unit of units)
      if (
        (code === null || STRICT[unit.code] < STRICT[code]) &&
        pointInPolygon(unit.geometry, positions[i * 2], positions[i * 2 + 1])
      )
        code = unit.code
    if (!code) continue
    const entry = tally.get(code) ?? { seen: 0, all: 0 }
    entry.all += 1
    entry.seen += visible[i]
    tally.set(code, entry)
  }
  return tally
}

describe('EVQO class of each sample', () => {
  it('matches testing every unit, overlaps resolved to the stricter class', () => {
    // Overlapping units listed loosest first, plus one far away.
    const units: EvqoUnit[] = [
      { code: 'MM', geometry: square(-122.6, 53.8, 0.2) },
      { code: 'M', geometry: square(-122.55, 53.85, 0.1) },
      { code: 'PR', geometry: square(-122.52, 53.87, 0.04) },
      { code: 'R', geometry: square(-121, 52, 0.1) },
    ] as EvqoUnit[]
    const count = 4000
    const positions = new Float64Array(count * 2)
    const visible = new Uint8Array(count)
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < count; i += 1) {
      positions[i * 2] = -122.65 + random() * 0.3
      positions[i * 2 + 1] = 53.75 + random() * 0.3
      visible[i] = random() > 0.5 ? 1 : 0
    }
    const shares = visibilityShares({ positions, anyVisible: visible, sampleCount: count } as never, units)
    const expected = bruteForce(positions, visible, count, units)
    expect(expected.size).toBe(3)
    expect(Object.keys(shares.byCode).sort()).toEqual([...expected.keys()].sort())
    for (const [code, entry] of expected) {
      expect(entry.all).toBeGreaterThan(50)
      expect(shares.byCode[code]?.visible).toBeCloseTo(entry.seen / entry.all, 12)
      expect(shares.byCode[code]?.hidden).toBeCloseTo(1 - entry.seen / entry.all, 12)
    }
  })
})
