import { describe, expect, it } from 'vitest'
import { placeTrees } from './forest'
import { pointInPolygon, preparePolygons, type PolygonGeometry } from './visibility'

/** A deterministic generator, so a failure reproduces. */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** A star-shaped ring of `count` vertices: concave, with many edges, as a lake shoreline is. */
function ring(next: () => number, cx: number, cy: number, radius: number, count: number) {
  const points: Array<[number, number]> = []
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    const r = radius * (0.45 + next() * 0.55)
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r])
  }
  points.push(points[0])
  return points
}

describe('preparePolygons', () => {
  it('answers exactly as pointInPolygon on long rings, holes and multipolygons', () => {
    const next = random(7)
    const polygons: PolygonGeometry[] = [
      { type: 'Polygon', coordinates: [ring(next, -122.6, 53.9, 0.02, 600), ring(next, -122.6, 53.9, 0.006, 90)] },
      {
        type: 'MultiPolygon',
        coordinates: [
          [ring(next, -122.55, 53.92, 0.01, 300)],
          [ring(next, -122.65, 53.88, 0.015, 30), ring(next, -122.65, 53.88, 0.004, 12)],
        ],
      },
      { type: 'Polygon', coordinates: [ring(next, -122.58, 53.89, 0.005, 8)] },
    ]
    const prepared = preparePolygons(polygons)
    for (let index = 0; index < 20_000; index += 1) {
      const lng = -122.69 + next() * 0.16
      const lat = 53.86 + next() * 0.08
      const expected = polygons.findIndex((polygon) => pointInPolygon(polygon, lng, lat))
      expect(prepared.indexAt(lng, lat)).toBe(expected)
    }
  })

  it('leaves out parts outside `within` without changing answers inside it', () => {
    const next = random(11)
    const polygons: PolygonGeometry[] = [
      { type: 'Polygon', coordinates: [ring(next, 0, 0, 1, 200)] },
      { type: 'Polygon', coordinates: [ring(next, 5, 5, 1, 200)] },
    ]
    const within: [number, number, number, number] = [-1, -1, 1, 1]
    const prepared = preparePolygons(polygons, within)
    expect(prepared.partCount).toBe(1)
    for (let index = 0; index < 2000; index += 1) {
      const lng = -1 + next() * 2,
        lat = -1 + next() * 2
      expect(prepared.contains(lng, lat)).toBe(pointInPolygon(polygons[0], lng, lat))
    }
  })
})

describe('placeTrees within a square', () => {
  it('grows exactly the stems a full patch grows inside the square', () => {
    const next = random(3)
    const clearings: PolygonGeometry[] = [{ type: 'Polygon', coordinates: [ring(next, -122.6, 53.9, 0.002, 400)] }]
    const centre = { lng: -122.6, lat: 53.9 }
    const bounds: [number, number, number, number] = [-122.604, 53.8975, -122.596, 53.9025]
    const options = { stands: [], clearings, centre, radiusMeters: 400, spacingMeters: 6, seed: 2, anchorLatitude: 54 }
    const full = placeTrees(options).filter(
      (tree) => tree.lng >= bounds[0] && tree.lng < bounds[2] && tree.lat >= bounds[1] && tree.lat < bounds[3],
    )
    const square = placeTrees({ ...options, bounds })
    expect(square.length).toBeGreaterThan(100)
    expect(square).toEqual(full)
  })
})
