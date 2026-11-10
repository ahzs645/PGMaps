import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { DEFAULT_SUPPORT_LAYOUT } from './cableLayout/settings'
import { layoutOverlay } from './cableLayout/overlay'
import { layoutKey } from './cableLayout/useCableLayout'
import { CableSupportsSection } from './CableSupportsSection'
import { CableChart } from './Charts'
import { analyzeCable, offsetCoordinate } from './engine'
import type { CableLine, Coordinate, TerrainSource } from './types'

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
const buttons = (root: ReactTestInstance, label: RegExp) =>
  root.findAll((node) => node.type === 'button' && label.test(text(node).trim()))

const start: Coordinate = [-122.72, 53.89]
const line: CableLine = {
  id: 'd1',
  name: 'D-line',
  start,
  end: offsetCoordinate(start, 90, 300),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
}
const slope: TerrainSource = { elevationAt: (lng) => 1000 - (lng - start[0]) * 20_000 }

describe('intermediate supports section', () => {
  it('adds a fixed support and a sector to the D-line through its edit', async () => {
    const onEdit = vi.fn()
    await act(async () => {
      renderer = create(createElement(CableSupportsSection, { line, terrain: slope, onEdit }))
    })
    const root = renderer!.root
    expect(text(root.findByProps({ 'data-testid': 'cable-supports' }))).toContain('not run')
    await act(async () => buttons(root, /^Intermediate supports/)[0].props.onClick())
    await act(async () => buttons(root, /Add$/)[0].props.onClick())
    const added = onEdit.mock.calls[0][0](line) as CableLine
    expect(added.supportLayout?.fixedSupports).toEqual([{ stationM: 150 }])
    expect(buttons(root, /^Find supports$/)).toHaveLength(1)
  })

  it('keeps a layout found on the default settings once it is saved onto the line', () => {
    // A line never given settings has no `supportLayout`; saving its first result adds the defaults.
    const saved = {
      ...line,
      supportLayout: { ...DEFAULT_SUPPORT_LAYOUT, saved: { preTensionKN: 80, complete: true, supports: [] } },
    }
    expect(layoutKey(saved, slope)).toBe(layoutKey(line, slope))
  })
})

describe('D-line chart with a support layout', () => {
  it('replaces the single span with the layout and says so', async () => {
    const overlay = {
      ...layoutOverlay({ lengthM: 300, yarderAtEnd: false }, DEFAULT_SUPPORT_LAYOUT, null),
      loadPath: [
        { x: 0, z: 1012, ground: 1000 },
        { x: 150, z: 960, ground: 940 },
        { x: 300, z: 920, ground: 910 },
      ],
      emptyRope: [
        { x: 0, z: 1012 },
        { x: 300, z: 920 },
      ],
      summary: 'Layout · 1 support · pre-tension 80 kN · min clearance 7.4 m · max tension 130 of 141 kN',
    }
    await act(async () => {
      renderer = create(createElement(CableChart, { analysis: analyzeCable(line, slope), layout: overlay }))
    })
    const all = text(renderer!.root)
    expect(all).toContain('Layout · 1 support · pre-tension 80 kN')
    expect(all).toContain('Static multi-span skyline')
    expect(all).toContain('Supports')
  })
})
