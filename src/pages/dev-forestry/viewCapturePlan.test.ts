import { describe, expect, it } from 'vitest'

import { HFOV_50_MM, type AngularExtent } from './figureFraming'
import { verticalFovFromHorizontal } from './exifPose'
import {
  captureMessage,
  captureSummary,
  captureWaitingFor,
  figurePlanFor,
  lensApplied,
  placeNameFromView,
  planSingleFrame,
  planCapture,
  standFacing,
  standPlace,
  waitFailure,
  withoutPlannedView,
  type CaptureFacts,
  type CaptureWant,
} from './viewCapturePlan'
import { lensHfovDeg, type ViewOfInterest } from './viewsOfInterest'

const view = (id: string, patch: Partial<ViewOfInterest> = {}): ViewOfInterest => ({
  id,
  name: 'VLI 144, arrow 1',
  source: { kind: 'vli', key: 'vli:144' },
  lng: -122.65,
  lat: 53.905,
  blockId: 'block-1',
  facing: { kind: 'block' },
  focalMm: 50,
  framing: 'landform',
  ...patch,
})

describe('planning a capture', () => {
  it('groups the requested views by place in list order and names the ones no longer listed', () => {
    const views = [
      view('a'),
      view('b', { lng: -122.7, source: { kind: 'map' }, name: 'Viewpoint 1, toward Block A' }),
      view('c', { facing: { kind: 'bearing', degrees: 80 } }),
    ]
    const { places, missing } = planCapture(views, ['c', 'b', 'a', 'gone'])
    expect(places.map((place) => place.views.map((entry) => entry.id))).toEqual([['a', 'c'], ['b']])
    expect(missing).toEqual(['gone'])
  })

  it('stands an inventory view at its candidate and a map view at its coordinates', () => {
    expect(standPlace(view('a'), 'VLI 144')).toEqual({ key: 'vli:144', name: 'VLI 144' })
    expect(standPlace(view('a'))).toEqual({ key: 'vli:144', name: 'VLI 144' })
    const map = view('m', { source: { kind: 'map' }, name: 'Viewpoint 2, toward Block A' })
    expect(standPlace(map)).toEqual({ key: 'map--122.650000,53.905000', name: 'Viewpoint 2' })
    expect(placeNameFromView('Lookout over the lake')).toBe('Lookout over the lake')
  })

  it('faces the block, or the bearing in [0, 360)', () => {
    expect(standFacing(view('a'))).toEqual({ lookAtTargetId: 'block-1', lookBearing: null })
    expect(standFacing(view('a', { facing: { kind: 'bearing', degrees: -15 } }))).toEqual({
      lookAtTargetId: null,
      lookBearing: 345,
    })
  })
})

const ready: CaptureFacts = {
  key: 'k1',
  runFresh: true,
  runRunning: false,
  runError: null,
  roadViewOpen: true,
  canSave: true,
  lookAtTargetId: null,
  lookBearing: 245,
  poseBearing: 245.4,
  blockBearing: null,
  lensMm: 35,
  lensApplied: true,
}
const want: CaptureWant = { key: 'k1', lookAtTargetId: null, lookBearing: 245, lensMm: 35 }

describe('waiting for the road view', () => {
  it('saves once the run, the road view, the facing, the lens and the timber are ready', () => {
    expect(captureWaitingFor(ready, want)).toBeNull()
  })

  it('waits on each in turn', () => {
    expect(captureWaitingFor({ ...ready, key: 'k0' }, want)).toBe('run')
    expect(captureWaitingFor({ ...ready, runFresh: false }, want)).toBe('run')
    expect(captureWaitingFor({ ...ready, roadViewOpen: false }, want)).toBe('road view')
    expect(captureWaitingFor({ ...ready, lookBearing: 200 }, want)).toBe('facing')
    expect(captureWaitingFor({ ...ready, lensMm: 50 }, want)).toBe('lens')
    expect(captureWaitingFor({ ...ready, lensApplied: false }, want)).toBe('lens')
    expect(captureWaitingFor({ ...ready, poseBearing: 250 }, want)).toBe('facing')
    expect(captureWaitingFor({ ...ready, canSave: false }, want)).toBe('timber')
  })

  it('checks a block facing against the bearing to the block from the camera', () => {
    const block: CaptureWant = { ...want, lookAtTargetId: 'block-1', lookBearing: null }
    const facts = { ...ready, lookAtTargetId: 'block-1', lookBearing: null, poseBearing: 359.6, blockBearing: 0.2 }
    expect(captureWaitingFor(facts, block)).toBeNull()
    expect(captureWaitingFor({ ...facts, blockBearing: 10 }, block)).toBe('facing')
    expect(captureWaitingFor({ ...facts, blockBearing: null }, block)).toBe('facing')
  })

  it('says why in plain words', () => {
    expect(waitFailure('run', { ...ready, runError: 'No terrain.' })).toBe('The run for this place failed: No terrain.')
    expect(waitFailure('run', ready)).toBe('The run for this place did not finish within 5 minutes.')
    expect(waitFailure('timber', ready)).toMatch(/drawn timber did not finish loading within 2 minutes/)
    expect(captureMessage(1, 5, 'VLI 144, arrow 1')).toBe('Capturing 2 of 5: VLI 144, arrow 1…')
    expect(captureSummary(4, 5, 1, false)).toBe('Captured 4 of 5 views; 1 could not be captured.')
    expect(captureSummary(1, 1, 0, false)).toBe('Captured 1 of 1 view.')
    expect(captureSummary(2, 5, 0, true)).toBe('Captured 2 of 5 views; cancelled.')
  })

  it('reads a lens as applied once the eye map shows its field across the canvas', () => {
    const vertical = verticalFovFromHorizontal(lensHfovDeg(35), 1200, 800)
    expect(lensApplied(35, { verticalFovDeg: vertical, width: 1200, height: 800 })).toBe(true)
    expect(lensApplied(35, { verticalFovDeg: 36.87, width: 1200, height: 800 })).toBe(false)
    expect(lensApplied(35, null)).toBe(false)
    expect(lensApplied(null, null)).toBe(true)
  })
})

describe('replacing a recaptured view', () => {
  it('removes its earlier saves here and wherever they were shelved, and drops emptied places', () => {
    const saved = [{ id: 's1', plannedViewId: 'a' }, { id: 's2' }]
    const shelved = [
      { key: 'k0', views: [{ id: 's3', plannedViewId: 'a' }] },
      {
        key: 'k2',
        views: [
          { id: 's4', plannedViewId: 'b' },
          { id: 's5', plannedViewId: 'a' },
        ],
      },
    ]
    const result = withoutPlannedView(saved, shelved, 'a')
    expect(result.saved.map((entry) => entry.id)).toEqual(['s2'])
    expect(result.shelved).toEqual([{ key: 'k2', views: [{ id: 's4', plannedViewId: 'b' }] }])
    expect(result.removed).toEqual(['s1', 's3', 's5'])
  })
})

describe('framing a saved view with its lens', () => {
  const extent: AngularExtent = {
    azLeftDeg: 80,
    azRightDeg: 100,
    elTopDeg: 3,
    elBottomDeg: -1,
  } as AngularExtent
  const pose = { bearing: 250 }

  it('frames the landform with 50 mm by default, and with the saved lens or the photo when given', () => {
    expect(figurePlanFor({ photoHfov: null, pose }, extent, null)!.frames[0].hfovDeg).toBeCloseTo(HFOV_50_MM, 6)
    expect(figurePlanFor({ photoHfov: null, lensHfov: 60, pose }, extent, null)!.frames[0].hfovDeg).toBe(60)
    expect(figurePlanFor({ photoHfov: 45, lensHfov: 60, pose }, extent, null)!.frames[0].hfovDeg).toBe(45)
  })

  it('takes one frame of the lens centred on the facing for a single framing, over the scene’s fixed frame', () => {
    const lens = lensHfovDeg(35)
    const plan = figurePlanFor({ photoHfov: null, lensHfov: lens, framing: 'single', pose }, extent, {
      bearingDeg: 90,
      spanDeg: 30,
    })!
    expect(plan.frames).toHaveLength(1)
    expect(plan.frames[0].bearingDeg).toBeCloseTo(250, 6)
    expect(plan.totalHfovDeg).toBeCloseTo(lens, 6)
  })

  it('draws a wide lens as one 3:2 frame, never a tiled panorama', () => {
    const lens = lensHfovDeg(24)
    const plan = planSingleFrame(10, lens, null)
    expect(plan.frames).toHaveLength(1)
    expect(plan.frames[0].pitchDeg).toBe(0)
    expect(Math.tan((plan.vfovDeg * Math.PI) / 360) / Math.tan((lens * Math.PI) / 360)).toBeCloseTo(2 / 3, 9)
    expect(plan.label).toBe('single frame: 24 mm full-frame equivalent, 73.7° across, facing 10°')
  })

  it('keeps the scene’s fixed frame for a landform framing, and nothing to frame without an extent', () => {
    const fixed = figurePlanFor({ photoHfov: null, lensHfov: 60, pose }, extent, { bearingDeg: 90, spanDeg: 30 })!
    expect(fixed.totalHfovDeg).toBeCloseTo(30, 6)
    expect(figurePlanFor({ photoHfov: null, pose }, null, null)).toBeNull()
  })
})
