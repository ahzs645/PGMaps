import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { LayerList, type LayerListGroup } from './layer-list'

const groups: LayerListGroup[] = [
  {
    id: 'scene',
    title: 'The scene',
    items: [
      // No `help` here: its (i) is a popover that needs a browser, and is not this list's own behaviour.
      { id: 'skyline', label: 'Skyline' },
      { id: 'blocks', label: 'Proposed blocks', status: 'Reading…' },
      { id: 'landform', label: 'Landform', unavailable: 'Not read' },
    ],
  },
  { id: 'added', title: 'Added layers', items: [{ id: 'custom:haul', label: 'Haul road' }] },
  { id: 'empty', title: 'Nothing here', items: [] },
]

function render(visibility: Record<string, boolean>, handlers: Partial<Parameters<typeof LayerList>[0]> = {}) {
  let view: ReturnType<typeof create>
  act(() => {
    view = create(
      <LayerList subject="the photo" groups={groups} visibility={visibility} onChange={vi.fn()} {...handlers} />,
    )
  })
  return view!
}
const box = (view: ReturnType<typeof create>, label: string) =>
  view.root.findByProps({ 'aria-label': `Show ${label} on the photo` })

describe('LayerList', () => {
  it('lists each group with how many of its layers are on, and leaves out a group with none', () => {
    const view = render({ skyline: true, blocks: false, landform: true, 'custom:haul': true })
    const sections = view.root.findAllByType('section').map((section) => section.props['aria-label'])
    expect(sections).toEqual(['The scene', 'Added layers'])
    expect(view.root.findAllByProps({ role: 'status' })[0].children.join('')).toBe('2 of 4 shown')
    act(() => view.unmount())
  })

  it('switches a layer, and keeps one that cannot be shown off with its reason', () => {
    const onChange = vi.fn()
    const view = render({ skyline: true, landform: true }, { onChange })
    expect(box(view, 'skyline').props.checked).toBe(true)
    act(() => box(view, 'proposed blocks').props.onChange({ target: { checked: true } }))
    expect(onChange).toHaveBeenCalledWith('blocks', true)
    // On in the record, but it cannot be drawn here: off, disabled, and saying why.
    const landform = box(view, 'landform')
    expect(landform.props.checked).toBe(false)
    expect(landform.props.disabled).toBe(true)
    expect(view.root.findAllByProps({ title: 'Not read' })).not.toHaveLength(0)
    act(() => view.unmount())
  })

  it('shows or hides a whole group, touching only the layers that can be shown and need changing', () => {
    const onChange = vi.fn()
    const view = render({ skyline: true, blocks: false }, { onChange })
    act(() => view.root.findByProps({ 'aria-label': 'Show all of the scene on the photo' }).props.onClick())
    expect(onChange.mock.calls).toEqual([['blocks', true]])
    act(() => view.unmount())
    const allOn = vi.fn()
    const full = render({ skyline: true, blocks: true }, { onChange: allOn })
    act(() => full.root.findByProps({ 'aria-label': 'Hide all of the scene on the photo' }).props.onClick())
    expect(allOn.mock.calls).toEqual([
      ['skyline', false],
      ['blocks', false],
    ])
    act(() => full.unmount())
  })

  it('offers the usual layers back only when the caller can give them, and reports the row under the pointer', () => {
    const plain = render({})
    expect(
      plain.root.findAllByType('button').some((button) => button.children.includes('Back to the usual layers')),
    ).toBe(false)
    act(() => plain.unmount())
    const onReset = vi.fn()
    const onHover = vi.fn()
    const view = render({}, { onReset, onHover })
    act(() =>
      view.root
        .findAllByType('button')
        .find((button) => button.children.includes('Back to the usual layers'))!
        .props.onClick(),
    )
    expect(onReset).toHaveBeenCalledOnce()
    act(() => view.root.findAllByType('li')[1].props.onMouseEnter())
    expect(onHover).toHaveBeenLastCalledWith('blocks')
    act(() => view.unmount())
  })
})
