import { describe, expect, it } from 'vitest'
import { roofCentre, sceneOffset, SOURCE_MIN_ELEVATION, type RoofFeature } from './roofInspection'

describe('roof focus and local viewing elevation', () => {
  it('centres a candidate on its WGS84 bounds and tolerates polygon holes', () => {
    const feature = {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123, 53],
            [-122, 53],
            [-122, 54],
            [-123, 54],
            [-123, 53],
          ],
          [
            [-122.8, 53.2],
            [-122.7, 53.2],
            [-122.7, 53.3],
            [-122.8, 53.2],
          ],
        ],
      },
    } as unknown as RoofFeature
    expect(roofCentre(feature)).toEqual([-122.5, 53.5])
  })
  it('puts local ground at scene zero while retaining the roof height and can restore the whole-tile origin', () => {
    const localGround = 762.82
    const roofElevation = localGround + 17.05
    expect(localGround + sceneOffset(localGround)).toBe(0)
    expect(roofElevation + sceneOffset(localGround)).toBeCloseTo(17.05)
    expect(sceneOffset(null)).toBe(-SOURCE_MIN_ELEVATION)
    expect(sceneOffset(NaN)).toBe(-SOURCE_MIN_ELEVATION)
  })
})
