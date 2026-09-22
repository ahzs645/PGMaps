import { describe, expect, it } from 'vitest'
import { createRoadsideDriveScene, roadsideDriveCue } from './driveScenario'
import { roadPath, roadPlacement } from './driveMath'
import { forestBands, forestPatches, growForestPatch } from './forestPatches'
import { bufferLine } from './forest'
import { pointInPolygon, polygonAreaMeters } from './visibility'

describe('roadside harvest comparison', () => {
  it('places the hypothetical opening beside the middle of the road, with screened approach and exit', () => {
    const scene = createRoadsideDriveScene()
    const road = roadPath(scene.viewpoint.coordinates)
    expect(road.at(-1)!.distanceAlongMeters).toBeCloseTo(1200, -1)
    const block = scene.targets.find((t) => t.role === 'block')!
    expect(polygonAreaMeters(block.geometry) / 10000).toBeCloseTo(11.5, 1)
    for (let distance = 0; distance <= 1200; distance += 25) {
      const eye = roadPlacement(road, distance)!
      expect(pointInPolygon(block.geometry, eye.lng, eye.lat)).toBe(false)
    }
    expect(roadsideDriveCue(200)).toContain('150 m')
    expect(roadsideDriveCue(600)).toContain('Alongside')
    expect(roadsideDriveCue(1000)).toContain('Past')
    expect(block.source).toContain('not a recorded or proposed harvest')
    expect(scene.settings.greenAreaConfirmed).toBe(false)
  })

  it('removes trees only inside the proposal while retaining identical stems and terrain outside it', () => {
    const scene = createRoadsideDriveScene()
    const eye = roadPlacement(roadPath(scene.viewpoint.coordinates), 600)!
    const anchor = scene.viewpoint.coordinates[0][1]
    const bands = forestBands(3500)
    const patches = forestPatches(eye, bands, anchor).filter((p) => p.band === 0)
    const block = scene.targets.find((t) => t.role === 'block')!.geometry
    const road = bufferLine(scene.viewpoint.coordinates, 10)!
    const terrain = { elevationAt: () => 680 }
    const grow = (clearings: (typeof block)[]) =>
      patches.flatMap((p) =>
        growForestPatch(
          p,
          bands[0],
          {
            stands: [],
            clearings,
            heightMeters: 28,
          },
          terrain,
          anchor,
        ),
      )
    const before = grow([road])
    const after = grow([road, block])
    const removed = before.filter((t) => pointInPolygon(block, t.lng, t.lat))
    expect(removed.length).toBeGreaterThan(1000)
    expect(after).toEqual(before.filter((t) => !pointInPolygon(block, t.lng, t.lat)))
    expect(after.some((t) => pointInPolygon(road, t.lng, t.lat))).toBe(false)
  })
})
