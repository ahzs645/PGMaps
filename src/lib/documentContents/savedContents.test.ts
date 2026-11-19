import { describe, expect, it } from 'vitest'

import { ON_OFF, type ContentsPart } from './contents'
import {
  MAX_SAVED_CONTENTS,
  MAX_SAVED_CONTENTS_NAME,
  applySavedContents,
  matchingSavedContents,
  parseSavedContents,
  readSavedContents,
  savedContentsName,
  savedContentsPresets,
  withSavedContents,
  withoutSavedContents,
  type SavedContents,
} from './savedContents'

const part = (key: string, extra: Partial<ContentsPart> = {}): ContentsPart => ({
  key,
  label: key,
  state: 'on',
  ...extra,
})

describe('saved contents', () => {
  it('reads a stored preset and refuses a malformed one with the field named', () => {
    expect(parseSavedContents({ id: 'p1', name: '  Short  ', states: { a: 'off' }, order: ['b', 'a'] })).toEqual({
      id: 'p1',
      name: 'Short',
      states: { a: 'off' },
      order: ['b', 'a'],
    })
    expect(() => parseSavedContents({ id: 'p1', name: 'x', states: { a: 3 } })).toThrow('Saved contents.states.a')
    expect(() => parseSavedContents({ id: 'p1', name: '   ', states: {} })).toThrow('Saved contents.name')
    expect(() => parseSavedContents({ id: 'p1', name: 'x', states: {}, order: 'a' })).toThrow('Saved contents.order')
  })

  it('reads every stored preset, listing what no longer reads', () => {
    const read = readSavedContents([
      { id: 'p1', name: 'One', states: {} },
      { id: 'p1', name: 'Again', states: {} },
      'junk',
    ])
    expect(read.saved.map((preset) => preset.id)).toEqual(['p1'])
    expect(read.unreadable.map((entry) => entry.index)).toEqual([1, 2])
    expect(readSavedContents({ not: 'a list' })).toEqual({ saved: [], unreadable: [] })
  })

  it('trims and caps names', () => {
    expect(savedContentsName('  Field \n copy ')).toBe('Field copy')
    expect(savedContentsName('   ')).toBeNull()
    expect(savedContentsName('x'.repeat(200))).toHaveLength(MAX_SAVED_CONTENTS_NAME)
  })

  it('replaces a preset of the same name and refuses past the cap', () => {
    const first = withSavedContents([], { id: 'p1', name: 'Mine', states: { a: 'off' } })
    if ('error' in first) throw Error(first.error)
    const again = withSavedContents(first.saved, { id: 'p2', name: 'mine ', states: { a: 'on' }, order: ['a'] })
    if ('error' in again) throw Error(again.error)
    expect(again.saved).toEqual([{ id: 'p1', name: 'mine', states: { a: 'on' }, order: ['a'] }])
    const full: SavedContents[] = Array.from({ length: MAX_SAVED_CONTENTS }, (_, index) => ({
      id: `p${index}`,
      name: `Preset ${index}`,
      states: {},
    }))
    expect(withSavedContents(full, { id: 'new', name: 'One more', states: {} })).toEqual({
      error: `This list keeps ${MAX_SAVED_CONTENTS} presets. Delete one to save another.`,
    })
    expect(withSavedContents([], { id: 'x', name: ' ', states: {} })).toEqual({ error: 'Give the preset a name.' })
    expect(withoutSavedContents(full, 'p0')).toHaveLength(MAX_SAVED_CONTENTS - 1)
  })

  it('applies a preset to today’s parts, reporting ids it no longer has', () => {
    const parts = [part('a'), part('b'), part('locked', { locked: 'Always printed' }), part('new')]
    const preset: SavedContents = {
      id: 'p1',
      name: 'Mine',
      states: { a: 'off', gone: 'off', locked: 'off', b: 'sideways' },
      order: ['b', 'gone', 'a', 'locked'],
    }
    expect(applySavedContents(preset, parts, ON_OFF)).toEqual({
      states: { a: 'off' },
      order: ['b', 'a', 'locked', 'new'],
      unknown: ['gone'],
      invalid: ['b'],
    })
  })

  it('finds the saved preset the parts match now', () => {
    const saved: SavedContents[] = [
      { id: 'p1', name: 'Off a', states: { a: 'off' } },
      { id: 'p2', name: 'Off b, b first', states: { b: 'off' }, order: ['b', 'a'] },
    ]
    expect(matchingSavedContents(saved, [part('a', { state: 'off' }), part('b')], ON_OFF)).toBe('p1')
    expect(matchingSavedContents(saved, [part('b', { state: 'off' }), part('a')], ON_OFF)).toBe('p2')
    expect(matchingSavedContents(saved, [part('a'), part('b', { state: 'off' })], ON_OFF)).toBeNull()
    expect(savedContentsPresets(saved)).toEqual([
      { id: 'p1', label: 'Off a', saved: true },
      { id: 'p2', label: 'Off b, b first', saved: true },
    ])
  })
})
