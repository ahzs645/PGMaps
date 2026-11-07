import { createElement, isValidElement, cloneElement, useState, useEffect, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkPlanningDialog } from './NetworkPlanningDialog'
import { runProjection } from './roads/client'
import * as rasterUtilities from './roads/utilities'
import {
  createNetworkPlanning,
  prepareNetworkScenario,
  networkPathAlignment,
  type PreparedNetworkScenario,
} from './roads/workspace'
import { downloadText } from '@/lib/download'
import { createDemoProject, demoTerrain } from './terrain'
import type { RoadsResult, RoadsMethod, RoadsGraph } from './roads/types'
import type { RoadProject, TerrainSource } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('@/components/ui/dialog-shell', () => ({
  DialogShell: ({ children, footer }: { children: ReactNode; footer: ReactNode }) =>
    createElement('div', {}, children, footer),
}))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', {}, children),
}))
vi.mock('@/components/ui/tab-bar', () => ({
  TabBar: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (value: string) => void }) =>
    createElement(
      'div',
      {},
      options.map((option) =>
        createElement('button', { key: option.value, onClick: () => onChange(option.value) }, option.label),
      ),
    ),
}))
vi.mock('./Controls', () => ({
  roadFieldClass: '',
  Field: ({ label, children }: { label: string; children: ReactNode }) =>
    createElement(
      'label',
      {},
      label,
      isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
        : children,
    ),
  NumberField: ({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) =>
    createElement('input', {
      'aria-label': label,
      type: 'number',
      value,
      onChange: (event: { target: { value: string } }) => onChange(Number(event.target.value)),
    }),
}))
vi.mock('./PlanningCoordinateField', () => ({ PlanningCoordinateField: () => createElement('div', {}) }))
vi.mock('./roads/client', () => ({ runProjection: vi.fn() }))
vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
vi.mock('./roads/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./roads/workspace')>()
  return {
    ...actual,
    prepareNetworkScenario: vi.fn(),
    networkPathAlignment: vi.fn(),
  }
})

let renderer: ReactTestRenderer | undefined
let latestProject: RoadProject
let replaceProject: (next: RoadProject) => void
let replaceSource: (next: TerrainSource) => void
let replaceOpen: (next: boolean) => void
const onAdopt = vi.fn(),
  onPreview = vi.fn(),
  onOpenChange = vi.fn()
const emptyGraph: RoadsGraph = {
  cellCount: 9,
  offsets: new Uint32Array(10),
  neighbours: new Uint32Array(),
  edgeIds: new Uint32Array(),
  from: new Uint32Array(),
  to: new Uint32Array(),
  weights: new Float64Array(),
  baseWeights: new Float64Array(),
  lengths: new Float64Array(),
  passable: new Uint8Array(9).fill(1),
}
const result = (method: RoadsMethod = 'ilcp'): RoadsResult => ({
  method,
  paths: [
    {
      id: 'path-1',
      fromCell: 8,
      toCell: 0,
      cells: [8, 4, 0],
      objective: 2.8,
      lengthM: 28.28,
      newLengthM: 28.28,
      reusedLengthM: 0,
      targetIds: ['landing-1'],
    },
    {
      id: 'path-2',
      fromCell: 6,
      toCell: 0,
      cells: [6, 3, 0],
      objective: 2,
      lengthM: 20,
      newLengthM: 20,
      reusedLengthM: 0,
      targetIds: ['landing-2'],
    },
  ],
  targets: [
    { id: 'landing-1', name: 'East landing', cell: 8, status: 'connected', pathIds: ['path-1'] },
    { id: 'landing-2', name: 'West landing', cell: 6, status: 'connected', pathIds: ['path-2'] },
    {
      id: 'landing-3',
      name: 'Isolated landing',
      cell: 7,
      status: 'unreachable',
      pathIds: [],
      message: 'No path through the permitted cells.',
    },
  ],
  newLengthM: 48.28,
  reusedLengthM: 0,
  objective: 4.8,
  warnings: [],
  simulation: {
    version: 1,
    grid: { origin: [0, 20], cellM: 10, width: 3, height: 3, values: new Float64Array(9).fill(1) },
    options: createNetworkPlanning().options,
    graph: emptyGraph,
    seedRoadCells: [0],
    roadCells: [0, 3, 4, 6, 8],
    constructedEdges: new Uint32Array(),
    stage: 2,
    cumulativeNewLengthM: 48.28,
    cumulativeObjective: 4.8,
  },
})
function prepare(project: RoadProject, canAdopt = true): PreparedNetworkScenario {
  const planning = project.networkPlanning!
  return {
    input: {
      grid: result().simulation.grid,
      roadCells: [0],
      landings: [{ id: 'landing-1', cell: 8 }],
      options: planning.options,
    },
    stages: [[{ id: 'landing-1', cell: 8 }]],
    epsg: canAdopt ? 32610 : null,
    ...(canAdopt
      ? { toLonLat: ([x, y]: [number, number]): [number, number] => [-122 + x * 0.00001, 53 + y * 0.00001] }
      : {}),
    planning,
    provenance: 'Test grid with one unreachable target',
    canAdopt,
    warnings: ['Test coverage warning'],
  }
}
function Harness({ project }: { project: RoadProject }) {
  const [value, setValue] = useState(project)
  const [source, setSource] = useState<TerrainSource>(demoTerrain)
  const [open, setOpen] = useState(true)
  useEffect(() => {
    latestProject = value
    replaceProject = setValue
    replaceSource = setSource
    replaceOpen = setOpen
  }, [value])
  const workspace = {
    project: value,
    source,
    alignment: value.alignments[0],
    busy: '',
    update: (fn: (previous: RoadProject) => RoadProject) => setValue(fn),
  } as unknown as RoadWorkspace
  return createElement(NetworkPlanningDialog, {
    workspace,
    open,
    onOpenChange: (next) => {
      onOpenChange(next)
      setOpen(next)
    },
    onPreview,
    onAdopt,
  })
}
function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('')
}
function button(label: string) {
  const found = renderer!.root.findAllByType('button').find((node) => textOf(node) === label)
  if (!found) throw Error(`Missing button: ${label}`)
  return found
}
const change = (label: string, value: string) =>
  renderer!.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } })
function deferredFile() {
  let complete: (text: string) => void = () => {}
  const text = new Promise<string>((resolve) => {
    complete = resolve
  })
  return { file: { size: 1024, text: () => text } as File, complete }
}
function importFile(file: File) {
  renderer!.root
    .findByProps({ 'aria-label': 'Network scenario file' })
    .props.onChange({ target: { files: [file], value: 'selected.json' } })
}
async function mount(canAdopt = true) {
  const project = createDemoProject()
  project.networkPlanning = { ...createNetworkPlanning(project), exampleId: 'clus-reference' }
  vi.mocked(prepareNetworkScenario).mockImplementation(async (input) => prepare(input, canAdopt))
  vi.mocked(runProjection).mockImplementation(async (input) => result(input.options?.method ?? 'ilcp'))
  await act(async () => {
    renderer = create(createElement(Harness, { project }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(networkPathAlignment).mockImplementation((_prepared, path, template) => ({
    id: `candidate-${path.id}`,
    name: 'Projected branch',
    color: '#2563eb',
    points: [
      { id: 'p1', coordinate: [-122, 53], radiusM: 0 },
      { id: 'p2', coordinate: [-122.001, 53.001], radiusM: 0 },
    ],
    vertical: [],
    template,
    overrides: [],
  }))
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.restoreAllMocks()
})

describe('network planning review controls', () => {
  it('compares identical prepared inputs, reports unreachable targets and exports the selected method', async () => {
    await mount()
    const checkbox = renderer!.root
      .findAllByType('input')
      .find((node) => node.props.type === 'checkbox' && textOf(node.parent!).includes('Compare all four methods'))!
    await act(async () => checkbox.props.onChange({ target: { checked: true } }))
    await act(async () => button('Compare network methods').props.onClick())
    expect(prepareNetworkScenario).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runProjection).mock.calls.map(([input]) => input.options?.method)).toEqual([
      'ilcp',
      'lcp',
      'mst',
      'snap',
    ])
    expect(new Set(vi.mocked(runProjection).mock.calls.map(([input]) => input.grid)).size).toBe(1)
    expect(textOf(renderer!.root)).toContain('No path through the permitted cells.')
    expect(textOf(renderer!.root)).toContain('Test coverage warning')
    await act(async () => button('Minimum spanning tree').props.onClick())
    await act(async () => button('Network results CSV').props.onClick())
    expect(downloadText).toHaveBeenCalledWith(expect.stringContaining('mst'), 'road-network-results.csv', 'text/csv')
  })

  it('adopts only the selected branch through the parent, retaining a separate editable candidate', async () => {
    await mount()
    await act(async () => button('Project road network').props.onClick())
    await act(async () => change('Projected branch', 'path-2'))
    await act(async () => button('Use branch as new road').props.onClick())
    expect(networkPathAlignment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'path-2' }),
      latestProject.alignments[0].template,
    )
    expect(onAdopt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'candidate-path-2', vertical: [], overrides: [] }),
    )
    expect(latestProject.alignments).toHaveLength(2)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('blocks map/adoption/current exports after inputs change and disallows geographic adoption for examples', async () => {
    await mount()
    await act(async () => button('Project road network').props.onClick())
    expect(button('Use branch as new road').props.disabled).toBe(false)
    await act(async () => replaceProject({ ...latestProject, name: 'Changed source project' }))
    expect(button('Use branch as new road').props.disabled).toBe(true)
    expect(button('Inspect network on project map').props.disabled).toBe(true)
    expect(button('Network scenario JSON').props.disabled).toBe(true)
    await act(async () => renderer?.unmount())
    renderer = undefined
    await mount(false)
    await act(async () => button('Project road network').props.onClick())
    expect(button('Use branch as new road').props.disabled).toBe(true)
    expect(button('Network GeoJSON').props.disabled).toBe(true)
    expect(button('Network scenario JSON').props.disabled).toBe(false)
  })

  it('cancels the worker run and never publishes or adopts its late completion', async () => {
    await mount()
    let resolve: (value: RoadsResult) => void = () => {}
    vi.mocked(runProjection).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await act(async () => button('Project road network').props.onClick())
    const signal = vi.mocked(runProjection).mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    await act(async () => button('Cancel network calculation').props.onClick())
    expect(signal?.aborted).toBe(true)
    await act(async () => resolve(result()))
    expect(textOf(renderer!.root)).toContain('Network calculation cancelled.')
    expect(onAdopt).not.toHaveBeenCalled()
    expect(onPreview.mock.calls.every(([preview]) => preview === null)).toBe(true)
    expect(renderer!.root.findAllByProps({ 'data-testid': 'network-result-preview' })).toHaveLength(0)
  })

  it('applies example-specific options and clears imported grids when choosing a built-in scenario', async () => {
    await mount(false)
    const imported = {
      grid: { origin: [0, 0] as [number, number], cellM: 1, width: 2, height: 2, values: [1, 1, 1, 1] },
      roadCells: [0],
      landings: [{ id: 'p', cell: 3 }],
      provenance: 'Imported',
    }
    await act(async () =>
      replaceProject({
        ...latestProject,
        networkPlanning: {
          ...latestProject.networkPlanning!,
          mode: 'example',
          exampleId: 'imported',
          importedScenario: imported,
        },
      }),
    )
    await act(async () => change('Network example', 'hillside-grade'))
    expect(latestProject.networkPlanning?.importedScenario).toBeUndefined()
    expect(latestProject.networkPlanning?.options.weightFunction).toBe('grade')
    expect(latestProject.networkPlanning?.options.gradeMode).toBe('terrain')
    expect(latestProject.networkPlanning?.options.grade.limit).toBe(12)
  })

  it('retains reconstruction warnings and inferred cells, and exposes a refused computation without adopting it', async () => {
    await mount(false)
    await act(async () => button('Project road network').props.onClick())
    const reconstruct = vi.spyOn(rasterUtilities, 'rasterToLineSegments').mockReturnValue({
      lines: [
        [
          [0, 0],
          [10, 10],
        ],
      ],
      warnings: ['One gap cell was inferred; review the connection.'],
      addedCells: [4],
      components: 1,
    })
    await act(async () => {
      button('Export reconstructed raster lines').props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    const payload = JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)![0])
    expect(payload.addedCells).toEqual([4])
    expect(payload.warnings).toEqual(['One gap cell was inferred; review the connection.'])
    expect(payload.status).toContain('not proposed or surveyed roads')
    expect(onAdopt).not.toHaveBeenCalled()
    reconstruct.mockImplementation(() => {
      throw Error('Raster-to-line reconstruction exceeds its budget; crop or thin the raster first.')
    })
    await act(async () => {
      button('Export reconstructed raster lines').props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(textOf(renderer!.root)).toContain('Raster-to-line reconstruction exceeds its budget')
    expect(onAdopt).not.toHaveBeenCalled()
  })

  it.each(['project', 'terrain', 'close', 'external-close'] as const)(
    'does not apply an import completed after a %s change',
    async (changeKind) => {
      await mount()
      const originalPlanning = latestProject.networkPlanning
      const deferred = deferredFile()
      await act(async () => importFile(deferred.file))
      await act(async () => {
        if (changeKind === 'project') replaceProject({ ...latestProject, name: 'Another project' })
        if (changeKind === 'terrain') replaceSource({ elevationAt: () => 123 })
        if (changeKind === 'close') button('Close').props.onClick()
        if (changeKind === 'external-close') replaceOpen(false)
      })
      await act(async () => deferred.complete(JSON.stringify({ ...createNetworkPlanning(), cellM: 123 })))
      expect(latestProject.networkPlanning).toEqual(originalPlanning)
      expect(onPreview).not.toHaveBeenCalled()
    },
  )

  it('keeps the newest import when an older file read finishes later', async () => {
    await mount()
    const oldFile = deferredFile(),
      newFile = deferredFile()
    await act(async () => importFile(oldFile.file))
    await act(async () => importFile(newFile.file))
    await act(async () => newFile.complete(JSON.stringify({ ...createNetworkPlanning(), cellM: 30 })))
    expect(latestProject.networkPlanning?.cellM).toBe(30)
    await act(async () => oldFile.complete(JSON.stringify({ ...createNetworkPlanning(), cellM: 99 })))
    expect(latestProject.networkPlanning?.cellM).toBe(30)
    expect(textOf(renderer!.root)).toContain('Imported network inputs.')
    expect(textOf(renderer!.root)).not.toContain('Scenario import cancelled.')
  })

  it('releases a cancelled import immediately and ignores its later bytes', async () => {
    await mount()
    const original = latestProject.networkPlanning
    const deferred = deferredFile()
    await act(async () => importFile(deferred.file))
    expect(button('Project road network').props.disabled).toBe(true)
    await act(async () => button('Cancel network calculation').props.onClick())
    expect(button('Project road network').props.disabled).toBe(false)
    await act(async () => deferred.complete(JSON.stringify({ ...createNetworkPlanning(), cellM: 99 })))
    expect(latestProject.networkPlanning).toEqual(original)
  })

  it('does not calculate or download a reconstruction after the dialog closes during its yield', async () => {
    await mount(false)
    await act(async () => button('Project road network').props.onClick())
    const reconstruct = vi.spyOn(rasterUtilities, 'rasterToLineSegments')
    await act(async () => {
      button('Export reconstructed raster lines').props.onClick()
      button('Close').props.onClick()
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(reconstruct).not.toHaveBeenCalled()
    expect(downloadText).not.toHaveBeenCalled()
  })
})
