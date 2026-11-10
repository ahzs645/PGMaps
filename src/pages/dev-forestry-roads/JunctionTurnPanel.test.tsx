import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { offsetCoordinate } from './engine'
import { JunctionTurnPanel } from './JunctionTurnPanel'
import { VEHICLE_PRESETS } from './sweptPath'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))

const origin: Coordinate = [-122.8, 53.9]
const road = (id: string, name: string, points: Coordinate[]): Alignment => ({
  id,
  name,
  color: '#16817a',
  points: points.map((coordinate, i) => ({ id: `${id}${i}`, coordinate, radiusM: 0 })),
  vertical: [],
  template: { ...DEFAULT_TEMPLATE, leftWidth: 3, rightWidth: 3 },
  overrides: [],
})
const main = road('main', 'Main road', [origin, offsetCoordinate(origin, 90, 300)])
const spur = road('spur', 'Spur', [
  offsetCoordinate(origin, 90, 150),
  offsetCoordinate(offsetCoordinate(origin, 90, 150), 30, 200),
])
const text = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.children[0] === 'string')
    .map((node) => node.children.join(''))
    .join(' ')

let renderer: ReactTestRenderer | undefined
afterEach(() => act(() => renderer?.unmount()))

describe('junction turn panel', () => {
  it('lists the turns into and out of a branch and draws the selected one only while open', () => {
    const onOverlay = vi.fn()
    const onStation = vi.fn()
    const lg5 = VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle
    act(() => {
      renderer = create(
        createElement(JunctionTurnPanel, {
          alignment: spur,
          vehicle: lg5,
          clearanceM: 0.3,
          junctions: { alignments: [main, spur], context: [], onOverlay },
          onStation,
          showOnPlan: true,
        }),
      )
    })
    const all = text(renderer!)
    expect(all).toMatch(/1 junction/)
    expect(all).toMatch(/Main road at 0\+000/)
    const rows = renderer!.root.findAll((node) => node.props['data-testid'] === 'road-junction-turn')
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.props['data-state'])).toContain('attention')
    // Closed, nothing is drawn; opened, the worst turn is.
    expect(onOverlay).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'FeatureCollection' }))
    const details = renderer!.root.findByProps({ 'data-testid': 'road-junction-turns' })
    act(() => details.props.onToggle({ currentTarget: { open: true } }))
    const drawn = onOverlay.mock.calls.at(-1)![0] as GeoJSON.FeatureCollection
    expect(drawn.features.map((f) => f.properties?.role)).toContain('swept-wheels')
    // Choosing another turn draws that one instead.
    const buttons = renderer!.root.findAll((node) => node.type === 'button' && node.props['aria-pressed'] === false)
    act(() => buttons[0].props.onClick())
    expect(onOverlay.mock.calls.at(-1)![0]).not.toEqual(drawn)
    act(() => renderer!.root.findByProps({ children: 'Go to station' }).props.onClick())
    expect(onStation).toHaveBeenCalledWith(0)
    act(() => renderer?.unmount())
    renderer = undefined
    expect(onOverlay.mock.calls.at(-1)![0]).toBeNull()
  })
})
