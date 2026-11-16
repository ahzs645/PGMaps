import { describe, expect, it } from 'vitest'
import { createTourActionStream } from './tourActions'
import { readTourLaunch, tourkitMode, tourLaunchSearch } from './tourLaunch'

describe('lesson launch from the address', () => {
  const lessons = ['station-200']

  it('reads a known lesson and its mode, practice by default', () => {
    expect(readTourLaunch('?example=training&tour=station-200&tourMode=watch', lessons)).toEqual({
      id: 'station-200',
      mode: 'watch',
    })
    expect(readTourLaunch('?tour=station-200', lessons)).toEqual({ id: 'station-200', mode: 'practice' })
    expect(readTourLaunch('?tour=station-200&tourMode=anything', lessons)?.mode).toBe('practice')
  })

  it('ignores a lesson this page does not have', () => {
    expect(readTourLaunch('?tour=unknown', lessons)).toBeNull()
    expect(readTourLaunch('?example=training', lessons)).toBeNull()
  })

  it('sets or removes the lesson and keeps every other parameter', () => {
    const search = '?example=training&interface=workbench&tour=station-200&tourMode=practice'
    expect(tourLaunchSearch(search, null)).toBe('?example=training&interface=workbench')
    expect(tourLaunchSearch('?tour=station-200', null)).toBe('')
    expect(tourLaunchSearch('?interface=ribbon', { id: 'station-200', mode: 'watch' })).toBe(
      '?interface=ribbon&tour=station-200&tourMode=watch',
    )
  })

  it('says watch where Tourkit says autoplay', () => {
    expect(tourkitMode('watch')).toBe('autoplay')
    expect(tourkitMode('practice')).toBe('practice')
  })
})

describe('the action stream a page reports to', () => {
  it('hands each listener the action as Tourkit matches it, until it unsubscribes', () => {
    const stream = createTourActionStream()
    const seen: unknown[] = []
    const stop = stream.subscribe((action) => seen.push(action))
    stream.observe('road.command', { command: 'crossSection' })
    stream.observe('road.plan')
    stop()
    stream.observe('road.command', { command: 'profile' })
    expect(seen).toEqual([
      { id: 'road.command', args: { command: 'crossSection' }, match: 'subset' },
      { id: 'road.plan', match: 'subset' },
    ])
  })
})
