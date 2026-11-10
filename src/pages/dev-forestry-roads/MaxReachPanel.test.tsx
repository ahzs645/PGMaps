import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { CableRiggingFields } from './CableRiggingFields'
import { CableChart } from './Charts'
import { analyzeCable, offsetCoordinate } from './engine'
import { RadialDeflectionPanel } from './RadialDeflectionPanel'
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
const button = (root: ReactTestInstance, label: string) =>
  root.find((node) => node.type === 'button' && text(node).trim() === label)

const center: Coordinate = [-122.72, 53.89]
const flat: TerrainSource = { elevationAt: () => 500 }

describe('landing maximum reach', () => {
  it('switches the landing screen to maximum reach, runs it and adopts a line', async () => {
    const onPreview = vi.fn()
    const onAdopt = vi.fn()
    await act(async () => {
      renderer = create(createElement(RadialDeflectionPanel, { source: flat, center, onPreview, onAdopt }))
    })
    const root = renderer!.root
    await act(async () => button(root, 'Maximum reach').props.onClick())
    expect(root.findAll((node) => node.props['data-testid'] === 'radial-reach-panel')).toHaveLength(1)
    await act(async () => {
      await button(root, 'Find maximum reach').props.onClick()
    })
    const table = root.find((node) => node.props['data-testid'] === 'radial-reach-table')
    // 15° steps over a full circle; on flat ground every bearing reaches 380 m with a 3 % sag.
    const rows = table.findAll((node) => node.type === 'tr').slice(1)
    expect(rows).toHaveLength(24)
    expect(text(rows[0])).toContain('380 m')
    expect(text(rows[0])).toContain('Clearance')
    const overlay = onPreview.mock.calls.at(-1)![0] as GeoJSON.FeatureCollection
    expect(overlay.features[0].properties).toMatchObject({ kind: 'radial-reach-envelope' })
    expect(overlay.features.filter((f) => f.properties?.kind === 'radial-spoke')).toHaveLength(24)
    await act(async () => button(root, 'Use selected D-line').props.onClick())
    const adopted = onAdopt.mock.calls[0][0] as CableLine
    expect(adopted.end[1]).toBeGreaterThan(center[1])
    expect(adopted.sagModel).toBeUndefined()
  })
})

describe('D-line rope and load', () => {
  it('opts a line into rope mechanics with the example rigging and keeps it when switching back', async () => {
    const line: CableLine = {
      id: 'd',
      name: 'D',
      start: center,
      end: offsetCoordinate(center, 0, 300),
      startHeight: 15,
      endHeight: 12,
      deflectionPercent: 5,
    }
    const onChange = vi.fn()
    await act(async () => {
      renderer = create(createElement(CableRiggingFields, { line, onChange }))
    })
    const select = renderer!.root.find((node) => node.props.ariaLabel === 'Sag from')
    await act(async () => select.props.onValueChange('mechanics'))
    expect(onChange).toHaveBeenLastCalledWith({ ...line, sagModel: 'mechanics', rigging: EXAMPLE_RIGGING })
    await act(async () =>
      renderer!.update(createElement(CableRiggingFields, { line: onChange.mock.calls[0][0], onChange })),
    )
    expect(renderer!.root.findAll((node) => node.props['data-testid'] === 'cable-rigging')).toHaveLength(1)
    await act(async () =>
      renderer!.root.find((node) => node.props.ariaLabel === 'Sag from').props.onValueChange('assumed'),
    )
    expect(onChange).toHaveBeenLastCalledWith({ ...line, sagModel: 'assumed', rigging: EXAMPLE_RIGGING })
  })

  it('draws the loaded carriage path and states the tension in the profile footer', async () => {
    const line: CableLine = {
      id: 'd',
      name: 'D',
      start: center,
      end: offsetCoordinate(center, 0, 300),
      startHeight: 15,
      endHeight: 12,
      deflectionPercent: 5,
      sagModel: 'mechanics',
      rigging: EXAMPLE_RIGGING,
    }
    await act(async () => {
      renderer = create(createElement(CableChart, { analysis: analyzeCable(line, { elevationAt: () => 470 }) }))
    })
    const all = text(renderer!.root)
    expect(all).toContain('Loaded carriage path')
    expect(all).toContain('Empty skyline')
    expect(all).toMatch(/Max tension 141 kN at the start support \(allowable 141 kN\)/)
    // Supports 15 and 12 m up on flat ground; a 20.7 m loaded sag puts the carriage below it.
    expect(all).toMatch(/Minimum load clearance -7\.\d m · below 1 m/)
    expect(all).toMatch(/mid-span sag 20\.7 m \(6\.9% of span\)/)
  })
})
