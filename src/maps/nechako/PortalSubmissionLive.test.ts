import { describe, expect, it } from 'vitest'
import { refreshSubmissionLiveAfterConnection } from './PortalSubmissionLive'
import { SubmissionLiveLoader, type SubmissionLiveState } from './data/submissionLive'

describe('live submission connection completion', () => {
  it('clears an in-flight identity read, then refreshes on successful sign-in without accepting the old response', async () => {
    let finishPrevious!: (value: unknown) => void
    const states: SubmissionLiveState[] = []
    let reads = 0
    const loader = new SubmissionLiveLoader(
      async () => {
        if (++reads === 1)
          return new Promise((resolve) => {
            finishPrevious = resolve
          })
        return [{ uname: 'Current permitted account', history_timestamp: '2026-10-12' }]
      },
      (state) => states.push(state),
    )
    const oldRequest = loader.load('history', '9')
    const connectionEvent = async (reason: unknown) => {
      loader.cancel('Connection changed')
      if (refreshSubmissionLiveAfterConnection(reason)) await loader.load('history', '9')
    }
    await connectionEvent('session-changing')
    expect(reads).toBe(1)
    expect(states.at(-1)?.status).toBe('idle')
    await connectionEvent('signed-in')
    expect(reads).toBe(2)
    finishPrevious([{ uname: 'Previous private account' }])
    await oldRequest
    expect(JSON.stringify(states.at(-1))).toContain('Current permitted account')
    expect(JSON.stringify(states)).not.toContain('Previous private account')
  })
  it('uses a newly selected connection, while logout and cross-tab uncertainty require a manual read', async () => {
    const states: SubmissionLiveState[] = []
    let reads = 0
    const loader = new SubmissionLiveLoader(
      async () => {
        reads++
        return []
      },
      (state) => states.push(state),
    )
    for (const reason of ['disconnected', 'external-session', 'session-changing', undefined, 'unknown']) {
      loader.cancel()
      if (refreshSubmissionLiveAfterConnection(reason)) await loader.load('children', '9')
    }
    expect(reads).toBe(0)
    if (refreshSubmissionLiveAfterConnection('mode')) await loader.load('children', '9')
    expect(reads).toBe(1)
    expect(states.at(-1)).toEqual({ status: 'loaded', data: { kind: 'children', rows: [] } })
  })
})
