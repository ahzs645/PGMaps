import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDriveTerrain } from './useDriveTerrain'
import { useForestHistory } from './useForestHistory'
import { LandformSuggestions } from './LandformSuggestions'
import { DriveCamera } from './DriveCamera'
import { createEmptyScene, type ForestryScene } from './scene'
import type { ForestHistoryData } from './bcForestHistory'
import type { LoadElevationGridOptions } from './demLoader'
import type { ElevationSource, Bounds } from './terrain'
import type { PolygonGeometry } from './visibility'
import type { loadVisualInventorySnapshot } from './visualInventorySnapshot'

const loaders = vi.hoisted(() => ({ terrain: vi.fn(), history: vi.fn(), inventory: vi.fn() }))
vi.mock('./previewTerrainCache', () => ({ loadPreviewTerrain: loaders.terrain }))
vi.mock('./bcForestHistory', () => ({ fetchForestHistory: loaders.history }))
vi.mock('./visualInventorySnapshot', () => ({
  loadVisualInventorySnapshot: loaders.inventory,
  VISUAL_INVENTORY_PATH: '/inventory.json',
}))
vi.mock('@/components/ui/map', () => ({ useMap: () => ({ map: null, isLoaded: false }) }))

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
function Terrain({ active = true, points = road }: { active?: boolean; points?: number[][] }) {
  return <output data-result={useDriveTerrain(active, points, polygons)} />
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

describe('forest history display snapshots', () => {
  it('holds arriving records during playback, applies them on pause and never carries them to another footprint', async () => {
    const jobs: { bounds: Bounds; signal: AbortSignal; onUpdate: (data: ForestHistoryData) => void }[] = []
    loaders.history.mockImplementation(
      (bounds: Bounds, signal: AbortSignal, options: { onUpdate: (data: ForestHistoryData) => void }) => {
        jobs.push({ bounds, signal, onUpdate: options.onUpdate })
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
    type Snapshot = Awaited<ReturnType<typeof loadVisualInventorySnapshot>>
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
    const snapshot = (count: number): Snapshot => ({
      units: [],
      manifest: {
        schemaVersion: 2,
        retrievedAt: '2026-01-01',
        featureCount: count,
        sourceLatestUpdate: 0,
        gzipBytes: 0,
        source: 'Test source',
        simplification: { toleranceMetres: 0 },
        shards: [],
      },
    })
    const paragraphs = () =>
      view.root
        .findAllByType('p')
        .map((p) => p.children.filter((child) => typeof child === 'string').join(''))
        .join('\n')
    await act(async () => jobs[0].resolve(snapshot(1)))
    expect(paragraphs()).not.toContain('1 units')
    await act(async () => jobs[1].resolve(snapshot(2)))
    expect(paragraphs()).toContain('2 units')
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
