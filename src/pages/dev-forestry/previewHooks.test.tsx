import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDriveTerrain } from './useDriveTerrain'
import { useForestHistory } from './useForestHistory'
import { LandformSuggestions } from './LandformSuggestions'
import { DriveCamera } from './DriveCamera'
import { createEmptyScene, type ForestryScene } from './scene'
import type { ForestHistoryData } from './bcForestHistory'
import type { LoadElevationGridOptions } from '@/lib/forestry/terrain/demLoader'
import type { ElevationSource, Bounds } from '@/lib/forestry/terrain/terrain'
import type { PolygonGeometry } from './visibility'
import type { VisualInventoryResult } from './visualInventoryQuery'

const loaders = vi.hoisted(() => ({
  terrain: vi.fn(),
  history: vi.fn(),
  inventory: vi.fn(),
  contextTerrain: vi.fn(),
  openGround: vi.fn(),
}))
vi.mock('./previewTerrainCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./previewTerrainCache')>()),
  loadPreviewTerrain: loaders.terrain,
  // The background band's own mosaic (`useDriveTerrain`'s `loadForestContext`).
  createPreviewTerrainLoader: () => loaders.contextTerrain,
}))
vi.mock('./bcVegetationInventory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bcVegetationInventory')>()),
  fetchOpenGround: loaders.openGround,
}))
vi.mock('./bcForestHistory', () => ({ fetchForestHistory: loaders.history }))
vi.mock('./visualInventoryQuery', () => ({
  queryVisualInventory: loaders.inventory,
  VISUAL_INVENTORY_SOURCE: 'Test source',
}))
vi.mock('@/components/ui/map', () => ({ useMap: () => ({ map: null, isLoaded: false }) }))
// The road-view bar's (i) reads `window.matchMedia`; this renderer has no DOM, and the tip is not under test.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))

const views: ReturnType<typeof create>[] = []
const polygons: PolygonGeometry[] = []
const road = [
  [-122.6, 53.9],
  [-122.59, 53.91],
]
const otherRoad = [
  [-123.6, 54.9],
  [-123.59, 54.91],
]
const source: ElevationSource = { elevationAt: () => 600 }
const otherSource: ElevationSource = { elevationAt: () => 900 }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}
function mount(element: React.ReactElement) {
  let view!: ReturnType<typeof create>
  act(() => {
    view = create(element)
  })
  views.push(view)
  return view
}
function Terrain({
  active = true,
  points = road,
  distantTrees = false,
}: {
  active?: boolean
  points?: number[][]
  distantTrees?: boolean
}) {
  return <output data-result={useDriveTerrain(active, points, polygons, null, distantTrees)} />
}
function History({
  active = true,
  points = road,
  freeze = false,
}: {
  active?: boolean
  points?: number[][]
  freeze?: boolean
}) {
  return <output data-result={useForestHistory(active, points, polygons, freeze)} />
}
const terrainResult = (view: ReturnType<typeof create>) =>
  view.root.findByType('output').props['data-result'] as ReturnType<typeof useDriveTerrain>
const historyResult = (view: ReturnType<typeof create>) =>
  view.root.findByType('output').props['data-result'] as ReturnType<typeof useForestHistory>
beforeEach(() => vi.clearAllMocks())
afterEach(() =>
  act(() => {
    for (const view of views.splice(0)) view.unmount()
  }),
)

describe('fixed preview terrain requests', () => {
  it('resets progress for a changed footprint and ignores its cancelled response', async () => {
    const jobs: {
      options: LoadElevationGridOptions
      task: ReturnType<typeof deferred<{ source: ElevationSource; missingTileCount: number }>>
    }[] = []
    loaders.terrain.mockImplementation((options: LoadElevationGridOptions) => {
      const task = deferred<{ source: ElevationSource; missingTileCount: number }>()
      jobs.push({ options, task })
      return task.promise
    })
    const view = mount(<Terrain />)
    expect(terrainResult(view).loading).toBe(true)
    act(() => jobs[0].options.onProgress?.(1, 2))
    expect(terrainResult(view).progress).toBe(50)
    act(() => view.update(<Terrain points={otherRoad} />))
    expect(jobs[0].options.signal?.aborted).toBe(true)
    expect(terrainResult(view).progress).toBe(0)
    expect(terrainResult(view).source).toBeNull()
    await act(async () => {
      jobs[0].task.resolve({ source, missingTileCount: 0 })
    })
    expect(terrainResult(view).source).toBeNull()
    await act(async () => {
      jobs[1].task.resolve({ source: otherSource, missingTileCount: 0 })
    })
    expect(terrainResult(view).source).toBe(otherSource)
    expect(terrainResult(view).loading).toBe(false)
    act(() => terrainResult(view).retry())
    expect(terrainResult(view).source).toBeNull()
    expect(terrainResult(view).loading).toBe(true)
    expect(loaders.terrain.mock.calls[2][1]).toBe(true)
    act(() => view.update(<Terrain active={false} points={otherRoad} />))
    expect(terrainResult(view)).toMatchObject({ source: null, message: null, progress: 0, loading: false })
    expect(jobs[2].options.signal?.aborted).toBe(true)
  })

  it('rejects over-budget extents before starting a DEM request', () => {
    const view = mount(
      <Terrain
        points={[
          [-170, 10],
          [-60, 70],
        ]}
      />,
    )
    expect(loaders.terrain).not.toHaveBeenCalled()
    expect(terrainResult(view).loading).toBe(false)
    expect(terrainResult(view).message).toContain('Preview extent is too large')
  })

  it('exposes a failed load and retains missing ground as unknown after retry', async () => {
    loaders.terrain.mockRejectedValueOnce(new Error('DEM unavailable'))
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<Terrain />)
    })
    views.push(view)
    expect(terrainResult(view).loading).toBe(false)
    expect(terrainResult(view).source).toBeNull()
    expect(terrainResult(view).message).toContain('DEM unavailable')
    loaders.terrain.mockResolvedValueOnce({ source: null, missingTileCount: 1 })
    await act(async () => terrainResult(view).retry())
    expect(terrainResult(view).loading).toBe(false)
    expect(terrainResult(view).source).toBeNull()
    expect(terrainResult(view).message).toContain('1 terrain tiles unavailable')
  })
})

describe('the background band’s read (Distant trees)', () => {
  const contextSource: ElevationSource = { elevationAt: () => 650 }
  const openGround = {
    stands: [],
    complete: [[-123, 53, -122, 54]],
    tiles: [],
    read: [],
    failed: 0,
    capped: 0,
  }

  it('names its reach before the read comes, and keeps the road view’s own ground apart from it', async () => {
    loaders.terrain.mockResolvedValue({ source, missingTileCount: 0 })
    const contextTask = deferred<{ source: ElevationSource; missingTileCount: number }>()
    loaders.contextTerrain.mockReturnValue(contextTask.promise)
    loaders.openGround.mockResolvedValue(openGround)
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<Terrain distantTrees />)
    })
    views.push(view)
    // The core stand can grow at once: its ground is there, the background read is still out.
    expect(terrainResult(view).source).toBe(source)
    expect(terrainResult(view).forestContext).toBeNull()
    expect(terrainResult(view).forestContextLoading).toBe(true)
    const radius = terrainResult(view).forestContextRadius
    expect(radius).toBe(8000)
    await act(async () => contextTask.resolve({ source: contextSource, missingTileCount: 0 }))
    const read = terrainResult(view).forestContext
    expect(read?.source).toBe(contextSource)
    // Neither the reach nor the road view's own ground changes when the read comes.
    expect(terrainResult(view).forestContextRadius).toBe(radius)
    expect(terrainResult(view).source).toBe(source)
  })

  it('hands the same read to a remounted page, as reopening the road view keeps the stand', async () => {
    loaders.terrain.mockResolvedValue({ source, missingTileCount: 0 })
    loaders.contextTerrain.mockResolvedValue({ source: contextSource, missingTileCount: 0 })
    loaders.openGround.mockResolvedValue(openGround)
    let first!: ReturnType<typeof create>
    await act(async () => {
      first = create(<Terrain points={otherRoad} distantTrees />)
    })
    const read = terrainResult(first).forestContext
    expect(read).not.toBeNull()
    act(() => first.unmount())
    let second!: ReturnType<typeof create>
    await act(async () => {
      second = create(<Terrain points={otherRoad} distantTrees />)
    })
    views.push(second)
    // The very read, by identity: the background band's patches are kept under its key and nothing regrows.
    expect(terrainResult(second).forestContext).toBe(read)
    expect(loaders.contextTerrain).toHaveBeenCalledTimes(1)
    expect(loaders.openGround).toHaveBeenCalledTimes(1)
  })

  // Each test stands somewhere of its own: whole reads are kept for the module, by request.
  const roadAt = (lng: number, lat: number) => [
    [lng, lat],
    [lng + 0.01, lat + 0.01],
  ]

  it('reads afresh once on a retry, then keeps that read for a new request over the same ground', async () => {
    const here = roadAt(-121.6, 52.9)
    loaders.terrain.mockResolvedValue({ source, missingTileCount: 0 })
    loaders.contextTerrain.mockResolvedValue({ source: contextSource, missingTileCount: 0 })
    loaders.openGround.mockResolvedValue(openGround)
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<Terrain points={here} distantTrees />)
    })
    views.push(view)
    const first = terrainResult(view).forestContext
    expect(first).not.toBeNull()
    await act(async () => terrainResult(view).retry())
    const retried = terrainResult(view).forestContext
    expect(retried).not.toBe(first)
    expect(loaders.contextTerrain).toHaveBeenCalledTimes(2)
    // The same ground asked for again (a new extent with the same key) takes the retried read: no third read.
    await act(async () => view.update(<Terrain points={here.map((point) => [...point])} distantTrees />))
    expect(terrainResult(view).forestContext).toBe(retried)
    expect(loaders.contextTerrain).toHaveBeenCalledTimes(2)
    expect(loaders.openGround).toHaveBeenCalledTimes(2)
  })

  it('shows a partial read but keeps only a whole one', async () => {
    const here = roadAt(-120.6, 51.9)
    loaders.terrain.mockResolvedValue({ source, missingTileCount: 0 })
    loaders.contextTerrain.mockResolvedValue({ source: contextSource, missingTileCount: 0 })
    loaders.openGround.mockResolvedValue({ ...openGround, failed: 1 })
    let first!: ReturnType<typeof create>
    await act(async () => {
      first = create(<Terrain points={here} distantTrees />)
    })
    const partial = terrainResult(first).forestContext
    expect(partial?.source).toBe(contextSource)
    act(() => first.unmount())
    // A terrain tile missing is partial too.
    loaders.openGround.mockResolvedValue(openGround)
    loaders.contextTerrain.mockResolvedValue({ source: contextSource, missingTileCount: 2 })
    let second!: ReturnType<typeof create>
    await act(async () => {
      second = create(<Terrain points={here} distantTrees />)
    })
    const missing = terrainResult(second).forestContext
    expect(missing).not.toBeNull()
    expect(missing).not.toBe(partial)
    act(() => second.unmount())
    loaders.contextTerrain.mockResolvedValue({ source: contextSource, missingTileCount: 0 })
    let third!: ReturnType<typeof create>
    await act(async () => {
      third = create(<Terrain points={here} distantTrees />)
    })
    const whole = terrainResult(third).forestContext
    expect(whole).not.toBe(missing)
    act(() => third.unmount())
    let fourth!: ReturnType<typeof create>
    await act(async () => {
      fourth = create(<Terrain points={here} distantTrees />)
    })
    views.push(fourth)
    expect(terrainResult(fourth).forestContext).toBe(whole)
    expect(loaders.contextTerrain).toHaveBeenCalledTimes(3)
  })

  it('keeps the band through a new extent with the same key, before the kept read is handed back', async () => {
    const here = roadAt(-119.6, 50.9)
    loaders.terrain.mockResolvedValue({ source, missingTileCount: 0 })
    loaders.contextTerrain.mockResolvedValue({ source: contextSource, missingTileCount: 0 })
    loaders.openGround.mockResolvedValue(openGround)
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<Terrain points={here} distantTrees />)
    })
    views.push(view)
    const read = terrainResult(view).forestContext
    expect(read).not.toBeNull()
    act(() => view.update(<Terrain points={here.map((point) => [...point])} distantTrees />))
    expect(terrainResult(view).forestContext).toBe(read)
    expect(terrainResult(view).forestContextLoading).toBe(false)
  })

  it('reads nothing while it is off', async () => {
    loaders.terrain.mockResolvedValue({ source, missingTileCount: 0 })
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<Terrain />)
    })
    views.push(view)
    expect(terrainResult(view)).toMatchObject({ forestContext: null, forestContextRadius: undefined })
    expect(loaders.contextTerrain).not.toHaveBeenCalled()
    expect(loaders.openGround).not.toHaveBeenCalled()
  })
})

describe('forest history display snapshots', () => {
  it('holds arriving records during playback, applies them on pause and never carries them to another footprint', async () => {
    const jobs: { bounds: Bounds; signal: AbortSignal; onUpdate: (data: ForestHistoryData) => void }[] = []
    loaders.history.mockImplementation(
      (cells: Bounds[], signal: AbortSignal, options: { onUpdate: (data: ForestHistoryData) => void }) => {
        jobs.push({ bounds: cells[0], signal, onUpdate: options.onUpdate })
        return new Promise(() => {})
      },
    )
    const view = mount(<History />)
    expect(historyResult(view).loading).toBe(true)
    const first: ForestHistoryData = {
      bounds: jobs[0].bounds,
      records: [],
      issues: [],
      retrievedAt: 'first',
      pendingSources: ['planting'],
    }
    act(() => jobs[0].onUpdate(first))
    expect(historyResult(view).data).toBe(first)
    act(() => view.update(<History freeze />))
    const complete: ForestHistoryData = { ...first, retrievedAt: 'complete', pendingSources: [] }
    act(() => jobs[0].onUpdate(complete))
    expect(historyResult(view).data).toBe(first)
    expect(historyResult(view).pendingUpdate).toBe(true)
    expect(historyResult(view).loading).toBe(false)
    act(() => view.update(<History />))
    expect(historyResult(view).data).toBe(complete)
    expect(historyResult(view).pendingUpdate).toBe(false)
    act(() => historyResult(view).retry())
    expect(historyResult(view).loading).toBe(true)
    expect(historyResult(view).data).toBe(complete)
    expect(loaders.history.mock.calls[1][2].retryFailed).toBe(true)
    act(() => view.update(<History points={otherRoad} freeze />))
    expect(jobs[1].signal.aborted).toBe(true)
    expect(historyResult(view).data).toBeNull()
    act(() => jobs[1].onUpdate({ ...complete, retrievedAt: 'obsolete' }))
    expect(historyResult(view).data).toBeNull()
    const current: ForestHistoryData = { ...complete, bounds: jobs[2].bounds, retrievedAt: 'current' }
    act(() => jobs[2].onUpdate(current))
    expect(historyResult(view).data).toBe(current)
    act(() => view.update(<History active={false} points={otherRoad} />))
    expect(historyResult(view).data).toBeNull()
    act(() => view.update(<History points={otherRoad} />))
    expect(historyResult(view).data).toBe(current)
    expect(historyResult(view).loading).toBe(true)
    expect(jobs).toHaveLength(4)
  })
})

describe('inventory suggestions and restored drive look', () => {
  it('shows only inventory for the latest search footprint', async () => {
    type Snapshot = VisualInventoryResult
    const jobs: ReturnType<typeof deferred<Snapshot>>[] = []
    loaders.inventory.mockImplementation(() => {
      const job = deferred<Snapshot>()
      jobs.push(job)
      return job.promise
    })
    const scene = createEmptyScene()
    scene.viewpoint.coordinates = [[-122, 54]]
    const view = mount(<LandformSuggestions scene={scene} onShow={vi.fn()} onAdopt={vi.fn()} />)
    const moved: ForestryScene = { ...scene, viewpoint: { ...scene.viewpoint, coordinates: [[-123, 55]] } }
    act(() => view.update(<LandformSuggestions scene={moved} onShow={vi.fn()} onAdopt={vi.fn()} />))
    // Only the unit count differs between the two reads, so the text shows which one is on screen.
    const snapshot = (count: number): Snapshot => ({
      units: Array.from({ length: count }, (_, index) => ({
        id: String(index),
        polygonNumber: String(index),
        name: `VLI ${index}`,
        objectiveId: null,
        recommendedId: null,
        vac: null,
        vsc: null,
        scenicArea: false,
        rationale: null,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-140, 80],
              [-139.9, 80],
              [-139.9, 80.1],
              [-140, 80],
            ],
          ],
        },
      })),
      truncated: false,
      retrievedAt: '2026-01-01T00:00:00Z',
    })
    const paragraphs = () =>
      view.root
        .findAllByType('p')
        .map((p) => p.children.filter((child) => typeof child === 'string').join(''))
        .join('\n')
    await act(async () => jobs[0].resolve(snapshot(1)))
    expect(paragraphs()).not.toContain('1 units in the search area')
    await act(async () => jobs[1].resolve(snapshot(2)))
    expect(paragraphs()).toContain('2 units in the search area')
    expect(
      view.root
        .findAllByType('button')
        .some((button) => button.children.includes('Download nearby inventory (GeoJSON)')),
    ).toBe(true)
    act(() => view.update(<LandformSuggestions scene={createEmptyScene()} onShow={vi.fn()} onAdopt={vi.fn()} />))
    expect(
      view.root
        .findAllByType('button')
        .some((button) => button.children.includes('Download nearby inventory (GeoJSON)')),
    ).toBe(false)
  })

  it('restores look only on its original active, target and seek reset triggers', () => {
    const onLookChange = vi.fn()
    const props = {
      active: true,
      playing: false,
      stations: [],
      seekMeters: 0,
      seekVersion: 0,
      speedMetersPerSecond: 1,
      eyeHeightMeters: 1.6,
      lookAt: null,
      spotBearing: 0,
      elevation: null,
      onPosition: vi.fn(),
      onLookChange,
      restoredLook: { yaw: 12, tilt: -4 },
    }
    const view = mount(<DriveCamera {...props} />)
    expect(onLookChange).toHaveBeenLastCalledWith({ yaw: 12, tilt: -4 })
    act(() => view.update(<DriveCamera {...props} restoredLook={{ yaw: 30, tilt: 5 }} />))
    expect(onLookChange).toHaveBeenCalledTimes(1)
    act(() => view.update(<DriveCamera {...props} seekVersion={1} restoredLook={{ yaw: 30, tilt: 5 }} />))
    expect(onLookChange).toHaveBeenLastCalledWith({ yaw: 30, tilt: 5 })
    act(() =>
      view.update(
        <DriveCamera
          {...props}
          seekVersion={1}
          lookAt={{ lng: -122.6, lat: 53.9, elevationMeters: 700 }}
          restoredLook={{ yaw: 20, tilt: -10 }}
        />,
      ),
    )
    expect(onLookChange).toHaveBeenLastCalledWith({ yaw: 20, tilt: -10 })
    act(() => view.update(<DriveCamera {...props} active={false} />))
    expect(onLookChange).toHaveBeenLastCalledWith({ yaw: 12, tilt: -4 })
  })
})
