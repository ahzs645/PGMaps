import { createElement, useState, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionMenuItem } from '@/components/ui/action-menu'
import { analyzeRoad, offsetCoordinate } from './engine'
import { StationJumpMenu } from './StationJumpMenu'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, RoadProject } from './types'

vi.mock('@/components/ui/action-menu', () => ({
  ActionMenu: ({ trigger, items }: { trigger: ReactNode; items: ActionMenuItem[] }) =>
    createElement('span', { 'data-menu-items': items }, trigger),
}))

const origin: Coordinate = [-122.8, 53.9]
const alignment: Alignment = {
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
  ],
  vertical: [
    { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'm', chainage: 125.5, elevation: 805, curveLength: 0 },
    { id: 'e', chainage: 300, elevation: 806, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const analysis = analyzeRoad(alignment, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
const project = { settings: DEFAULT_ROAD_SETTINGS, context: [], alignments: [alignment] } as unknown as RoadProject

let renderer: ReactTestRenderer | undefined
let target: EventTarget
beforeEach(() => {
  target = new EventTarget()
  vi.stubGlobal('window', target)
  vi.stubGlobal('Element', class {})
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

function Bar({ notices }: { notices: string[] }) {
  const [station, setStation] = useState(0)
  return createElement(
    'div',
    null,
    createElement(StationJumpMenu, {
      project,
      alignment,
      analysis,
      station,
      onJump: (t) => setStation(t.chainage),
      onNotice: (text) => notices.push(text),
    }),
    createElement('output', null, String(station)),
  )
}
function mount() {
  const notices: string[] = []
  act(() => {
    renderer = create(createElement(Bar, { notices }))
  })
  const root = renderer!.root
  const station = () => Number(root.findByType('output').children.join(''))
  const select = (id: string) => {
    const items: ActionMenuItem[] = root.findByType('span').props['data-menu-items']
    const item = items.find((candidate) => candidate && candidate.id === id)
    if (!item || !('onSelect' in item)) throw Error(`Missing menu action ${id}`)
    act(item.onSelect)
  }
  const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    act(() => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        key,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        ...mods,
      })
      target.dispatchEvent(event)
    })
  return { notices, station, select, press }
}

describe('jumping between PVIs', () => {
  it('steps to the next and previous PVI from the jump menu, landing exactly on it', () => {
    const view = mount()
    view.select('next')
    expect(view.station()).toBe(125.5)
    expect(view.notices.at(-1)).toBe('PVI at 0+125.5: PVI 2.')
    view.select('next')
    expect(view.station()).toBeCloseTo(300, 6)
    view.select('previous')
    expect(view.station()).toBe(125.5)
  })

  it('takes ] and [ from the page, but not with ⌘', () => {
    const view = mount()
    view.press(']')
    expect(view.station()).toBe(125.5)
    view.press('[', { metaKey: true })
    expect(view.station()).toBe(125.5)
    view.press('[')
    expect(view.station()).toBe(0)
  })

  it('says so at the end of the road instead of moving', () => {
    const view = mount()
    view.press('[')
    expect(view.station()).toBe(0)
    expect(view.notices.at(-1)).toBe('No PVI before 0+000.0.')
  })
})
