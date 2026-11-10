import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
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

const origin: Coordinate = [-122.6, 54.0]
type Node = ReactTestRenderer['root']
const text = (node: Node | string): string =>
  typeof node === 'string' ? node : node.children.map((child) => text(child as Node | string)).join('')
const at = (x: number, y: number) => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)

function setup(elevation: (north: number) => number = () => 700) {
  const demo = createDemoProject()
  const project: RoadProject = {
    ...demo,
    context: [
      {
        id: 'block',
        name: 'Block L',
        kind: 'harvest',
        geometry: {
          type: 'Polygon',
          coordinates: [[at(-200, 10), at(200, 10), at(200, 310), at(-200, 310), at(-200, 10)]],
        },
      },
      {
        id: 'main',
        name: 'Main road',
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [at(-300, 0), at(300, 0)] },
      },
    ],
  }
  const source = { elevationAt: (_lon: number, lat: number) => elevation((lat - origin[1]) * 111_195) }
  const preview = vi.fn()
  const pick = vi.fn()
  const notices = vi.fn()
  const workspace = {
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
  }
  return { workspace, preview, pick, notices }
}

async function mount(s: ReturnType<typeof setup>) {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(
      createElement(SkidReachPanel, {
        workspace: s.workspace,
        onPreviewSkidReach: s.preview,
        onPickOnPlan: s.pick,
      } as unknown as SidebarProps),
    )
  })
  const byTestId = (id: string) => renderer.root.findByProps({ 'data-testid': id })
  const select = (label: string) => renderer.root.findByProps({ 'aria-label': label })
  const field = (label: string) => renderer.root.find((node) => node.props.label === label && node.props.onChange)
  const button = (text: string) =>
    renderer.root.find((node) => node.type === 'button' && [node.props.children].flat(3).includes(text))
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
  const lastFeatures = () => (s.preview.mock.calls.at(-1)![0] ?? []) as GeoJSON.Feature[]
  return { renderer, byTestId, select, field, button, eventually, lastFeatures }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('takes landings from road stations and the plan, runs to them, and maps each catchment', async () => {
  const s = setup()
  const ui = await mount(s)
  // A landing at a road station, by keyboard: 100 m and 500 m along the 600 m road.
  for (const station of [100, 500]) {
    await act(async () => ui.field('From (m)').props.onChange(station))
    await act(async () => ui.field('To (m)').props.onChange(station))
    await act(async () => ui.byTestId('landing-add-stretch').props.onClick())
  }
  await act(async () => ui.select('L2 status').props.onChange({ target: { value: 'proposed' } }))
  // Landings show on the plan before any run.
  expect(ui.lastFeatures().filter((f) => f.properties?.kind === 'extraction-landing')).toHaveLength(2)

  // Picking on the plan adds one landing per click and asks for the next until Escape.
  const keys = new EventTarget()
  vi.stubGlobal('window', keys)
  await act(async () => ui.byTestId('landing-pick').props.onClick())
  const [prompt, onPick] = s.pick.mock.calls.at(-1)!
  expect(prompt).toMatch(/Click each landing/)
  await act(async () => onPick(at(0, 300)))
  expect(s.pick.mock.calls.at(-1)![1]).toBeTypeOf('function')
  await act(async () => {
    keys.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  })
  expect(s.pick.mock.calls.at(-1)![0]).toBeNull()
  expect(ui.byTestId('landing-pick').props['aria-pressed']).toBe(false)
  // The far plan landing serves the north edge; remove it to keep the test to two road landings.
  await act(async () => ui.renderer.root.findByProps({ 'aria-label': 'Remove landing L3' }).props.onClick())

  await act(async () => ui.byTestId('skid-reach-run').props.onClick())
  const table = await ui.eventually(() => ui.byTestId('landing-catchment-table'))
  const rows = table.findAllByType('th').map(text)
  expect(rows).toContain('L1existing')
  expect(rows).toContain('L2proposed')
  expect(String(s.notices.mock.calls.at(-1)![0])).toMatch(/within skidder reach of 2 landings/)

  await act(async () => ui.select('Extraction layer on the plan').props.onChange({ target: { value: 'catchments' } }))
  const catchments = ui.lastFeatures().filter((f) => f.properties?.kind === 'extraction-catchment')
  expect(new Set(catchments.map((f) => f.properties?.color)).size).toBe(2)

  // Pin, change the landings, run again, and read the difference.
  await act(async () => ui.byTestId('pin-run').props.onClick())
  await act(async () => ui.renderer.root.findByProps({ 'aria-label': 'Remove landing L2' }).props.onClick())
  await act(async () => ui.byTestId('skid-reach-run').props.onClick())
  const pinned = await ui.eventually(() => ui.byTestId('pinned-comparison'))
  expect(pinned.findByProps({ 'data-testid': 'pinned-state-table' })).toBeTruthy()
  await act(async () => ui.select('Extraction layer on the plan').props.onChange({ target: { value: 'pinned' } }))
  const change = ui.lastFeatures().filter((f) => f.properties?.kind === 'extraction-pinned')
  expect(change.map((f) => f.properties?.role)).toContain('lost')
  await act(async () => ui.renderer.unmount())
}, 30_000)

it('suggests harvest systems from all three machines, and maps them', async () => {
  // Level by the road, then a 70 % slope north: ground-based below, cable above.
  const s = setup((north) => (north < 120 ? 700 : 700 + 0.7 * (north - 120)))
  const ui = await mount(s)
  // Few cable bearings keep the test quick: the setting is in the cable yarder's fields.
  await act(async () => ui.button('Cable yarder').props.onClick())
  await act(async () => ui.field('Bearing step (°)').props.onChange(15))
  await act(async () => ui.button('Skidder').props.onClick())
  await act(async () => ui.byTestId('harvest-systems-run').props.onClick())
  const table = await ui.eventually(() => ui.byTestId('harvest-system-table'))
  const rows = table.findAllByType('th').map(text)
  expect(rows.some((r) => r.includes('Ground-based'))).toBe(true)
  expect(rows.some((r) => r.startsWith('Cable'))).toBe(true)
  expect(String(s.notices.mock.calls.at(-1)![0])).toMatch(/suggested from reach only/)
  // The skidder's own run is the panel's run, and the plan shows the suggestion.
  expect(ui.byTestId('extraction-area-table')).toBeTruthy()
  expect(ui.lastFeatures().some((f) => f.properties?.kind === 'harvest-system')).toBe(true)
  await act(async () => ui.renderer.unmount())
}, 120_000)
