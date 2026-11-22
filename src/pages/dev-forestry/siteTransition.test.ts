import { describe, expect, it } from 'vitest'

import {
  createOpenRequests,
  createSiteGeneration,
  shelvedWithSaved,
  siteWorthKeeping,
  workspaceHoldsSiteRecords,
} from './siteTransition'
import { createEmptyScene, createSampleScene, parseScene, serializeScene, type ForestryScene } from './scene'
import { createRoadsideDriveScene } from './driveScenario'
import { createPurdenLakeScene } from './purdenLakeScenario'

describe('the site generation', () => {
  it('lets work write while its site stands, and never after the site changes', async () => {
    const site = createSiteGeneration()
    const written: string[] = []
    // A save started on site A: its screenshot arrives after an await.
    const save = async (what: string, wait: Promise<void>) => {
      const guard = site.guard()
      await wait
      if (guard()) written.push(what)
    }
    let release!: () => void
    const slow = new Promise<void>((resolve) => (release = resolve))
    const onA = save('A’s figure', slow)
    await save('A’s screenshot', Promise.resolve())
    // *New site* while A's figure is still drawing.
    site.next()
    const onB = save('B’s screenshot', Promise.resolve())
    release()
    await Promise.all([onA, onB])
    expect(written).toEqual(['A’s screenshot', 'B’s screenshot'])
  })

  it('counts every transition, so a guard taken between two still fails after the second', () => {
    const site = createSiteGeneration()
    expect(site.current).toBe(0)
    site.next()
    const guard = site.guard()
    expect(guard()).toBe(true)
    expect(site.next()).toBe(2)
    expect(guard()).toBe(false)
    expect(site.guard()()).toBe(true)
  })
})

describe('whether a site is kept to reopen', () => {
  const nothing = { views: 0, attachments: 0, ownPhotos: 0, workspaceRecords: false }
  it('keeps what the reviewer made or added, and passes over an empty site or an untouched sample', () => {
    expect(siteWorthKeeping({ scene: createEmptyScene(), ...nothing })).toBe(false)
    expect(siteWorthKeeping({ scene: createSampleScene(), ...nothing })).toBe(false)
    expect(siteWorthKeeping({ scene: createRoadsideDriveScene(), ...nothing })).toBe(false)
    expect(siteWorthKeeping({ scene: createPurdenLakeScene(), ...nothing })).toBe(false)
    // Anything saved at a sample keeps it.
    expect(siteWorthKeeping({ scene: createRoadsideDriveScene(), ...nothing, views: 1 })).toBe(true)
    expect(siteWorthKeeping({ scene: createEmptyScene(), ...nothing, attachments: 1 })).toBe(true)
    expect(siteWorthKeeping({ scene: createEmptyScene(), ...nothing, ownPhotos: 1 })).toBe(true)
    expect(siteWorthKeeping({ scene: createEmptyScene(), ...nothing, workspaceRecords: true })).toBe(true)
    // A road drawn on a new site, or a block of the reviewer's own beside a sample's, is the reviewer's.
    const drawn = createEmptyScene()
    drawn.viewpoint = {
      ...drawn.viewpoint,
      coordinates: [
        [-120, 54],
        [-120.01, 54.01],
      ],
    }
    expect(siteWorthKeeping({ scene: drawn, ...nothing })).toBe(true)
    const sample = createSampleScene()
    const own = { ...sample.targets.find((target) => target.role === 'block')!, id: 'own', source: 'Drawn' }
    expect(siteWorthKeeping({ scene: { ...sample, targets: [...sample.targets, own] }, ...nothing })).toBe(true)
  })
})

describe('what a sample holds that is the reviewer’s', () => {
  const nothing = { views: 0, attachments: 0, ownPhotos: 0, workspaceRecords: false }
  const kept = (change: (scene: ForestryScene) => ForestryScene) =>
    siteWorthKeeping({ scene: change(createSampleScene()), ...nothing })

  it('passes over a sample only as it opens, whatever its ids and however it was stored', () => {
    expect(kept((scene) => scene)).toBe(false)
    // Read back from this browser's storage, with its empty defaults filled in.
    expect(kept((scene) => parseScene(JSON.parse(serializeScene(scene)))!)).toBe(false)
    expect(
      siteWorthKeeping({ scene: parseScene(JSON.parse(serializeScene(createPurdenLakeScene())))!, ...nothing }),
    ).toBe(false)
  })

  it('keeps a sample with the reviewer’s review, report fields, masks, landform, edits or settings', () => {
    expect(kept((scene) => ({ ...scene, viaReview: { visualsNote: 'The block sits below the skyline.' } }))).toBe(true)
    expect(
      kept((scene) => ({ ...scene, reportMetadata: { ...(scene.reportMetadata ?? {}), licensee: 'A licensee' } })),
    ).toBe(true)
    expect(
      kept((scene) => ({
        ...scene,
        masks: [
          {
            id: 'mask',
            name: 'Reserve',
            kind: 'retained',
            geometry: scene.targets[0].geometry as GeoJSON.Polygon,
            source: 'Drawn',
          },
        ],
      })),
    ).toBe(true)
    // The sample's landform set aside for another.
    const purden = createPurdenLakeScene()
    expect(siteWorthKeeping({ scene: { ...purden, activeLandformId: null }, ...nothing })).toBe(true)
    // A block moved by a hair, a road point dragged, a setting changed.
    expect(
      kept((scene) => ({
        ...scene,
        targets: scene.targets.map((target, i) =>
          i === 0 && target.geometry.type === 'Polygon'
            ? {
                ...target,
                geometry: {
                  ...target.geometry,
                  coordinates: [target.geometry.coordinates[0].map(([lng, lat]) => [lng + 1e-5, lat])],
                },
              }
            : target,
        ),
      })),
    ).toBe(true)
    expect(
      kept((scene) => ({
        ...scene,
        viewpoint: { ...scene.viewpoint, coordinates: scene.viewpoint.coordinates.slice(1) },
      })),
    ).toBe(true)
    expect(
      kept((scene) => ({
        ...scene,
        settings: { ...scene.settings, observerHeightMeters: scene.settings.observerHeightMeters + 0.5 },
      })),
    ).toBe(true)
  })

  it('counts every workspace record but the reviewer’s own curves as the site’s', () => {
    const empty = {
      version: 1,
      options: [],
      views: [],
      fields: [],
      runs: [],
      growthCurve: [{ age: 10, height: 3 }],
      growthSource: 'Own curve',
      curveLibrary: [{ id: 'c' }],
      blockCurves: {},
      referenceMeasurements: [],
    }
    expect(workspaceHoldsSiteRecords(empty)).toBe(false)
    expect(workspaceHoldsSiteRecords(null)).toBe(false)
    expect(workspaceHoldsSiteRecords({ ...empty, referenceMeasurements: [{ id: 'row' }] })).toBe(true)
    expect(workspaceHoldsSiteRecords({ ...empty, blockCurves: { block: 'c' } })).toBe(true)
    expect(workspaceHoldsSiteRecords({ ...empty, options: [{ id: 'design' }] })).toBe(true)
    // A record a newer workspace adds counts too.
    expect(workspaceHoldsSiteRecords({ ...empty, laterRecords: [{}] })).toBe(true)
  })
})

describe('views saved under another design', () => {
  it('go with the shelved views when the scene open is not theirs', () => {
    const saved = { key: 'design-a', views: ['a1', 'a2'] }
    // Moved the road since: the saved set is design A's, and design B shows none.
    expect(shelvedWithSaved(saved, 'design-b', [{ key: 'design-c', views: ['c1'] }])).toEqual([
      { key: 'design-c', views: ['c1'] },
      { key: 'design-a', views: ['a1', 'a2'] },
    ])
    // The saved set is the open scene's: only the shelved sets, never the open one twice.
    expect(shelvedWithSaved(saved, 'design-a', [{ key: 'design-a', views: ['old'] }])).toEqual([])
    // A stale shelved copy of the saved set's key is replaced by the saved set.
    expect(shelvedWithSaved(saved, 'design-b', [{ key: 'design-a', views: ['old'] }])).toEqual([
      { key: 'design-a', views: ['a1', 'a2'] },
    ])
    expect(shelvedWithSaved({ key: 'design-a', views: [] }, 'design-b', [])).toEqual([])
  })
})

describe('project opens and site switches', () => {
  it('lets the newest open win over a keep still running for an older switch', () => {
    const opens = createOpenRequests()
    const a = opens.next()
    // A's switch starts keeping the last site; it supersedes only requests older than A.
    const supersedesForA = a - 1
    // B is picked while A's keep runs.
    const b = opens.next()
    expect(opens.current(a)).toBe(false)
    // A's switch ends: B is not dropped.
    opens.supersede(supersedesForA)
    expect(opens.current(b)).toBe(true)
    // New site, started after B was asked, supersedes it.
    const newSite = opens.latest
    opens.supersede(newSite)
    expect(opens.current(b)).toBe(false)
    expect(opens.current(opens.next())).toBe(true)
  })
})
