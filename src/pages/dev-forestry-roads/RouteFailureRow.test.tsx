import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteFailureRow } from './RouteFailureRow'
import { RouteSearchPresets } from './RouteSearchPresets'
import type { RouteRow } from './routeComparison'
import type { RouteSearchStop } from './routeSearchStop'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))

const text = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.children[0] === 'string')
    .map((node) => node.children.join(''))
    .join(' ')

let renderer: ReactTestRenderer | undefined
afterEach(() => act(() => renderer?.unmount()))

const row = { id: 'r1', goal: 'shortest', label: 'Shortest' } as RouteRow
const stop: RouteSearchStop = {
  search: 'corridor',
  reached: [
    [-122.8, 53.9],
    [-122.799, 53.9005],
  ],
  stoppedAt: [-122.799, 53.9005],
  end: [-122.797, 53.901],
  remainingM: 140,
  named: { coordinate: [-122.7992, 53.9003], label: 'Platform too steep' },
}

function render(props: Partial<Parameters<typeof RouteFailureRow>[0]> = {}) {
  const calls = { toggle: 0, steeper: 0, hover: [] as boolean[] }
  act(() => {
    renderer = create(
      createElement(RouteFailureRow, {
        goals: [row],
        message: 'No line within 12% reaches the end.',
        stop,
        limitPercent: 12,
        selected: false,
        busy: false,
        onToggle: () => calls.toggle++,
        onHover: (on: boolean) => calls.hover.push(on),
        onTrySteeper: () => calls.steeper++,
        ...props,
      }),
    )
  })
  return calls
}
const byTestId = (id: string) =>
  renderer!.root.findAll((node) => node.props['data-testid'] === id && typeof node.type === 'string')

describe('a failed goal row', () => {
  it('marks its stop on the plan when clicked, and says where', () => {
    const calls = render()
    const [toggle] = byTestId('road-route-failure')
    expect(toggle.type).toBe('button')
    expect(toggle.props['aria-pressed']).toBe(false)
    expect(text(renderer!)).toContain(
      'Highlight on the plan: where it stopped, 140 m short of the end; platform too steep.',
    )
    act(() => toggle.props.onClick())
    act(() => toggle.props.onFocus())
    expect(calls.toggle).toBe(1)
    expect(calls.hover).toEqual([true])
    render({ selected: true })
    expect(byTestId('road-route-failure')[0].props['aria-pressed']).toBe(true)
    expect(text(renderer!)).toContain('Highlighted on the plan')
  })

  it('offers +2 % and +4 % over the limit, then shows what it found instead of the button', () => {
    const calls = render()
    const [button] = byTestId('road-route-try-steeper')
    expect(text(renderer!)).toContain('Try 14% and 16%')
    act(() => button.props.onClick())
    expect(calls.steeper).toBe(1)
    render({ steeper: { limitPercent: 12, tried: [14, 16], connectsAt: null, line: null } })
    expect(byTestId('road-route-try-steeper')).toHaveLength(0)
    expect(text(renderer!)).toContain('Does not connect up to 16%')
    render({ busy: true })
    expect(byTestId('road-route-try-steeper')[0].props.disabled).toBe(true)
  })

  it('is plain text when the search left no stop to show', () => {
    render({ stop: undefined })
    expect(byTestId('road-route-failure')[0].type).toBe('div')
    expect(byTestId('road-route-try-steeper')).toHaveLength(0)
  })
})

describe('search presets', () => {
  it('fills the grade limit and curve from Table 3-5 and shows which preset the settings match', () => {
    const applied: string[] = []
    act(() => {
      renderer = create(
        createElement(RouteSearchPresets, {
          settings: { maxGradePercent: 12, minRadius: 35 },
          onApply: (preset) => applied.push(preset.id),
        }),
      )
    })
    const pressed = (id: string) => byTestId(`road-route-preset-${id}`)[0].props['aria-pressed']
    expect([pressed('spur'), pressed('block'), pressed('mainline')]).toEqual([false, true, false])
    act(() => byTestId('road-route-preset-mainline')[0].props.onClick())
    expect(applied).toEqual(['mainline'])
    expect(text(renderer!)).toContain('Table 3-5')
  })
})
