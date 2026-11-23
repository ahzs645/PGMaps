import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync, zipSync } from 'fflate'

import {
  packProject,
  parseProject,
  PROJECT_FORMAT,
  projectOpenedLine,
  projectOpenStatus,
  projectRecipeStatus,
  reachableProjectState,
  serializeProject,
  type ProjectState,
} from './projectFile'
import { emptyProjectMedia, openProjectArchive, projectArchiveFileList, writeProjectArchive } from './projectArchive'
import { renderJobKey } from './renderJobKey'
import type { SavedDriveView } from './previewState'
import { createEmptyScene } from './scene'
import { viewAtPoint, viewCaptureKey } from './viewsOfInterest'
import { emptyTools, parseTools, serializeTools } from './assessmentTools'
import { linkPhotoJob, photoRecordFromOwn, withFlights, type OwnSearchSummary } from './photoRecords'
import type { OwnPoseSources } from './exifPose'

const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
const view = (id: string, name: string): SavedDriveView => ({
  id,
  name,
  positionMeters: 0,
  lookAtTargetId: null,
  lookBearing: 343,
  yaw: 10,
  tilt: -2,
  treeHeightMeters: 25,
  roadClearWidthMeters: 20,
  harvestPhase: 'after',
  plannedViewId: 'voi-1',
  plannedKey: 'k',
})
const classes = () => {
  const codes = new Uint8Array(6 * 4)
  codes.forEach((_, i) => (codes[i] = (i * 7) % 11))
  return { codes, width: 6, height: 4 }
}
const state = (): ProjectState => {
  const scene = createEmptyScene()
  scene.viaReview = {
    ...scene.viaReview,
    reportEdits: { 'cover||field|Licence': 'A12345' },
    // The reviewed scope's statement and note (`assessmentScope.ts`), a review record kept on the landform.
    landformRecords: { 'Made-up face': { reviewedAs: 'part-of-unit', scopeNote: 'East of the draw.' } },
  }
  return {
    scene,
    views: [view('view-a', 'Here')],
    shelved: [{ key: '{"place":"elsewhere"}', views: [view('view-b', 'Elsewhere')] }],
    images: {
      'view-a': { dataUrl: PIXEL, width: 1, height: 1, caption: 'Here.', savedAt: 5 },
      'view-b': {
        dataUrl: PIXEL,
        width: 1,
        height: 1,
        caption: 'Elsewhere.',
        savedAt: 6,
        figure: {
          classes: classes(),
          frameImage: { dataUrl: PIXEL, width: 6, height: 4, caption: '' },
          facts: [],
          camera: { renderedOn: new Date('2026-11-12T10:00:00Z') },
        },
        figureAt: { pose: { lng: -121.9, lat: 53.9, bearing: 343 } },
      },
      orphan: { dataUrl: PIXEL, width: 1, height: 1, caption: 'No view holds it.' },
    },
    capturedBefore: { 'view-b': { plannedKey: 'k', render: { dataUrl: PIXEL, width: 6, height: 4, caption: '' } } },
    engineFigures: { 'view-b|worldgen|k': { classes: classes(), facts: [] } },
    workspace: '{"version":1}',
    pkg: { renderer: 'worldgen', recipeId: 'district-rationale' },
  }
}

describe('the project file', () => {
  it('reads back what it wrote: views by their ids, pictures, rasters value for value, the review and the package', async () => {
    const written = state()
    const text = await serializeProject(written, new Date('2026-11-16T12:00:00Z'))
    const { state: read, summary } = await parseProject(text)
    expect(summary).toEqual({
      savedAt: '2026-11-16T12:00:00.000Z',
      views: 2,
      pictures: 2,
      dropped: [],
      figures: 'current',
    })
    expect(read.views.map((entry) => entry.id)).toEqual(['view-a'])
    expect(read.shelved).toEqual(written.shelved)
    expect(read.scene.viaReview?.reportEdits).toEqual({ 'cover||field|Licence': 'A12345' })
    expect(read.scene.viaReview?.landformRecords).toEqual({
      'Made-up face': { reviewedAs: 'part-of-unit', scopeNote: 'East of the draw.' },
    })
    const figure = read.images['view-b'].figure as { classes: { codes: Uint8Array } }
    expect(figure).toMatchObject({ camera: { renderedOn: new Date('2026-11-12T10:00:00.000Z') } })
    expect(figure.classes.codes).toBeInstanceOf(Uint8Array)
    expect([...figure.classes.codes]).toEqual([...classes().codes])
    expect(read.images['view-b'].figureAt).toEqual({ pose: { lng: -121.9, lat: 53.9, bearing: 343 } })
    // A picture no saved view holds does not come back.
    expect(read.images.orphan).toBeUndefined()
    expect(read.capturedBefore['view-b']).toEqual(written.capturedBefore['view-b'])
    expect(Object.keys(read.engineFigures)).toEqual(['view-b|worldgen|k'])
    expect(read.workspace).toBe('{"version":1}')
    expect(read.pkg).toEqual({ renderer: 'worldgen', recipeId: 'district-rationale' })
    expect(projectOpenedLine('a.pgvq.json', summary)).toContain('2 saved views, 2 with their pictures')
  })

  it('leaves out what does not read and names it, keeping the rest', async () => {
    const raw = JSON.parse(await serializeProject(state()))
    raw.images['view-b'].figure.classes.width = 99
    raw.images['view-a'].dataUrl = 'javascript:alert(1)'
    raw.views.push({ id: 'bad', positionMeters: 'x' })
    const { state: read, summary } = await parseProject(JSON.stringify(raw))
    expect(read.images['view-a']).toBeUndefined()
    expect(read.images['view-b'].figure).toBeUndefined()
    expect(read.images['view-b'].figureError).toBeTruthy()
    expect(summary.dropped).toEqual([
      '1 saved view that did not read',
      'Here: its screenshot is not a picture',
      'Elsewhere’s analysis sheet: its figure’s class pass is not the size it states',
    ])
  })

  it("keeps the stand's own eye, and names one that does not read", async () => {
    // A made-up spot stood at with a view's own eye height above the ground (`standEyeHeight`).
    const written = state()
    const at = { lng: -122.4, lat: 54.2 }
    written.scene.viewpoint = {
      id: 'stand-lookout',
      name: 'Lookout',
      mode: 'spot',
      coordinates: [[at.lng, at.lat]],
      standEyeHeight: { heightMeters: 3, ...at },
    }
    const { state: read, summary } = await parseProject(await serializeProject(written))
    expect(read.scene.viewpoint).toEqual(written.scene.viewpoint)
    expect(summary.dropped).toEqual([])
    // An older file, without one, reads as it always has.
    const old = state()
    expect((await parseProject(await serializeProject(old))).state.scene.viewpoint).toEqual(old.scene.viewpoint)
    const raw = JSON.parse(await serializeProject(written))
    raw.scene.viewpoint.standEyeHeight.heightMeters = -2
    raw.scene.viewpoint.surveyedEye = { elevationMeters: 'high', ...at }
    const bad = await parseProject(JSON.stringify(raw))
    expect(bad.state.scene.viewpoint.standEyeHeight).toBeUndefined()
    expect(bad.state.scene.viewpoint.surveyedEye).toBeUndefined()
    expect(bad.summary.dropped).toEqual([
      'the surveyed eye elevation where the eye stands: it is not an elevation',
      'the eye height above the ground where the eye stands: it is not a height',
    ])
  })

  it('writes only the pictures, renders and engine figures a saved or shelved view holds', async () => {
    const written = state()
    // What another site's views left behind: a picture, a before render and engine figures for views not in the file.
    written.capturedBefore.gone = {
      plannedKey: 'k',
      render: { dataUrl: 'data:image/png;base64,Z29uZQ==', width: 1, height: 1, caption: '' },
    }
    const gone = renderJobKey({ viewId: 'gone', engine: 'worldgen', sceneKey: 'site-a', optionsKey: 'o' })
    // A view whose id begins with a held view's id is still another view.
    const lookalike = renderJobKey({ viewId: 'view-bb', engine: 'nanite', sceneKey: null, optionsKey: 'o' })
    written.engineFigures[gone] = { classes: classes(), facts: [] }
    written.engineFigures[lookalike] = { classes: classes(), facts: [] }
    const reachable = reachableProjectState(written)
    expect(Object.keys(reachable.images).sort()).toEqual(['view-a', 'view-b'])
    expect(Object.keys(reachable.capturedBefore)).toEqual(['view-b'])
    expect(Object.keys(reachable.engineFigures)).toEqual(['view-b|worldgen|k'])
    const doc = await packProject(written)
    expect(Object.keys(doc.images as object).sort()).toEqual(['view-a', 'view-b'])
    expect(Object.keys(doc.capturedBefore as object)).toEqual(['view-b'])
    expect(Object.keys(doc.engineFigures as object)).toEqual(['view-b|worldgen|k'])
    // The archive's file list carries no capture for them either.
    const archive = await writeProjectArchive(written, emptyProjectMedia())
    const files = (await projectArchiveFileList(archive)).split('\n')
    expect(files.filter((path) => path.startsWith('captures/before/'))).toHaveLength(0)
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    expect(strFromU8(entries['project.json'])).not.toContain('No view holds it.')
    expect(strFromU8(entries['project.json'])).not.toContain(gone)
  })

  it('leaves out an engine figure for a view the file does not hold, and names it', async () => {
    const raw = JSON.parse(await serializeProject(state()))
    raw.engineFigures['stranger|worldgen|k'] = raw.engineFigures['view-b|worldgen|k']
    const { state: read, summary } = await parseProject(JSON.stringify(raw))
    expect(Object.keys(read.engineFigures)).toEqual(['view-b|worldgen|k'])
    expect(summary.dropped).toEqual(['1 engine figure for a view not in the project'])
  })

  it('refuses a file that is not a project, or is from a newer PGMaps', async () => {
    await expect(parseProject('nope')).rejects.toThrow('not JSON')
    await expect(parseProject('{"type":"pgmaps-driving-preview"}')).rejects.toThrow('not a visual-quality project')
    await expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 99 }))).rejects.toThrow('newer PGMaps')
  })
})

describe('the open receipt', () => {
  it('says whether the saved figures are the scene’s as it opens, from the key the file kept', async () => {
    const raw = JSON.parse(await serializeProject(state()))
    expect(typeof raw.sceneKey).toBe('string')
    expect((await parseProject(JSON.stringify(raw))).summary.figures).toBe('current')
    // Another calculation of the scene (another PGMaps): the figures are kept as saved and said to be earlier.
    expect((await parseProject(JSON.stringify({ ...raw, sceneKey: '{"other":1}' }))).summary.figures).toBe('earlier')
    const { sceneKey: _key, ...older } = raw
    void _key
    expect((await parseProject(JSON.stringify(older))).summary.figures).toBe('not-stated')
    expect((await parseProject(JSON.stringify({ ...raw, views: [] }))).summary.figures).toBe('none')
  })

  it('names the recipe: none chosen, shipped, yours here, yours elsewhere, or unknown', () => {
    const shipped = [{ id: 'district-rationale', name: 'District rationale' }]
    const own = [{ id: 'own-mine-abcd', name: 'Mine' }]
    expect(projectRecipeStatus(null, shipped, own)).toEqual({ kind: 'format' })
    expect(projectRecipeStatus('district-rationale', shipped, own)).toEqual({
      kind: 'shipped',
      name: 'District rationale',
    })
    expect(projectRecipeStatus('own-mine-abcd', shipped, own)).toEqual({ kind: 'own', name: 'Mine' })
    expect(projectRecipeStatus('own-theirs-wxyz', shipped, own)).toEqual({ kind: 'own-missing' })
    expect(projectRecipeStatus('retired-recipe', shipped, own)).toEqual({ kind: 'unknown' })
  })

  it('counts earlier captures of edited views and keeps them, and a kept one, through the file', async () => {
    const written = state()
    const planned = viewAtPoint({ lng: -122.7, lat: 53.9 }, { id: 'block-1', name: 'Block' }, [])
    const before = viewCaptureKey(planned)
    written.scene = { ...written.scene, viewsOfInterest: [{ ...planned, focalMm: 28 }] }
    written.views = [
      { ...view('view-a', 'Here'), plannedViewId: planned.id, plannedKey: before },
      // Kept as its own saved view: no planned view's id or key.
      { ...view('view-c', 'Kept'), plannedViewId: undefined, plannedKey: undefined },
    ]
    const text = await serializeProject(written)
    const { state: read, summary } = await parseProject(text)
    expect(read.views[0]).toMatchObject({ plannedViewId: planned.id, plannedKey: before })
    expect(read.views[1]).not.toHaveProperty('plannedViewId')
    expect(read.views[1]).not.toHaveProperty('plannedKey')
    const status = projectOpenStatus(read, {
      shipped: [{ id: 'district-rationale', name: 'District rationale' }],
      own: [],
    })
    expect(status).toEqual({ recipe: { kind: 'shipped', name: 'District rationale' }, earlierCaptures: 1 })
    expect(projectOpenedLine('a.pgvq.zip', summary, status)).toBe(
      'Opened a.pgvq.zip: 3 saved views, 2 with their pictures. Their figures are as saved for this scene. No run yet: it is made again when a file needs it. Recipe: District rationale. One earlier capture is listed under its view.',
    )
    expect(
      projectOpenedLine(
        'b',
        { ...summary, figures: 'earlier' },
        { recipe: { kind: 'own-missing' }, earlierCaptures: 0 },
      ),
    ).toBe(
      'Opened b: 3 saved views, 2 with their pictures. Their figures were saved under an earlier calculation of this scene: they are kept as saved, and a new run may differ. No run yet: it is made again when a file needs it. Its own recipe is not in this browser: the format’s recipe is used until it is added.',
    )
  })
})

describe('the project ZIP', () => {
  it('opens the original photo, supporting files, field images and captured figures with their original bytes', async () => {
    const written = state()
    const field = 'data:image/png;base64,iVBORw0KGgo='
    written.workspace = JSON.stringify({ version: 1, fields: [{ image: field }] })
    written.capturedBefore['view-b'] = {
      plannedKey: 'k',
      render: { dataUrl: 'data:image/png;base64,YmVmb3Jl', width: 1, height: 1 },
    }
    const original = new Blob([new Uint8Array([255, 216, 255, 217])])
    const pose = {
      lng: -121,
      lat: 53,
      bearing: 73,
      roll: 2,
      pitch: 3,
      hfov: 50,
      eyeHeightMeters: 2,
      altitudeMeters: 615,
    }
    const blob = await writeProjectArchive(written, {
      title: 'Reference VIA',
      attachments: [
        { name: 'Camera original.JPG', blob: original },
        { name: 'Source report.pdf', blob: new Blob(['source bytes']) },
      ],
      photo: { name: 'Camera original.JPG', blob: original, pose, recordId: null },
    })
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        'project.json',
        'archive.json',
        'photos/field/1.png',
        'captures/views/2.jpg',
        'captures/before/3.png',
        'attachments/1/Camera original.JPG',
        'attachments/2/Source report.pdf',
      ]),
    )
    expect(strFromU8(entries['project.json'])).not.toContain('data:image/')
    expect(Object.keys(entries).filter((path) => path.endsWith('Camera original.JPG'))).toHaveLength(1)
    const read = await openProjectArchive(blob)
    expect(read.summary.dropped).toEqual([])
    // The scene's key travels in the archive's project.json too.
    expect(read.summary.figures).toBe('current')
    expect(read.state.workspace).toBe(written.workspace)
    expect(read.state.capturedBefore).toEqual(written.capturedBefore)
    expect(read.state.images['view-b']).toEqual(written.images['view-b'])
    expect(read.state.engineFigures).toEqual(written.engineFigures)
    expect(read.media.title).toBe('Reference VIA')
    expect(read.media.photo?.pose).toEqual(pose)
    expect(read.media.photo?.blob).toBe(read.media.attachments[0].blob)
    expect(await read.media.photo?.blob.arrayBuffer()).toEqual(await original.arrayBuffer())
    expect(await read.media.attachments[1].blob.text()).toBe('source bytes')
  })

  it('keeps every own photo’s record, acceptance, uses and original, and the open photo’s sources and search', async () => {
    const pose = {
      lng: -121,
      lat: 53,
      bearing: 73,
      roll: 2,
      pitch: -6,
      hfov: 50,
      eyeHeightMeters: 1.6,
      altitudeMeters: 1200,
    }
    const sources: OwnPoseSources = {
      position: 'exif',
      heading: 'skyline',
      pitch: 'skyline',
      roll: 'skyline',
      fov: 'exif',
      eyeHeight: 'exif',
    }
    const make = (id: string) =>
      photoRecordFromOwn({
        id,
        name: `${id}.HEIC`,
        image: { dataUrl: PIXEL, width: 4, height: 3 },
        exif: null,
        pose,
        sources,
      })
    const accepted = linkPhotoJob(
      {
        ...make('field-1'),
        takenAtUtc: '2026-07-01T14:03:00.000Z',
        acceptance: {
          acceptedBy: 'AB',
          acceptedAt: '2026-11-17T10:00:00.000Z',
          method: 'skyline',
          pose: { lng: -121, lat: 53, altitudeMeters: 1200, bearing: 73, pitch: -6, roll: 2, hfov: 50 },
          evidence: { skyColumns: 300, settled: true },
          note: '',
        },
      },
      'viewpoint',
      'voi-1',
    )
    const fields = withFlights([accepted, { ...make('field-2'), takenAtUtc: '2026-07-01T14:03:03.000Z' }])
    const written = state()
    written.workspace = serializeTools({ ...emptyTools(), fields })
    const originals = [new Blob([new Uint8Array([1, 1])]), new Blob([new Uint8Array([2, 2])])]
    const search: OwnSearchSummary = {
      bearing: 73,
      pitch: -6,
      roll: 2,
      columns: 300,
      agreeing: 270,
      agreement: 0.9,
      span: 0.8,
      medianErrorPx: 2,
      meanLoss: 0.2,
      trustworthy: true,
      ambiguous: false,
      runnerUp: { bearing: 250, pitch: -4, roll: 0, meanLoss: 0.7 },
      modelScore: 0.8,
      runnerUpModelScore: null,
    }
    const blob = await writeProjectArchive(written, {
      title: null,
      attachments: [
        { name: 'field-1.HEIC', blob: originals[0], recordId: 'field-1' },
        { name: 'field-2.HEIC', blob: originals[1], recordId: 'field-2' },
      ],
      photo: { name: 'field-1.HEIC', blob: originals[0], pose, recordId: 'field-1', sources, search },
      // The rest of the set comes back too, each with its own pose.
      photos: [{ name: 'field-2.HEIC', blob: originals[1], pose: { ...pose, bearing: 80 }, recordId: 'field-2' }],
    })
    const read = await openProjectArchive(blob)
    expect(read.summary.dropped).toEqual([])
    expect(parseTools(JSON.parse(read.state.workspace!)).fields).toEqual(fields)
    expect(read.media.attachments.map((a) => a.recordId)).toEqual(['field-1', 'field-2'])
    expect(await read.media.attachments[1].blob.arrayBuffer()).toEqual(await originals[1].arrayBuffer())
    expect(read.media.photo).toMatchObject({ recordId: 'field-1', pose, sources, search })
    expect(read.media.photo?.blob).toBe(read.media.attachments[0].blob)
    expect(read.media.photos).toHaveLength(1)
    expect(read.media.photos?.[0]).toMatchObject({ recordId: 'field-2', pose: { ...pose, bearing: 80 }, sources: null })
    expect(read.media.photos?.[0].blob).toBe(read.media.attachments[1].blob)
    // Rasters, terrain and drawings are not in the file: they are made again from the pose.
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    expect(Object.keys(entries).filter((path) => path.startsWith('photos/open/'))).toEqual([])
  })

  it('opens a photo saved before its sources were kept, and leaves out sources that do not read', async () => {
    const pose = { lng: -121, lat: 53, bearing: 73, roll: 0, pitch: 0, hfov: 50, eyeHeightMeters: 1.6 }
    const original = new Blob([new Uint8Array([9])])
    const older = await writeProjectArchive(state(), {
      title: null,
      attachments: [],
      photo: { name: 'a.jpg', blob: original, pose, recordId: null },
    })
    expect((await openProjectArchive(older)).media.photo).toMatchObject({ sources: null, search: null, recordId: null })
    const entries = unzipSync(new Uint8Array(await older.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(entries['archive.json']))
    manifest.photo.sources = { position: 'exif', heading: 'a guess' }
    entries['archive.json'] = new TextEncoder().encode(JSON.stringify(manifest))
    const odd = await openProjectArchive(new Blob([zipSync(entries) as BlobPart]))
    expect(odd.media.photo).toMatchObject({ sources: null, pose })
  })

  it('opens earlier project JSON and reports an incomplete ZIP', async () => {
    const legacy = await openProjectArchive(new Blob([await serializeProject(state())]))
    expect(legacy.summary.pictures).toBe(2)
    expect(legacy.media).toEqual(emptyProjectMedia())
    const archived = await writeProjectArchive(state(), emptyProjectMedia())
    const entries = unzipSync(new Uint8Array(await archived.arrayBuffer()))
    delete entries['captures/views/1.jpg']
    await expect(openProjectArchive(new Blob([zipSync(entries) as BlobPart]))).rejects.toThrow('missing a file')
  })
})
