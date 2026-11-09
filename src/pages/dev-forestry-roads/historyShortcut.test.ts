import { describe, expect, it } from 'vitest'
import { historyShortcut, isApplePlatform, isRemoveKey } from './historyShortcut'

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

describe('historyShortcut', () => {
  it('reads ⌘Z and ⇧⌘Z on Apple devices, and ignores Ctrl there', () => {
    expect(historyShortcut(key('z', { metaKey: true }), true)).toBe('undo')
    expect(historyShortcut(key('Z', { metaKey: true, shiftKey: true }), true)).toBe('redo')
    expect(historyShortcut(key('z', { ctrlKey: true }), true)).toBeNull()
    expect(historyShortcut(key('y', { metaKey: true }), true)).toBeNull()
  })

  it('reads Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z elsewhere, and ignores the Windows key', () => {
    expect(historyShortcut(key('z', { ctrlKey: true }), false)).toBe('undo')
    expect(historyShortcut(key('y', { ctrlKey: true }), false)).toBe('redo')
    expect(historyShortcut(key('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo')
    expect(historyShortcut(key('z', { metaKey: true }), false)).toBeNull()
  })

  it('leaves Alt chords and other keys alone', () => {
    expect(historyShortcut(key('z', { ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(historyShortcut(key('x', { ctrlKey: true }), false)).toBeNull()
    expect(historyShortcut(key('z'), false)).toBeNull()
  })
})

describe('isRemoveKey', () => {
  it('reads Delete and Backspace alone, and leaves chords to the browser', () => {
    expect(isRemoveKey(key('Delete'))).toBe(true)
    expect(isRemoveKey(key('Backspace'))).toBe(true)
    expect(isRemoveKey(key('Backspace', { metaKey: true }))).toBe(false)
    expect(isRemoveKey(key('Delete', { shiftKey: true }))).toBe(false)
    expect(isRemoveKey(key('d'))).toBe(false)
  })
})

describe('isApplePlatform', () => {
  it('prefers client hints and falls back to navigator.platform', () => {
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' } })).toBe(true)
    expect(isApplePlatform({ platform: 'iPad' })).toBe(true)
    expect(isApplePlatform({ platform: 'Win32' })).toBe(false)
    expect(isApplePlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(false)
  })
})
