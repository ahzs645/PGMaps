import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import { emptyProjectMedia, openProjectArchive, writeProjectArchive } from './projectArchive'
import type { ProjectState } from './projectFile'
import type { SavedDriveView } from './previewState'
import { renderJobKey } from './renderJobKey'
import { createSampleScene } from './scene'
import {
  checkpointLine,
  checkpointMayReplace,
  checkpointRefusal,
  comparableFingerprint,
  mergeCheckpoint,
  newSiteId,
  type PageParts,
} from './siteCheckpoint'
import {
  clearSiteCheckpoint,
  loadPhotoSet,
  loadPreviousSite,
  loadSiteCheckpoint,
  saveAttachments,
  savePreviousSite,
  saveSiteCheckpoint,
} from './toolsStorage'

const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
const view = (id: string, name: string, phase: 'before' | 'after', positionMeters: number): SavedDriveView => ({
  id,
  name,
  positionMeters,
  lookAtTargetId: null,
  lookBearing: 212,
  yaw: 31.5,
  tilt: -3.25,
  treeHeightMeters: 24,
  roadClearWidthMeters: 18,
  harvestPhase: phase,
  plannedViewId: `voi-${id}`,
  plannedKey: `key-${id}`,
})
const classes = () => {
  const codes = new Uint8Array(8 * 5)
  codes.forEach((_, i) => (codes[i] = (i * 3) % 7))
  return { codes, width: 8, height: 5 }
}

/** A made-up site with a view here, one shelved, each picture, figure, render and engine figure, and a recipe. */
function site(): ProjectState {
  const scene = createSampleScene()
  const here = view('view-here', 'Pullout above the creek', 'after', 120)
  const away = view('view-away', 'Bridge approach', 'before', 40)
  const engineKey = renderJobKey({
    viewId: away.id,
    engine: 'worldgen',
    sceneKey: '{"made":"up"}',
    optionsKey: 'q1',
  })
  return {
    scene,
    views: [here],
    shelved: [{ key: '{"made":"up"}', views: [away] }],
    images: {
      [here.id]: { dataUrl: PIXEL, width: 1, height: 1, caption: 'From the pullout, looking up the draw.', savedAt: 3 },
      [away.id]: {
        dataUrl: PIXEL,
        width: 1,
        height: 1,
        caption: 'From the bridge approach.',
        savedAt: 4,
        figure: {
          classes: classes(),
          frameImage: { dataUrl: PIXEL, width: 8, height: 5, caption: '' },
          facts: [],
          camera: { renderedOn: new Date('2026-11-20T09:30:00Z') },
        },
        figureAt: { pose: { lng: -122.1, lat: 54.2, bearing: 212 } },
      },
    },
    capturedBefore: {
      [away.id]: { plannedKey: 'key-view-away', render: { dataUrl: PIXEL, width: 8, height: 5, caption: '' } },
    },
    engineFigures: { [engineKey]: { classes: classes(), facts: [] } },
    workspace: null,
    pkg: { renderer: 'worldgen', recipeId: 'made-up-recipe' },
  }
}

const emptyPage = (key: string | null, loadedRevision = 5): PageParts => ({
  key,
  loadedRevision,
  savedRecordHoldsKey: false,
  views: [],
  shelved: [],
  images: {},
  capturedBefore: {},
  engineFigures: {},
  pkg: { renderer: null, recipeId: null },
  title: null,
})

describe('the site checkpoint', () => {
  it('brings back view ids, poses, phases, figures, captions, attachments and the recipe after a reload', async () => {
    const written = site()
    const key = comparableFingerprint(written.scene)
    const siteId = newSiteId(() => 'made-up-1')
    // Written as the page writes it: the project file's format, no media, no workspace.
    const blob = await writeProjectArchive(
      written,
      { ...emptyProjectMedia(), title: 'Made-up block review' },
      new Date('2026-11-22T14:02:00Z'),
    )
    expect(
      await saveSiteCheckpoint({
        siteId,
        sceneRevision: 5,
        savedAt: '2026-11-22T14:02:00.000Z',
        name: 'Made-up',
        blob,
      }),
    ).toBe(true)
    // A photo's original is kept by its own store, beside the checkpoint.
    await saveAttachments([
      { key: 'record:photo-1', name: 'field.jpg', blob: new Blob(['jpeg bytes']), recordId: 'photo-1' },
    ])

    // The reload.
    const row = await loadSiteCheckpoint()
    expect(checkpointRefusal(row, siteId)).toBeNull()
    const { state, media } = await openProjectArchive(row!.blob)
    const merged = mergeCheckpoint(emptyPage(key), {
      state,
      title: media.title,
      key: comparableFingerprint(state.scene),
      sceneRevision: row!.sceneRevision,
    })
    expect(merged.scene).toBeNull()
    expect(merged.views).toEqual(written.views)
    expect(merged.shelved).toEqual(written.shelved)
    expect(merged.views![0]).toMatchObject({ yaw: 31.5, tilt: -3.25, positionMeters: 120, harvestPhase: 'after' })
    expect(merged.shelved[0].views[0].harvestPhase).toBe('before')
    const images = merged.images as Record<string, { caption: string; figure?: { classes: { codes: Uint8Array } } }>
    expect(images['view-here'].caption).toBe('From the pullout, looking up the draw.')
    expect(images['view-away'].figure!.classes.codes).toEqual(classes().codes)
    expect(Object.keys(merged.capturedBefore)).toEqual(['view-away'])
    expect(Object.keys(merged.engineFigures)).toEqual(Object.keys(written.engineFigures))
    expect(merged.renderer).toBe('worldgen')
    expect(merged.recipeId).toBe('made-up-recipe')
    expect(merged.title).toBe('Made-up block review')
    const kept = await loadPhotoSet()
    expect(kept.attachments.map((entry) => entry.recordId)).toEqual(['photo-1'])
  })

  it('never opens another site’s checkpoint', () => {
    expect(checkpointRefusal(null, 'site-a')).toBe('nothing kept')
    expect(checkpointRefusal({ siteId: 'site-b' }, 'site-a')).toMatch(/another site/)
  })

  it('never replaces a newer checkpoint of the same site', async () => {
    const at = (sceneRevision: number, savedAt: string, siteId = 'site-guard') => ({ siteId, sceneRevision, savedAt })
    expect(checkpointMayReplace(null, at(1, 'a'))).toBe(true)
    expect(checkpointMayReplace(at(9, 'z', 'site-other'), at(1, 'a'))).toBe(true)
    expect(checkpointMayReplace(at(4, '2026-11-22T10:00:00Z'), at(5, '2026-11-22T09:00:00Z'))).toBe(true)
    expect(checkpointMayReplace(at(6, '2026-11-22T09:00:00Z'), at(5, '2026-11-22T10:00:00Z'))).toBe(false)
    expect(checkpointMayReplace(at(5, '2026-11-22T10:00:01Z'), at(5, '2026-11-22T10:00:00Z'))).toBe(false)

    const blob = (text: string) => new Blob([text])
    await saveSiteCheckpoint({ ...at(7, '2026-11-22T10:00:00Z'), name: 'Newer', blob: blob('newer') })
    expect(await saveSiteCheckpoint({ ...at(6, '2026-11-22T10:05:00Z'), name: 'Older', blob: blob('older') })).toBe(
      false,
    )
    expect((await loadSiteCheckpoint())?.name).toBe('Newer')
    // The previous site's slot is its own: neither touches the other.
    await savePreviousSite({ name: 'Left', savedAt: '2026-11-22T09:00:00Z', blob: blob('left') })
    expect((await loadSiteCheckpoint())?.name).toBe('Newer')
    expect((await loadPreviousSite())?.name).toBe('Left')
    await clearSiteCheckpoint('site-guard')
    expect((await loadSiteCheckpoint())?.name).toBe('Newer')
    await clearSiteCheckpoint('site-next')
    expect(await loadSiteCheckpoint()).toBeNull()
    expect((await loadPreviousSite())?.name).toBe('Left')
  })

  it('keeps what the page already holds over the checkpoint', () => {
    const kept = site()
    const key = comparableFingerprint(kept.scene)
    const newView = view('view-new', 'Saved since the reload', 'after', 10)
    const page: PageParts = {
      ...emptyPage(key),
      // This browser's Saved views record holds the scene, written at once: its views are the newer, even none.
      savedRecordHoldsKey: true,
      views: [newView],
      images: { 'view-here': { dataUrl: PIXEL, width: 1, height: 1, caption: 'Retaken.' } },
      pkg: { renderer: 'nanite', recipeId: 'chosen-since' },
      title: 'Renamed since',
    }
    const merged = mergeCheckpoint(page, { state: kept, title: 'Kept title', key, sceneRevision: 5 })
    expect(merged.scene).toBeNull()
    expect(merged.views).toBeNull()
    // A picture for a view the page no longer holds is not brought back; a shelved place is.
    expect(Object.keys(merged.images).sort()).toEqual(['view-away', 'view-here'])
    expect((merged.images['view-here'] as { caption: string }).caption).toBe('Retaken.')
    expect(merged).toMatchObject({ renderer: 'nanite', recipeId: 'chosen-since', title: 'Renamed since' })

    // All views removed since the checkpoint: the record (holding none) wins, so none come back.
    const removed = mergeCheckpoint(
      { ...emptyPage(key), savedRecordHoldsKey: true },
      { state: kept, title: null, key, sceneRevision: 5 },
    )
    expect(removed.views).toBeNull()
    expect(Object.keys(removed.images)).toEqual(['view-away'])
  })

  it('gives the views this browser’s Saved views record renumbered their kept ids back, with their pictures', () => {
    const kept = site()
    const key = comparableFingerprint(kept.scene)
    // The record reads its views back as view-0, view-1…: the same views, under new ids.
    const renumbered = kept.views.map((entry, index) => ({ ...entry, id: `view-${index}` }))
    const merged = mergeCheckpoint(
      { ...emptyPage(key), savedRecordHoldsKey: true, views: renumbered },
      { state: kept, title: null, key, sceneRevision: 5 },
    )
    expect(merged.views?.map((entry) => entry.id)).toEqual(['view-here'])
    expect(Object.keys(merged.images).sort()).toEqual(['view-away', 'view-here'])
    // A view whose content differs from every kept one keeps the id it has.
    const moved = [{ ...renumbered[0], positionMeters: 300 }]
    expect(
      mergeCheckpoint(
        { ...emptyPage(key), savedRecordHoldsKey: true, views: moved },
        { state: kept, title: null, key, sceneRevision: 5 },
      ).views,
    ).toBeNull()
  })

  it('takes the checkpoint’s scene only when it is newer than the scene read', () => {
    const kept = site()
    const key = comparableFingerprint(kept.scene)
    const behind = mergeCheckpoint(emptyPage('{"another":"scene"}', 4), {
      state: kept,
      title: null,
      key,
      sceneRevision: 5,
    })
    expect(behind.scene).toBe(kept.scene)
    expect(behind.views).toEqual(kept.views)
    const ahead = mergeCheckpoint(emptyPage('{"another":"scene"}', 6), {
      state: kept,
      title: null,
      key,
      sceneRevision: 5,
    })
    expect(ahead.scene).toBeNull()
    // The scene moved on since: its views were saved for another scene, so they come back as a shelved place.
    expect(ahead.views).toBeNull()
    expect(ahead.shelved.find((entry) => entry.key === key)?.views).toEqual(kept.views)
    expect(Object.keys(ahead.images).sort()).toEqual(['view-away', 'view-here'])
  })

  it('says quietly whether the site is kept', () => {
    const time = (iso: string) => iso.slice(11, 16)
    expect(checkpointLine({ kind: 'idle' }, time)).toBeNull()
    expect(checkpointLine({ kind: 'kept', savedAt: '2026-11-22T14:02:00Z' }, time)).toBe('Kept in this browser 14:02')
    expect(checkpointLine({ kind: 'not-kept', reason: 'storage is full' }, time)).toBe(
      'Not kept in this browser: storage is full',
    )
  })
})
