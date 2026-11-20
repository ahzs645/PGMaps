import { createElement, useEffect, useState, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineeringControls } from './EngineeringControls'
import { calculatedAlignment, safeAnalyzeRoad } from './analysisResult'
import { offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { RoadStationProvider } from './roadStation'
import { createDemoProject } from './terrain'
import type { Alignment, Culvert, RoadAnalysis, TerrainSource } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))
// The renderer has no scroll element to measure. Keep the real inventory rows and their handlers.
vi.mock('@/components/ui/virtual-result-list', () => ({
  VirtualResultList: ({
    items,
    getKey,
    children,
    label,
  }: {
    items: Culvert[]
    getKey: (item: Culvert) => string
    children: (item: Culvert) => ReactNode
    label: string
  }) =>
    createElement(
      'div',
      { 'aria-label': label },
      items.map((item) => createElement('div', { key: getKey(item) }, children(item))),
    ),
}))

let renderer: ReactTestRenderer | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
})

const culvert = (id: string, name: string, chainage: number): Culvert => ({
  id,
  name,
  kind: 'cross-drain',
  chainage,
  skewDegrees: 0,
  lengthM: 16,
  diameterM: 0.8,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.6,
  unitCost: 400,
  fixedCost: 1500,
})

function mount(options: { invalid?: boolean; namedStations?: boolean; selected?: string } = {}) {
  const project = createDemoProject()
  const initial = project.alignments[0]
  const origin = initial.points[0].coordinate
  initial.points = [
    { id: 'start', coordinate: origin, radiusM: 0 },
    { id: 'end', coordinate: offsetCoordinate(origin, 0, 500), radiusM: 0 },
  ]
  initial.vertical = [
    { id: 'start', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'end', chainage: 500, elevation: 800, curveLength: 0 },
  ]
  initial.overrides = []
  initial.engineering = {
    ...createEngineeringDesign(),
    // Deliberately stored out of station order: editing must follow IDs, not sorted row indexes.
    culverts: [
      culvert('later', 'Upper cross-drain', 420),
      { ...culvert('earlier', 'Lower cross-drain', 125.321), ...(options.invalid ? { diameterM: -1 } : {}) },
    ],
  }
  if (options.namedStations) initial.stationing = { startStation: 1000, equations: [{ back: 1200, ahead: 1500 }] }
  project.context = []
  project.settings.stationInterval = 10
  const source: TerrainSource = { elevationAt: () => 800 }
  const setStation = vi.fn()
  const onSelect = vi.fn()
  let alignment = initial
  let analysis: RoadAnalysis
  let request: (id: string) => void
  let restore: (road: Alignment) => void

  function Harness() {
    const [road, setRoad] = useState(initial)
    const [selected, setSelected] = useState(options.selected)
    const [culvertRequest, setCulvertRequest] = useState(0)
    const currentAnalysis = safeAnalyzeRoad(road, source, project.settings)
    useEffect(() => {
      alignment = road
      analysis = currentAnalysis
      request = (id) => {
        setSelected(id)
        setCulvertRequest((previous) => previous + 1)
      }
      restore = setRoad
    }, [road, currentAnalysis])
    const workspace = {
      alignment: road,
      calculatedAlignment: calculatedAlignment(road, currentAnalysis),
      analysis: currentAnalysis,
      project: { ...project, alignments: [road] },
      source,
      referenceSurfaces: {},
      station: Number.NaN,
      setStation,
      updateAlignment: setRoad,
      setError: vi.fn(),
      setNotice: vi.fn(),
    } as unknown as RoadWorkspace
    return createElement(RoadStationProvider, {
      station: 237.654,
      read: () => 237.654,
      children: createElement(EngineeringControls, {
        workspace,
        onPreviewTemplate: vi.fn(),
        onQuantities: vi.fn(),
        selectedCulvertId: selected,
        culvertRequest,
        onSelectCulvert: (id) => {
          onSelect(id)
          setSelected(id)
        },
      }),
    })
  }

  act(() => {
    renderer = create(createElement(Harness))
  })
  act(() => tab('culverts').props.onClick())
  return {
    initial,
    alignment: () => alignment,
    analysis: () => analysis,
    setStation,
    onSelect,
    request: (id: string) => act(() => request(id)),
    restore: (road: Alignment) => act(() => restore(road)),
  }
}

function tab(value: string) {
  return renderer!.root.findAllByType('button').find((node) => node.props['data-tab-value'] === value)!
}
function rows() {
  return renderer!.root
    .findAllByType('button')
    .filter((node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('Edit '))
}
function editors() {
  return renderer!.root.findAll((node) => node.type === 'div' && node.props['data-testid'] === 'road-culvert-editor')
}
function input(label: string) {
  const inputs = renderer!.root.findAllByType('input')
  const named = inputs.find((node) => node.props['aria-label'] === label)
  if (named) return named
  const associated = renderer!.root.findAllByType('label').find((node) => textOf(node).trim() === label)
  return inputs.find((node) => node.props.id === associated?.props.htmlFor)!
}
function typeNumber(label: string, value: string) {
  act(() => input(label).props.onChange({ target: { value } }))
  act(() => input(label).props.onBlur())
}
function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join(' ').replace(/\s+/g, ' ')
}

describe('the selected culvert inspector', () => {
  it('sorts navigation by station, keeps one editor and shares the exact selected chainage', () => {
    const view = mount({ namedStations: true })
    expect(rows().map((row) => row.props['aria-label'])).toEqual([
      'Edit Lower cross-drain at 1+125.3',
      'Edit Upper cross-drain at 1+720.0',
    ])
    expect(editors()).toHaveLength(1)
    expect(editors()[0].props['aria-label']).toBe('Selected culvert: Upper cross-drain')
    act(() => rows()[0].props.onClick())
    expect(view.onSelect).toHaveBeenLastCalledWith('earlier')
    expect(view.setStation).toHaveBeenLastCalledWith(125.321)
    expect(rows().map((row) => row.props['aria-pressed'])).toEqual([true, false])
    expect(editors()).toHaveLength(1)
    expect(editors()[0].props['aria-label']).toBe('Selected culvert: Lower cross-drain')
    expect(textOf(editors()[0])).toContain('Selected culvert · 1+125.3')
    expect(input('Culvert 2 station').props.value).toBe('1125.321')

    act(() => tab('review').props.onClick())
    const panels = editors()[0].findAll((node) => node.type === 'div' && typeof node.props.hidden === 'boolean')
    expect(panels.map((panel) => panel.props.hidden)).toEqual([true, true, false])
    act(() => tab('templates').props.onClick())
    expect(editors()).toHaveLength(0)
    view.request('later')
    expect(editors()).toHaveLength(1)
    expect(editors()[0].props['aria-label']).toBe('Selected culvert: Upper cross-drain')
    expect(tab('culverts').props['aria-selected']).toBe(true)
  })

  it('renames and edits the selected ID without changing a different culvert', () => {
    const view = mount({ selected: 'earlier' })
    const untouched = view.alignment().engineering!.culverts[0]
    act(() => input('Culvert 2 name').props.onChange({ target: { value: 'Creek approach' } }))
    typeNumber('Culvert 2 diameter (m)', '1.2')
    expect(view.alignment().engineering!.culverts[0]).toBe(untouched)
    expect(view.alignment().engineering!.culverts[1]).toMatchObject({
      id: 'earlier',
      name: 'Creek approach',
      diameterM: 1.2,
      chainage: 125.321,
    })
    expect(rows()[0].props['aria-label']).toContain('Edit Creek approach')
    act(() => rows()[1].props.onClick())
    expect(input('Culvert 1 name').props.value).toBe('Upper cross-drain')
    expect(input('Culvert 1 diameter (m)').props.value).toBe('0.8')
    expect(editors()).toHaveLength(1)
  })

  it('keeps an invalid culvert reachable and repairable when there is no calculated culvert geometry', () => {
    const view = mount({ invalid: true, selected: 'earlier' })
    expect(view.analysis().engineering?.culverts).toBeUndefined()
    expect(view.analysis().invalidInput?.target).toMatchObject({ list: 'culverts', id: 'earlier', field: 'diameterM' })
    expect(rows()).toHaveLength(2)
    expect(textOf(rows()[0])).toContain('Invalid input')
    expect(editors()).toHaveLength(1)
    expect(input('Culvert 2 diameter (m)').props['aria-invalid']).toBe(true)
    act(() => rows()[1].props.onClick())
    act(() => rows()[0].props.onClick())
    expect(view.setStation).toHaveBeenLastCalledWith(125.321)
    typeNumber('Culvert 2 diameter (m)', '0.9')
    expect(view.analysis().invalidInput).toBeUndefined()
    expect(view.analysis().engineering!.culverts.map((item) => item.id)).toEqual(['later', 'earlier'])
    expect(textOf(rows()[0])).not.toContain('Invalid input')
  })

  it('falls back after removal and restores the selected editor when the caller restores its data', () => {
    const view = mount({ selected: 'earlier' })
    const before = view.alignment()
    act(() => {
      renderer!.root
        .findAllByType('button')
        .find((node) => node.props['aria-label'] === 'Remove Lower cross-drain')!
        .props.onClick()
    })
    expect(view.alignment().engineering!.culverts.map((item) => item.id)).toEqual(['later'])
    expect(rows()).toHaveLength(1)
    expect(rows()[0].props['aria-pressed']).toBe(true)
    expect(editors()).toHaveLength(1)
    expect(editors()[0].props['aria-label']).toBe('Selected culvert: Upper cross-drain')
    view.restore(before)
    expect(rows()).toHaveLength(2)
    expect(rows()[0].props['aria-pressed']).toBe(true)
    expect(editors()).toHaveLength(1)
    expect(editors()[0].props['aria-label']).toBe('Selected culvert: Lower cross-drain')
  })

  it('selects a newly added culvert at the live station and opens its geometry fields', () => {
    const view = mount({ selected: 'earlier' })
    act(() => tab('review').props.onClick())
    act(() => {
      renderer!.root
        .findAllByType('button')
        .find((node) => node.children.includes('Add culvert at station'))!
        .props.onClick()
    })
    const added = view.alignment().engineering!.culverts[2]
    expect(added.chainage).toBe(237.654)
    expect(view.onSelect).toHaveBeenLastCalledWith(added.id)
    expect(view.setStation).toHaveBeenLastCalledWith(237.654)
    expect(editors()).toHaveLength(1)
    expect(editors()[0].props['aria-label']).toBe('Selected culvert: Culvert 3')
    expect(tab('geometry').props['aria-selected']).toBe(true)
    expect(rows().filter((row) => row.props['aria-pressed'])).toHaveLength(1)
  })
})
