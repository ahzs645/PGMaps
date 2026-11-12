import { describe, expect, it } from 'vitest'
import { canvasWindow, focalForHfov, HFOV_50_MM, landformAngularExtent, planFraming } from './figureFraming'
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
