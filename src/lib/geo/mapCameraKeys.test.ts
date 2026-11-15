import { describe, expect, it } from 'vitest'

import { keyBelongsElsewhere, mapCameraAction } from './mapCameraKeys'

describe('map camera keys', () => {
  it('reads N, U, R and ? in either case', () => {
    expect(mapCameraAction({ key: 'n' })).toBe('north')
    expect(mapCameraAction({ key: 'N' })).toBe('north')
    expect(mapCameraAction({ key: 'u' })).toBe('topDown')
    expect(mapCameraAction({ key: 'r' })).toBe('reset')
    expect(mapCameraAction({ key: '?' })).toBe('help')
    expect(mapCameraAction({ key: 'x' })).toBeNull()
    expect(mapCameraAction({ key: 'Enter' })).toBeNull()
  })

  it('leaves modified, repeated and already-handled presses alone', () => {
    expect(mapCameraAction({ key: 'r', metaKey: true })).toBeNull()
    expect(mapCameraAction({ key: 'r', ctrlKey: true })).toBeNull()
    expect(mapCameraAction({ key: 'n', altKey: true })).toBeNull()
    expect(mapCameraAction({ key: 'n', repeat: true })).toBeNull()
    expect(mapCameraAction({ key: 'n', defaultPrevented: true })).toBeNull()
    expect(mapCameraAction({ key: 'n', isComposing: true })).toBeNull()
  })

  it('never takes keys typed into a field, a dialog or a menu', () => {
    expect(keyBelongsElsewhere({ tagName: 'input' })).toBe(true)
    expect(keyBelongsElsewhere({ tagName: 'TEXTAREA' })).toBe(true)
    expect(keyBelongsElsewhere({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(keyBelongsElsewhere({ tagName: 'BUTTON', closest: (s) => (s.includes('dialog') ? {} : null) })).toBe(true)
    expect(keyBelongsElsewhere({ tagName: 'CANVAS', closest: () => null })).toBe(false)
    expect(keyBelongsElsewhere(null)).toBe(false)
  })
})
