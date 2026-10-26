import { IDBFactory } from 'fake-indexeddb'
import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLibrary, readProject } from './projectLibrary'
import { createDemoProject, demoTerrain, loadLidarTerrain, roadProjection } from './terrain'
import type { Coordinate, RoadProject } from './types'
import { useRoadWorkspace, type RoadWorkspace } from './useRoadWorkspace'

vi.mock('./terrain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./terrain')>()
  return {
    ...actual,
    loadLidarTerrain: vi.fn(async () => ({
      source: actual.demoTerrain,
      metadata: actual.createDemoProject().terrain,
      alignments: actual.createDemoProject().alignments,
    })),
  }
})

const DATABASE = 'pgmaps-forestry-roads-v1'
let renderer: ReactTestRenderer | undefined
let workspace: RoadWorkspace

async function stored(factory: IDBFactory, project?: RoadProject): Promise<RoadProject | undefined> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('projects', project ? 'readwrite' : 'readonly')
      const operation = project
        ? transaction.objectStore('projects').put(project, 'current')
        : transaction.objectStore('projects').get('current')
      let result: RoadProject | undefined
      operation.onsuccess = () => {
        if (!project) result = operation.result
      }
      transaction.oncomplete = () => {
        db.close()
        resolve(result)
      }
      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}

async function openWorkspace() {
  function Harness() {
    const value = useRoadWorkspace()
    useEffect(() => {
      workspace = value
    })
    return null
  }
  await act(async () => {
    renderer = create(createElement(Harness))
  })
  await vi.waitFor(() => expect(workspace.ready).toBe(true))
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('window', globalThis)
  vi.mocked(loadLidarTerrain).mockClear()
})

afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer!.unmount()
    })
  renderer = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('road workspace persistence', () => {
  it('preserves an existing project after a transient startup storage read failure, even after dismissing the error and editing', async () => {
    const factory = indexedDB as IDBFactory
    const original = { ...createDemoProject(), name: 'Keep the saved road' }
    await stored(factory, original)
    const open = vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      throw new DOMException('Storage temporarily unavailable', 'UnknownError')
    })

    await openWorkspace()
    expect(workspace.error).toContain('Could not read the locally saved road project')
    expect(loadLidarTerrain).not.toHaveBeenCalled()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(async () => {
      workspace.setError('')
      workspace.update((project) => ({ ...project, name: 'Edited fallback' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    // No write is attempted after the failed read, even though storage works again.
    expect(open).toHaveBeenCalledTimes(1)
    expect(await stored(factory)).toEqual(original)
  })

  it('loads default terrain and autosaves when storage successfully reports no saved project', async () => {
    await openWorkspace()
    expect(workspace.error).toBe('')
    expect(loadLidarTerrain).toHaveBeenCalledOnce()
    expect(workspace.source).toBe(demoTerrain)
    await act(async () => {
      workspace.update((project) => ({ ...project, name: 'New saved road' }))
    })
    await vi.waitFor(() => expect(workspace.saving).toBe('Saved on this device'), { timeout: 2000 })
    const { entries, activeId } = await readLibrary()
    expect(entries.map((e) => e.name)).toEqual(['New saved road'])
    expect((await readProject(activeId!))?.name).toBe('New saved road')
  })

  it('autosaves an edited imported DEM project and restores its road and embedded elevations on a fresh mount', async () => {
    const original = createDemoProject()
    const raster = {
      id: 'imported-dem',
      name: 'Imported DEM',
      kind: 'terrain' as const,
      epsg: 26910,
      origin: [500000, 5970000] as [number, number],
      pixelSize: [10, -10] as [number, number],
      width: 32,
      height: 32,
      values: Array<number | null>(32 * 32).fill(800),
      acquired: '',
      verticalReference: 'Fixture metres',
      sha256: 'a'.repeat(64),
    }
    original.terrain = {
      kind: 'geotiff',
      name: raster.name,
      epsg: raster.epsg,
      resolutionM: 10,
      sha256: raster.sha256,
      verticalReference: raster.verticalReference,
      raster,
    }
    const projection = roadProjection(raster.epsg)
    original.alignments = [
      {
        ...original.alignments[0],
        vertical: [],
        overrides: [],
        points: [
          [500100, 5969900],
          [500220, 5969900],
        ].map((point, index) => ({
          id: 'point-' + index,
          coordinate: projection.inverse(point) as Coordinate,
          radiusM: 0,
        })),
      },
    ]
    original.context = []
    original.cables = []
    await stored(indexedDB as IDBFactory, original)

    await openWorkspace()
    expect(loadLidarTerrain).not.toHaveBeenCalled()
    expect(workspace.source.elevationAt(...original.alignments[0].points[0].coordinate)).toBe(800)
    await act(async () => {
      workspace.updateAlignment((road) => ({ ...road, name: 'Edited imported road' }))
    })
    await vi.waitFor(() => expect(workspace.saving).toBe('Saved on this device'), { timeout: 2000 })
    await act(async () => {
      renderer!.unmount()
    })
    renderer = undefined
    await openWorkspace()
    expect(workspace.alignment.name).toBe('Edited imported road')
    expect(workspace.project.terrain.raster).toEqual(raster)
    expect(workspace.source.elevationAt(...original.alignments[0].points[0].coordinate)).toBe(800)
    expect(loadLidarTerrain).not.toHaveBeenCalled()
  })
})

describe('local project library', () => {
  const saved = () => vi.waitFor(() => expect(workspace.saving).toBe('Saved on this device'), { timeout: 2000 })

  it('moves the single pre-library autosave into the library and keeps it open', async () => {
    await stored(indexedDB as IDBFactory, { ...createDemoProject(), name: 'Saved before the library' })
    await openWorkspace()
    expect(loadLidarTerrain).not.toHaveBeenCalled()
    expect(workspace.project.name).toBe('Saved before the library')
    expect(workspace.library.map((e) => e.name)).toEqual(['Saved before the library'])
    expect(workspace.projectId).toBe(workspace.library[0].id)
  })

  it('keeps every project, switches between them without losing edits, and reopens the last one', async () => {
    await openWorkspace()
    const first = workspace.projectId!
    await act(async () => {
      workspace.update((project) => ({ ...project, name: 'First road project' }))
    })
    await saved()
    // A project opened from a file becomes a new project; it does not overwrite the open one.
    await act(async () => {
      await workspace.restore({ ...createDemoProject(), name: 'From a file' })
    })
    const second = workspace.projectId!
    expect(second).not.toBe(first)
    await act(async () => {
      workspace.update((project) => ({ ...project, name: 'From a file, edited' }))
    })
    await act(async () => {
      await workspace.openProject(first)
    })
    expect(workspace.project.name).toBe('First road project')
    expect(workspace.library.map((e) => e.name).sort()).toEqual(['First road project', 'From a file, edited'])
    await act(async () => {
      await workspace.duplicateProject(second)
    })
    expect(workspace.library.map((e) => e.name)).toContain('From a file, edited copy')
    await expect(workspace.removeProject(first)).rejects.toThrow(/Open another project/)
    await act(async () => {
      await workspace.removeProject(second)
    })
    expect(workspace.library.map((e) => e.name).sort()).toEqual(['First road project', 'From a file, edited copy'])
    expect(await readProject(second)).toBeUndefined()

    await act(async () => {
      renderer!.unmount()
    })
    renderer = undefined
    await openWorkspace()
    expect(workspace.projectId).toBe(first)
    expect(workspace.project.name).toBe('First road project')
  })
})
