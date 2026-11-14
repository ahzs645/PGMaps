import { describe, expect, it } from 'vitest'
import { buildScenePackage } from './scenePackage'
import {
  SKYLINE_MAX_RADIUS_METERS,
  curvatureDrop,
  frameBearingRange,
  skylineReach,
  skylineTerrainRadius,
} from './skylineReach'
import type { ElevationSource } from './terrain'
import { metersPerDegree } from './visibility'

const EYE = { lng: -116.9, lat: 50.1, elevation: 501.5 }
const m = metersPerDegree(EYE.lat)
const local = (lng: number, lat: number) => ({ x: (lng - EYE.lng) * m.lng, y: (lat - EYE.lat) * m.lat })

/** A cone peak `height` metres above a 500 m plain, `radius` across its foot, centred `x`, `y` metres from the eye. */
const peak = (x: number, y: number, height: number, radius: number) => (lng: number, lat: number) => {
  const p = local(lng, lat)
  return Math.max(0, height * (1 - Math.hypot(p.x - x, p.y - y) / radius))
}

/**
 * A plain at 500 m with a near ridge 6 km north (1200 m) and, behind it to the north-east, a 2400 m peak 20 km off:
 * the scene at Lost Ledge, where a 15 km grid left out the peak standing over the landform.
 */
const near = peak(0, 6000, 700, 1500)
const far = peak(20_000 * Math.sin(Math.PI / 6), 20_000 * Math.cos(Math.PI / 6), 1900, 3000)
const terrain: ElevationSource = { elevationAt: (lng, lat) => 500 + Math.max(near(lng, lat), far(lng, lat)) }

describe('the skyline, bearing by bearing', () => {
  it('drops far ground by the curvature less standard refraction', () => {
    expect(curvatureDrop(0)).toBe(0)
    // 30 km: 70.6 m of curvature, 61.4 m after refraction.
    expect(curvatureDrop(30_000)).toBeCloseTo(61.45, 1)
    expect(curvatureDrop(30_000, 0)).toBeCloseTo(70.63, 1)
  })

  it('finds the near ridge where it hides everything, and the far peak where it stands over it', () => {
    const reach = skylineReach(terrain, EYE, [{ fromDegrees: 350, toDegrees: 40 }], { stepDegrees: 1 })
    const at = (bearing: number) => reach.rays.find((ray) => ray.bearingDegrees === bearing)!
    // Due north the near ridge's crest is the skyline.
    expect(at(0).distanceMeters).toBeGreaterThan(5800)
    expect(at(0).distanceMeters).toBeLessThan(6200)
    expect(at(0).groundElevationMeters).toBeGreaterThan(1150)
    // At 30° the far peak's summit, 20 km off.
    expect(at(30).distanceMeters).toBeGreaterThan(19_500)
    expect(at(30).distanceMeters).toBeLessThan(20_500)
    // Its summit's angle, within a sample step of the sharp cone's tip.
    const summit = (Math.atan((2400 - curvatureDrop(20_000) - EYE.elevation) / 20_000) * 180) / Math.PI
    expect(Math.abs(at(30).elevationAngleDegrees! - summit)).toBeLessThan(0.1)
    // The farthest skyline point is on the peak's flank or summit.
    expect(reach.farthestMeters).toBeGreaterThanOrEqual(at(30).distanceMeters!)
    expect(reach.farthestMeters).toBeLessThan(21_000)
    expect(Math.abs(reach.farthestBearingDegrees! - 30)).toBeLessThanOrEqual(2)
    expect(reach.reachesLimit).toBe(false)
    // Bearings from 350° through north to 40°, each degree once.
    expect(reach.rays).toHaveLength(51)
    expect(at(0).unknownMeters).toBe(0)
  })

  it('skips ground the source does not have, never reading it as sea level', () => {
    const holed: ElevationSource = {
      elevationAt: (lng, lat) => (local(lng, lat).y > 15_000 ? Number.NaN : terrain.elevationAt(lng, lat)),
    }
    const reach = skylineReach(holed, EYE, [{ fromDegrees: 30, toDegrees: 30 }])
    expect(reach.rays).toHaveLength(1)
    expect(reach.rays[0].distanceMeters).toBeLessThan(18_000)
    expect(reach.rays[0].unknownMeters).toBeGreaterThan(40_000)
  })

  it('says when the skyline may stand past the scan', () => {
    const reach = skylineReach(terrain, EYE, [{ fromDegrees: 30, toDegrees: 30 }], { maxDistanceMeters: 20_500 })
    expect(reach.reachesLimit).toBe(true)
  })
})

describe('the terrain a skyline needs', () => {
  it('reaches the farthest skyline point plus a margin, capped at 60 km', () => {
    expect(skylineTerrainRadius({ farthestMeters: 19_428, reachesLimit: false })).toEqual({
      radiusMeters: 22_000,
      spacingMeters: 88,
      clipped: false,
    })
    // A near skyline still takes 2 km.
    expect(skylineTerrainRadius({ farthestMeters: 11_289, reachesLimit: false }).radiusMeters).toBe(14_000)
    expect(skylineTerrainRadius({ farthestMeters: 58_000, reachesLimit: true })).toEqual({
      radiusMeters: SKYLINE_MAX_RADIUS_METERS,
      spacingMeters: 240,
      clipped: true,
    })
  })

  it('covers each frame’s bearings, wider at the corners of a pitched frame', () => {
    expect(frameBearingRange({ bearingDeg: 40, pitchDeg: 0, hfovDeg: 30, vfovDeg: 20 }, 0)).toEqual({
      fromDegrees: 25,
      toDegrees: 55,
    })
    const pitched = frameBearingRange({ bearingDeg: 5, pitchDeg: 10, hfovDeg: 30, vfovDeg: 20 }, 1)
    expect(pitched.fromDegrees).toBeLessThan(349)
    expect(pitched.fromDegrees).toBeGreaterThan(347)
    expect(pitched.toDegrees).toBeGreaterThan(21)
  })
})

describe('a scene package reaching the skyline', () => {
  const build = (skylineTerrainRadiusMeters?: number) =>
    buildScenePackage({
      eye: EYE,
      eyeHeightMeters: 1.5,
      bearingDegrees: 30,
      pitchDegrees: 0,
      verticalFovDegrees: 30,
      forest: { anchorLatitude: EYE.lat, stands: [], clearings: [], openings: [], standHeightMeters: 25 },
      elevation: terrain,
      treeRadiusMeters: 200,
      terrainRadiusMeters: 1000,
      terrainSpacingMeters: 100,
      farTerrainRadiusMeters: 15_000,
      farTerrainSpacingMeters: 1000,
      ...(skylineTerrainRadiusMeters ? { skylineTerrainRadiusMeters, skylineTerrainSpacingMeters: 2000 } : {}),
      includeModels: false,
    })

  it('carries a coarser, curvature-dropped grid out past the far terrain', () => {
    const scene = build(22_000)
    const grid = scene.skylineTerrain!
    expect(grid.spacing).toBe(2000)
    expect(grid.columns).toBe(23)
    expect(grid.west).toBe(-22_000)
    expect(grid.earthCurvature).toEqual({ earthRadiusMeters: 6_371_000, refraction: 0.13 })
    // The post 20 km east of the eye stands on the plain, dropped by the curvature there.
    const east = grid.heights[11 * grid.columns + 21]
    expect(east).toBeCloseTo(500 - curvatureDrop(20_000), 1)
    // The far terrain inside it keeps its heights as read.
    const farGrid = scene.farTerrain!
    expect(farGrid.heights[15 * farGrid.columns + 29]).toBe(500)
  })

  it('carries none when the skyline stands inside the far terrain', () => {
    expect(build().skylineTerrain).toBeUndefined()
    expect(build(14_000).skylineTerrain).toBeUndefined()
  })
})
