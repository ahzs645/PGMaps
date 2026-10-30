import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { FormField, NativeSelect, NullableNumberField, NumberField, SelectField } from './form-field'

describe('shared field interactions', () => {
  it('keeps a unitless numeric input directly inside its label and deduplicates its help reference', () => {
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<NumberField label="Station (m)" value={2} onValueChange={vi.fn()} hint="Station along the road" />)
    })
    const root = view!.root,
      input = root.findByType('input')
    expect(input.parent?.type).toBe('label')
    expect(input.parent?.findAllByType('span')[0].children).toEqual(['Station (m)'])
    const helpId = input.props['aria-describedby']
    expect(helpId.split(/\s+/)).toHaveLength(1)
    expect(root.findByProps({ id: helpId }).children).toEqual(['Station along the road'])
    act(() => view!.unmount())
  })

  it('retains the flex row for a unit or an explicitly styled row', () => {
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<NumberField label="Length" value={2} onValueChange={vi.fn()} unit="m" />)
    })
    expect(view!.root.findByType('input').parent?.type).toBe('span')
    expect(
      view!.root
        .findByType('input')
        .parent?.findAllByType('span')
        .some((span) => span.children.length === 1 && span.children[0] === 'm'),
    ).toBe(true)
    act(() => {
      view!.update(<NumberField label="Length" value={2} onValueChange={vi.fn()} rowClassName="mt-1" />)
    })
    expect(view!.root.findByType('input').parent?.props.className).toContain('mt-1')
    act(() => view!.unmount())
  })

  it('preserves source precision when a field is focused and blurred without editing', () => {
    const onValueChange = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<NumberField label="Source value" value={0.123456789} onValueChange={onValueChange} />)
    })
    const input = view!.root.findByType('input')
    expect(input.props.value).toBe('0.123456789')
    act(() => input.props.onBlur())
    expect(onValueChange).not.toHaveBeenCalled()
    act(() => view!.unmount())
  })

  it('steps an out-of-bounds draft before clamping the final value', () => {
    const onValueChange = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <NumberField
          label="Road offset"
          value={2}
          onValueChange={onValueChange}
          min={0}
          max={10}
          stepMode="increment"
        />,
      )
    })
    const input = () => view!.root.findByType('input')
    act(() => input().props.onChange({ target: { value: '-5' } }))
    act(() => input().props.onKeyDown({ key: 'ArrowUp', preventDefault: vi.fn() }))
    expect(onValueChange).toHaveBeenLastCalledWith(0)
    act(() => view!.unmount())
  })

  it('lets the browser apply native arrow steps and receives the resulting change normally', () => {
    const onValueChange = vi.fn(),
      preventDefault = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <NumberField label="Native diameter" value={0.15} onValueChange={onValueChange} min={0.1} step={0.1} />,
      )
    })
    const input = () => view!.root.findByType('input')
    act(() => input().props.onKeyDown({ key: 'ArrowDown', preventDefault }))
    expect(preventDefault).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
    // The actual browser aligns 0.15 to the min/step grid and dispatches change.
    act(() => input().props.onChange({ target: { value: '0.1' } }))
    expect(onValueChange).toHaveBeenLastCalledWith(0.1)
    act(() => view!.unmount())
  })

  it('keeps required drafts editable, clamps on commit and accepts an external reset', () => {
    const onValueChange = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<NumberField label="Length" value={2} onValueChange={onValueChange} min={1} max={10} />)
    })
    const input = () => view!.root.findByType('input')
    act(() => input().props.onChange({ target: { value: '' } }))
    expect(onValueChange).not.toHaveBeenCalled()
    expect(input().props.value).toBe('')
    act(() => input().props.onChange({ target: { value: '15' } }))
    expect(onValueChange).not.toHaveBeenCalled()
    act(() => input().props.onBlur())
    expect(onValueChange).toHaveBeenLastCalledWith(10)
    act(() => view!.update(<NumberField label="Length" value={4} onValueChange={onValueChange} min={1} max={10} />))
    expect(input().props.value).toBe('4')
    act(() => view!.unmount())
  })

  it('distinguishes a nullable blank and an advisory bound', () => {
    const onValueChange = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <NullableNumberField label="Observed" value={4} onValueChange={onValueChange} max={10} clampOn="never" />,
      )
    })
    const input = () => view!.root.findByType('input')
    act(() => input().props.onChange({ target: { value: '' } }))
    expect(onValueChange).toHaveBeenLastCalledWith(null)
    act(() => input().props.onChange({ target: { value: '15' } }))
    expect(onValueChange).toHaveBeenLastCalledWith(15)
    act(() => view!.unmount())
  })

  it('defers expensive changes until commit and steps with the keyboard', () => {
    const onValueChange = vi.fn(),
      onCommit = vi.fn(),
      preventDefault = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <NumberField
          label="Threshold"
          value={2}
          onValueChange={onValueChange}
          onCommit={onCommit}
          updateOn="commit"
          stepMode="increment"
          step={0.25}
        />,
      )
    })
    const input = () => view!.root.findByType('input')
    act(() => input().props.onChange({ target: { value: '3' } }))
    act(() => input().props.onKeyDown({ key: 'ArrowUp', preventDefault }))
    expect(preventDefault).toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(input().props.value).toBe('3.25')
    act(() => input().props.onKeyDown({ key: 'Enter' }))
    expect(onValueChange).toHaveBeenLastCalledWith(3.25)
    expect(onCommit).toHaveBeenCalledTimes(1)
    act(() => input().props.onBlur())
    expect(onCommit).toHaveBeenCalledTimes(1)
    act(() => view!.unmount())
  })

  it('associates help and errors without including a hint button in the label', () => {
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <FormField label="Area" error="Enter an area" hintAction={<button>About area</button>}>
          <input />
        </FormField>,
      )
    })
    const root = view!.root,
      input = root.findByType('input'),
      label = root.findByType('label')
    expect(label.props.htmlFor).toBe(input.props.id)
    expect(root.findByProps({ role: 'alert' }).props.id).toBe(input.props['aria-describedby'])
    expect(input.props['aria-invalid']).toBe(true)
    expect(label.findAllByType('button')).toHaveLength(0)
    act(() => view!.unmount())
  })

  it('retains native select props, option children and explicit label associations', () => {
    const change = vi.fn()
    let view: ReturnType<typeof create>
    act(() => {
      view = create(
        <SelectField label="Source" id="source" value="a" onChange={change} disabled hint="Choose a release">
          <option value="a">A</option>
        </SelectField>,
      )
    })
    const select = view!.root.findByType('select')
    expect(select.props.disabled).toBe(true)
    expect(view!.root.findByType('label').props.htmlFor).toBe('source')
    expect(select.props['aria-describedby']).toBe('source-description')
    expect(view!.root.findByType(NativeSelect).props.onChange).toBe(change)
    act(() => view!.unmount())
  })
})
