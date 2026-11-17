import { describe, expect, it } from 'vitest'

import { ownPhotoSteps, type OwnPhotoStepsInput } from './ownPhotoSteps'

const base: OwnPhotoStepsInput = {
  position: 'exif',
  heading: 'exif',
  airborne: false,
  search: null,
  pairs: 0,
  solved: null,
  matched: null,
  bearing: 104,
  checkedBearings: [],
}

describe('ownPhotoSteps', () => {
  it('starts a phone photo with its position done and its heading still to find', () => {
    const { steps, next } = ownPhotoSteps(base)
    expect(steps.position).toEqual({ state: 'done', note: 'from the photo’s GPS' })
    expect(steps.direction.state).toBe('todo')
    expect(steps.direction.note).toContain('often a few degrees out')
    expect(steps.check.state).toBe('todo')
    expect(next).toBe('direction')
  })

  it('warns that a phone’s heading from an aircraft can be far out', () => {
    const { steps } = ownPhotoSteps({ ...base, airborne: true })
    expect(steps.position.note).toBe('from the photo’s GPS, at its altitude')
    expect(steps.direction.note).toContain('from an aircraft can be far out')
  })

  it('asks for a spot first when the photo has none', () => {
    const { steps, next } = ownPhotoSteps({ ...base, position: null, heading: 'road-view' })
    expect(steps.position.state).toBe('attention')
    expect(next).toBe('position')
  })

  it('does not take the road view’s spot for where the photo was taken', () => {
    const { steps, next } = ownPhotoSteps({ ...base, position: 'road-view' })
    expect(steps.position.state).toBe('todo')
    expect(next).toBe('position')
  })

  it('reads a trusted skyline search as done, and an unsettled one as wanting attention', () => {
    const found = ownPhotoSteps({ ...base, heading: 'skyline', search: { trustworthy: true, ambiguous: false } })
    expect(found.steps.direction).toEqual({ state: 'done', note: 'fitted to the skyline' })
    expect(found.next).toBe('check')
    const unsettled = ownPhotoSteps({ ...base, heading: 'skyline', search: { trustworthy: false, ambiguous: true } })
    expect(unsettled.steps.direction.state).toBe('attention')
    expect(unsettled.steps.direction.note).toContain('not settled')
    expect(unsettled.next).toBe('direction')
    const poor = ownPhotoSteps({ ...base, heading: 'skyline', search: { trustworthy: false, ambiguous: false } })
    expect(poor.steps.direction.note).toContain('not trustworthy')
  })

  it('reads a point solve as done unless the solved camera looks wrong', () => {
    const solved = ownPhotoSteps({ ...base, heading: 'controls', pairs: 4, solved: { points: 4, suspect: false } })
    expect(solved.steps.direction).toEqual({ state: 'done', note: 'solved from 4 paired points' })
    const suspect = ownPhotoSteps({ ...base, heading: 'controls', pairs: 3, solved: { points: 3, suspect: true } })
    expect(suspect.steps.direction.state).toBe('attention')
  })

  it('carries a matched camera’s warnings into its step', () => {
    const clean = ownPhotoSteps({ ...base, position: 'matched', heading: 'matched', matched: { checks: 0 } })
    expect(clean.steps.direction.state).toBe('done')
    const warned = ownPhotoSteps({ ...base, position: 'matched', heading: 'matched', matched: { checks: 2 } })
    expect(warned.steps.direction.state).toBe('attention')
  })

  it('leaves a landmark heading unfinished: it is a start for the search or the solve', () => {
    expect(ownPhotoSteps({ ...base, heading: 'landmark' }).steps.direction.state).toBe('todo')
  })

  it('counts a check only for the camera it was drawn for', () => {
    const settled: OwnPhotoStepsInput = {
      ...base,
      heading: 'skyline',
      search: { trustworthy: true, ambiguous: false },
      bearing: 48.9,
    }
    const checked = ownPhotoSteps({ ...settled, checkedBearings: [48.9] })
    expect(checked.steps.check.state).toBe('done')
    expect(checked.next).toBe('line-up')
    const moved = ownPhotoSteps({ ...settled, checkedBearings: [277] })
    expect(moved.steps.check).toEqual({ state: 'todo', note: 'the camera has changed since it was checked' })
    expect(moved.next).toBe('check')
    // Across north: 359.8° and 0.1° are 0.3° apart.
    expect(ownPhotoSteps({ ...settled, bearing: 0.1, checkedBearings: [359.8] }).steps.check.state).toBe('done')
  })
})
