import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createDemoProject, starterAlignment } from './terrain'
import { parseProject, serializeProject } from './project'
import { libraryEntry, readLibrary, readProject } from './projectLibrary'
import {
  awaitingFirstRoad,
  isAccessInvestigation,
  startInvestigationDesign,
  withAddedAlignments,
} from './investigationWorkspace'
import type { RoadProject } from './types'

/** Invented fixture reproducing the old application's untouched 300 m starter, not a BC record. */
function legacyStudy(): RoadProject {
  const project = createDemoProject()
  project.terrain.kind = 'regional'
  project.terrain.bounds = [-122.73, 53.885, -122.69, 53.905]
  const draft = starterAlignment([-122.71, 53.895])
  draft.name = 'Design draft · no historical-use assertion'
  project.alignments = [draft]
  project.activeAlignmentId = draft.id
  project.scenario = { id: 'bc-opening-60677', terrainCoveragePercent: 100, contextWarnings: [] }
  project.cables = []
  project.profiles = []
  return project
}

afterEach(() => vi.unstubAllGlobals())

describe('access investigation workspace contract', () => {
  it('migrates and round-trips only the original unused pilot starter, retaining its records', () => {
    const legacy = legacyStudy()
    const reopened = parseProject(legacy)
    expect(isAccessInvestigation(reopened)).toBe(true)
    expect(reopened.investigation).toEqual({ openingId: '60677', draftAlignmentId: legacy.activeAlignmentId })
    expect(reopened.context).toEqual(legacy.context)
    expect(reopened.alignments).toEqual(legacy.alignments)
    expect(parseProject(serializeProject(reopened))).toEqual(reopened)
    expect(libraryEntry('study', reopened).roads).toBe(0)
  })

  it.each(['geometry', 'name', 'grade', 'template', 'new-road', 'different-scenario'] as const)(
    'preserves a legacy project with intentional %s changes as a design',
    (change) => {
      const project = legacyStudy()
      const road = project.alignments[0]
      if (change === 'geometry') road.points[0].coordinate[0] += 0.0001
      if (change === 'name') road.name = 'My reviewed connector proposal'
      if (change === 'grade') road.vertical = [{ id: 'pvi', chainage: 0, elevation: 600, curveLength: 0 }]
      if (change === 'template') road.template.leftWidth = 4
      if (change === 'new-road') project.alignments.push({ ...structuredClone(road), id: 'second-design' })
      if (change === 'different-scenario') project.scenario!.id = 'regional-example'
      const reopened = parseProject(project)
      expect(isAccessInvestigation(reopened)).toBe(false)
      expect(reopened.alignments).toEqual(project.alignments)
    },
  )

  it('requires an explicit valid mode and placeholder reference, and makes Start design durable', () => {
    const project = parseProject(legacyStudy())
    expect(() => parseProject({ ...project, workspaceMode: 'historical-road' })).toThrow('Workspace mode')
    expect(() => parseProject({ ...project, investigation: undefined })).toThrow('opening ID')
    expect(() =>
      parseProject({ ...project, investigation: { openingId: '60677', draftAlignmentId: 'missing' } }),
    ).toThrow('placeholder')
    const design = parseProject(startInvestigationDesign(project))
    expect(design.workspaceMode).toBe('design')
    expect(design.investigation).toBeUndefined()
    // The design starts empty: the placeholder is kept for the schema but hidden and not counted.
    expect(design.designPlaceholderId).toBe(project.activeAlignmentId)
    expect(awaitingFirstRoad(design)).toBe(true)
    expect(libraryEntry('design', design).roads).toBe(0)
    expect(parseProject(serializeProject(design))).toEqual(design)
  })

  it('replaces the hidden placeholder with the first road added, by any route', () => {
    const design = parseProject(startInvestigationDesign(parseProject(legacyStudy())))
    const road = { ...starterAlignment([-122.7, 53.9]), id: 'first-road', name: 'Road 1' }
    const next = parseProject(withAddedAlignments(design, [road]))
    expect(next.alignments.map((a) => a.id)).toEqual(['first-road'])
    expect(next.activeAlignmentId).toBe('first-road')
    expect(next.designPlaceholderId).toBeUndefined()
    expect(libraryEntry('design', next).roads).toBe(1)
    const second = { ...starterAlignment([-122.71, 53.9]), id: 'second-road', name: 'Road 2' }
    expect(parseProject(withAddedAlignments(next, [second])).alignments.map((a) => a.id)).toEqual([
      'first-road',
      'second-road',
    ])
  })

  it('starts a design from a chosen road, and rejects a placeholder that is not the only road', () => {
    const study = parseProject(legacyStudy())
    const road = { ...starterAlignment([-122.7, 53.9]), id: 'mapped', name: 'Mapped' }
    const design = parseProject(startInvestigationDesign(study, [road]))
    expect(design.alignments.map((a) => a.id)).toEqual(['mapped'])
    expect(design.designPlaceholderId).toBeUndefined()
    const empty = parseProject(startInvestigationDesign(study))
    expect(() => parseProject({ ...empty, alignments: [...empty.alignments, road] })).toThrow('only road')
    expect(() => parseProject({ ...empty, workspaceMode: 'access-investigation' })).toThrow()
  })

  it('counts source road records once when their geometry has multiple map parts', () => {
    const project = parseProject(legacyStudy())
    const feature = {
      id: 'road-part-1',
      name: 'Invented multipart source record',
      kind: 'existing-road' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-122.71, 53.895],
          [-122.7, 53.895],
        ],
      },
      roadEvidence: {
        source: 'bc-ften' as const,
        sourceId: 'fixture-row-1',
        condition: 'unknown' as const,
        conditionBasis: 'unreviewed' as const,
        reuseAllowed: false,
      },
    }
    project.context = [feature, { ...feature, id: 'road-part-2' }]
    expect(libraryEntry('study', project)).toMatchObject({ roads: 0, roadRecords: 1 })
  })

  it('repairs an existing library card without changing its timestamp or overwriting the stored source project', async () => {
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    const original = legacyStudy()
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('pgmaps-forestry-roads-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('projects')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('projects', 'readwrite')
        const store = transaction.objectStore('projects')
        store.put(original, 'project:old-study')
        store.put(
          [{ id: 'old-study', name: original.name, terrain: original.terrain.name, roads: 1, updatedAt: 12345 }],
          'library',
        )
        store.put('old-study', 'active')
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
    const library = await readLibrary()
    expect(library.activeId).toBe('old-study')
    expect(library.entries[0]).toMatchObject({
      roads: 0,
      updatedAt: 12345,
      workspaceMode: 'access-investigation',
      openingId: '60677',
    })
    expect(await readProject('old-study')).toEqual(original)
    expect((await readLibrary()).entries).toEqual(library.entries)
  })
})
