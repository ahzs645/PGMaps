import { expect, it } from 'vitest'
import { computeViewshed } from './model'
import { ViewshedResultCache } from './resultCache'

it('retains transferable results without detaching cached samples, and excludes incomplete terrain', () => {
  const result = computeViewshed(
    { elevationAt: () => 800 },
    { observer: { lng: 0, lat: 0 }, radiusMeters: 500, heightA: 1.6, heightB: 1.6 },
    20,
    16,
    false,
  )
  const cache = new ViewshedResultCache(2)
  cache.put('first', result)
  const hit = cache.get('first')!
  structuredClone(hit, { transfer: [hit.cells.buffer] })
  expect(hit.cells.length).toBe(0)
  expect(cache.get('first')!.cells.length).toBe(256)
  cache.put('second', result)
  cache.get('first')
  cache.put('third', result)
  expect(cache.get('second')).toBeNull()
  cache.put('unknown', { ...result, counts: { ...result.counts, unknown: 1 } })
  expect(cache.get('unknown')).toBeNull()
  cache.clear()
  expect(cache.get('first')).toBeNull()
})
