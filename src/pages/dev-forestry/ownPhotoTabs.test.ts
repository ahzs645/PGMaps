import { describe, expect, it } from 'vitest'

import { adjustsAt, ownPhotoPrimary, tabOf, type OwnPhotoPrimaryInput } from './ownPhotoTabs'

const base: OwnPhotoPrimaryInput = {
  count: 3,
  activeId: 'a',
  queue: { running: false, position: null, total: 3 },
  status: 'options',
  acceptance: 'none',
  checked: false,
  acceptReason: null,
  viewpointId: null,
  standReason: null,
  nextId: 'b',
}

describe('own photo tabs', () => {
  it('opens the older steps on the camera tab, the first two with the hand tools', () => {
    expect(tabOf('position')).toBe('camera')
    expect(tabOf('check')).toBe('camera')
    expect(tabOf('use')).toBe('use')
    expect(adjustsAt('direction')).toBe(true)
    expect(adjustsAt('check')).toBe(false)
    expect(adjustsAt('photos')).toBe(false)
  })
})

describe('ownPhotoPrimary', () => {
  it('adds photos when there are none', () => {
    expect(ownPhotoPrimary({ ...base, count: 0, activeId: null }).kind).toBe('add')
  })

  it('says where the queue is while the active photo waits or is searched', () => {
    expect(ownPhotoPrimary({ ...base, status: 'searching', queue: { running: true, position: 3, total: 14 } })).toEqual(
      { kind: 'searching', label: 'Searching 3 of 14' },
    )
    expect(ownPhotoPrimary({ ...base, status: 'queued' }).label).toBe('Waiting its turn')
  })

  it('offers the search for a photo the queue never reached', () => {
    expect(ownPhotoPrimary({ ...base, status: 'unsearched' })).toEqual({
      kind: 'search',
      label: 'Search for the camera',
    })
  })

  it('checks before it accepts, and passes on the gate’s reason', () => {
    expect(ownPhotoPrimary(base).kind).toBe('check')
    expect(ownPhotoPrimary({ ...base, status: 'failed' }).kind).toBe('check')
    expect(ownPhotoPrimary({ ...base, checked: true, acceptReason: 'Type your initials.' })).toEqual({
      kind: 'accept',
      label: 'Accept camera',
      reason: 'Type your initials.',
    })
  })

  it('treats a lapsed acceptance as none', () => {
    expect(ownPhotoPrimary({ ...base, acceptance: 'lapsed' }).kind).toBe('check')
  })

  it('makes a viewpoint, stands there, then moves on', () => {
    const accepted = { ...base, status: 'accepted' as const, acceptance: 'accepted' as const, checked: true }
    expect(ownPhotoPrimary(accepted).kind).toBe('viewpoint')
    expect(ownPhotoPrimary({ ...accepted, viewpointId: 'v' }).kind).toBe('stand')
    expect(ownPhotoPrimary({ ...accepted, viewpointId: 'v', standReason: 'Too far' })).toEqual({
      kind: 'next',
      label: 'Next photo',
      nextId: 'b',
    })
    expect(ownPhotoPrimary({ ...accepted, viewpointId: 'v', standReason: 'Too far', nextId: null })).toMatchObject({
      kind: 'stand',
      reason: 'Too far',
    })
  })
})
