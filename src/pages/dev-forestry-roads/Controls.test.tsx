import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { NumberField, OptionalNumberField } from './Controls'

function Required({ initial, min, max }: { initial: number; min: number; max: number }) {
  const [value, setValue] = useState(initial)
  return createElement(NumberField, { label: 'Quality', value, min, max, onChange: setValue })
}
function Optional({ min, max }: { min: number; max: number }) {
  const [value, setValue] = useState<number | null>(null)
  return createElement(OptionalNumberField, { label: 'Cut batter', value, min, max, onChange: setValue })
}
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
/** Types into the field as a browser does: the input event, then React's change. */
function type(renderer: ReactTestRenderer, value: string) {
  const input = renderer.root.findByType('input')
  act(() => {
    input.props.onInput({ currentTarget: { value } })
    input.props.onChange({ target: { value } })
  })
}
const blur = (renderer: ReactTestRenderer) => act(() => renderer.root.findByType('input').props.onBlur())

describe('a road number field says when it changes what was typed', () => {
  it('states the range while an out-of-range value is typed, then what it was changed to', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(Required, { initial: 40, min: 0, max: 100 }))
    })
    expect(text(renderer)).not.toContain('Enter 0 to 100')
    type(renderer, '150')
    // Not applied yet: the field is marked invalid and names the range.
    expect(renderer.root.findByType('input').props['aria-invalid']).toBe(true)
    expect(text(renderer)).toContain('Enter 0 to 100.')
    blur(renderer)
    expect(renderer.root.findByType('input').props.value).toBe('100')
    expect(renderer.root.findByType('input').props['aria-invalid']).toBeFalsy()
    expect(text(renderer)).toContain('150 is outside 0 to 100, so it was changed to 100.')
    // A value inside the range clears the note.
    type(renderer, '55')
    blur(renderer)
    expect(text(renderer)).not.toContain('changed to')
    expect(renderer.root.findByType('input').props.value).toBe('55')
  })
  it('does the same below the minimum and for an optional field', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(Optional, { min: 0.1, max: 10 }))
    })
    type(renderer, '-1')
    expect(text(renderer)).toContain('Enter 0.1 to 10.')
    blur(renderer)
    expect(renderer.root.findByType('input').props.value).toBe('0.1')
    expect(text(renderer)).toContain('-1 is outside 0.1 to 10, so it was changed to 0.1.')
    // Clearing an optional field is not an adjustment.
    type(renderer, '')
    blur(renderer)
    expect(text(renderer)).not.toContain('changed to')
  })
})
