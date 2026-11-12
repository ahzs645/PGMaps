import { describe, expect, it } from 'vitest'
import { splitLandform, subLandformDividers } from './subLandforms'
import { terrainLines } from './terrainLines'
import { metersPerDegree, pointInPolygon } from './visibility'

const box = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
})

const LANDFORM = box(-122.04, 54, -122, 54.02)
const VIEWPOINT = { lng: -122.02, lat: 53.95 }

describe('sub-landform candidates', () => {
  it('splits at a VSU boundary, names the parts left to right and draws the divider', () => {
    const result = splitLandform({
      landform: LANDFORM,
      landformName: '1',
      vsus: [
        { id: 'A', evqo: 'PR', geometry: box(-122.05, 53.99, -122.02, 54.03) },
        { id: 'B', evqo: 'R', geometry: box(-122.02, 53.99, -121.99, 54.03) },
      ],
      barriers: [],
      viewpoint: VIEWPOINT,
      cellMeters: 50,
    })
    expect(result.subs.map((s) => s.id)).toEqual(['1a', '1b'])
    expect(result.subs[0].vsuIds).toEqual(['A'])
    expect(result.subs[0].reasons[0]).toMatch(/VSU boundary/)
    expect(result.subs[0].share + result.subs[1].share).toBeCloseTo(1)
    const dividers = subLandformDividers(result)
    expect(dividers.length).toBeGreaterThan(0)
    for (const line of dividers) for (const [lng] of line) expect(lng).toBeCloseTo(-122.02, 2)
  })

  it('keeps one landform whole, merging a fragment under the minimum share', () => {
    const result = splitLandform({
      landform: LANDFORM,
      landformName: '2',
      vsus: [
        { id: 'A', evqo: null, geometry: box(-122.05, 53.99, -121.99, 54.03) },
        { id: 'tiny', evqo: null, geometry: box(-122.002, 54.018, -121.99, 54.03) },
      ],
      barriers: [],
      viewpoint: VIEWPOINT,
      cellMeters: 50,
    })
    expect(result.subs).toHaveLength(1)
    expect(result.subs[0].id).toBe('2')
    expect(subLandformDividers(result)).toEqual([])
  })

  it('splits at a creek that crosses the landform far enough', () => {
    const result = splitLandform({
      landform: LANDFORM,
      landformName: '3',
      vsus: [],
      barriers: [
        {
          name: 'Sample Creek',
          kind: 'creek',
          line: [
            [-122.02, 53.99],
            [-122.02, 54.03],
          ],
        },
      ],
      viewpoint: VIEWPOINT,
      cellMeters: 50,
    })
    expect(result.subs).toHaveLength(2)
    expect(result.subs[0].reasons.join()).toMatch(/Sample Creek/)
  })
})

describe('lines of force from terrain', () => {
  // Valleys at x = 0 and ridges at x = ±1200 m, all rising to the north.
  const origin = { lng: -122.02, lat: 54 }
  const m = metersPerDegree(origin.lat)
  const elevationAt = (lng: number, lat: number) => {
    const x = (lng - origin.lng) * m.lng,
      y = (lat - origin.lat) * m.lat
    return 1000 + 0.15 * y - 150 * Math.cos((2 * Math.PI * x) / 2400)
  }
  const bounds: [number, number, number, number] = [-122.05, 53.995, -121.98, 54.03]

  it('finds the draw as concave and the ridge as convex, clipped to the landform', () => {
    const inside = (lng: number, lat: number) => pointInPolygon(box(-122.04, 54, -121.99, 54.025), lng, lat)
    const { lines } = terrainLines(
      { elevationAt },
      { bounds, inside, cellMeters: 30, minAreaM2: 100_000, minLengthM: 400 },
    )
    const concave = lines.filter((l) => l.kind === 'concave')
    const convex = lines.filter((l) => l.kind === 'convex')
    expect(concave.length).toBeGreaterThan(0)
    expect(convex.length).toBeGreaterThan(0)
    const meanX = (line: (typeof lines)[number]) =>
      (line.points.reduce((s, p) => s + p.lng, 0) / line.points.length - origin.lng) * m.lng
    expect(Math.abs(meanX(concave[0]))).toBeLessThan(150)
    expect(Math.min(...convex.map((line) => Math.abs(Math.abs(meanX(line)) - 1200)))).toBeLessThan(150)
    for (const line of lines) for (const p of line.points) expect(inside(p.lng, p.lat)).toBe(true)
    // A draw's arrow runs up it: its last point is higher than its first.
    expect(concave[0].points.at(-1)!.elevation).toBeGreaterThan(concave[0].points[0].elevation)
  })
})
