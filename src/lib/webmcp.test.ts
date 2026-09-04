import { describe, expect, it } from 'vitest'

import { optionalString, requiredString, resolveNamedIndex } from './webmcp'

describe('WebMCP input helpers', () => {
  it('trims and validates required strings', () => {
    expect(requiredString({ scene: '  Two  ' }, 'scene')).toBe('Two')
    expect(() => requiredString({}, 'scene')).toThrow('scene must be a non-empty string')
  })

  it('keeps an empty optional string so a filter can be cleared', () => {
    expect(optionalString({ query: '  ' }, 'query')).toBe('')
    expect(optionalString({}, 'query')).toBeUndefined()
  })

  it('resolves scenes by one-based number, exact title, or unique partial text', () => {
    const scenes = [
      { label: 'Opening', title: 'A provincial view' },
      { label: 'North', title: 'Where the north begins' },
    ]
    expect(resolveNamedIndex(scenes, '2', 'scene')).toBe(1)
    expect(resolveNamedIndex(scenes, 'Opening', 'scene')).toBe(0)
    expect(resolveNamedIndex(scenes, 'north begins', 'scene')).toBe(1)
    expect(() => resolveNamedIndex(scenes, 'missing', 'scene')).toThrow('Available scenes')
  })
})
