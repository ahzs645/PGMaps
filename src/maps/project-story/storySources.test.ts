import { describe, expect, it, vi } from 'vitest'
import type { ProjectStoryLayerDef } from '@/lib/projectPackages'
import { StorySourceStore, storySourceKey } from './storySources'

const layer = (id: string, data = `/${id}.geojson`) => ({ id, data }) as ProjectStoryLayerDef
const collection: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('active story sources', () => {
  it('shares one request across styles and releases inactive data', async () => {
    const load = vi.fn(async () => collection)
    const store = new StorySourceStore(load)
    const first = layer('height', '/trees.geojson'),
      second = layer('species', '/trees.geojson')
    store.setSources([first, second])
    await tick()
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().size).toBe(1)
    store.setSources([second])
    expect(load).toHaveBeenCalledTimes(1)
    store.setSources([])
    expect(store.getSnapshot().size).toBe(0)
  })
  it('publishes independent successes and retries only failed sources', async () => {
    let fail = true
    const load = vi.fn(async (item: ProjectStoryLayerDef) => {
      if (item.id === 'bad' && fail) throw new Error('503')
      return collection
    })
    const store = new StorySourceStore(load),
      good = layer('good'),
      bad = layer('bad')
    store.setSources([good, bad])
    await tick()
    expect(store.getSnapshot().get(storySourceKey(good))?.status).toBe('ready')
    expect(store.getSnapshot().get(storySourceKey(bad))?.status).toBe('error')
    fail = false
    store.retry()
    await tick()
    expect(store.getSnapshot().get(storySourceKey(bad))?.status).toBe('ready')
    expect(load.mock.calls.filter(([item]) => item.id === 'good')).toHaveLength(1)
  })
  it('aborts obsolete work and ignores late results, including after disposal', async () => {
    let finish: (value: GeoJSON.FeatureCollection) => void = () => {}
    let signal: AbortSignal | undefined
    const store = new StorySourceStore((_layer, nextSignal) => {
      signal = nextSignal
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    store.setSources([layer('large')])
    store.setSources([])
    expect(signal?.aborted).toBe(true)
    finish(collection)
    await tick()
    expect(store.getSnapshot().size).toBe(0)
    store.setSources([layer('next')])
    store.dispose()
    expect(signal?.aborted).toBe(true)
    finish(collection)
    await tick()
    expect(store.getSnapshot().size).toBe(0)
  })
})
