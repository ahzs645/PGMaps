// @vitest-environment node
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CableLayoutInput, CableLayoutResult, LayoutToAnalyse } from './cableLayout'
import { analyzeCableLayout } from './cableLayoutClient'
import {
  clearEditCheck,
  clearLayoutFocus,
  drawnEditResult,
  focusLayoutRow,
  getEditCheck as read,
  getLayoutFocus,
  scheduleEditCheck,
  setEditCheckError,
  useClearStaleSpanFocus,
} from './editStore'
import { EDIT_CHECK_DELAY_MS } from './layoutEdit'

vi.mock('./cableLayoutClient', () => ({ analyzeCableLayout: vi.fn() }))
const analyze = vi.mocked(analyzeCableLayout)

const input = {} as CableLayoutInput
const layout = (h: number): LayoutToAnalyse => ({
  preTensionKN: 90,
  complete: true,
  supports: [
    { stationM: 0, heightM: 12 },
    { stationM: 150, heightM: h },
    { stationM: 300, heightM: 8 },
  ],
})
const resultFor = (h: number) => ({ objective: h }) as unknown as CableLayoutResult

beforeEach(() => {
  vi.useFakeTimers()
  analyze.mockReset()
})
afterEach(() => {
  clearEditCheck('d1')
  clearLayoutFocus()
  vi.useRealTimers()
})

describe('edited layout check', () => {
  it('waits for the edits to settle and checks only the latest', async () => {
    analyze.mockImplementation(async (_input, l) => resultFor(l.supports[1].heightM))
    scheduleEditCheck('d1', 'line', 'a', input, layout(10))
    vi.advanceTimersByTime(EDIT_CHECK_DELAY_MS - 50)
    scheduleEditCheck('d1', 'line', 'b', input, layout(12))
    expect(read('d1')).toMatchObject({ status: 'pending', checkKey: 'b' })
    vi.advanceTimersByTime(EDIT_CHECK_DELAY_MS - 1)
    expect(analyze).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0][1].supports[1].heightM).toBe(12)
    await vi.runAllTimersAsync()
    expect(read('d1')).toMatchObject({ status: 'done', checkKey: 'b', result: resultFor(12) })
    // The same edit again is already checked.
    scheduleEditCheck('d1', 'line', 'b', input, layout(12))
    expect(read('d1')?.status).toBe('done')
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('cancels a check still running when the layout changes, and keeps the last rope drawn', async () => {
    const signals: AbortSignal[] = []
    analyze.mockImplementationOnce(async (_i, l) => resultFor(l.supports[1].heightM))
    analyze.mockImplementationOnce(
      (_i, _l, options) =>
        new Promise((_resolve, reject) => {
          signals.push(options!.signal!)
          options!.signal!.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError')))
        }),
    )
    analyze.mockImplementationOnce(async (_i, l) => resultFor(l.supports[1].heightM))
    scheduleEditCheck('d1', 'line', 'a', input, layout(10))
    await vi.advanceTimersByTimeAsync(EDIT_CHECK_DELAY_MS)
    expect(read('d1')?.status).toBe('done')
    scheduleEditCheck('d1', 'line', 'b', input, layout(14))
    await vi.advanceTimersByTimeAsync(EDIT_CHECK_DELAY_MS)
    expect(read('d1')?.status).toBe('running')
    // While b runs, the chart keeps drawing a's rope, marked as pending.
    expect(drawnEditResult(read('d1'), 'line', 'b')).toEqual({ result: resultFor(10), pending: true })
    scheduleEditCheck('d1', 'line', 'c', input, layout(16))
    expect(signals[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(EDIT_CHECK_DELAY_MS)
    expect(read('d1')).toMatchObject({ status: 'done', checkKey: 'c', result: resultFor(16) })
    expect(drawnEditResult(read('d1'), 'line', 'c')).toEqual({ result: resultFor(16), pending: false })
    // A result for another D-line state is never drawn.
    expect(drawnEditResult(read('d1'), 'moved line', 'c')).toBeNull()
  })

  it('records why an edit cannot be checked without sending it', () => {
    setEditCheckError('d1', 'line', 'a', 'Ground is unknown under the support at 150 m.')
    expect(read('d1')).toMatchObject({ status: 'error', error: expect.stringMatching(/unknown/) })
    vi.advanceTimersByTime(EDIT_CHECK_DELAY_MS * 2)
    expect(analyze).not.toHaveBeenCalled()
    clearEditCheck('d1')
    expect(read('d1')).toBeUndefined()
  })

  it('toggles the located row', () => {
    focusLayoutRow('d1', 'clearance', 120)
    expect(getLayoutFocus()).toMatchObject({ cableId: 'd1', rowId: 'clearance', x: 120 })
    focusLayoutRow('d1', 'span:0', 40)
    expect(getLayoutFocus()).toMatchObject({ rowId: 'span:0', x: 40 })
    focusLayoutRow('d1', 'span:0', 40)
    expect(getLayoutFocus()).toBeNull()
  })

  it('clears a pressed span row once the spans change, and keeps other rows', () => {
    const Spans = ({ spans }: { spans: { fromM: number; toM: number }[] }) => {
      useClearStaleSpanFocus('d1', spans)
      return null
    }
    const before = [
      { fromM: 0, toM: 190 },
      { fromM: 190, toM: 380 },
    ]
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(Spans, { spans: before }))
    })
    focusLayoutRow('d1', 'span:1', 300)
    // The same spans again (a re-render, or a re-check that moved nothing) keep the row pressed.
    act(() => renderer.update(createElement(Spans, { spans: before.map((s) => ({ ...s })) })))
    expect(getLayoutFocus()).toMatchObject({ rowId: 'span:1' })
    act(() =>
      renderer.update(
        createElement(Spans, {
          spans: [
            { fromM: 0, toM: 300 },
            { fromM: 300, toM: 380 },
          ],
        }),
      ),
    )
    expect(getLayoutFocus()).toBeNull()
    focusLayoutRow('d1', 'clearance', 120)
    act(() => renderer.update(createElement(Spans, { spans: before })))
    expect(getLayoutFocus()).toMatchObject({ rowId: 'clearance' })
    act(() => renderer.unmount())
  })
})
