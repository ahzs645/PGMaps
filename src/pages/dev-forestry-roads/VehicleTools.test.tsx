import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { offsetCoordinate } from './engine'
import type { MapNote } from './mapNotes'
import { SweptPathPanel, type VehicleToolsProps } from './SweptPathPanel'
import { VEHICLE_PRESETS } from './sweptPath'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, VehicleCheck } from './types'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))

const origin: Coordinate = [-122.8, 53.9]
const main: Alignment = {
  id: 'main',
  name: 'Main road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 90, 300), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE, leftWidth: 3, rightWidth: 3 },
  overrides: [],
}
const corner = offsetCoordinate(origin, 90, 120)
const note = (id: string, kind: MapNote['kind'], points: Coordinate[], text: string): MapNote => ({
  id,
  kind,
  points,
  text,
  color: '#2563eb',
  createdAt: '2026-11-10T00:00:00Z',
})
const landing = [
  offsetCoordinate(corner, 0, 5),
  offsetCoordinate(offsetCoordinate(corner, 0, 5), 90, 50),
  offsetCoordinate(offsetCoordinate(corner, 0, 55), 90, 50),
  offsetCoordinate(corner, 0, 55),
]
const notes: MapNote[] = [
  note('turn', 'line', [origin, corner, offsetCoordinate(corner, 0, 60)], 'Into the landing'),
  note('landing', 'area', landing, 'Landing 3'),
  note('pin', 'pin', [offsetCoordinate(corner, 0, 30)], 'Turn here'),
]
const lg5 = structuredClone(VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle)
const check: VehicleCheck = { vehicle: lg5, direction: 'up', clearanceM: 0.3 }

const text = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.children[0] === 'string')
    .map((node) => node.children.join(''))
    .join(' ')
const button = (renderer: ReactTestRenderer, label: RegExp) =>
  renderer.root.find(
    (node) =>
      node.type === 'button' &&
      label.test(
        [node.children]
          .flat(3)
          .filter((c) => typeof c === 'string')
          .join(''),
      ),
  )
const select = (renderer: ReactTestRenderer, ariaLabel: string): ReactTestInstance =>
  renderer.root.find((node) => node.props.ariaLabel === ariaLabel && typeof node.props.onValueChange === 'function')

let renderer: ReactTestRenderer | undefined
afterEach(() => act(() => renderer?.unmount()))

function render(overrides: Partial<VehicleToolsProps> = {}) {
  const tools: VehicleToolsProps = {
    onOverlay: vi.fn(),
    notes,
    alignments: [main],
    library: [],
    onLibraryChange: vi.fn(),
    ...overrides,
  }
  const onChange = vi.fn()
  act(() => {
    renderer = create(
      createElement(SweptPathPanel, {
        check,
        result: null,
        error: '',
        onChange,
        onStation: vi.fn(),
        showOnPlan: true,
        onShowOnPlan: vi.fn(),
        alignment: main,
        tools,
      }),
    )
  })
  return { tools, onChange }
}
const lastOverlay = (tools: VehicleToolsProps) =>
  (tools.onOverlay as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as GeoJSON.FeatureCollection | null

describe('vehicle tools in the swept path panel', () => {
  it('drives a drawn line into a landing and reports the swept area against it', async () => {
    const { tools } = render()
    const drive = renderer!.root.findByProps({ 'data-testid': 'road-drive-path' })
    act(() => drive.props.onToggle({ currentTarget: { open: true } }))
    act(() => select(renderer!, 'Path to drive').props.onValueChange('note:turn'))
    const landingBox = renderer!.root.find(
      (node) =>
        node.type === 'input' &&
        node.props.type === 'checkbox' &&
        node.parent?.children.includes('Drawn area: Landing 3') === true,
    )
    act(() => landingBox.props.onChange({ target: { checked: true } }))
    await act(async () => {
      button(renderer!, /Drive the path/).props.onClick()
      for (
        let i = 0;
        i < 200 && !renderer!.root.findAll((n) => n.props['data-testid'] === 'road-drive-result').length;
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(renderer!.root.findByProps({ 'data-testid': 'road-drive-result' })).toBeTruthy()
    expect(text(renderer!)).toMatch(/Swept area/)
    expect(text(renderer!)).toMatch(/Into the landing/)
    const roles = lastOverlay(tools)!.features.map((f) => f.properties?.role)
    expect(roles).toContain('swept-area')
    expect(roles).toContain('vehicle-outline')
    expect(roles).toContain('swept-wheels')
  })

  it('places the turning template in a landing and says whether a loop fits', () => {
    render()
    const drive = renderer!.root.findByProps({ 'data-testid': 'road-drive-path' })
    act(() => drive.props.onToggle({ currentTarget: { open: true } }))
    act(() => select(renderer!, 'Where to place the turning template').props.onValueChange('note:landing'))
    expect(renderer!.root.findByProps({ 'data-testid': 'road-turning-template' })).toBeTruthy()
    expect(text(renderer!)).toMatch(/Loop turnaround (fits|does not fit)/)
    expect(text(renderer!)).toMatch(/Outer body radius/)
  })

  it('shows the vehicle at a station and draws it', () => {
    const { tools } = render()
    const show = renderer!.root
      .findByProps({ 'data-testid': 'road-vehicle-at-station' })
      .find((node) => node.type === 'input' && node.props.type === 'checkbox')
    act(() => show.props.onChange({ target: { checked: true } }))
    expect(renderer!.root.findByProps({ 'data-testid': 'road-vehicle-label' })).toBeTruthy()
    expect(text(renderer!)).toMatch(/Steer 0\.0°/)
    expect(lastOverlay(tools)!.features.map((f) => f.properties?.role)).toContain('vehicle-outline')
  })

  it('saves the vehicle to the project and adds units up to six', () => {
    const { tools, onChange } = render()
    act(() => button(renderer!, /Save to project vehicles/).props.onClick())
    expect(tools.onLibraryChange).toHaveBeenCalledWith([expect.objectContaining({ name: lg5.name })])
    act(() => button(renderer!, /Add a unit/).props.onClick())
    expect(onChange.mock.calls.at(-1)![0].vehicle.units).toHaveLength(4)
  })

  it('clears its plan features when it goes away', () => {
    const { tools } = render()
    act(() => renderer?.unmount())
    renderer = undefined
    expect(lastOverlay(tools)).toBeNull()
  })
})
