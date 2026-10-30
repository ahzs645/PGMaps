import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { NumericRangeField } from './numeric-range-field'

describe('numeric range fields', () => {
  it('emits continuous numeric edits and retains caller bounds, display, names and help', () => {
    const change = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <NumericRangeField
          label="Observer height"
          aria-label="Height above ground"
          min={0.5}
          max={120}
          step={0.1}
          value={1.6}
          unit="m"
          description="Measured above the sampled terrain."
          onChange={change}
        />,
      )
    })
    try {
      const input = renderer.root.findByType('input')
      expect(input.props).toMatchObject({
        min: 0.5,
        max: 120,
        step: 0.1,
        value: 1.6,
        type: 'range',
        'aria-label': 'Height above ground',
        'aria-valuetext': '1.6 m',
      })
      expect(renderer.root.findByType('label').props.htmlFor).toBe(input.props.id)
      expect(renderer.root.findByType('p').props.id).toBe(input.props['aria-describedby'])
      act(() => input.props.onChange({ target: { value: '2.3' } }))
      act(() => input.props.onChange({ target: { value: '2.4' } }))
      expect(change.mock.calls).toEqual([[2.3], [2.4]])
      act(() =>
        renderer.update(
          <NumericRangeField
            label="Palette start"
            min={0}
            max={55}
            value={20}
            display="20%"
            disabled
            onChange={change}
          />,
        ),
      )
      expect(renderer.root.findByType('input').props).toMatchObject({
        min: 0,
        max: 55,
        step: 1,
        value: 20,
        disabled: true,
        'aria-valuetext': '20%',
      })
    } finally {
      act(() => renderer.unmount())
    }
  })

  it('passes the same value and accessibility contract to an existing slider adapter', () => {
    const change = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        <NumericRangeField
          label="Target height"
          value={0}
          min={0}
          max={120}
          step={1}
          unit="m"
          disabled
          onChange={change}
          renderControl={({ onChange, ...props }) => <button {...props} onClick={() => onChange(3)} />}
        />,
      )
    })
    try {
      expect(renderer.root.findAllByType('input')).toHaveLength(0)
      const control = renderer.root.findByType('button')
      expect(control.props).toMatchObject({
        min: 0,
        max: 120,
        step: 1,
        value: 0,
        disabled: true,
        'aria-label': 'Target height',
        'aria-valuetext': '0 m',
      })
      expect(renderer.root.findByType('label').props.htmlFor).toBe(control.props.id)
      // An adapter owns its interaction; the field forwards every reported value.
      act(() => control.props.onClick())
      expect(change).toHaveBeenCalledWith(3)
    } finally {
      act(() => renderer.unmount())
    }
  })
})
