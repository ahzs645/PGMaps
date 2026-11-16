import { describe, expect, it } from 'vitest'

import type { CaptureFacts } from './viewCapturePlan'
import { standFacing } from './viewCapturePlan'
import { runViewCapture, type CaptureClock, type ViewCaptureHost, type ViewCaptureState } from './useViewCapture'
import type { ViewOfInterest } from './viewsOfInterest'

const view = (id: string, patch: Partial<ViewOfInterest> = {}): ViewOfInterest => ({
  id,
  name: `View ${id}`,
  source: { kind: 'vli', key: 'vli:144' },
  lng: -122.65,
  lat: 53.905,
  blockId: 'block-1',
  facing: { kind: 'block' },
  focalMm: 50,
  framing: 'landform',
  ...patch,
})

/** A clock that runs as fast as the batch asks it to. */
function fastClock(): CaptureClock & { elapsed: () => number } {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms
      await Promise.resolve()
    },
    elapsed: () => t,
  }
}

/**
 * A page that runs for a few polls after each stand, then opens its road view; it faces and takes lenses at once,
 * and lists each save as it is made.
 */
function fakePage(views: ViewOfInterest[], options: { runError?: string; lens?: boolean } = {}) {
  const log: string[] = []
  const page = {
    key: 'home' as string,
    runFresh: true,
    runRunning: false,
    runError: null as string | null,
    roadViewOpen: false,
    lookAtTargetId: null as string | null,
    lookBearing: null as number | null,
    lensMm: null as number | null,
    saved: [] as string[],
  }
  let polls = 0
  const host: ViewCaptureHost<string> = {
    views,
    facts: (): CaptureFacts => {
      if (polls > 0 && --polls === 0) {
        page.runRunning = false
        if (options.runError) page.runError = options.runError
        else {
          page.runFresh = true
          page.roadViewOpen = true
        }
      }
      return {
        key: page.key,
        runFresh: page.runFresh,
        runRunning: page.runRunning,
        runError: page.runError,
        roadViewOpen: page.roadViewOpen,
        canSave: page.roadViewOpen,
        lookAtTargetId: page.lookAtTargetId,
        lookBearing: page.lookBearing,
        poseBearing: page.lookBearing ?? (page.lookAtTargetId ? 90 : null),
        blockBearing: page.lookAtTargetId ? 90 : null,
        lensMm: page.lensMm,
        lensApplied: options.lens !== false,
      }
    },
    stand: (v) => {
      if (v.blockId === 'gone') return { error: 'Its block is no longer in the scene.' }
      log.push(`stand ${v.id}`)
      page.key = `at ${v.lng}`
      page.runFresh = false
      page.runRunning = true
      page.roadViewOpen = false
      Object.assign(page, standFacing(v), { lensMm: v.focalMm })
      polls = 3
      return { key: page.key }
    },
    face: (v) => {
      log.push(`face ${v.id}`)
      Object.assign(page, standFacing(v), { lensMm: v.focalMm })
    },
    save: async (v) => {
      log.push(`save ${v.id} facing ${page.lookBearing ?? page.lookAtTargetId} at ${page.lensMm} mm`)
      page.saved.push(`saved-${v.id}`)
      return { viewId: `saved-${v.id}` }
    },
    savedViewIds: () => page.saved,
    snapshot: () => 'where I stood',
    restore: (back) => log.push(`restore ${back}`),
  }
  return { host, log, page }
}

describe('capturing planned views', () => {
  it('stands once per place, faces and saves each view there, then steps back', async () => {
    const views = [
      view('a'),
      view('b', { lng: -122.7 }),
      view('c', { facing: { kind: 'bearing', degrees: 245 }, focalMm: 35 }),
    ]
    const { host, log } = fakePage(views)
    const states: ViewCaptureState[] = []
    const report = await runViewCapture(() => host, ['a', 'b', 'c'], {
      cancelled: () => false,
      onState: (state) => states.push(state),
      clock: fastClock(),
    })
    expect(report).toEqual({ captured: ['a', 'c', 'b'], failures: [], cancelled: false })
    expect(log).toEqual([
      'stand a',
      'save a facing block-1 at 50 mm',
      'face c',
      'save c facing 245 at 35 mm',
      'stand b',
      'save b facing block-1 at 50 mm',
      'restore where I stood',
    ])
    expect(states.some((state) => state.message === 'Capturing 2 of 3: View c…')).toBe(true)
    expect(states.at(-1)).toMatchObject({ status: 'done', done: 3, total: 3, message: 'Captured 3 of 3 views.' })
  })

  it('reports a view it cannot stand at and goes on with the rest', async () => {
    const views = [view('a', { blockId: 'gone' }), view('b', { lng: -122.7 })]
    const { host } = fakePage(views)
    const report = await runViewCapture(() => host, ['a', 'b', 'missing'], {
      cancelled: () => false,
      onState: () => {},
      clock: fastClock(),
    })
    expect(report.captured).toEqual(['b'])
    expect(report.failures).toEqual([
      { viewId: 'missing', reason: 'The view is no longer listed.' },
      { viewId: 'a', reason: 'Its block is no longer in the scene.' },
    ])
  })

  it('fails every view at a place whose run failed', async () => {
    const views = [view('a'), view('b', { facing: { kind: 'bearing', degrees: 10 } })]
    const { host, log } = fakePage(views, { runError: 'No terrain under the viewpoint.' })
    const report = await runViewCapture(() => host, ['a', 'b'], {
      cancelled: () => false,
      onState: () => {},
      clock: fastClock(),
    })
    expect(report.captured).toEqual([])
    expect(report.failures.map((failure) => failure.reason)).toEqual([
      'The run for this place failed: No terrain under the viewpoint.',
      'The run for this place failed: No terrain under the viewpoint.',
    ])
    expect(log.at(-1)).toBe('restore where I stood')
  })

  it('gives up on a view whose lens never takes, after its own time limit', async () => {
    const { host } = fakePage([view('a')], { lens: false })
    const clock = fastClock()
    const report = await runViewCapture(() => host, ['a'], { cancelled: () => false, onState: () => {}, clock })
    expect(report.failures).toEqual([{ viewId: 'a', reason: 'The road view did not take the view’s lens.' }])
    expect(clock.elapsed()).toBeGreaterThan(20_000)
    expect(clock.elapsed()).toBeLessThan(25_000)
  })

  it('stops when cancelled and still steps back', async () => {
    const views = [view('a'), view('b', { lng: -122.7 })]
    const { host, log, page } = fakePage(views)
    const report = await runViewCapture(() => host, ['a', 'b'], {
      cancelled: () => page.saved.length > 0,
      onState: () => {},
      clock: fastClock(),
    })
    expect(report).toMatchObject({ captured: ['a'], cancelled: true })
    expect(log).toEqual(['stand a', 'save a facing block-1 at 50 mm', 'restore where I stood'])
  })
})
