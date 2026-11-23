import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisInput, AnalysisResult, AnalysisWorkerResponse, ReverseInput } from './types'
import { useVisibilityAnalysis, type AnalysisController } from './useVisibilityAnalysis'

/** A worker that only records what it was sent; the test answers for it. */
class FakeWorker {
  static made: FakeWorker[] = []
  onmessage: ((event: MessageEvent<AnalysisWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  sent: Array<{ type: string; requestId: number }> = []
  terminated = false
  constructor() {
    FakeWorker.made.push(this)
  }
  postMessage(message: { type: string; requestId: number }) {
    this.sent.push(message)
  }
  terminate() {
    this.terminated = true
  }
  answer(message: AnalysisWorkerResponse) {
    if (this.terminated) return
    this.onmessage?.({ data: message } as MessageEvent<AnalysisWorkerResponse>)
  }
}

let hook: AnalysisController | null = null
function Probe() {
  const value = useVisibilityAnalysis()
  useEffect(() => void (hook = value))
  return null
}

const forwardInput = {} as AnalysisInput
const reverseInput = {} as ReverseInput
const current = () => {
  if (!hook) throw new Error('hook not mounted')
  return hook
}

describe('forward and reverse runs on the one worker', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(async () => {
    FakeWorker.made = []
    vi.stubGlobal('Worker', FakeWorker)
    await act(async () => {
      renderer = create(<Probe />)
    })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    vi.unstubAllGlobals()
  })

  it('settles a forward run that a reverse run replaced', () => {
    act(() => current().run(forwardInput))
    expect(current().state.status).toBe('running')
    act(() => current().runReverse(reverseInput))
    expect(current().reverseState.status).toBe('running')
    // The forward run's worker is gone, so nothing will ever answer it: its state must not stay `running`.
    expect(FakeWorker.made[0].terminated).toBe(true)
    expect(current().state.status).not.toBe('running')
  })

  it('settles a reverse run that a forward run replaced', () => {
    act(() => current().runReverse(reverseInput))
    act(() => current().run(forwardInput))
    expect(current().reverseState.status).not.toBe('running')
    expect(current().state.status).toBe('running')
  })

  it('keeps a forward result when a reverse run starts after it', () => {
    act(() => current().run(forwardInput))
    const [worker] = FakeWorker.made
    const result = { stations: [] } as unknown as AnalysisResult
    act(() => worker.answer({ type: 'result', requestId: worker.sent[0].requestId, result }))
    expect(current().state.status).toBe('ready')
    act(() => current().runReverse(reverseInput))
    expect(current().state).toMatchObject({ status: 'ready', result })
  })

  it('never lets a superseded run write its answer', () => {
    act(() => current().run(forwardInput))
    const [forward] = FakeWorker.made
    act(() => current().runReverse(reverseInput))
    const [, reverse] = FakeWorker.made
    // A late message from the forward request, even on the reverse worker, is ignored.
    act(() => reverse.answer({ type: 'error', requestId: forward.sent[0].requestId, message: 'late forward failure' }))
    expect(current().state.error).toBeNull()
    expect(current().reverseState.status).toBe('running')
    act(() => reverse.answer({ type: 'error', requestId: reverse.sent[0].requestId, message: 'no roads' }))
    expect(current().reverseState).toMatchObject({ status: 'error', error: 'no roads' })
    expect(current().state.status).not.toBe('running')
  })

  it('cancel settles both', () => {
    act(() => current().run(forwardInput))
    act(() => current().cancel())
    expect(current().state.status).toBe('idle')
    expect(current().reverseState.status).toBe('idle')
  })
})
