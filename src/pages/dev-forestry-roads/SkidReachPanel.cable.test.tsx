import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { SkidReachPanel } from './SkidReachPanel'
import { offsetCoordinate } from './engine'
import { createDemoProject } from './terrain'
import type { Coordinate, RoadProject } from './types'
import type { SidebarProps } from './DesignSidebarBody'
import type { CableCoverInput } from './cableLayout/cableLayout'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', {}, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))
// The page screens lines in the cable-layout worker; the test runs the same module in-process.
vi.mock('./cableLayout/cableLayoutClient', async () => {
  const { instantiateCableLayout } = await import('./cableLayout/cableLayout')
  const engine = await instantiateCableLayout(readFileSync(new URL('./cableLayout/cable_layout.wasm', import.meta.url)))
  return {
    screenCoverLines: async (
      batches: CableCoverInput[],
      options: { onProgress?: (done: number, lines: number) => void },
    ) => {
      const out = batches.flatMap((batch) => engine.cover(batch))
      options.onProgress?.(1, out.length)
      return out
    },
  }
})

it('runs the cable yarder: coverage in the shared tables, suggested lines on the plan', async () => {
  const origin: Coordinate = [-122.6, 54.0]
  const at = (x: number, y: number) => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
  const demo = createDemoProject()
  const project: RoadProject = {
    ...demo,
    context: [
      {
        id: 'block',
        name: 'Block C',
        kind: 'harvest',
        geometry: {
          type: 'Polygon',
          coordinates: [[at(-150, 10), at(150, 10), at(150, 310), at(-150, 310), at(-150, 10)]],
        },
      },
      {
        id: 'main',
        name: 'Main road',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [at(-150, 0), at(150, 0)] },
      },
    ],
  }
  // A 30 % slope rising north from the road.
  const source = {
    elevationAt: (lon: number, lat: number) => {
      const north = (lat - origin[1]) * 111_195
      return 700 + 0.3 * north + 0 * lon
    },
  }
  const preview = vi.fn()
  const notices = vi.fn()
  const workspace = () => ({
    project,
    source,
    analyses: new Map(),
    alignment: project.alignments[0],
    busy: '',
    commit: vi.fn(),
    setBusy: vi.fn(),
    setBusyCancel: vi.fn(),
    setBusyProgress: vi.fn(),
    setNotice: notices,
    setError: vi.fn((message: string) => {
      if (message) throw Error(message)
    }),
  })
  const view = () =>
    createElement(SkidReachPanel, { workspace: workspace(), onPreviewSkidReach: preview } as unknown as SidebarProps)
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(view())
  })
  const byTestId = (id: string) => renderer.root.findByProps({ 'data-testid': id })
  const eventually = async <T,>(find: () => T): Promise<T> => {
    for (let i = 0; i < 400; i++) {
      try {
        return find()
      } catch {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
      }
    }
    return find()
  }
  const cable = renderer.root.find(
    (node) => node.type === 'button' && [node.props.children].flat().includes('Cable yarder'),
  )
  await act(async () => cable.props.onClick())
  // Fewer bearings keep the test quick.
  const step = renderer.root.find((node) => node.props.label === 'Bearing step (°)' && node.props.onChange)
  await act(async () => step.props.onChange(15))
  await act(async () => byTestId('skid-reach-run').props.onClick())
  const results = await eventually(() => byTestId('cable-coverage-results'))
  expect(byTestId('extraction-area-table')).toBeTruthy()
  const rows = byTestId('extraction-area-table')
    .findAllByType('th')
    .map((node) => node.children.join(''))
  expect(rows).toContain('Yarded by skyline')
  expect(rows).not.toContain('Too steep for the machine')
  expect(results.findByProps({ 'data-testid': 'cable-selection-summary' })).toBeTruthy()
  const shown = preview.mock.calls.at(-1)![0] as GeoJSON.Feature[]
  expect(shown.some((feature) => feature.properties?.kind === 'cable-line')).toBe(true)
  expect(shown.some((feature) => feature.properties?.kind === 'extraction-class')).toBe(true)
  const notice = String(notices.mock.calls.find((args) => String(args[0]).includes('cable yarder reach'))?.[0])
  expect(notice).toMatch(
    /^Block C: \d+% of [\d.]+ ha within cable yarder reach of \d+ roads?, .* \d+ of \d+ lines work\./,
  )
  // Spur suggestions read ground-based reach and are not offered for cable.
  expect(renderer.root.findAllByProps({ 'data-testid': 'skid-reach-suggest' })).toHaveLength(0)
  await act(async () => renderer.unmount())
}, 120_000)
