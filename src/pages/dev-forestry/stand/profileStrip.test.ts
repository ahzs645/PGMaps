import { describe, expect, it } from 'vitest'
import { metersPerDegree } from '../visibility'
import { profileStripPolygon } from './profileStrip'
import type { Stand, StandTree } from './standTrees'

const tree = (x: number, y: number): StandTree => {
  const scale = metersPerDegree(54)
  return {
    key: x * 1000 + y,
    id: `${x},${y}`,
    lng: -122 + x / scale.lng,
    lat: 54 + y / scale.lat,
    x,
    y,
    species: 'spruce',
    heightMeters: 20,
    crownWidthMeters: 4,
    dbhCm: 25,
    expansion: 1,
  }
}

const stand = (trees: StandTree[]): Stand => ({
  trees,
  areaHa: 1,
  origin: { lng: -122, lat: 54 },
  anchorLatitude: 54,
  spacingMeters: 4,
  seed: 1,
  source: 'drawn',
  diameterSource: 'curve',
  maxExpansion: 1,
})

describe('profileStripPolygon', () => {
  it('runs along the bearing through the stand, as long as the trees in it', () => {
    const trees = [tree(0, 50), tree(100, 50), tree(200, 50), tree(100, 90)]
    const polygon = profileStripPolygon(stand(trees), { bearingDegrees: 90, widthMeters: 24 })!
    const scale = metersPerDegree(54)
    const ring = polygon.coordinates[0]
    expect(ring).toHaveLength(5)
    const xs = ring.map(([lng]) => (lng + 122) * scale.lng)
    const ys = ring.map(([, lat]) => (lat - 54) * scale.lat)
    expect(Math.min(...xs)).toBeCloseTo(0, 0)
    expect(Math.max(...xs)).toBeCloseTo(200, 0)
    // Centred on the trees' mean north offset (60 m), 24 m wide: the tree at 90 m is outside it.
    expect(Math.min(...ys)).toBeCloseTo(48, 0)
    expect(Math.max(...ys)).toBeCloseTo(72, 0)
  })

  it('has no strip without trees', () => {
    expect(profileStripPolygon(stand([]), { bearingDegrees: null, widthMeters: 20 })).toBeNull()
  })
})
