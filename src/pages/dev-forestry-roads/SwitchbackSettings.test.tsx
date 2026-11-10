import { createElement, useState, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ROUTE_OPTIONS, type RouteSearchOptions } from './routing'
import { SwitchbackSettings } from './SwitchbackSettings'

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

function Host({ saved }: { saved: RouteSearchOptions[] }) {
  const [route, setRoute] = useState<RouteSearchOptions>({ ...DEFAULT_ROUTE_OPTIONS })
  return createElement(SwitchbackSettings, {
    route,
    minRadiusM: 25,
    maxGradePercent: 12,
    onChange: (next: RouteSearchOptions) => {
      saved.push(next)
      setRoute(next)
    },
  })
}

describe('switchback settings', () => {
  it('stays off for older projects, and turning it on saves the defaults and shows the rules', () => {
    const saved: RouteSearchOptions[] = []
    act(() => {
      renderer = create(createElement(Host, { saved }))
    })
    expect(text(renderer!)).toContain('Off')
    expect(text(renderer!)).not.toContain('Radius (m)')
    const allow = renderer!.root.findByProps({ 'data-testid': 'road-route-allow-switchbacks' })
    act(() => allow.props.onChange({ target: { checked: true } }))
    expect(saved.at(-1)!.switchbacks).toMatchObject({ allow: true, radiusM: null, platformSlopePercent: 55 })
    const shown = text(renderer!)
    // The summary states the values in force: the road's 25 m minimum radius, 3 R apart.
    expect(shown).toContain('R 25 m · ≥ 75 m apart · platform ≤ 25% over 55%')
    for (const label of ['Radius (m)', 'Spacing (× R)', 'Platform over %', 'Minimum grade %', 'Pass points within (m)'])
      expect(shown).toContain(label)
    // The sharpest stackable turn for 12 % at R 25 m, in the explanation.
    expect(shown).toContain('164.3°')
  })
})
