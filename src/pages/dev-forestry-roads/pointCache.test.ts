import { describe, expect, it } from 'vitest'
import { fixed9Key, PointCache } from './pointCache'

/** A deterministic stream of doubles, so a failure can be replayed. */
function* doubles(count: number, seed = 7) {
  let state = seed
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
  for (let i = 0; i < count; i++) yield (next() - 0.5) * 400 + next() * 1e-6
}

describe('point cache', () => {
  it('holds what a Map keyed by `x,y` held, through growth', () => {
    const cache = new PointCache(4),
      map = new Map<string, number>()
    const points = [...doubles(20_000)].map((x, i) => [x, i % 7 === 0 ? x : x / 3] as const)
    points.forEach(([x, y], i) => {
      if (i % 3 === 0 && i > 0) {
        // Revisit an earlier point: one entry, value replaced.
        const [px, py] = points[i - 1]
        cache.set(px, py, i)
        map.set(px + ',' + py, i)
      }
      cache.set(x, y, i)
      map.set(x + ',' + y, i)
    })
    expect(cache.size).toBe(map.size)
    for (const [x, y] of points) expect(cache.get(x, y)).toBe(map.get(x + ',' + y))
    expect(cache.get(1e9, 1e9)).toBeUndefined()
  })

  it('treats 0 and −0 as one position, every NaN as one, and returns a stored NaN', () => {
    const cache = new PointCache()
    cache.set(0, -0, 1)
    expect(cache.get(-0, 0)).toBe(1)
    cache.set(NaN, 2, NaN)
    expect(cache.get(0 / 0, 2)).toBeNaN()
    expect(cache.size).toBe(2)
  })
})

describe('fixed9Key', () => {
  it('is equal for two values exactly when their toFixed(9) strings are', () => {
    const values = [...doubles(50_000)]
    // Ties and near-ties at the 9th decimal, both signs, and values that round to (−)0.
    for (let i = 0; i < 2000; i++) {
      const base = Math.round(values[i] * 1e9) / 1e9
      values.push(base + 5e-10, base - 5e-10, base + 5.000001e-10, -(base + 5e-10))
    }
    values.push(0, -0, 1e-12, -1e-12, 4e-10, -4e-10, 5e-10, -5e-10, 999.9999999995, -999.9999999995, -122.8, 53.9)
    const byKey = new Map<number, string>()
    for (const value of values) {
      const key = fixed9Key(value)!
      const text = value.toFixed(9)
      const seen = byKey.get(key)
      if (seen !== undefined) expect(seen).toBe(text)
      else byKey.set(key, text)
    }
    // And distinct strings never share a key.
    expect(new Set(byKey.values()).size).toBe(byKey.size)
    expect(fixed9Key(-1e-12)).not.toBe(fixed9Key(0))
    // The same key to a Map: -0 and 0 are one.
    expect(fixed9Key(-0) === fixed9Key(0)).toBe(true)
    expect(fixed9Key(1000)).toBeNull()
    expect(fixed9Key(NaN)).toBeNull()
  })
})
