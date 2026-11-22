import { describe, expect, it } from 'vitest'

import type { CaptureFacts } from './viewCapturePlan'
import { CAPTURE_TIMEOUTS, standFacing } from './viewCapturePlan'
import {
  captureAsNeeded,
  runViewCapture,
  type CaptureClock,
  type ViewCaptureHost,
  type ViewCaptureOptions,
  type ViewCaptureReport,
  type ViewCaptureState,
} from './useViewCapture'
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
function fakePage(
  views: ViewOfInterest[],
  options: { runError?: string; lens?: boolean; runCancelled?: boolean } = {},
) {
  const log: string[] = []
  const page = {
    key: 'home' as string,
    runFresh: true,
    runRunning: false,
    runError: null as string | null,
    runPending: false,
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
        page.runPending = false
        if (options.runError) page.runError = options.runError
        // Cancelled by hand: the analysis goes back to idle with no error, and nothing starts it again.
        else if (options.runCancelled) page.runFresh = false
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
        runPending: page.runPending,
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
      page.runPending = true
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

  it('fails a place whose run was cancelled under it within seconds, not after the run’s budget', async () => {
    const views = [view('a'), view('b', { lng: -122.7 })]
    const { host, log } = fakePage(views, { runCancelled: true })
    const clock = fastClock()
    const report = await runViewCapture(() => host, ['a', 'b'], { cancelled: () => false, onState: () => {}, clock })
    expect(report.captured).toEqual([])
    expect(report.failures.map((failure) => failure.reason)).toEqual([
      'The run for this place was cancelled.',
      'The run for this place was cancelled.',
    ])
    expect(log).toEqual(['stand a', 'stand b', 'restore where I stood'])
    // Two places, each given the grace and no more: far inside one run's five minutes.
    expect(clock.elapsed()).toBeLessThan(2 * (CAPTURE_TIMEOUTS.runAbandonMs + 1000))
  })

  it('keeps waiting on a run whose page does not say what is pending', async () => {
    const { host } = fakePage([view('a')])
    const facts = host.facts
    let polls = 0
    // The run is idle for ten seconds before it starts, with no word on what is pending.
    host.facts = () => {
      const now = facts()
      return ++polls < 100 ? { ...now, runRunning: false, runPending: undefined } : now
    }
    const report = await runViewCapture(() => host, ['a'], {
      cancelled: () => false,
      onState: () => {},
      clock: fastClock(),
    })
    expect(report.captured).toEqual(['a'])
  })

  /**
   * The page's drawn timber grows one patch every `everyMs` once the road view opens, up to `stopAt` patches of
   * `total` (all of them when absent), as a slow GPU grows it.
   */
  function growingTimber(
    host: ViewCaptureHost<string>,
    clock: ReturnType<typeof fastClock>,
    growth: { total: number; everyMs: number; stopAt?: number },
  ) {
    const facts = host.facts
    let openedAt: number | null = null
    host.facts = () => {
      const now = facts()
      if (!now.roadViewOpen) return now
      openedAt ??= clock.elapsed()
      const grown = Math.floor((clock.elapsed() - openedAt) / growth.everyMs)
      const done = Math.min(grown, growth.stopAt ?? growth.total, growth.total)
      return done >= growth.total
        ? { ...now, timberProgress: null }
        : {
            ...now,
            canSave: false,
            saveBlocker: `the drawn timber (${done} of ${growth.total} patches)`,
            timberProgress: { done, total: growth.total },
          }
    }
  }

  it('keeps waiting on drawn timber that keeps growing, past the road view’s two minutes', async () => {
    const { host, log } = fakePage([view('a')])
    const clock = fastClock()
    // 40 patches, one every 5 s: 200 s in all, as under software rendering.
    growingTimber(host, clock, { total: 40, everyMs: 5000 })
    const states: ViewCaptureState[] = []
    const report = await runViewCapture(() => host, ['a'], {
      cancelled: () => false,
      onState: (state) => states.push(state),
      clock,
    })
    expect(report.failures).toEqual([])
    expect(report.captured).toEqual(['a'])
    expect(clock.elapsed()).toBeGreaterThan(CAPTURE_TIMEOUTS.roadViewMs)
    expect(log).toContain('save a facing block-1 at 50 mm')
    expect(states.some((state) => state.message === 'Capturing 1 of 1: View a… Preparing timber 12 of 40')).toBe(true)
  })

  it('gives up on drawn timber that stops growing, naming how far it got', async () => {
    const { host, log } = fakePage([view('a')])
    const clock = fastClock()
    growingTimber(host, clock, { total: 40, everyMs: 1000, stopAt: 17 })
    const report = await runViewCapture(() => host, ['a'], { cancelled: () => false, onState: () => {}, clock })
    expect(report.captured).toEqual([])
    expect(report.failures).toEqual([
      {
        viewId: 'a',
        reason: "The road view's drawn timber stopped growing at 17 of 40 patches: no patch was added for 30 s.",
      },
    ])
    expect(log).not.toContain('save a facing block-1 at 50 mm')
    // It stopped at 17 s and was given up 30 s later, not after two minutes.
    expect(clock.elapsed()).toBeLessThan(17_000 + CAPTURE_TIMEOUTS.timberStallMs + 5000)
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

  it('counts a save without its analysis sheet apart, and says so', async () => {
    const views = [view('a'), view('b', { facing: { kind: 'bearing', degrees: 10 } })]
    const { host } = fakePage(views)
    const save = host.save
    host.save = async (v) => {
      const outcome = await save(v)
      return v.id === 'a' && 'viewId' in outcome
        ? { ...outcome, warning: 'Saved, but its analysis sheet could not be drawn: The framed view did not draw.' }
        : outcome
    }
    const states: ViewCaptureState[] = []
    const report = await runViewCapture(() => host, ['a', 'b'], {
      cancelled: () => false,
      onState: (state) => states.push(state),
      clock: fastClock(),
    })
    expect(report.captured).toEqual(['a', 'b'])
    expect(report.failures).toEqual([
      {
        viewId: 'a',
        reason: 'Saved, but its analysis sheet could not be drawn: The framed view did not draw.',
        warning: 'sheet',
      },
    ])
    expect(states.at(-1)?.message).toBe('Captured 1 of 2 views; 1 saved without its analysis sheet.')
  })

  it("takes each place's before-harvest renders after its saves, while still standing there", async () => {
    const views = [view('a'), view('b', { facing: { kind: 'bearing', degrees: 10 } }), view('c', { lng: -122.7 })]
    const { host, log } = fakePage(views)
    const asked: string[][] = []
    host.before = async (saved) => {
      asked.push(saved.map((entry) => entry.id))
      log.push(`before ${saved.map((entry) => entry.id).join(' ')}`)
      return saved[0].id === 'saved-c'
        ? { taken: [], notes: ['View c: the before render could not be framed (no terrain under the view yet).'] }
        : { taken: saved.map((entry) => entry.id), notes: [] }
    }
    const report = await runViewCapture(() => host, ['a', 'b', 'c'], {
      cancelled: () => false,
      onState: () => {},
      clock: fastClock(),
      before: true,
    })
    expect(asked).toEqual([['saved-a', 'saved-b'], ['saved-c']])
    expect(log).toEqual([
      'stand a',
      'save a facing block-1 at 50 mm',
      'face b',
      'save b facing 10 at 50 mm',
      'before saved-a saved-b',
      'stand c',
      'save c facing block-1 at 50 mm',
      'before saved-c',
      'restore where I stood',
    ])
    expect(report.captured).toEqual(['a', 'b', 'c'])
    expect(report.failures).toEqual([
      {
        viewId: 'c',
        reason:
          'Saved, but its before-harvest render could not be taken: the before render could not be framed (no terrain under the view yet).',
        warning: 'before',
      },
    ])
  })

  it('draws again only the analysis sheet of a view saved without one, keeping the saved view', async () => {
    const views = [view('a'), view('b', { facing: { kind: 'bearing', degrees: 10 } })]
    const { host, log, page } = fakePage(views)
    // Each save's sheet as the page holds it, by saved view id: the first save of `a` draws none.
    const figures: Record<string, boolean> = {}
    const save = host.save
    host.save = async (v) => {
      const outcome = await save(v)
      if (!('viewId' in outcome)) return outcome
      figures[outcome.viewId] = v.id !== 'a'
      return v.id === 'a'
        ? { ...outcome, warning: 'Saved, but its analysis sheet could not be drawn: The framed view did not draw.' }
        : outcome
    }
    host.redraw = async (v) => {
      const savedId = `saved-${v.id}`
      log.push(`redraw ${savedId}`)
      figures[savedId] = true
      return { viewId: savedId }
    }
    const first = await runViewCapture(() => host, ['a', 'b'], {
      cancelled: () => false,
      onState: () => {},
      clock: fastClock(),
    })
    expect(first.failures.map((failure) => failure.warning)).toEqual(['sheet'])
    expect(figures).toEqual({ 'saved-a': false, 'saved-b': true })

    log.length = 0
    const states: ViewCaptureState[] = []
    const again = await runViewCapture(() => host, ['a'], {
      cancelled: () => false,
      onState: (state) => states.push(state),
      clock: fastClock(),
      stage: 'sheet',
    })
    expect(again).toEqual({ captured: ['a'], failures: [], cancelled: false })
    // It stood at the place and drew the sheet of the same saved view: no second save, no facing.
    expect(log).toEqual(['stand a', 'redraw saved-a', 'restore where I stood'])
    expect(page.saved).toEqual(['saved-a', 'saved-b'])
    expect(figures['saved-a']).toBe(true)
    expect(states.some((state) => state.message === 'Drawing analysis sheet 1 of 1: View a…')).toBe(true)
    expect(states.at(-1)?.message).toBe('Drew 1 of 1 analysis sheet.')
  })

  it('draws a sheet again without waiting for the facing or the lens', async () => {
    const { host, log } = fakePage([view('a')], { lens: false })
    host.redraw = async (v) => {
      log.push(`redraw ${v.id}`)
      return { viewId: `saved-${v.id}` }
    }
    const clock = fastClock()
    const report = await runViewCapture(() => host, ['a'], {
      cancelled: () => false,
      onState: () => {},
      clock,
      stage: 'sheet',
    })
    expect(report.captured).toEqual(['a'])
    // The lens never takes here, which fails a whole capture (above): a sheet is framed from the saved camera.
    expect(log).toEqual(['stand a', 'redraw a', 'restore where I stood'])
  })

  it('draws the sheets and captures the rest whole in one batch, as one report', async () => {
    const calls: Array<{ ids: readonly string[]; stage?: string; sheets?: string[]; before?: boolean }> = []
    const capture = async (ids: readonly string[], options: ViewCaptureOptions = {}) => {
      calls.push({
        ids,
        stage: options.stage,
        sheets: options.sheetIds ? [...options.sheetIds] : undefined,
        before: options.before,
      })
      return { captured: [...ids], failures: [], cancelled: false } satisfies ViewCaptureReport
    }
    const report = await captureAsNeeded(capture, ['a', 'b', 'c'], new Set(['b', 'z']), { before: true })
    expect(calls).toEqual([{ ids: ['a', 'b', 'c'], stage: undefined, sheets: ['b'], before: true }])
    expect(report).toEqual({ captured: ['a', 'b', 'c'], failures: [], cancelled: false })
    calls.length = 0
    await captureAsNeeded(capture, ['a'], new Set(['b']))
    expect(calls).toEqual([{ ids: ['a'], stage: undefined, sheets: undefined, before: undefined }])
  })

  it('stands back once when a batch draws some sheets and captures other views whole', async () => {
    const views = [view('a'), view('b', { facing: { kind: 'bearing', degrees: 10 } }), view('c', { lng: -122.7 })]
    const { host, log } = fakePage(views)
    let snapshots = 0
    const snapshot = host.snapshot
    host.snapshot = () => {
      snapshots += 1
      return snapshot()
    }
    host.redraw = async (v) => {
      log.push(`redraw ${v.id}`)
      return { viewId: `saved-${v.id}` }
    }
    const states: ViewCaptureState[] = []
    const report = await runViewCapture(() => host, ['a', 'b', 'c'], {
      cancelled: () => false,
      onState: (state) => states.push(state),
      clock: fastClock(),
      sheetIds: new Set(['a']),
    })
    expect(report).toEqual({ captured: ['a', 'b', 'c'], failures: [], cancelled: false })
    // `a`'s sheet is drawn from its saved camera, `b` at the same place is faced and saved, then `c`; one step back.
    expect(log).toEqual([
      'stand a',
      'redraw a',
      'face b',
      'save b facing 10 at 50 mm',
      'stand c',
      'save c facing block-1 at 50 mm',
      'restore where I stood',
    ])
    expect(snapshots).toBe(1)
    expect(states.some((state) => state.message === 'Drawing analysis sheet 1 of 3: View a…')).toBe(true)
    expect(states.some((state) => state.message?.startsWith('Capturing 2 of 3: View b'))).toBe(true)
    expect(states.at(-1)?.message).toBe('Captured 3 of 3 views.')
  })

  it('takes no before render unless asked', async () => {
    const { host } = fakePage([view('a')])
    let called = false
    host.before = async () => {
      called = true
      return { taken: [], notes: [] }
    }
    await runViewCapture(() => host, ['a'], { cancelled: () => false, onState: () => {}, clock: fastClock() })
    expect(called).toBe(false)
  })
})
