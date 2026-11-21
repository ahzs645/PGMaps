import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localRasterResolution } from '@/lib/forestry/terrain/localRaster'
import type { LocalRaster } from '@/lib/forestry/terrain/localRaster'
import { TerrainPreview } from './TerrainPreview'
import { analyzeRoad, offsetCoordinate, positionAt } from './engine'
import { DEFAULT_DESIGN_STANDARDS } from './designStandards'
import { parseProject } from './project'
import { createDemoProject, terrainFromMetadata } from './terrain'
import { PREVIEW_CANVAS_STATIONS, PREVIEW_GPU_MAX_STATIONS } from './previewCamera'
import type { TerrainFace } from './TerrainGround'
import type { TerrainVertex } from './terrainMesh'
import type { TerrainGpuData } from './terrainGpuTypes'

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
// The legend's panel reads a media query on mount, which this renderer (no window) cannot answer; its sections are real.
vi.mock('@/components/ui/map-panels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/map-panels')>()),
  MapLegendPanel: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
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
  TerrainCover: () => null,
}))
// The accelerated view's canvas: what the scene hands it is recorded, and its status can be reported from a test.
vi.mock('./TerrainGpu', () => ({
  TerrainGpu: (props: Record<string, unknown>) => createElement('g', { 'data-gpu-capture': true, ...props }),
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
  it('colours formation faces from the reviewed grade standard, including permitted pitches', async () => {
    const project = createDemoProject()
    const alignment = project.alignments[0]
    const origin = alignment.points[0].coordinate
    alignment.points = [
      { id: 'start', coordinate: origin, radiusM: 0 },
      { id: 'end', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ]
    alignment.vertical = [
      { id: 'start', chainage: 0, elevation: 802, curveLength: 0 },
      { id: 'end', chainage: 100, elevation: 817, curveLength: 0 },
    ]
    const terrain = { elevationAt: () => 800 }
    const settings = { ...project.settings, maxGradePercent: 12, stationInterval: 10 }
    const analyse = (allowedLength: number) =>
      analyzeRoad(alignment, terrain, settings, [], {
        gradeStandards: {
          ...DEFAULT_DESIGN_STANDARDS,
          shortPitchGradePercent: 16,
          shortPitchMaxLengthM: allowedLength,
        },
      })
    const view = (allowedLength: number) =>
      createElement(TerrainPreview, {
        terrain,
        alignment,
        analysis: analyse(allowedLength),
        station: 0,
        onStation: vi.fn(),
        maxGradePercent: 12,
      })
    await act(async () => {
      renderer = create(view(120))
    })
    const roadFaces = () =>
      renderer!.root.findAllByType('polygon').filter((polygon) => polygon.props.stroke === '#94744a')
    expect(roadFaces().length).toBeGreaterThan(0)
    expect(roadFaces().every((face) => face.props.fill === '#e8c886')).toBe(true)
    await act(async () => {
      renderer!.update(view(50))
    })
    expect(roadFaces().some((face) => face.props.fill === '#f2a39b')).toBe(true)
  })

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

describe('accelerated terrain ground', () => {
  function gpuProject(stationInterval?: number) {
    const parsed = parseProject(createDemoProject())
    const terrain = terrainFromMetadata(parsed.terrain)!
    const settings = stationInterval ? { ...parsed.settings, stationInterval } : parsed.settings
    const analysis = analyzeRoad(parsed.alignments[0], terrain, settings, parsed.context)
    return { parsed, terrain, analysis }
  }
  async function mount(stationInterval?: number) {
    const { parsed, terrain, analysis } = gpuProject(stationInterval)
    await act(async () => {
      renderer = create(
        createElement(TerrainPreview, {
          terrain,
          analysis,
          station: 200,
          onStation: vi.fn(),
          alignment: parsed.alignments[0],
          terrainMetadata: parsed.terrain,
        }),
      )
    })
    const preview = () => renderer!.root.findByProps({ 'data-testid': 'road-terrain-preview' }).props
    const plot = () => renderer!.root.findByProps({ role: 'group' })
    const gpu = () => renderer!.root.findByProps({ 'data-gpu-capture': true }).props
    const canvasFaces = () =>
      renderer!.root.findAllByProps({ 'data-ground-capture': true })[0]?.props.projectedFaces as
        | TerrainFace[]
        | undefined
    return { preview, plot, gpu, canvasFaces, analysis }
  }
  const extent = (face: TerrainFace) =>
    Math.max(
      Math.max(...face.vertices.map((v) => v.x)) - Math.min(...face.vertices.map((v) => v.x)),
      Math.max(...face.vertices.map((v) => v.y)) - Math.min(...face.vertices.map((v) => v.y)),
    )

  it('draws a fine band along the road from the start, and never meshes again when the camera zooms', async () => {
    vi.useFakeTimers()
    try {
      const { preview, plot, gpu } = await mount()
      const coarse = preview()['data-mesh-spacing']
      const band = preview()['data-detail-spacing']
      expect(band).toBeGreaterThan(0)
      expect(band).toBeLessThan(coarse)
      const data = gpu().data as TerrainGpuData
      // Fine faces are drawn, and coarse ones away from the road.
      expect(data.ground.some((face) => extent(face) < coarse / 2)).toBe(true)
      expect(data.ground.some((face) => extent(face) >= coarse - 1e-9)).toBe(true)
      for (let i = 0; i < 4; i++) await act(async () => plot().props.onDoubleClick(pointer(420, 90)))
      expect(preview()['data-zoom']).toBeGreaterThan(8)
      await act(async () => plot().props.onKeyDown({ key: 'ArrowRight', shiftKey: false, preventDefault: () => {} }))
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      // The same scene object: nothing was rebuilt for the camera.
      expect(gpu().data).toBe(data)
      expect(preview()['data-detail-spacing']).toBe(band)
      expect(preview()['data-mesh-spacing']).toBe(coarse)
    } finally {
      vi.useRealTimers()
    }
  })

  it('meshes the Around station window once, with its band, and keeps it through a zoom', async () => {
    vi.useFakeTimers()
    try {
      const { preview, plot, gpu } = await mount()
      const whole = gpu().data as TerrainGpuData
      await act(async () =>
        renderer!.root
          .findAllByType('button')
          .find((button) => button.children.includes('Around station'))!
          .props.onClick(),
      )
      const around = gpu().data as TerrainGpuData
      expect(around).not.toBe(whole)
      const band = preview()['data-detail-spacing']
      expect(band).toBeGreaterThan(0)
      expect(band).toBeLessThan(preview()['data-mesh-spacing'])
      for (let i = 0; i < 3; i++) await act(async () => plot().props.onDoubleClick(pointer(300, 120)))
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
      expect(gpu().data).toBe(around)
      expect(preview()['data-detail-spacing']).toBe(band)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never hands the band to the canvas preview, before the first frame or after a renderer failure', async () => {
    vi.useFakeTimers()
    try {
      const { preview, plot, gpu, canvasFaces } = await mount()
      const band = preview()['data-detail-spacing']
      // Before the first accelerated frame the canvas preview draws the base mesh.
      expect(canvasFaces()!.length).toBeGreaterThan(0)
      expect(Math.min(...canvasFaces()!.map(extent))).toBeGreaterThan(band * 1.5)
      expect(canvasFaces()!.length).toBeLessThan((gpu().data as TerrainGpuData).ground.length)
      // A renderer failure: the canvas preview takes over, with its camera-following focus window, as before.
      await act(async () => (gpu().onStatus as (status: string, reason?: string) => void)('canvas', 'No WebGL here.'))
      expect(preview()['data-renderer']).toBe('canvas')
      expect(preview()['data-detail-spacing']).toBeUndefined()
      expect(Math.min(...canvasFaces()!.map(extent))).toBeGreaterThan(band * 1.5)
      const coarse = preview()['data-mesh-spacing']
      await act(async () => plot().props.onDoubleClick(pointer(420, 90)))
      await act(async () => plot().props.onDoubleClick(pointer(420, 90)))
      await act(async () => {
        vi.advanceTimersByTime(200)
      })
      expect(preview()['data-detail-spacing']).toBeLessThan(coarse)
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws every station in the accelerated view, where the canvas preview thins them', async () => {
    const { analysis, gpu, canvasFaces } = await mount(5)
    expect(analysis.stations.length).toBeGreaterThan(PREVIEW_CANVAS_STATIONS)
    expect(analysis.stations.length).toBeLessThan(PREVIEW_GPU_MAX_STATIONS)
    const data = gpu().data as TerrainGpuData
    const centreline = data.lines.filter((line) => line.color !== '#67bdd4')
    expect(centreline).toHaveLength(analysis.stations.length - 1)
    // One road face between each pair of stations, so the batter strips beside it share its stations.
    expect(data.road).toHaveLength(analysis.stations.length - 1)
    expect(canvasFaces()).toBeDefined()
  })
})
