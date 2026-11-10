import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PEG_TOOL, type PegToolSettings } from './pegCursor'
import { PegToolPanel } from './PegTool'
import { isPlanToolKey, PlanToolButtons } from './PlanTools'
import { formatOffset, PointQueryPanel } from './PointQueryTool'
import type { PointQueryResult } from './pointQuery'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))

const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
type Node = ReactTestRenderer['root']
const textOf = (node: Node | string): string =>
  typeof node === 'string' ? node : node.children.map((child) => textOf(child as Node | string)).join('')
const button = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.find(
    (node) => node.type === 'button' && (node.props['aria-label'] === label || textOf(node).trim() === label),
  )

/** An element as `closest` sees it: the selectors it would match, inside the plan or not. */
function target(matches: string[], inPlan = true) {
  return {
    closest: (selector: string) =>
      selector.split(',').some((part) => matches.includes(part.trim())) ||
      (inPlan && selector === '[data-testid="road-plan-view"]')
        ? {}
        : null,
  } as unknown as EventTarget
}

describe('keys for the tool in hand', () => {
  it('never come from a field, and from a button only to cancel or undo', () => {
    expect(isPlanToolKey({ key: ' ', target: target(['input']) })).toBe(false)
    expect(isPlanToolKey({ key: 'Escape', target: target(['input']) })).toBe(false)
    expect(isPlanToolKey({ key: 'Escape', target: target(['button']) })).toBe(true)
    expect(isPlanToolKey({ key: 'Backspace', target: target(['button']) })).toBe(true)
    expect(isPlanToolKey({ key: 'Enter', target: target(['button']) })).toBe(false)
    expect(isPlanToolKey({ key: 'Escape', target: target(['button'], false) })).toBe(false)
    expect(isPlanToolKey({ key: 'ArrowLeft', target: target([]) })).toBe(true)
    expect(isPlanToolKey({ key: 'ArrowLeft', target: target([], false) })).toBe(false)
    expect(isPlanToolKey({ key: 'Escape', target: target(['[role="dialog"]']) })).toBe(false)
  })
})

describe('the plan tool buttons', () => {
  it('pick a tool, show which is in hand, and keep pegging off without an editable road', () => {
    const onPick = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(PlanToolButtons, { tool: 'query', onPick, pegDisabled: true }))
    })
    expect(button(renderer, 'Query a point').props['aria-pressed']).toBe(true)
    expect(button(renderer, 'Peg at grade').props.disabled).toBe(true)
    act(() => button(renderer, 'Query a point').props.onClick())
    expect(onPick).toHaveBeenCalledWith('query')
  })
})

describe('the peg panel', () => {
  const mount = (overrides: Partial<Parameters<typeof PegToolPanel>[0]> = {}) => {
    const calls = { settings: [] as PegToolSettings[], add: 0, undo: 0, finish: 0, cancel: 0 }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(PegToolPanel, {
          settings: DEFAULT_PEG_TOOL,
          onSettings: (settings) => calls.settings.push(settings),
          aimBearing: 42,
          onAimBearing: () => {},
          status: '+8.0 % · 30.0 m',
          statusOk: true,
          note: '',
          legs: 0,
          lengthM: 0,
          gradePercent: null,
          limitPercent: 18,
          windowM: 12,
          onAdd: () => calls.add++,
          onUndo: () => calls.undo++,
          onFinish: () => calls.finish++,
          onCancel: () => calls.cancel++,
          ...overrides,
        }),
      )
    })
    return { renderer, calls }
  }
  it('states the next leg and offers its buttons, with nothing to undo or finish yet', () => {
    const { renderer, calls } = mount()
    expect(text(renderer)).toContain('Next leg: +8.0 % · 30.0 m')
    expect(text(renderer)).toContain('No legs yet')
    expect(button(renderer, 'Finish').props.disabled).toBe(true)
    expect(button(renderer, 'Undo leg').props.disabled).toBe(true)
    act(() => button(renderer, 'Add leg').props.onClick())
    act(() => button(renderer, 'Cancel pegging').props.onClick())
    expect(calls.add).toBe(1)
    expect(calls.cancel).toBe(1)
  })
  it('summarises the legs held, and turns the grade downhill', () => {
    const { renderer, calls } = mount({ legs: 3, lengthM: 90, gradePercent: 7.94, note: 'No leg added. Gap.' })
    expect(text(renderer)).toContain('3 legs · 90.0 m · overall +7.9 %')
    expect(text(renderer)).toContain('No leg added. Gap.')
    act(() => button(renderer, 'Finish').props.onClick())
    expect(calls.finish).toBe(1)
    act(() => button(renderer, 'Down').props.onClick())
    expect(calls.settings.at(-1)).toEqual({ ...DEFAULT_PEG_TOOL, direction: 'down' })
  })
})

describe('the point query panel', () => {
  const result: PointQueryResult = {
    roadId: 'r',
    roadName: 'Spur 4',
    coordinate: [-122.8, 53.9],
    centre: [-122.8001, 53.9],
    chainage: 120.04,
    offset: -7,
    beyond: null,
    ground: 812.5,
    design: 811.25,
    depth: -1.25,
    designUnknown: null,
  }
  it('reads the station, signed offset, levels and cut or fill', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(PointQueryPanel, {
          result,
          note: '',
          activeRoadName: 'Spur 4',
          onGo: () => {},
          onClose: () => {},
        }),
      )
    })
    const shown = text(renderer)
    expect(shown).toContain('0+120.0')
    expect(shown).toContain('−7.00 m left')
    expect(shown).toContain('812.50 m')
    expect(shown).toContain('Cut 1.25 m')
  })
  it('keeps unknown levels unknown and says why', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(PointQueryPanel, {
          result: { ...result, design: null, depth: null, designUnknown: 'outside-footprint', beyond: 'end' },
          note: '',
          activeRoadName: 'Spur 4',
          onGo: () => {},
          onClose: () => {},
        }),
      )
    })
    const shown = text(renderer)
    expect(shown).toContain('Unknown')
    expect(shown).toContain('beyond the catch point')
    expect(shown).toContain('past the road’s end')
  })
  it('goes to the station and offset typed', () => {
    const onGo = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(
        createElement(PointQueryPanel, { result: null, note: '', activeRoadName: 'Spur 4', onGo, onClose: () => {} }),
      )
    })
    act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} }))
    expect(onGo).toHaveBeenCalledWith(0, 0)
    expect(formatOffset(3.456)).toBe('+3.46 m right')
    expect(formatOffset(0.001)).toBe('on centreline')
  })
})
