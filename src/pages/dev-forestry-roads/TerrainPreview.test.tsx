import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localRasterResolution } from '../dev-forestry/localRaster'
import type { LocalRaster } from '../dev-forestry/types'
import { TerrainPreview } from './TerrainPreview'
import { analyzeRoad, positionAt } from './engine'
import { parseProject } from './project'
import { createDemoProject, terrainFromMetadata } from './terrain'
import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('@/components/ui/segmented-control', () => ({
  SegmentedControl: ({
    options,
    onChange,
  }: {
    options: { value: string; label: string }[]
    onChange: (value: string) => void
  }) =>
    createElement(
      'div',
      {},
      options.map((option) =>
        createElement('button', { key: option.value, onClick: () => onChange(option.value) }, option.label),
      ),
    ),
}))
vi.mock('@pgmaps/geo-toolkit/visualizations/react', () => ({
  ChartViewport: ({ children }: { children: (height: number) => ReactNode }) => children(240),
  SizedChart: ({ children }: { children: (width: number) => ReactNode }) => children(600),
}))
vi.mock('./TerrainGround', () => ({
  TerrainGround: (props: {
    faces: TerrainFace[]
    overlays: TerrainFace[]
    project: (vertex: TerrainVertex) => { x: number; y: number; depth: number }
    projectionKey: string
    width: number
    height: number
  }) =>
    createElement('g', {
      'data-ground-capture': true,
      projectionKey: props.projectionKey,
      width: props.width,
      height: props.height,
      projectedFaces: props.faces.map((face) => ({ ...face, projected: face.vertices.map(props.project) })),
      projectedOverlays: props.overlays.map((face) => ({ ...face, projected: face.vertices.map(props.project) })),
    }),
}))

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

function demoAnalysis() {
  const parsed = parseProject(createDemoProject())
  const terrain = terrainFromMetadata(parsed.terrain)!
  return { terrain, analysis: analyzeRoad(parsed.alignments[0], terrain, parsed.settings, parsed.context) }
}

/** A pointer event aimed at the 600 × 240 test plot, which sits at the page origin. */
function pointer(x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: () => {},
    target: { closest: () => null },
    currentTarget: {
      focus: () => {},
      setPointerCapture: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 240 }),
    },
    ...extra,
  }
}

describe('terrain preview infill restoration', () => {
  it('restores identical camera, source geometry and projected faces after follow → infill off → on', async () => {
    const project = createDemoProject()
    const raster: LocalRaster = {
      id: 'terrain-gap-fixture',
      name: 'Synthetic terrain with a known gap',
      kind: 'terrain',
      epsg: 4326,
      origin: [-122.731, 53.907],
      pixelSize: [0.0002, -0.0002],
      width: 211,
      height: 116,
      values: Array.from({ length: 211 * 116 }, (_, i) => 700 + (i % 211) * 0.01),
      acquired: '',
      verticalReference: 'Synthetic metres',
      sha256: 'a'.repeat(64),
    }
    const coordinate = positionAt(project.alignments[0], 200).coordinate
    const col = Math.floor((coordinate[0] - raster.origin[0]) / raster.pixelSize[0]),
      row = Math.floor((coordinate[1] - raster.origin[1]) / raster.pixelSize[1])
    for (let r = row - 1; r <= row + 1; r++)
      for (let c = col - 1; c <= col + 1; c++) raster.values[r * raster.width + c] = null
    const smallGap = positionAt(project.alignments[0], 600).coordinate
    raster.values[
      Math.floor((smallGap[1] - raster.origin[1]) / raster.pixelSize[1]) * raster.width +
        Math.floor((smallGap[0] - raster.origin[0]) / raster.pixelSize[0])
    ] = null
    project.terrain = {
      kind: 'geotiff',
      name: raster.name,
      epsg: raster.epsg,
      resolutionM: localRasterResolution(raster, raster.origin[1]),
      verticalReference: raster.verticalReference,
      sha256: raster.sha256,
      raster,
    }
    const parsed = parseProject(project)
    const terrain = terrainFromMetadata(parsed.terrain)!
    const analysis = analyzeRoad(parsed.alignments[0], terrain, parsed.settings, parsed.context)
    const view = (station: number) => createElement(TerrainPreview, { terrain, analysis, station, onStation: vi.fn() })
    await act(async () => {
      renderer = create(view(200))
    })
    await act(async () => renderer!.update(view(600)))
    await act(async () =>
      renderer!.root
        .findAllByType('button')
        .find((button) => button.children.includes('Around station'))!
        .props.onClick(),
    )
    const capture = () => renderer!.root.findByProps({ 'data-ground-capture': true }).props
    const preview = () => renderer!.root.findByProps({ 'data-testid': 'road-terrain-preview' }).props
    const filled = capture()
    const filledCount = preview()['data-infilled-cells']
    expect(filledCount).toBeGreaterThan(0)
    expect(filled.projectedFaces.some((face: TerrainFace) => face.estimated)).toBe(true)
    const toggle = () => renderer!.root.findByProps({ 'aria-label': 'Fill small gaps in 3D display' }).props.onClick()
    await act(async () => toggle())
    expect(preview()['data-infilled-cells']).toBe(0)
    expect(capture().projectedFaces.every((face: TerrainFace) => !face.estimated)).toBe(true)
    expect(capture().projectedFaces.length).toBeLessThan(filled.projectedFaces.length)
    await act(async () => toggle())
    const restored = capture()
    expect(preview()['data-infilled-cells']).toBe(filledCount)
    expect(restored.width).toBe(filled.width)
    expect(restored.height).toBe(filled.height)
    expect(restored.projectionKey).toBe(filled.projectionKey)
    expect(restored.projectedFaces).toEqual(filled.projectedFaces)
    expect(restored.projectedOverlays).toEqual(filled.projectedOverlays)
  })
})

describe('terrain preview camera controls', () => {
  async function mount(onStation = vi.fn()) {
    const { terrain, analysis } = demoAnalysis()
    await act(async () => {
      renderer = create(createElement(TerrainPreview, { terrain, analysis, station: 200, onStation }))
    })
    const preview = () => renderer!.root.findByProps({ 'data-testid': 'road-terrain-preview' }).props
    const plot = () => renderer!.root.findByProps({ role: 'group' })
    const button = (label: string) => renderer!.root.findByProps({ 'aria-label': label })
    return { preview, plot, button, onStation, analysis }
  }

  it('pans on a plain drag, even one that starts on the road, without picking a station', async () => {
    const { plot, onStation } = await mount()
    expect(plot().props['data-camera-focus']).toBe('fit')
    await act(async () => plot().props.onPointerDown(pointer(300, 120)))
    // Under the threshold it is still a click, not a drag.
    await act(async () => plot().props.onPointerMove(pointer(302, 121)))
    expect(plot().props['data-camera-focus']).toBe('fit')
    await act(async () => plot().props.onPointerMove(pointer(360, 150)))
    await act(async () => plot().props.onPointerUp())
    expect(plot().props['data-camera-focus']).not.toBe('fit')
    await act(async () => plot().props.onClick(pointer(360, 150)))
    expect(onStation).not.toHaveBeenCalled()
    // A click on the road without movement still selects its station.
    const road = renderer!.root.findAll((node) => node.type === 'polygon' && node.props.className === 'cursor-pointer')
    expect(road.length).toBeGreaterThan(0)
    await act(async () => road[0].props.onClick())
    expect(onStation).toHaveBeenCalledTimes(1)
  })

  it('rotates on a right-drag or Ctrl-drag and keeps the focus', async () => {
    const { plot, button } = await mount()
    const north = () => button('Face north').props['data-north-degrees']
    const before = north()
    await act(async () => plot().props.onPointerDown(pointer(300, 120, { ctrlKey: true })))
    await act(async () => plot().props.onPointerMove(pointer(380, 120)))
    await act(async () => plot().props.onPointerUp())
    expect(north()).not.toBe(before)
    expect(plot().props['data-camera-focus']).toBe('fit')
    await act(async () => button('Face north').props.onClick())
    expect(north()).toBe(0)
  })

  it('zooms toward a double-clicked point and meshes the ground there more finely', async () => {
    vi.useFakeTimers()
    try {
      const { plot, preview } = await mount()
      const coarse = preview()['data-mesh-spacing']
      expect(preview()['data-detail-spacing']).toBeUndefined()
      await act(async () => plot().props.onDoubleClick(pointer(420, 90)))
      await act(async () => plot().props.onDoubleClick(pointer(420, 90)))
      // Two ×2 steps; the pivot then moves onto the ground, with a small zoom correction for it.
      expect(preview()['data-zoom']).toBeGreaterThan(3.6)
      expect(preview()['data-zoom']).toBeLessThan(4.4)
      expect(plot().props['data-camera-focus']).not.toBe('fit')
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(preview()['data-detail-spacing']).toBeLessThan(coarse)
      // The coarse spacing, camera fit and colour range do not change with the finer patch.
      expect(preview()['data-mesh-spacing']).toBe(coarse)
      await act(async () => plot().props.onDoubleClick(pointer(420, 90, { shiftKey: true })))
      await act(async () => plot().props.onDoubleClick(pointer(420, 90, { shiftKey: true })))
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(preview()['data-zoom']).toBeLessThan(1.2)
      expect(preview()['data-detail-spacing']).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('centres on the selected station and Fit returns to the whole window', async () => {
    const { plot, preview, button } = await mount()
    await act(async () => button('Centre on selected station').props.onClick())
    expect(plot().props['data-camera-focus']).not.toBe('fit')
    await act(async () => button('Zoom terrain in').props.onClick())
    expect(preview()['data-zoom']).toBe(1.25)
    await act(async () => button('Fit terrain view').props.onClick())
    expect(plot().props['data-camera-focus']).toBe('fit')
    expect(preview()['data-zoom']).toBe(1)
  })

  it('pans with the arrow keys and rotates with Shift+arrows', async () => {
    const { plot, button } = await mount()
    const key = (name: string, shiftKey = false) => ({ key: name, shiftKey, preventDefault: () => {} })
    const north = button('Face north').props['data-north-degrees']
    await act(async () => plot().props.onKeyDown(key('ArrowRight')))
    expect(plot().props['data-camera-focus']).not.toBe('fit')
    expect(button('Face north').props['data-north-degrees']).toBe(north)
    await act(async () => plot().props.onKeyDown(key('ArrowRight', true)))
    expect(button('Face north').props['data-north-degrees']).not.toBe(north)
    await act(async () => plot().props.onKeyDown(key('Home')))
    expect(plot().props['data-camera-focus']).toBe('fit')
  })
})
