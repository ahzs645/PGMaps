import { describe, expect, it } from 'vitest'
import { helpHref, helpInterface, legacyHelpTarget, lessonLaunchHref } from './helpLinks'

const lessons = ['station-200', 'sketch-road']

describe('the old static help addresses', () => {
  it('send the catalog, in either layout, to the hub with its interface', () => {
    expect(legacyHelpTarget('index.html', '', lessons)).toBe('/help')
    expect(legacyHelpTarget('index.html', '?layout=ribbon&interface=ribbon', lessons)).toBe('/help?interface=ribbon')
    expect(legacyHelpTarget('index.html', '?interface=workbench&ribbonInterface=ribbon', lessons)).toBe(
      '/help?interface=workbench',
    )
  })

  it('send a guide, a recorded player or a Ribbon page to the lesson’s page', () => {
    expect(legacyHelpTarget('station-200/index.html', '?interface=workbench', lessons)).toBe(
      '/help/station-200?interface=workbench',
    )
    expect(legacyHelpTarget('sketch-road/tour.html', '', lessons)).toBe('/help/sketch-road')
    expect(legacyHelpTarget('ribbon.html', '?lesson=sketch-road&view=tour&interface=ribbon', lessons)).toBe(
      '/help/sketch-road?interface=ribbon',
    )
  })

  it('send an unknown lesson to the hub, and leave the new addresses alone', () => {
    expect(legacyHelpTarget('gone/tour.html', '', lessons)).toBe('/help')
    expect(legacyHelpTarget('ribbon.html', '?lesson=gone', lessons)).toBe('/help')
    expect(legacyHelpTarget('', '', lessons)).toBeNull()
    expect(legacyHelpTarget('station-200', '', lessons)).toBeNull()
    expect(legacyHelpTarget('station-200/', '', lessons)).toBeNull()
  })
})

describe('lesson and help links', () => {
  it('open the designer on the fixture, in the chosen interface, with the lesson requested', () => {
    expect(lessonLaunchHref('station-200', 'watch', { example: 'training' }, 'ribbon')).toBe(
      '/dev/forestry/road-design?example=training&interface=ribbon&tour=station-200&tourMode=watch',
    )
    expect(lessonLaunchHref('station-200', 'practice', { example: 'training' }, null)).toBe(
      '/dev/forestry/road-design?example=training&tour=station-200&tourMode=practice',
    )
  })

  it('keep only a known interface', () => {
    expect(helpInterface('?interface=ribbon', ['ribbon', 'workbench'])).toBe('ribbon')
    expect(helpInterface('?interface=gone&ribbonInterface=ribbon', ['ribbon'])).toBe('ribbon')
    expect(helpInterface('?interface=gone', ['ribbon'])).toBeNull()
    expect(helpHref('/help', null)).toBe('/help')
    expect(helpHref('/help/station-200', 'ribbon')).toBe('/help/station-200?interface=ribbon')
  })
})
