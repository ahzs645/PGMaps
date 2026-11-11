import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { AppSelect } from './select'
import { optionsFromChildren, splitSelectClasses, StyledSelect } from './styled-select'

const render = (element: React.ReactElement) => {
  let view: ReactTestRenderer
  act(() => {
    view = create(element)
  })
  return view!
}

describe('optionsFromChildren', () => {
  it('reads options through fragments, arrays, conditionals and option groups', () => {
    const extra = false as boolean
    const options = optionsFromChildren(
      <>
        <option value="">Any</option>
        {[1, 2].map((n) => (
          <option key={n} value={n}>
            Item {n}
          </option>
        ))}
        {extra && <option value="hidden">Hidden</option>}
        <optgroup label="Rasters" disabled>
          <option value="dem">DEM</option>
        </optgroup>
        <optgroup label="Vectors">
          <>
            <option value="roads" title="Road lines">
              Roads
            </option>
          </>
          <option disabled>Streams</option>
        </optgroup>
      </>,
    )
    expect(options).toEqual([
      { value: '', label: 'Any', disabled: undefined, title: undefined, group: undefined },
      { value: '1', label: 'Item 1', disabled: undefined, title: undefined, group: undefined },
      { value: '2', label: 'Item 2', disabled: undefined, title: undefined, group: undefined },
      { value: 'dem', label: 'DEM', disabled: true, title: undefined, group: 'Rasters' },
      { value: 'roads', label: 'Roads', disabled: undefined, title: 'Road lines', group: 'Vectors' },
      { value: 'Streams', label: 'Streams', disabled: true, title: undefined, group: 'Vectors' },
    ])
  })
})

describe('splitSelectClasses', () => {
  it('puts width, flex, margin and display classes on the wrapper and the rest on the trigger', () => {
    expect(splitSelectClasses('w-full sm:w-40 flex-1 mt-1 -ml-2 hidden md:block rounded border px-2 text-xs')).toEqual({
      layout: ['w-full', 'sm:w-40', 'flex-1', 'mt-1', '-ml-2', 'hidden', 'md:block'],
      trigger: ['rounded', 'border', 'px-2', 'text-xs'],
    })
  })
})

describe('StyledSelect', () => {
  it('calls onChange with a select-like event and skips an unchanged pick', () => {
    const change = vi.fn()
    const view = render(
      <StyledSelect name="source" value="a" onChange={change} aria-label="Source" className="w-40 text-xs">
        <option value="a">A</option>
        <option value="b">B</option>
      </StyledSelect>,
    )
    const select = view.root.findByType(AppSelect)
    expect(select.props.value).toBe('a')
    expect(select.props.triggerAriaLabel).toBe('Source')
    expect(select.props.className).toContain('w-40')
    expect(select.props.triggerClassName).toBe('text-xs')
    act(() => select.props.onValueChange('a'))
    expect(change).not.toHaveBeenCalled()
    act(() => select.props.onValueChange('b'))
    expect(change).toHaveBeenCalledWith({
      target: { value: 'b', name: 'source' },
      currentTarget: { value: 'b', name: 'source' },
    })
  })

  it('keeps its own value when uncontrolled and shows the first option for an unmatched value', () => {
    const view = render(
      <StyledSelect defaultValue="b" aria-label="Uncontrolled">
        <option value="a">A</option>
        <option value="b">B</option>
      </StyledSelect>,
    )
    expect(view.root.findByType(AppSelect).props.value).toBe('b')
    act(() => view.root.findByType(AppSelect).props.onValueChange('a'))
    expect(view.root.findByType(AppSelect).props.value).toBe('a')

    const unmatched = render(
      <StyledSelect value="gone" onChange={vi.fn()} aria-label="Unmatched">
        <option value="a" disabled>
          A
        </option>
        <option value="b">B</option>
      </StyledSelect>,
    )
    expect(unmatched.root.findByType(AppSelect).props.value).toBe('b')
  })

  it('becomes searchable past ten options and falls back to a native select for multi-select', () => {
    const many = Array.from({ length: 11 }, (_, i) => (
      <option key={i} value={i}>
        {`Option ${i}`}
      </option>
    ))
    expect(
      render(<StyledSelect aria-label="Many">{many}</StyledSelect>).root.findByType(AppSelect).props.searchable,
    ).toBe(true)
    const change = vi.fn()
    const multi = render(
      <StyledSelect multiple value={['a']} onChange={change} aria-label="Many at once">
        <option value="a">A</option>
      </StyledSelect>,
    )
    expect(multi.root.findAllByType(AppSelect)).toHaveLength(0)
    expect(multi.root.findByType('select').props.multiple).toBe(true)
  })
})
