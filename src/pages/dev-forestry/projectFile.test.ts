import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync, zipSync } from 'fflate'

import { parseProject, PROJECT_FORMAT, projectOpenedLine, serializeProject, type ProjectState } from './projectFile'
import { emptyProjectMedia, openProjectArchive, writeProjectArchive } from './projectArchive'
import type { SavedDriveView } from './previewState'
import { createEmptyScene } from './scene'

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
  scene.viaReview = { ...scene.viaReview, reportEdits: { 'cover||field|Licence': 'A12345' } }
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
        figure: { classes: classes(), frameImage: { dataUrl: PIXEL, width: 6, height: 4, caption: '' }, facts: [] },
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
    expect(summary).toEqual({ savedAt: '2026-11-16T12:00:00.000Z', views: 2, pictures: 2, dropped: [] })
    expect(read.views.map((entry) => entry.id)).toEqual(['view-a'])
    expect(read.shelved).toEqual(written.shelved)
    expect(read.scene.viaReview?.reportEdits).toEqual({ 'cover||field|Licence': 'A12345' })
    const figure = read.images['view-b'].figure as { classes: { codes: Uint8Array } }
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

  it('refuses a file that is not a project, or is from a newer PGMaps', async () => {
    await expect(parseProject('nope')).rejects.toThrow('not JSON')
    await expect(parseProject('{"type":"pgmaps-driving-preview"}')).rejects.toThrow('not a visual-quality project')
    await expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: 99 }))).rejects.toThrow('newer PGMaps')
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
