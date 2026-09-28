import { expect, it } from 'vitest'
import { FeatureViewportCache } from './featureViewportCache'
const plan = { id: 'a', url: 'https://example.test/1', title: 'A', where: '1=1', fields: ['id'] }
const features: GeoJSON.Feature[] = [
  {
    type: 'Feature',
    properties: { id: 1 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 0],
        ],
      ],
    },
  },
]
it('reuses only matching filters, coverage and sufficient geometry precision', () => {
  const cache = new FeatureViewportCache()
  cache.put(plan, [0, 0, 2, 2], 0.1, features)
  expect(cache.get(plan, [0.5, 0.5, 1, 1], 0.2)).toBe(features)
  expect(cache.get(plan, [0.5, 0.5, 1, 1], 0.01)).toBeUndefined()
  expect(cache.get(plan, [0.5, 0.5, 1, 1], Infinity)).toBe(features)
  expect(cache.get(plan, [-1, 0, 1, 1], 0.2)).toBeUndefined()
  expect(cache.get({ ...plan, where: 'id=2' }, [0, 0, 1, 1], 0.2)).toBeUndefined()
})
it('bounds retained geometry by feature count, coordinate count, and LRU entries', () => {
  const cache = new FeatureViewportCache(2, 8, 2)
  cache.put(plan, [0, 0, 2, 2], 0.1, features)
  cache.put({ ...plan, url: 'second' }, [0, 0, 2, 2], 0.1, features)
  cache.get(plan, [0, 0, 1, 1], 0.1)
  cache.put({ ...plan, url: 'third' }, [0, 0, 2, 2], 0.1, features)
  expect(cache.get({ ...plan, url: 'second' }, [0, 0, 1, 1], 0.1)).toBeUndefined()
  expect(cache.get(plan, [0, 0, 1, 1], 0.1)).toBe(features)
  const small = new FeatureViewportCache(2, 3, 2)
  small.put(plan, [0, 0, 2, 2], 0.1, features)
  expect(small.get(plan, [0, 0, 1, 1], 0.1)).toBeUndefined()
})
