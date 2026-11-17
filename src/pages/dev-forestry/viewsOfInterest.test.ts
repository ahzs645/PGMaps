import { describe, expect, it } from 'vitest'
import type { ViewpointCandidate } from './viewpointInventory'
import {
  addViews,
  blockCentre,
  captureChangeText,
  captureKeyChanges,
  groupByPlace,
  handSaveLink,
  lensHfovDeg,
  MAX_VIEWS_OF_INTEREST,
  parseViewsOfInterest,
  viewAtPoint,
  viewBearing,
  viewCaptureKey,
  viewCaptureState,
  needsCapture,
  viewsForCandidate,
  viewFromAcceptedPhoto,
  focalForHfov,
  type ViewOfInterest,
} from './viewsOfInterest'
import type { PhotoAcceptance } from './photoAcceptance'
import { sceneFingerprint } from './sceneInput'
import { createSampleScene, parseScene, serializeScene } from './scene'

const block = {
  id: 'block-1',
  name: 'Block A',
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.6, 53.9],
        [-122.59, 53.9],
        [-122.59, 53.91],
        [-122.6, 53.91],
        [-122.6, 53.9],
      ],
    ],
  },
}

// A viewpoint due west of the block: the block lies at about 90°.
const candidate = (bearings: number[]): ViewpointCandidate => ({
  key: 'vli:1',
  kind: 'vli',
  name: 'VLI 144',
  lng: -122.65,
  lat: 53.905,
  distanceMeters: 3000,
  bearingToBlock: 90,
  arrow: null,
  arrows: bearings.map((bearing, index) => ({
    id: `a${index}`,
    bearing,
    offsetDegrees: Math.abs(bearing - 90),
    lengthMeters: 500,
    aims: Math.abs(bearing - 90) <= 30,
  })),
  weight: 1,
})

describe('viewsForCandidate', () => {
  it('adds the two arrows aimed nearest the block, nearest first', () => {
    const views = viewsForCandidate(candidate([200, 100, 70, 85]), block)
    expect(views.map((view) => view.facing)).toEqual([
      { kind: 'bearing', degrees: 85, arrowId: 'a3' },
      { kind: 'bearing', degrees: 100, arrowId: 'a1' },
    ])
    expect(views[0].name).toBe('VLI 144, arrow 4')
  })
  it('faces the block when no arrow aims at it', () => {
    const views = viewsForCandidate(candidate([200, 300]), block)
    expect(views).toHaveLength(1)
    expect(views[0].facing).toEqual({ kind: 'block' })
    expect(views[0].name).toBe('VLI 144, toward Block A')
  })
  it('takes the arrows the reviewer picked', () => {
    const views = viewsForCandidate(candidate([200, 100]), block, { arrowIds: ['a0'] })
    expect(views.map((view) => view.facing)).toEqual([{ kind: 'bearing', degrees: 200, arrowId: 'a0' }])
  })
})

describe('the list', () => {
  it('skips repeats and stops at the limit', () => {
    const first = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    const again = { ...first, id: 'other' }
    const result = addViews([first], [again])
    expect(result).toMatchObject({ duplicates: 1, overLimit: 0 })
    const many = Array.from({ length: MAX_VIEWS_OF_INTEREST + 2 }, (_, index) =>
      viewAtPoint({ lng: -122.7 + index * 0.01, lat: 53.9 }, block, []),
    )
    expect(addViews([], many)).toMatchObject({ overLimit: 2 })
  })
  it('groups views standing at one place', () => {
    const views = viewsForCandidate(candidate([80, 100]), block)
    const other = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    expect(groupByPlace([...views, other]).map((group) => group.length)).toEqual([2, 1])
  })
  it('keeps an aircraft photo’s view apart from a ground view over the same spot', () => {
    const ground = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    const photo = { recordId: 'field-1', altitudeMeters: 1200, pitch: -6, roll: 0, hfov: 54 }
    const air = { ...ground, id: 'air', photo }
    const sameAir = { ...ground, id: 'air-2', photo: { ...photo, recordId: 'field-2' } }
    const higher = { ...ground, id: 'air-3', photo: { ...photo, altitudeMeters: 1500 } }
    expect(groupByPlace([ground, air, sameAir, higher]).map((group) => group.map((view) => view.id))).toEqual([
      [ground.id],
      ['air', 'air-2'],
      ['air-3'],
    ])
  })
  it('faces the block from where it stands', () => {
    const view = viewAtPoint({ lng: -122.65, lat: 53.905 }, block, [])
    expect(viewBearing(view, { lng: -122.595, lat: 53.905 })).toBeCloseTo(90, 0)
  })
  it('reads a 50 mm lens as 39.6° across', () => {
    expect(lensHfovDeg(50)).toBeCloseTo(39.6, 1)
  })
})

describe('capture state', () => {
  it('needs capturing again once the facing changes, not the name', () => {
    const view = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    const saved = [{ plannedViewId: view.id, plannedKey: viewCaptureKey(view) }]
    expect(viewCaptureState(view, saved)).toBe('captured')
    expect(viewCaptureState({ ...view, name: 'Renamed', include: false }, saved)).toBe('captured')
    expect(viewCaptureState({ ...view, facing: { kind: 'bearing', degrees: 10 } }, saved)).toBe('outdated')
    expect(viewCaptureState(view, [])).toBe('not-captured')
  })
  it('reads a capture saved without its analysis sheet as one more to capture', () => {
    const view = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    const key = viewCaptureKey(view)
    const saved = [
      { id: 'old', plannedViewId: view.id, plannedKey: key },
      { id: 'new', plannedViewId: view.id, plannedKey: key },
    ]
    expect(viewCaptureState(view, saved, () => false)).toBe('no-figure')
    expect(viewCaptureState(view, saved, (id) => id === 'new')).toBe('captured')
    // A sheet under an earlier key does not make the current capture complete.
    expect(viewCaptureState({ ...view, focalMm: 35 }, saved, () => true)).toBe('outdated')
    expect(needsCapture('no-figure')).toBe(true)
    expect(needsCapture('captured')).toBe(false)
  })
})

describe('naming a view placed on the map', () => {
  it('takes its place in the list, or the next number no view uses', () => {
    const vli = viewsForCandidate(candidate([80, 100]), block)
    const first = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, vli)
    expect(first.name).toBe(`Viewpoint ${vli.length + 1}, toward ${block.name}`)
    const later = { ...first, name: `Viewpoint 7, toward ${block.name}` }
    expect(viewAtPoint({ lng: -122.71, lat: 53.9 }, block, [later]).name).toBe(`Viewpoint 8, toward ${block.name}`)
  })
})

describe('in the scene', () => {
  it('round-trips through the scene file and never stales the run', () => {
    const scene = createSampleScene()
    const blockId = scene.targets.find((target) => target.role === 'block')!.id
    const views = [viewAtPoint({ lng: -122.7, lat: 53.9 }, { id: blockId, name: 'B' }, [])]
    const planned = { ...scene, viewsOfInterest: views }
    expect(sceneFingerprint(planned)).toBe(sceneFingerprint(scene))
    expect(parseScene(JSON.parse(serializeScene(planned)))?.viewsOfInterest).toEqual(views)
  })
  it('drops malformed entries', () => {
    expect(parseViewsOfInterest([{ id: 'x' }, null, 4])).toEqual([])
  })
})

describe('what changed since a capture', () => {
  it('names each part of the key that moved, once', () => {
    const view = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    const saved = [{ id: 's1', plannedViewId: view.id, plannedKey: viewCaptureKey(view) }]
    expect(captureKeyChanges(view, saved)).toEqual([])
    const edited = { ...view, focalMm: 28, landformId: 'land-1', lng: view.lng + 0.01, lat: view.lat + 0.01 }
    expect(captureKeyChanges(edited, saved)).toEqual(['place', 'lens', 'landform'])
    expect(captureChangeText(captureKeyChanges(edited, saved))).toBe(
      'Changed since captured: place, lens and landform.',
    )
    expect(captureKeyChanges(edited, [])).toEqual([])
  })
})

describe('a view saved by hand from the road view', () => {
  // About 1 km south of Block A's centre, so the block lies due north.
  const eye = { lng: -122.595, lat: 53.896 }
  const toBlock = viewBearing(
    { ...viewAtPoint(eye, block, []), facing: { kind: 'block' } },
    blockCentre(block.geometry),
  )!
  const base = {
    views: [] as ReturnType<typeof viewAtPoint>[],
    standingView: null,
    blocks: [block],
    lookAtTargetId: block.id,
    fallbackBlockId: null,
    focalMm: null,
    name: 'View from Hwy 16 going north',
  }

  it('lists a new view where the eye stands, facing the block it looks at', () => {
    const link = handSaveLink({ ...base, pose: { ...eye, bearing: toBlock } })
    expect(link.kind).toBe('add')
    if (link.kind !== 'add') return
    expect(link.view).toMatchObject({
      name: 'View from Hwy 16 going north',
      source: { kind: 'map' },
      lng: eye.lng,
      lat: eye.lat,
      blockId: block.id,
      facing: { kind: 'block' },
      focalMm: 50,
      framing: 'landform',
    })
  })

  it('faces the bearing it looks along when it is turned off the block, with the road view lens', () => {
    const link = handSaveLink({ ...base, focalMm: 35, pose: { ...eye, bearing: toBlock + 30 } })
    expect(link.kind === 'add' && link.view.facing).toEqual({
      kind: 'bearing',
      degrees: Math.round((toBlock + 30) * 10) / 10,
    })
    expect(link.kind === 'add' && link.view.focalMm).toBe(35)
  })

  it('is the capture of the view stood at while the road view faces its way, else a view of its own', () => {
    const stood = { ...viewAtPoint(eye, block, []), id: 'voi-stood' }
    const facing = handSaveLink({
      ...base,
      views: [stood],
      standingView: stood,
      pose: { ...eye, bearing: toBlock + 1 },
    })
    expect(facing).toEqual({ kind: 'update', view: stood })
    const turned = handSaveLink({
      ...base,
      views: [stood],
      standingView: stood,
      pose: { ...eye, bearing: toBlock + 40 },
    })
    expect(turned.kind).toBe('add')
  })

  it('joins a listed view it repeats, and names a new one apart from those listed', () => {
    const listed = { ...viewAtPoint(eye, block, []), id: 'voi-listed' }
    expect(handSaveLink({ ...base, views: [listed], pose: { ...eye, bearing: toBlock } })).toEqual({
      kind: 'update',
      view: listed,
    })
    const named = { ...listed, name: base.name, lng: eye.lng + 0.01 }
    const link = handSaveLink({ ...base, views: [named], pose: { ...eye, bearing: toBlock } })
    expect(link.kind === 'add' && link.view.name).toBe('View from Hwy 16 going north (2)')
  })

  it('is saved alone, with the reason, with no cutblock, no position or a full list', () => {
    expect(handSaveLink({ ...base, blocks: [], pose: { ...eye, bearing: 0 } }).kind).toBe('none')
    expect(handSaveLink({ ...base, pose: null }).kind).toBe('none')
    const full = Array.from({ length: MAX_VIEWS_OF_INTEREST }, (_, i) => ({
      ...viewAtPoint({ lng: eye.lng + 0.01 * (i + 1), lat: eye.lat }, block, []),
      id: `voi-${i}`,
    }))
    const link = handSaveLink({ ...base, views: full, pose: { ...eye, bearing: toBlock } })
    expect(link).toEqual({ kind: 'none', reason: expect.stringContaining(`hold ${MAX_VIEWS_OF_INTEREST}`) })
  })
})

describe('a view made from an accepted photo', () => {
  // A camera 1,200 m up, about 3 km west of Block A, looking east and down at it.
  const acceptance = (patch: Partial<PhotoAcceptance['pose']> = {}): PhotoAcceptance => ({
    acceptedBy: 'AB',
    acceptedAt: '2026-11-17T10:00:00Z',
    method: 'skyline',
    pose: { lng: -122.65, lat: 53.905, altitudeMeters: 1200, bearing: 92, pitch: -6, roll: 1.5, hfov: 54.4, ...patch },
    evidence: { settled: true },
    note: '',
  })
  const other = { ...block, id: 'block-2', name: 'Block B', geometry: { ...block.geometry } }
  // Block B lies well north of the camera, out of an east-looking frame.
  other.geometry = {
    type: 'Polygon',
    coordinates: [block.geometry.coordinates[0].map(([lng, lat]) => [lng - 0.05, lat + 0.1])],
  }
  const scene = (views: ViewOfInterest[] = []) => ({
    targets: [
      { ...other, role: 'block' },
      { ...block, role: 'block' },
    ],
    viewsOfInterest: views,
  })
  const record = { id: 'field-1', name: 'IMG_0412.HEIC', acceptance: acceptance() }

  it('stands at the camera, faces its heading with one frame of its lens, and links the photo', () => {
    const made = viewFromAcceptedPhoto(record, scene())
    expect(made.kind).toBe('add')
    const view = (made as { view: ViewOfInterest }).view
    expect(view).toMatchObject({
      name: 'Photo IMG_0412, toward Block A',
      source: { kind: 'map' },
      lng: -122.65,
      lat: 53.905,
      blockId: 'block-1',
      facing: { kind: 'bearing', degrees: 92 },
      framing: 'single',
      photo: { recordId: 'field-1', altitudeMeters: 1200, pitch: -6, roll: 1.5, hfov: 54.4 },
    })
    expect(lensHfovDeg(view.focalMm)).toBeCloseTo(54.4, 1)
    expect(focalForHfov(lensHfovDeg(35))).toBeCloseTo(35, 6)
    // A view stood at an altitude reads back with its photo, and an older reader's parts are all still there.
    expect(parseViewsOfInterest(JSON.parse(JSON.stringify([view])))).toEqual([view])
  })

  it('moves the view that already holds the photo, keeping its id, name and block', () => {
    const first = (viewFromAcceptedPhoto(record, scene()) as { view: ViewOfInterest }).view
    const listed = { ...first, name: 'Helicopter view' }
    const again = viewFromAcceptedPhoto(
      { ...record, acceptance: acceptance({ bearing: 95, pitch: -8 }) },
      scene([listed]),
    )
    expect(again.kind).toBe('update')
    expect((again as { view: ViewOfInterest }).view).toMatchObject({
      id: first.id,
      name: 'Helicopter view',
      facing: { kind: 'bearing', degrees: 95 },
      photo: { pitch: -8 },
    })
  })

  it('refuses a camera not accepted, moved since, with no cutblock, or a full list', () => {
    expect(viewFromAcceptedPhoto({ ...record, acceptance: null }, scene())).toMatchObject({ kind: 'none' })
    const moved = viewFromAcceptedPhoto(record, scene(), { ...acceptance().pose, bearing: 93 })
    expect(moved).toEqual({
      kind: 'none',
      reason: 'The camera has moved since it was accepted: check it and accept it again.',
    })
    expect(viewFromAcceptedPhoto(record, scene(), acceptance().pose).kind).toBe('add')
    expect(viewFromAcceptedPhoto(record, { targets: [] })).toMatchObject({ kind: 'none' })
    const full = Array.from({ length: MAX_VIEWS_OF_INTEREST }, (_, i) =>
      viewAtPoint({ lng: -122.7 - i * 0.01, lat: 53.9 }, block, []),
    )
    const refused = viewFromAcceptedPhoto(record, scene(full))
    expect(refused).toMatchObject({ kind: 'none' })
    expect((refused as { reason: string }).reason).toContain(`hold ${MAX_VIEWS_OF_INTEREST}`)
  })

  it('needs capturing again when the photo camera moves, and keeps every other view’s key', () => {
    const plain = viewAtPoint({ lng: -122.7, lat: 53.9 }, block, [])
    // The key a capture of a view without a photo was saved under before photos joined it.
    expect(viewCaptureKey(plain)).toBe(JSON.stringify([-122.7, 53.9, 'block-1', 'block', 50, 'landform', null]))
    const view = (viewFromAcceptedPhoto(record, scene()) as { view: ViewOfInterest }).view
    const saved = [{ id: 's1', plannedViewId: view.id, plannedKey: viewCaptureKey(view) }]
    expect(viewCaptureState(view, saved)).toBe('captured')
    const higher = { ...view, photo: { ...view.photo!, altitudeMeters: 1250, roll: 0 } }
    expect(viewCaptureState(higher, saved)).toBe('outdated')
    expect(captureKeyChanges(higher, saved)).toEqual(['altitude', 'roll'])
    // A view given a photo after it was captured names the photo camera's parts as changed.
    const plainSaved = [{ id: 's2', plannedViewId: plain.id, plannedKey: viewCaptureKey(plain) }]
    const linked = { ...plain, photo: view.photo }
    expect(captureKeyChanges(linked, plainSaved)).toEqual(['altitude', 'pitch', 'roll', 'lens'])
  })

  it('keeps a view whose photo link does not read, without the link', () => {
    const view = (viewFromAcceptedPhoto(record, scene()) as { view: ViewOfInterest }).view
    const [read] = parseViewsOfInterest([{ ...view, photo: { recordId: 'field-1', pitch: 'down' } }])
    expect(read.photo).toBeUndefined()
    expect(read.facing).toEqual(view.facing)
  })
})
