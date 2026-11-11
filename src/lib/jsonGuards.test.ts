import { describe, expect, it } from 'vitest'
import { distinct, int, list, oneOf, optional, strictObject, text } from './jsonGuards'

describe('jsonGuards', () => {
  it('names the field it rejects', () => {
    expect(() => text('', 'Layout name')).toThrow('Layout name must contain 1–200 characters.')
    expect(() => int(2.5, 'Gap', 0, 40)).toThrow('Gap must be a whole number between 0 and 40.')
    expect(() => oneOf('middle', 'Dock', ['top', 'side'])).toThrow('Dock must be one of top, side.')
    expect(() => list('x', 'Groups')).toThrow('Groups must contain')
  })

  it('refuses unknown keys in a strict object', () => {
    expect(() => strictObject({ dock: 'top', dok: 1 }, 'Toolbar', ['dock'])).toThrow('Toolbar has unknown key: dok.')
    expect(strictObject({ dock: 'top' }, 'Toolbar', ['dock'])).toEqual({ dock: 'top' })
  })

  it('leaves absent optional values undefined and parses present ones', () => {
    const source = { gap: 4 }
    expect(optional(source, 'inset', (v) => int(v, 'Inset', 0, 80))).toBeUndefined()
    expect(optional(source, 'gap', (v) => int(v, 'Gap', 0, 40))).toBe(4)
  })

  it('rejects repeats', () => {
    expect(() => distinct(['a', 'a'], 'Repeated command')).toThrow('Repeated command')
  })
})
