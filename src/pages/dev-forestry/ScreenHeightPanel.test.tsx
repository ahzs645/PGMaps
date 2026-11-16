import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScreenHeightPanel, formatScreenHeight, type ScreenHeightPanelProps } from './ScreenHeightPanel'
import { screenHeightReading, type ScreenHeightReading } from './screenHeight'
import { metersPerDegree } from './visibility'

// The (i) reads `window.matchMedia`; this renderer has no DOM, and the tip is not under test.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/styled-select', async (actual) => ({
  ...(await actual<typeof import('@/components/ui/styled-select')>()),
  StyledSelect: (await import('@/components/ui/styledSelectTestDouble')).StyledSelectTestDouble,
}))

const LNG = -122.75
const LAT = 53.9
const scale = metersPerDegree(LAT)
const at = (east: number, north: number): [number, number] => [LNG + east / scale.lng, LAT + north / scale.lat]

/** A flat plain with a 1 m bank 500–520 m out, and a block 1000–1200 m off. */
function reading(): ScreenHeightReading {
  return screenHeightReading({
    eye: { lng: LNG, lat: LAT, heightAboveGroundMeters: 1.6 },
    block: {
      type: 'Polygon',
      coordinates: [[at(1000, -100), at(1200, -100), at(1200, 100), at(1000, 100), at(1000, -100)]],
    },
    elevation: {
      elevationAt: (lng) => {
        const east = (lng - LNG) * scale.lng
        return east >= 500 && east <= 520 ? 501 : 500
      },
    },
    sampleSpacingMeters: 40,
    stepMeters: 2,
  })
}

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => node.type === 'button' && text(node).trim() === label)

function render(patch: Partial<ScreenHeightPanelProps> = {}) {
  const props: ScreenHeightPanelProps = {
    blocks: [
      { id: 'a', name: 'Block A' },
      { id: 'b', name: 'Block B' },
    ],
    blockId: 'a',
    onBlockChange: vi.fn(),
    stationLabel: 'Assessment viewpoint',
    reading: null,
    running: null,
    error: null,
    unavailable: null,
    onRun: vi.fn(),
    onCancel: vi.fn(),
    standHeightMeters: 18,
    ...patch,
  }
  act(() => {
    renderer = create(createElement(ScreenHeightPanel, props))
  })
  return { root: renderer!.root, props }
}

describe('ScreenHeightPanel', () => {
  it('renders a reading: terrain share, the screens for half, three quarters and 90%, the stand height and the curve', () => {
    const r = reading()
    const { root } = render({ reading: r })
    const all = text(root)
    expect(all).toContain('Seen from: Assessment viewpoint')
    expect(all).toContain('Hidden by terrain')
    expect(all).toContain('0%')
    expect(all).toContain('Screen for half the visible ground')
    expect(all).toContain(formatScreenHeight(r.screenFor.half, true))
    expect(all).toContain('Screen for three quarters')
    expect(all).toContain('Screen for 90%')
    // A 1 m bank leaves less than a metre to screen, so 18 m timber hides all of it.
    expect(all).toContain("At the stand's height (18 m)")
    expect(all).toContain('100% hidden')
    expect(all).toContain('Unknown')
    expect(
      root.findAll((node) => node.props['data-screen-height-chart'] !== undefined && node.type === 'svg'),
    ).toHaveLength(1)
    expect(
      root.findAll((node) => node.props['data-screen-height-stand'] !== undefined && node.type === 'g'),
    ).toHaveLength(1)
    // The chart's numbers for screen readers: one row per metre.
    expect(root.findAllByType('tr')).toHaveLength(1 + 61)
    expect(button(root, 'Run again').props.disabled).toBe(false)
  })

  it('calls onRun from Run, onCancel from Cancel while running, and onBlockChange from the picker', () => {
    const { root, props } = render()
    act(() => button(root, 'Run').props.onClick())
    expect(props.onRun).toHaveBeenCalledTimes(1)
    act(() => root.findByType('select').props.onChange({ target: { value: 'b' } }))
    expect(props.onBlockChange).toHaveBeenCalledWith('b')

    const busy = render({ running: { progress: 0.42 } })
    expect(text(busy.root)).toContain('Reading sightlines to Block A… 42%')
    expect(busy.root.findAll((node) => node.type === 'button' && text(node).trim() === 'Run')).toHaveLength(0)
    act(() => button(busy.root, 'Cancel').props.onClick())
    expect(busy.props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows why it cannot run, and keeps Run off', () => {
    const { root } = render({ unavailable: 'Open the road view so its terrain loads' })
    expect(text(root)).toContain('Open the road view so its terrain loads')
    expect(button(root, 'Run').props.disabled).toBe(true)
    const noStation = render({ stationLabel: null })
    expect(text(noStation.root)).toContain('No station')
    expect(button(noStation.root, 'Run').props.disabled).toBe(true)
    const failed = render({ error: 'Terrain did not load.' })
    expect(text(failed.root)).toContain('Terrain did not load.')
  })

  it('words screen heights past the curve and where no screen can serve', () => {
    expect(formatScreenHeight(0.63, true)).toBe('0.7 m')
    expect(formatScreenHeight(17.2, true)).toBe('18 m')
    expect(formatScreenHeight(75, true)).toBe('Taller than 60 m')
    expect(formatScreenHeight(null, true)).toBe('No screen outside the block can')
    expect(formatScreenHeight(null, false)).toBe('No visible ground')
  })
})
