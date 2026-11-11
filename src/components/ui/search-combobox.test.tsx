import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SearchComboboxInput,
  SearchResultList,
  useSearchCombobox,
  type UseSearchComboboxOptions,
} from './search-combobox'

interface Item {
  name: string
  disabled?: boolean
  group?: string
}

const ITEMS: Item[] = [{ name: 'Alder' }, { name: 'Birch', disabled: true }, { name: 'Cedar' }, { name: 'Douglas fir' }]

let view: ReactTestRenderer | undefined
afterEach(() => {
  if (view) act(() => view?.unmount())
  view = undefined
})

type HarnessOptions = Partial<UseSearchComboboxOptions<Item>> & { query?: string }

function Harness({ query = '', ...options }: HarnessOptions) {
  const combobox = useSearchCombobox<Item>({
    items: ITEMS,
    onPick: () => {},
    isDisabled: (item) => Boolean(item.disabled),
    id: 'trees',
    ...options,
  })
  return (
    <>
      <SearchComboboxInput combobox={combobox} variant="bare" aria-label="Search trees" value={query} readOnly />
      <SearchResultList
        combobox={combobox}
        aria-label="Trees"
        getKey={(item) => item.name}
        getGroup={(item) => item.group}
        renderOption={(item) => item.name}
        empty={<p>No trees</p>}
      />
    </>
  )
}

function mount(options: HarnessOptions = {}) {
  act(() => {
    view = create(<Harness {...options} />)
  })
  return view!
}

const input = () => view!.root.findByProps({ role: 'combobox' })
const active = () => input().props['aria-activedescendant'] as string | undefined
function press(key: string, init: { isComposing?: boolean } = {}) {
  const event = { key, nativeEvent: { isComposing: Boolean(init.isComposing) }, preventDefault: vi.fn() }
  act(() => input().props.onKeyDown(event))
  return event
}

describe('useSearchCombobox', () => {
  it('starts on the first option and wraps past either end', () => {
    mount({ skipDisabled: false })
    expect(active()).toBe('trees-0')
    press('ArrowUp')
    expect(active()).toBe('trees-3')
    press('ArrowDown')
    expect(active()).toBe('trees-0')
    expect(press('ArrowDown').preventDefault).toHaveBeenCalled()
    expect(active()).toBe('trees-1')
  })

  it('stops at the ends when loop is off', () => {
    mount({ loop: false, skipDisabled: false })
    press('ArrowUp')
    expect(active()).toBe('trees-0')
    for (let i = 0; i < 5; i++) press('ArrowDown')
    expect(active()).toBe('trees-3')
  })

  it('passes over disabled options with the arrows, Home/End and hover', () => {
    mount({ homeEnd: true, activateOnHover: true })
    press('ArrowDown')
    expect(active()).toBe('trees-2')
    press('ArrowUp')
    expect(active()).toBe('trees-0')
    press('End')
    expect(active()).toBe('trees-3')
    press('Home')
    expect(active()).toBe('trees-0')
    const options = view!.root.findAllByProps({ role: 'option' })
    act(() => options[1].props.onPointerMove())
    expect(active()).toBe('trees-0')
    act(() => options[2].props.onPointerMove())
    expect(active()).toBe('trees-2')
  })

  it('leaves Home/End to the caret unless asked', () => {
    mount()
    expect(press('End').preventDefault).not.toHaveBeenCalled()
    expect(active()).toBe('trees-0')
  })

  it('picks the highlighted option with Enter and never a disabled one', () => {
    const onPick = vi.fn()
    mount({ onPick, skipDisabled: false })
    press('ArrowDown')
    const enter = press('Enter')
    expect(enter.preventDefault).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
    expect(view!.root.findAllByProps({ role: 'option' })[1].props['aria-disabled']).toBe(true)
    press('ArrowDown')
    press('Enter')
    expect(onPick).toHaveBeenCalledWith(ITEMS[2], 2)
    act(() => view!.root.findAllByProps({ role: 'option' })[1].props.onClick())
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('ignores keys while an input method is composing', () => {
    const onPick = vi.fn()
    mount({ onPick })
    const down = press('ArrowDown', { isComposing: true })
    const enter = press('Enter', { isComposing: true })
    expect(active()).toBe('trees-0')
    expect(down.preventDefault).not.toHaveBeenCalled()
    expect(enter.preventDefault).not.toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('returns to the first enabled option when the reset key changes', () => {
    const items = [{ name: 'Birch', disabled: true }, ...ITEMS.filter((item) => !item.disabled)]
    mount({ items, query: 'a', resetKey: 'a' })
    press('ArrowDown')
    press('ArrowDown')
    expect(active()).toBe('trees-3')
    act(() => view!.update(<Harness items={items} query="ab" resetKey="ab" />))
    expect(active()).toBe('trees-1')
  })

  it('has no highlight and ignores keys with no options', () => {
    const onPick = vi.fn()
    mount({ items: [], onPick })
    expect(active()).toBeUndefined()
    expect(press('ArrowDown').preventDefault).not.toHaveBeenCalled()
    press('Enter')
    expect(onPick).not.toHaveBeenCalled()
    expect(view!.root.findByType('p').children).toEqual(['No trees'])
  })
})

describe('SearchResultList', () => {
  it('wires the listbox to the box and groups consecutive options under named headings', () => {
    const items = [
      { name: 'Map A', group: 'Maps' },
      { name: 'Map B', group: 'Maps' },
      { name: 'Data A', group: 'Data' },
    ]
    mount({ items })
    expect(input().props['aria-controls']).toBe('trees')
    expect(input().props['aria-expanded']).toBe(true)
    const list = view!.root.findByProps({ role: 'listbox' })
    expect(list.props.id).toBe('trees')
    const groups = list.findAllByProps({ role: 'group' })
    expect(groups.map((group) => group.props['aria-labelledby'])).toEqual(['trees-group-0', 'trees-group-1'])
    expect(groups[0].findAllByProps({ role: 'option' })).toHaveLength(2)
    expect(view!.root.findByProps({ id: 'trees-group-1' }).children).toEqual(['Data'])
    const options = list.findAllByProps({ role: 'option' })
    expect(options.map((option) => option.props['aria-selected'])).toEqual([true, false, false])
  })

  it('shows the clear and close buttons of a bare box', () => {
    const onClear = vi.fn()
    const onClose = vi.fn()
    function Box({ value }: { value: string }) {
      const combobox = useSearchCombobox({ items: ITEMS, onPick: () => {} })
      return (
        <SearchComboboxInput
          combobox={combobox}
          variant="bare"
          value={value}
          readOnly
          onClear={onClear}
          onClose={onClose}
          closeLabel="Close tree search"
        />
      )
    }
    act(() => {
      view = create(<Box value="" />)
    })
    const labels = () => view!.root.findAllByType('button').map((button) => button.props['aria-label'])
    expect(labels()).toEqual(['Close tree search'])
    act(() => view!.update(<Box value="ce" />))
    expect(labels()).toEqual(['Clear search', 'Close tree search'])
    expect(view!.root.findByType('input').props['data-map-search-input']).toBeUndefined()
  })
})
