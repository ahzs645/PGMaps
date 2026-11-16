import { describe, expect, it } from 'vitest'
import {
  canvasWindow,
  focalForHfov,
  HFOV_50_MM,
  landformAngularExtent,
  planFraming,
  parseFigureFrame,
  planFixedFraming,
  panoramaBand,
  savedFigureFraming,
  terrainDetailNote,
} from './figureFraming'
import { metersPerDegree } from './visibility'

const EYE = { lng: -122.6, lat: 53.9 }
const m = metersPerDegree(EYE.lat)
const at = (east: number, north: number): [number, number] => [EYE.lng + east / m.lng, EYE.lat + north / m.lat]

describe('framing a landform', () => {
  it('names the lens: a 50 mm frame is 39.6° across', () => {
    expect(HFOV_50_MM).toBeCloseTo(39.6, 1)
    expect(focalForHfov(HFOV_50_MM)).toBeCloseTo(50)
  })

  it('reads the visible landform’s bearings and elevation angles from the eye', () => {
    // A hillside rising east of the eye from 2 km to 4 km out, flat elsewhere at 500 m.
    const source = {
      elevationAt: (lng: number, lat: number) => {
        const x = (lng - EYE.lng) * m.lng
        void lat
        return x < 2000 ? 500 : 500 + (x - 2000) * 0.4
      },
    }
    const landform: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[at(2000, -1000), at(4000, -1000), at(4000, 1000), at(2000, 1000), at(2000, -1000)]],
    }
    const extent = landformAngularExtent(source, { ...EYE, elevation: 502 }, landform)!
    expect(extent.visibleBins).toBeGreaterThan(100)
    // About 90° ± atan(1/2), and from the hill's toe (just under level) up to its crest.
    expect(extent.azLeftDeg).toBeGreaterThan(55)
    expect(extent.azRightDeg).toBeLessThan(125)
    expect(extent.elBottomDeg).toBeLessThan(1)
    expect(extent.elTopDeg).toBeGreaterThan(8)
    // Nothing of it in view behind a wall.
    const walled = {
      elevationAt: (lng: number) => ((lng - EYE.lng) * m.lng < 100 && (lng - EYE.lng) * m.lng > 0 ? 9000 : 500),
    }
    expect(landformAngularExtent(walled, { ...EYE, elevation: 502 }, landform)).toBeNull()
  })

  it('frames a narrow landform in one 50 mm frame with sky above and little ground below', () => {
    const plan = planFraming({ azLeftDeg: 100, azRightDeg: 120, elBottomDeg: 0, elTopDeg: 6, visibleBins: 1 })
    expect(plan.frames).toHaveLength(1)
    expect(plan.frames[0].hfovDeg).toBeCloseTo(HFOV_50_MM)
    expect(plan.frames[0].bearingDeg).toBeCloseTo(110)
    expect(plan.shares.sky).toBeGreaterThanOrEqual(0.15)
    expect(plan.shares.ground).toBeLessThanOrEqual(0.15)
    // The landform's middle sits in the frame's middle third.
    const centre = (plan.frames[0].pitchDeg - (0 + 6) / 2) / plan.vfovDeg
    expect(Math.abs(centre)).toBeLessThan(1 / 6)
    expect(plan.label).toMatch(/^50 mm/)
  })

  it('covers a wide landform with several frames across its bearings, across north too', () => {
    const plan = planFraming({ azLeftDeg: 330, azRightDeg: 430, elBottomDeg: 1, elTopDeg: 4, visibleBins: 1 })
    expect(plan.frames).toHaveLength(3)
    expect(plan.totalHfovDeg).toBeGreaterThanOrEqual(105)
    expect(plan.frames[1].bearingDeg).toBeCloseTo(20, 0)
    expect(plan.label).toMatch(/3 frames of 50 mm/)
    expect(
      planFraming({ azLeftDeg: 0, azRightDeg: 300, elBottomDeg: 0, elTopDeg: 2, visibleBins: 1 }).frames,
    ).toHaveLength(4)
  })

  it('takes a field photo’s lens', () => {
    const plan = planFraming(
      { azLeftDeg: 0, azRightDeg: 20, elBottomDeg: 0, elTopDeg: 3, visibleBins: 1 },
      { lensHfovDeg: 65 },
    )
    expect(plan.frames[0].hfovDeg).toBe(65)
    expect(plan.label).toMatch(/^28 mm/)
  })

  it('crops the canvas to the frame without stretching it', () => {
    const frame = { bearingDeg: 0, pitchDeg: 2, hfovDeg: 40, vfovDeg: 16 }
    const square = canvasWindow(frame, 1)
    // A square canvas 40° across is 40° tall: crop the height.
    expect(square.verticalFovDeg).toBeCloseTo(40)
    expect(square.crop.width).toBeCloseTo(1)
    expect(square.crop.height).toBeLessThan(0.5)
    const wide = canvasWindow({ ...frame, vfovDeg: 30 }, 3)
    // A 3:1 canvas 40° across is too short: draw it taller and crop the width.
    expect(wide.crop.height).toBeCloseTo(1)
    expect(wide.crop.width).toBeLessThan(1)
  })

  it('draws through a wider field when asked, cropping the same pinhole window from it', () => {
    const frame = { bearingDeg: 0, pitchDeg: 0, hfovDeg: 27.1, vfovDeg: 30.13 }
    const plain = canvasWindow(frame, 1.04)
    const wide = canvasWindow(frame, 1.04, 75)
    expect(wide.verticalFovDeg).toBeCloseTo(75)
    // The window's half-angles are the frame's own either way: tan(half field) × crop share.
    const tan = (deg: number) => Math.tan((deg * Math.PI) / 360)
    for (const w of [plain, wide]) {
      expect(tan(w.verticalFovDeg) * w.crop.height).toBeCloseTo(tan(frame.vfovDeg), 9)
      expect(tan(w.verticalFovDeg) * 1.04 * w.crop.width).toBeCloseTo(tan(frame.hfovDeg), 9)
    }
    // A field already wider than the minimum is left alone.
    expect(canvasWindow(frame, 1.04, 10)).toEqual(plain)
  })
})

describe('projecting into a framed capture', () => {
  it('puts a point straight ahead in the middle, and one to the right of it to the right', async () => {
    const { projectToFrame, projectToFrames } = await import('./figureFraming')
    const frame = { bearingDeg: 90, pitchDeg: 0, hfovDeg: 40, vfovDeg: 20 }
    const eye = { ...EYE, elevation: 500 }
    const project = projectToFrame(frame, eye, { width: 400, height: 200 })
    const [x, y] = project(...at(1000, 0), 500)!
    expect(x).toBeCloseTo(200)
    expect(y).toBeCloseTo(100)
    // 10° to the right of the bearing: tan(10°)/tan(20°) of the half-width.
    const [x2] = project(...at(1000, -1000 * Math.tan((10 * Math.PI) / 180)), 500)!
    expect(x2).toBeCloseTo(200 + 200 * (Math.tan((10 * Math.PI) / 180) / Math.tan((20 * Math.PI) / 180)), 0)
    // Up is up the picture.
    expect(project(...at(1000, 0), 550)![1]).toBeLessThan(100)
    expect(project(...at(-1000, 0), 500)).toBeNull()
    // Two frames side by side: a point in the second is shifted by a frame's width.
    const both = projectToFrames([frame, { ...frame, bearingDeg: 130 }], eye, { frameWidth: 400, height: 200 })
    const [bx] = both(...at(1000 * Math.sin((130 * Math.PI) / 180), 1000 * Math.cos((130 * Math.PI) / 180)), 500)!
    expect(bx).toBeCloseTo(600, 0)
  })
})

describe('a fixed frame, as a reference panorama was taken', () => {
  it('tiles the span exactly with frames of at most 40°, centred on the bearing', () => {
    const plan = planFixedFraming({ bearingDeg: 44, spanDeg: 111, pitchDeg: 1.4, vfovDeg: 30 }, null)
    expect(plan.frames).toHaveLength(3)
    expect(plan.frames.every((frame) => Math.abs(frame.hfovDeg - 37) < 1e-9)).toBe(true)
    expect(plan.frames[0].bearingDeg).toBeCloseTo(44 - 37, 9)
    expect(plan.frames[2].bearingDeg).toBeCloseTo(44 + 37, 9)
    expect(plan.totalHfovDeg).toBe(111)
    expect(plan.frames.every((frame) => frame.pitchDeg === 1.4 && frame.vfovDeg === 30)).toBe(true)
    expect(plan.label).toMatch(/^fixed frame: 3 frames/)
    // Across north.
    const north = planFixedFraming({ bearingDeg: 5, spanDeg: 30 }, null)
    expect(north.frames[0].bearingDeg).toBeCloseTo(5, 9)
  })

  it('takes the vertical window from the landform when the frame gives none, keeping the water below it', () => {
    const plan = planFixedFraming(
      { bearingDeg: 18, spanDeg: 60 },
      { azLeftDeg: 0, azRightDeg: 40, elTopDeg: 3, elBottomDeg: -1, visibleBins: 10 },
    )
    expect(plan.vfovDeg).toBeCloseTo(20, 9)
    expect(plan.shares.ground).toBeGreaterThan(0.25)
  })

  it('says when the landform in view runs past the frame, across north too', () => {
    const extent = (azLeftDeg: number, azRightDeg: number) => ({
      azLeftDeg,
      azRightDeg,
      elTopDeg: 3,
      elBottomDeg: -1,
      visibleBins: 10,
    })
    // Marblehead VP1: an 80 mm frame facing north on a landform seen from 300° to 355°.
    expect(planFixedFraming({ bearingDeg: 0, spanDeg: 25.4 }, extent(300, 355)).label).toMatch(
      /from 347° to 13°; the landform is in view from 300° to 355°, wider than the frame/,
    )
    expect(planFixedFraming({ bearingDeg: 0, spanDeg: 25.4 }, extent(350, 370)).label).not.toMatch(/wider/)
    expect(planFixedFraming({ bearingDeg: 18, spanDeg: 60 }, extent(0, 40)).label).not.toMatch(/wider/)
    expect(planFixedFraming({ bearingDeg: 18, spanDeg: 60 }, extent(0, 60)).label).toMatch(/in view from 0° to 60°/)
  })

  it('reads only a sensible frame', () => {
    expect(parseFigureFrame({ bearingDeg: -10, spanDeg: 60, pitchDeg: 2 })).toEqual({
      bearingDeg: 350,
      spanDeg: 60,
      pitchDeg: 2,
    })
    expect(parseFigureFrame({ bearingDeg: 10, spanDeg: 200 })).toBeNull()
    expect(parseFigureFrame({ bearingDeg: 10 })).toBeNull()
    expect(parseFigureFrame(null)).toBeNull()
  })
})

describe('panoramaBand', () => {
  it('takes a band at least minAspect wide round the landform rows, kept inside the picture', () => {
    // 2400 x 2769 portrait, landform rows 1500-1700: a 1000-row band centred on them.
    expect(panoramaBand({ y: 1500, height: 200 }, 2400, 2769, 2.4)).toEqual({ y: 1100, height: 1000 })
    // Near the bottom: clamped to the picture.
    expect(panoramaBand({ y: 2600, height: 150 }, 2400, 2769, 2.4)).toEqual({ y: 1769, height: 1000 })
    // A landform taller than the band is cut, not the panorama narrowed: the band stays on its middle.
    expect(panoramaBand({ y: 200, height: 1200 }, 2400, 2769, 2.4)).toEqual({ y: 300, height: 1000 })
    // Already wide, or no rows: no crop.
    expect(panoramaBand({ y: 100, height: 100 }, 2400, 800, 2.4)).toBeNull()
    expect(panoramaBand(null, 2400, 2769, 2.4)).toBeNull()
  })

  it('keeps the blocks’ rows, moving off the landform’s middle only as far as they need (26, VP1)', () => {
    // Hwy 31's render: 2400 x 2867, the landform 513-2106 (taller than a 2.4:1 band), its blocks' marks 1122-1794.
    const landform = { y: 513, height: 1593 }
    const band = panoramaBand(landform, 2400, 2867, 2.4, { y: 1122, height: 672 })!
    expect(band.height).toBe(1000)
    expect(band.y).toBeLessThanOrEqual(1122)
    expect(band.y + band.height).toBeGreaterThanOrEqual(1794)
    // Centred on the landform (1309.5) the band would end at 1810: inside, so it stays there.
    expect(band).toEqual({ y: 810, height: 1000 })
    // Blocks lower down move it down, just far enough.
    expect(panoramaBand(landform, 2400, 2867, 2.4, { y: 1700, height: 500 })).toEqual({ y: 1200, height: 1000 })
    // Blocks spread over more rows than the aspect allows: the band takes them all and is narrower than 2.4:1.
    expect(panoramaBand(landform, 2400, 2867, 2.4, { y: 600, height: 1400 })).toEqual({ y: 600, height: 1400 })
  })
})

describe('a saved view drawn again', () => {
  it('keeps the frame and landform it was saved with, whatever scene is open by then', () => {
    const open = { figureFrame: { bearingDeg: 200, spanDeg: 60 }, landform: 'landform at the last viewpoint' }
    const first = { figureFrame: { bearingDeg: 12.5, spanDeg: 115 }, landform: 'landform at the first viewpoint' }
    expect(savedFigureFraming(first, open)).toEqual(first)
    // Saved framed on its landform (no fixed frame): it stays so, and is not given the open scene's frame.
    expect(savedFigureFraming({ figureFrame: null, landform: null }, open)).toEqual({
      figureFrame: null,
      landform: null,
    })
    // Saved before these were kept: the open scene's.
    expect(savedFigureFraming({}, open)).toEqual(open)
  })
})

describe('the terrain detail note', () => {
  it('says the picture drew the ground coarser than the run only when it did, by two zoom levels or more', () => {
    // Argenta Beach: the blocks drawn from z10 cells (98 m), the run on z13 (12 m).
    expect(terrainDetailNote({ drawnCellMeters: 97.7, runCellMeters: 12.2 })).toBe(
      'The map draws the ground at the blocks from 98 m elevation cells and the sightline run from 12 m cells, so rises and hollows smaller than that can hide ground in one figure and not the other.',
    )
    expect(terrainDetailNote({ drawnCellMeters: 48.8, runCellMeters: 12.2 })).not.toBeNull()
    // One zoom level apart, or the same: no note.
    expect(terrainDetailNote({ drawnCellMeters: 24.4, runCellMeters: 12.2 })).toBeNull()
    expect(terrainDetailNote({ drawnCellMeters: 12.2, runCellMeters: 12.2 })).toBeNull()
    expect(terrainDetailNote(null)).toBeNull()
    expect(terrainDetailNote({ drawnCellMeters: NaN, runCellMeters: 12.2 })).toBeNull()
  })
})
