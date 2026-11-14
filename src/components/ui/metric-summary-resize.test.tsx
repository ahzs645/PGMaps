import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetricSummaryLayout, type MetricSummaryPlacement } from './metric-summary'
import { usePaneResizing } from './pane-resize'

let view: ReactTestRenderer | undefined
afterEach(() => {
  if (view) act(() => view?.unmount())
  view = undefined
  vi.unstubAllGlobals()
})

function mount() {
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  const properties = new Map<string, string>(),
    attributes = new Map<string, string>()
  const width = () => Number.parseFloat(properties.get('--metric-summary-width') ?? '144')
  const summary = {
    style: {
      getPropertyValue: (key: string) => properties.get(key) ?? '',
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
    getBoundingClientRect: () => ({ width: width() }),
  }
  const grip = {
    previousElementSibling: summary,
    parentElement: { getBoundingClientRect: () => ({ width: 1000 }) },
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    dataset: {} as Record<string, string>,
  }
  let mounts = 0
  function ConnectedView() {
    const resizing = usePaneResizing()
    useEffect(() => {
      mounts++
    }, [])
    return <main data-resizing={resizing} />
  }
  function render({
    small = false,
    placement = 'left',
    visible = true,
    id = 'ribbon',
  }: { small?: boolean; placement?: MetricSummaryPlacement; visible?: boolean; id?: string } = {}) {
    act(() => {
      const element = (
        <MetricSummaryLayout
          placement={placement}
          small={small}
          summary={visible && <aside className="metric-summary-panel" />}
          resize={visible ? { storageKey: id, label: 'road summary', controls: 'measurements' } : undefined}
        >
          <ConnectedView />
        </MetricSummaryLayout>
      )
      if (view) view.update(element)
      else view = create(element, { createNodeMock: (element) => (element.props.role === 'separator' ? grip : null) })
    })
  }
  render()
  const separator = () => view!.root.findAllByType('div').find((node) => node.props.role === 'separator')!
  function key(key: string, shiftKey = false) {
    act(() => separator().props.onKeyDown({ key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }))
  }
  function pointer(handler: string, clientX: number, pointerId = 1) {
    act(() =>
      separator().props[handler]({
        type: handler === 'onPointerUp' ? 'pointerup' : handler,
        button: 0,
        isPrimary: true,
        pointerId,
        clientX,
        currentTarget: grip,
        preventDefault: vi.fn(),
      }),
    )
  }
  return { stored, attributes, width, separator, key, pointer, render, mounts: () => mounts }
}

describe('summary resize boundary', () => {
  it('supports keyboard steps, bounds, a saved width per interface and reset', () => {
    const h = mount()
    expect(h.separator().props['aria-controls']).toBe('measurements')
    expect(h.separator().props['aria-orientation']).toBe('vertical')
    h.key('ArrowRight')
    expect(h.width()).toBe(160)
    expect(h.attributes.get('aria-valuenow')).toBe('160')
    h.key('ArrowRight', true)
    expect(h.width()).toBe(224)
    h.render({ id: 'guided' })
    expect(h.width()).toBe(144)
    h.key('ArrowLeft', true)
    expect(h.width()).toBe(128)
    h.render()
    expect(h.width()).toBe(224)
    for (let i = 0; i < 4; i++) h.key('ArrowRight', true)
    expect(h.width()).toBe(360)
    act(() => h.separator().props.onDoubleClick())
    expect(h.width()).toBe(144)
    expect(h.stored.has('ribbon')).toBe(false)
  })

  it('previews a drag, commits its final position, and rolls a cancelled drag back', () => {
    const h = mount()
    h.pointer('onPointerDown', 150)
    expect(view!.root.findByType('main').props['data-resizing']).toBe(true)
    h.pointer('onPointerMove', 210, 2)
    expect(h.width()).toBe(144)
    h.pointer('onPointerMove', 210)
    expect(h.width()).toBe(204)
    expect(h.stored.size).toBe(0)
    h.pointer('onPointerUp', 230)
    expect(h.width()).toBe(224)
    expect(h.stored.get('ribbon')).toBe('[224]')
    expect(view!.root.findByType('main').props['data-resizing']).toBe(false)
    h.pointer('onPointerDown', 230)
    h.pointer('onPointerMove', 290)
    expect(h.width()).toBe(284)
    h.pointer('onPointerCancel', 290)
    expect(h.width()).toBe(224)
    expect(h.stored.get('ribbon')).toBe('[224]')
  })

  it('removes the handle on compact, top and hidden summaries without remounting the views', () => {
    const h = mount()
    h.key('ArrowRight', true)
    for (const options of [{ small: true }, { placement: 'top' as const }, { visible: false }]) {
      h.render(options)
      expect(h.separator()).toBeUndefined()
      h.render()
      expect(h.width()).toBe(208)
    }
    expect(h.mounts()).toBe(1)
    h.pointer('onPointerDown', 150)
    h.render({ small: true })
    expect(view!.root.findByType('main').props['data-resizing']).toBe(false)
  })
})
