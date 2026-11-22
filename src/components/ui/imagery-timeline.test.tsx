import { useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ImageryFeed, ImageryFrame } from '@/lib/imageryFeeds/feed'
import { useImageryFrameHandoffs, useImageryTimeline, type ImageryTimelineState } from './imagery-timeline'

// The hand-offs need a MapLibre map only once layers draw; here only their requests matter.
vi.mock('@pgmaps/geo-toolkit/map/map-context', () => ({ useMap: () => ({ map: null, isLoaded: false }) }))

const frame = (id: string, date: string, layers = 1): ImageryFrame<null> => ({
  id,
  date,
  layers: Array.from({ length: layers }, (_, i) => ({ tiles: `https://feed/${id}/${i}/{z}/{x}/{y}`, maxZoom: 14 })),
  source: null,
})

/** A feed no page has yet: it proves a new source needs only the contract. */
function testFeed(id: string, frames: ImageryFrame<null>[], extra: Partial<ImageryFeed<null>> = {}): ImageryFeed<null> {
  return {
    id,
    label: `Feed ${id}`,
    description: '',
    dateMeaning: 'Test date',
    loadingText: 'Loading…',
    retryLabel: 'Retry',
    period: 'year',
    playbackMs: 1000,
    placeMaxZoom: 14,
    listFrames: async () => frames,
    ...extra,
  }
}

const map = {
  getCenter: () => ({ lng: -124, lat: 54 }),
  getZoom: () => 12,
  isMoving: () => false,
  on: () => undefined,
  off: () => undefined,
} as unknown as MapLibreMap

function render(feed: ImageryFeed<null>) {
  const latest: { timeline: ImageryTimelineState | null; requests: Array<string | null> } = {
    timeline: null,
    requests: [],
  }
  function Harness({ feed }: { feed: ImageryFeed<null> }) {
    const timeline = useImageryTimeline(feed, true, map)
    const handoffs = useImageryFrameHandoffs('dated', timeline.frame)
    useEffect(() => {
      latest.timeline = timeline
      latest.requests = handoffs.map((handoff) => handoff.requested?.value.tiles ?? null)
    })
    return null
  }
  let renderer!: ReturnType<typeof create>
  return {
    latest,
    mount: async () => {
      await act(async () => {
        renderer = create(<Harness feed={feed} />)
      })
    },
    switchTo: async (next: ImageryFeed<null>) => {
      await act(async () => renderer.update(<Harness feed={next} />))
    },
  }
}

describe('useImageryTimeline', () => {
  it('opens on the newest frame and asks the map for each of its layers', async () => {
    const view = render(testFeed('a', [frame('1', '2020-05-01'), frame('2', '2024-07-01', 2)]))
    await view.mount()
    expect(view.latest.timeline?.frame?.id).toBe('2')
    expect(view.latest.requests).toEqual(['https://feed/2/0/{z}/{x}/{y}', 'https://feed/2/1/{z}/{x}/{y}', null, null])
    await act(async () => view.latest.timeline!.setIndex(0))
    expect(view.latest.requests).toEqual(['https://feed/1/0/{z}/{x}/{y}', null, null, null])
  })

  it('offers only the frames that change the place when the feed can say', async () => {
    const frames = [frame('1', '2018-01-01'), frame('2', '2020-01-01'), frame('3', '2022-01-01')]
    const feed = testFeed('b', frames, { framesChangingAt: async (all) => [all[0], all[2]] })
    const view = render(feed)
    await view.mount()
    expect(view.latest.timeline).toMatchObject({ changeCount: 2, frameCount: 3, filtering: true })
    expect(view.latest.timeline?.buckets.map((bucket) => bucket.key)).toEqual(['1', '3'])
  })

  it('reads no place and offers every frame when the feed cannot say', async () => {
    const view = render(testFeed('c', [frame('1', '2018-01-01'), frame('2', '2020-01-01')]))
    await view.mount()
    expect(view.latest.timeline).toMatchObject({ changeCount: null, localChecking: false, filtering: false })
    expect(view.latest.timeline?.capture).toEqual({ state: 'none' })
  })

  it('reads what the shown frame captured, when the feed can describe it', async () => {
    vi.useFakeTimers()
    const feed = testFeed('d', [frame('1', '2018-01-01')], {
      captureAt: async () => ({ date: '2017-08-01', resolutionM: 0.5, accuracyM: null, provider: null, source: null }),
    })
    const view = render(feed)
    await view.mount()
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    vi.useRealTimers()
    expect(view.latest.timeline?.capture).toMatchObject({ state: 'read', value: { date: '2017-08-01' } })
  })

  it('hands a feed a fetch it can call as a method, as the browser’s own refuses', async () => {
    const strict = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(new Response('{}'))
    } as unknown as typeof fetch
    const original = globalThis.fetch
    globalThis.fetch = strict
    const feed = testFeed('h', [frame('1', '2018-01-01'), frame('2', '2020-01-01')], {
      framesChangingAt: async (all, _place, context) => {
        await context.fetch('https://feed/check')
        return [all[1]]
      },
    })
    try {
      const view = render(feed)
      await view.mount()
      expect(view.latest.timeline).toMatchObject({ changeCount: 1, localError: null })
    } finally {
      globalThis.fetch = original
    }
  })

  it('starts a new feed from its newest frame, never showing the old feed’s dates', async () => {
    const view = render(testFeed('e', [frame('old', '2019-01-01')]))
    await view.mount()
    await view.switchTo(testFeed('f', [frame('x', '2025-01-01'), frame('y', '2026-01-01')]))
    expect(view.latest.timeline?.frame?.id).toBe('y')
    expect(view.latest.timeline?.feed.id).toBe('f')
  })

  it('groups a daily feed by month and opens a month on its label', async () => {
    const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'].map((date) => frame(date, date))
    const view = render(testFeed('g', days, { period: 'month' }))
    await view.mount()
    expect(view.latest.timeline?.buckets.filter((bucket) => bucket.periodStart).map((b) => b.tickLabel)).toEqual([
      'Sep 2026',
      'Oct 2026',
    ])
    await act(async () => view.latest.timeline!.selectTick(0))
    expect(view.latest.timeline?.period).toBe('2026-09')
    expect(view.latest.timeline?.buckets.map((bucket) => bucket.tickLabel)).toEqual(['Sep 29', 'Sep 30'])
  })
})
