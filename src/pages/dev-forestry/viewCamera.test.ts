import { describe, expect, it } from 'vitest'

import { parseProject, serializeProject, type ProjectState } from './projectFile'
import { createEmptyScene, type ForestryScene } from './scene'
import {
  EYE_GROUND_TOLERANCE_METERS,
  equivalentFocalMm,
  eyeCheck,
  eyeCheckText,
  fieldsOfView,
  focalForHfov,
  lensEntryHfov,
  lensEntryLabel,
  lensEntryProblem,
  lensHfovDeg,
  parseViewEye,
  parseViewLens,
  viewCaptureCamera,
  viewEyeProblem,
} from './viewCamera'
import { readPlaceInput } from './viewCoordinates'
import { viewLensHfov } from './viewCapturePlan'
import {
  captureKeyChanges,
  groupByPlace,
  parseViewsOfInterest,
  viewCaptureKey,
  type ViewOfInterest,
} from './viewsOfInterest'

// A made-up view: a frame of about 80 mm equivalent (25.4° across) from an eye surveyed below the model's ground.
const view = (patch: Partial<ViewOfInterest> = {}): ViewOfInterest => ({
  id: 'voi-a',
  name: 'Lookout A, toward Block 1',
  source: { kind: 'map' },
  lng: -122.71234,
  lat: 53.91234,
  blockId: 'block-1',
  facing: { kind: 'bearing', degrees: 245 },
  focalMm: 50,
  framing: 'single',
  ...patch,
})

describe('a view’s lens as entered', () => {
  it('gives the exact field across for a field entered as one', () => {
    const lens = { kind: 'hfov', hfovDeg: 25.4 } as const
    expect(lensEntryHfov(lens)).toBe(25.4)
    expect(equivalentFocalMm(lens)).toBeCloseTo(focalForHfov(25.4), 12)
    expect(lensHfovDeg(equivalentFocalMm(lens))).toBeCloseTo(25.4, 10)
    expect(lensEntryLabel(lens)).toBe('25.4° across, as entered (79.9 mm full-frame equivalent)')
  })

  it('takes a focal length on a cropped sensor to its full-frame equivalent', () => {
    const lens = { kind: 'focal', focalMm: 50, cropFactor: 1.6 } as const
    expect(equivalentFocalMm(lens)).toBeCloseTo(80, 12)
    expect(lensEntryHfov(lens)).toBeCloseTo(lensHfovDeg(80), 12)
    expect(lensEntryLabel(lens)).toBe('50 mm × 1.6 crop: 80 mm equivalent, 25.4° across')
    expect(lensEntryLabel({ kind: 'focal', focalMm: 80, cropFactor: 1 })).toBe('80 mm (35 mm equivalent), 25.4° across')
  })

  it('shows both fields for the canvas', () => {
    const { vfovDeg } = fieldsOfView(25.4, 1500, 1000)
    expect(vfovDeg).toBeCloseTo((2 * Math.atan(Math.tan((12.7 * Math.PI) / 180) * (2 / 3)) * 180) / Math.PI, 10)
  })

  it('refuses a lens the road view cannot hold, and drops one that does not read', () => {
    expect(lensEntryProblem({ kind: 'hfov', hfovDeg: 2 })).toMatch(/10 to 300 mm/)
    expect(lensEntryProblem({ kind: 'focal', focalMm: 50, cropFactor: 20 })).toMatch(/crop factor/)
    expect(lensEntryProblem({ kind: 'focal', focalMm: 0, cropFactor: 1 })).toMatch(/more than 0/)
    expect(parseViewLens({ kind: 'hfov', hfovDeg: 170 })).toBeNull()
    expect(parseViewLens({ kind: 'zoom' })).toBeNull()
  })
})

describe('a view’s surveyed eye', () => {
  it('flags, never refuses, a surveyed elevation away from the terrain model’s eye', () => {
    const eye = { reference: 'elevation', meters: 812 } as const
    const check = eyeCheck(eye, 820.4, 1.6)!
    expect(check.differenceMeters).toBeCloseTo(-10, 9)
    expect(check.flagged).toBe(true)
    expect(check.belowGround).toBe(true)
    expect(eyeCheckText(check)).toBe(
      "Surveyed eye 812.0 m is 10.0 m below the terrain model's eye (820.4 m ground + 1.6 m), under the model’s ground, which hides what it sees.",
    )
    const close = eyeCheck(eye, 812 - 1.6 + EYE_GROUND_TOLERANCE_METERS - 0.1, 1.6)!
    expect(close.flagged).toBe(false)
    expect(eyeCheck(eye, null, 1.6)).toBeNull()
    expect(eyeCheck({ reference: 'ground', meters: 3 }, 820, 1.6)).toBeNull()
  })

  it('reads only plausible eyes', () => {
    expect(viewEyeProblem({ reference: 'elevation', meters: 9500 })).not.toBeNull()
    expect(viewEyeProblem({ reference: 'ground', meters: 0 })).not.toBeNull()
    expect(parseViewEye({ reference: 'ground', meters: 3 })).toEqual({ reference: 'ground', meters: 3 })
    expect(parseViewEye({ reference: 'sea', meters: 3 })).toBeNull()
  })

  it('stands the capture on the eye: an elevation for the stand, a height for the road view', () => {
    expect(viewCaptureCamera(view({ eye: { reference: 'elevation', meters: 812 } }))).toMatchObject({
      surveyedEyeMeters: 812,
      eyeHeightMeters: null,
    })
    expect(viewCaptureCamera(view({ eye: { reference: 'ground', meters: 3 } }))).toMatchObject({
      surveyedEyeMeters: null,
      eyeHeightMeters: 3,
    })
    // A photo viewpoint's camera is its photo's.
    const photo = { recordId: 'r', altitudeMeters: 1200, pitch: -6, roll: 0, hfov: 52.3 }
    expect(viewCaptureCamera(view({ photo, eye: { reference: 'ground', meters: 3 } }))).toEqual({
      hfovDeg: 52.3,
      focalMm: 50,
      surveyedEyeMeters: 1200,
      eyeHeightMeters: null,
    })
  })

  it('stales the capture, names what changed and keeps eyes apart as stands', () => {
    const plain = view()
    const surveyed = view({ eye: { reference: 'elevation', meters: 812 } })
    expect(viewCaptureKey(plain)).not.toBe(viewCaptureKey(surveyed))
    const saved = [{ id: 's', plannedViewId: plain.id, plannedKey: viewCaptureKey(plain) }]
    expect(captureKeyChanges(surveyed, saved)).toEqual(['eye'])
    const lensed = { ...surveyed, lens: { kind: 'hfov', hfovDeg: 25.4 } as const, focalMm: focalForHfov(25.4) }
    expect(captureKeyChanges(lensed, saved)).toEqual(['lens', 'eye'])
    expect(groupByPlace([plain, { ...surveyed, id: 'voi-b' }])).toHaveLength(2)
  })
})

describe('a planned view with its own lens and surveyed eye', () => {
  it('survives the project file and gives the same camera for its capture', async () => {
    const lens = { kind: 'hfov', hfovDeg: 25.4 } as const
    const { entry: place } = readPlaceInput({
      system: 'utm',
      datum: 'NAD83',
      zone: 10,
      easting: '512345.6',
      northing: '5973210.4',
    })
    const planned = view({
      lng: place!.lng,
      lat: place!.lat,
      place,
      lens,
      focalMm: equivalentFocalMm(lens),
      eye: { reference: 'elevation', meters: 812.4 },
    })
    const scene: ForestryScene = { ...createEmptyScene(), viewsOfInterest: [planned] }
    const state: ProjectState = {
      scene,
      views: [],
      shelved: [],
      images: {},
      capturedBefore: {},
      engineFigures: {},
      workspace: null,
      pkg: { renderer: null, recipeId: null },
    }
    const { state: opened } = await parseProject(await serializeProject(state))
    const back = opened.scene.viewsOfInterest?.[0]
    expect(back).toEqual(planned)
    expect(viewCaptureCamera(back!)).toEqual(viewCaptureCamera(planned))
    expect(viewCaptureCamera(back!).hfovDeg).toBe(25.4)
    expect(viewLensHfov(back!)).toBe(25.4)
    expect(viewCaptureKey(back!)).toBe(viewCaptureKey(planned))
  })

  it('reads an older view with none of them as it always has', () => {
    const [older] = parseViewsOfInterest([{ ...view(), focalMm: 35 }])
    expect(older).toEqual(view({ focalMm: 35 }))
    expect(viewCaptureCamera(older)).toEqual({
      hfovDeg: lensHfovDeg(35),
      focalMm: 35,
      surveyedEyeMeters: null,
      eyeHeightMeters: null,
    })
    // A lens that does not read leaves the stored focal length.
    const [kept] = parseViewsOfInterest([{ ...view(), focalMm: 28, lens: { kind: 'hfov', hfovDeg: 'wide' } }])
    expect(kept.focalMm).toBe(28)
    expect(kept.lens).toBeUndefined()
  })
})
