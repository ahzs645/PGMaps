import { IDBFactory } from 'fake-indexeddb'
import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLibrary, readProject, writeProject } from './projectLibrary'
import { createDemoProject, demoTerrain, loadLidarTerrain, roadProjection, starterAlignment } from './terrain'
import { startInvestigationDesign } from './investigationWorkspace'
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
vi.mock('./existingRoads', () => ({ loadBcExistingRoads: vi.fn(async () => []) }))
// Scenarios load cutblocks through harvestHistory; an unmocked loader made a real network request
// and, with its retry, pushed startup past waitFor's one-second limit.
vi.mock('./harvestHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./harvestHistory')>()),
  loadBcHarvestHistory: vi.fn(async () => []),
}))

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
  // Startup loads and analyses the default scenario; CI runners need more than waitFor's 1 s default.
  await vi.waitFor(() => expect(workspace.ready).toBe(true), { timeout: 5000 })
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
  it.each(['open', 'start', 'import'] as const)(
    'leaves temporary training on %s, keeps the library and restores the adopted project on reload',
    async (action) => {
      await writeProject('existing', { ...createDemoProject(), name: 'Keep my earlier project' }, [])
      const address = new URL(
        'https://example.test/dev/forestry/road-design?interface=workbench&example=training#section',
      )
      vi.stubGlobal('location', address)
      const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
        address.href = new URL(url, address).href
      })
      vi.stubGlobal('history', { state: { keep: true }, replaceState })
      await openWorkspace()
      await vi.waitFor(() => expect(workspace.browserSave.kind).toBe('training'), { timeout: 2000 })
      expect(workspace.projectId).toBeNull()
      const adopted = { ...createDemoProject(), name: `My ${action} project` }
      await act(async () => {
        if (action === 'open') await workspace.restore(adopted)
        else if (action === 'start') workspace.startProject(adopted, demoTerrain)
        else {
          workspace.update(() => adopted)
          workspace.enablePersistence()
        }
      })
      await vi.waitFor(() => expect(workspace.browserSave.kind).toBe('saved'), { timeout: 2000 })
      expect(address.search).toBe('?interface=workbench')
      expect(address.hash).toBe('#section')
      expect(replaceState).toHaveBeenCalledWith(
        { keep: true },
        '',
        '/dev/forestry/road-design?interface=workbench#section',
      )
      const savedId = workspace.projectId!
      const library = await readLibrary()
      expect(library.entries.map((e) => e.name).sort()).toEqual(['Keep my earlier project', adopted.name].sort())
      expect(library.activeId).toBe(savedId)
      expect((await readProject(savedId))?.name).toBe(adopted.name)
      await act(async () => renderer!.unmount())
      renderer = undefined
      await openWorkspace()
      expect(workspace.project.name).toBe(adopted.name)
      expect(workspace.projectId).toBe(savedId)
      expect(workspace.browserSave.kind).toBe('saved')
      expect(loadLidarTerrain).not.toHaveBeenCalled()
    },
  )

  it('restores a study without analysing its internal placeholder, and Start design keeps it hidden', async () => {
    const study = createDemoProject()
    const placeholder = starterAlignment(study.alignments[0].points[0].coordinate)
    study.alignments = [placeholder]
    study.activeAlignmentId = placeholder.id
    study.workspaceMode = 'access-investigation'
    study.investigation = { openingId: '12345', draftAlignmentId: placeholder.id }
    study.cables = []
    study.profiles = []
    await stored(indexedDB as IDBFactory, study)
    await openWorkspace()
    expect(workspace.project.workspaceMode).toBe('access-investigation')
    expect(workspace.analysis.stations).toEqual([])
    expect(workspace.analysis.centerline).toEqual([])
    expect(workspace.analysis.crossings).toEqual([])
    expect(workspace.library[0].roads).toBe(0)
    await act(async () => workspace.update((current) => startInvestigationDesign(current)))
    // The design starts with no road: the placeholder stays unanalysed and is not counted.
    expect(workspace.project.workspaceMode).toBe('design')
    expect(workspace.project.designPlaceholderId).toBe(placeholder.id)
    expect(workspace.analysis.stations).toEqual([])
    expect(workspace.analysis.centerline).toEqual([])
    await act(async () => workspace.flush())
    expect((await readLibrary()).entries[0].roads).toBe(0)
    const saved = await readProject(workspace.projectId!)
    expect(saved?.workspaceMode).toBe('design')
    expect(saved?.designPlaceholderId).toBe(placeholder.id)
  })

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

describe('road workspace undo steps', () => {
  it('gives each quick button press its own step, while quick typing merges', async () => {
    await openWorkspace()
    const grade = () => workspace.project.settings.maxGradePercent
    const setGrade = (maxGradePercent: number, ownStep?: boolean) =>
      workspace.update((p) => ({ ...p, settings: { ...p.settings, maxGradePercent } }), undefined, { ownStep })
    const start = grade()
    // Two presets clicked 0.4 s apart: one undo steps back one preset, not both.
    await act(async () => setGrade(16, true))
    await act(async () => setGrade(10, true))
    await act(async () => workspace.undo())
    expect(grade()).toBe(16)
    await act(async () => workspace.undo())
    expect(grade()).toBe(start)
    // Typed digits within the merge window stay one step.
    await act(async () => setGrade(1))
    await act(async () => setGrade(14))
    await act(async () => workspace.undo())
    expect(grade()).toBe(start)
  }, 30_000)
})

describe('a drag in the undo history', () => {
  /** One edit of the active road's first PVI, `ms` after the last. */
  async function dragTo(clock: { now: number }, elevation: number, ms = 600) {
    clock.now += ms
    await act(async () => {
      workspace.updateAlignment((road) => ({
        ...road,
        vertical: road.vertical.map((v, i) => (i === 1 ? { ...v, elevation } : v)),
      }))
    })
  }

  it('is one step however long it pauses, and Escape leaves no step and the project as it was', async () => {
    await openWorkspace()
    const clock = { now: 1_000_000 }
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
    const steps = () => workspace.historyRows().length
    const start = workspace.project
    const rows = steps()

    // A drag that pauses longer than the merge window between moves, then is kept.
    await act(async () => workspace.editGesture('start'))
    await dragTo(clock, 801)
    await dragTo(clock, 802)
    await act(async () => workspace.editGesture('end'))
    expect(steps()).toBe(rows + 1)
    const kept = workspace.project

    // A drag cancelled with Escape after pauses: back where it started, no step, Undo still undoes the kept drag.
    await act(async () => workspace.editGesture('start'))
    await dragTo(clock, 810)
    await dragTo(clock, 820)
    await act(async () => workspace.editGesture('cancel'))
    expect(workspace.project).toEqual(kept)
    expect(steps()).toBe(rows + 1)
    await act(async () => workspace.undo())
    expect(workspace.project.alignments).toEqual(start.alignments)
    expect(workspace.canRedo).toBe(true)

    // Cancelling a drag keeps the redo list it found.
    await act(async () => workspace.editGesture('start'))
    await dragTo(clock, 830)
    await act(async () => workspace.editGesture('cancel'))
    expect(workspace.canRedo).toBe(true)
    await act(async () => workspace.redo())
    expect(workspace.project).toEqual(kept)
  }, 30_000)
})
