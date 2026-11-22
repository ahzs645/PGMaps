import { describe, expect, it } from 'vitest'

import { createSiteGeneration, siteWorthKeeping } from './siteTransition'
import { createEmptyScene, createSampleScene } from './scene'
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
