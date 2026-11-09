import { describe, expect, it } from 'vitest'
import {
  arrowHead,
  mapNotesGeoJson,
  noteAnchor,
  noteMeasure,
  parseMapNotes,
  pathLengthM,
  polygonAreaM2,
  simplifyPath,
  type MapNote,
} from './mapNotes'
import type { Coordinate } from './types'

const note = (patch: Partial<MapNote>): MapNote => ({
  id: 'n1',
  kind: 'pin',
  points: [[-122.7, 53.9]],
  text: 'Check culvert',
  color: '#e11d48',
  createdAt: '2026-11-08T12:00:00.000Z',
  ...patch,
})

describe('parseMapNotes', () => {
  it('round-trips valid notes and drops an arrow flag off anything but a line', () => {
    const notes = [
      note({}),
      note({
        id: 'n2',
        kind: 'line',
        points: [
          [-122.7, 53.9],
          [-122.69, 53.91],
        ],
        arrow: true,
      }),
      note({
        id: 'n3',
        kind: 'area',
        points: [
          [-122.7, 53.9],
          [-122.69, 53.9],
          [-122.69, 53.91],
        ],
      }),
    ]
    expect(parseMapNotes(JSON.parse(JSON.stringify(notes)))).toEqual(notes)
    expect(parseMapNotes([{ ...note({}), arrow: true }])[0]).not.toHaveProperty('arrow')
  })

  it('rejects malformed notes instead of repairing them', () => {
    expect(() => parseMapNotes([note({}), note({})])).toThrow(/unique/)
    expect(() =>
      parseMapNotes([
        note({
          kind: 'area',
          points: [
            [0, 0],
            [1, 1],
          ],
        }),
      ]),
    ).toThrow(/number of points/)
    expect(() => parseMapNotes([note({ points: [[200, 0]] })])).toThrow(/longitude/)
    expect(() => parseMapNotes([note({ color: 'red' })])).toThrow(/colour/)
    expect(() => parseMapNotes([note({ text: 'x'.repeat(1001) })])).toThrow(/1000/)
    expect(() => parseMapNotes('nope')).toThrow(/list/)
  })
})

describe('measures', () => {
  it('measures a 100 m square as one hectare and its sides as 100 m', () => {
    const lat = 54,
      dLat = 100 / 111194.9,
      dLng = 100 / (111194.9 * Math.cos((lat * Math.PI) / 180))
    const ring: Coordinate[] = [
      [-122, lat],
      [-122 + dLng, lat],
      [-122 + dLng, lat + dLat],
      [-122, lat + dLat],
    ]
    expect(polygonAreaM2({ type: 'Polygon', coordinates: [[...ring, ring[0]]] })).toBeCloseTo(10000, -2)
    expect(pathLengthM(ring.slice(0, 2))).toBeCloseTo(100, 0)
    expect(noteMeasure(note({ kind: 'area', points: ring }))).toBe('1.00 ha')
    expect(noteMeasure(note({ kind: 'line', points: ring.slice(0, 2) }))).toBe('100 m')
    expect(noteMeasure(note({}))).toBe('')
  })

  it('subtracts holes from a polygon area', () => {
    const square = (half: number): Coordinate[] => [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
      [-half, -half],
    ]
    const whole = polygonAreaM2({ type: 'Polygon', coordinates: [square(0.01)] })
    const holed = polygonAreaM2({ type: 'Polygon', coordinates: [square(0.01), square(0.005)] })
    expect(holed).toBeCloseTo(whole * 0.75, -3)
  })
})

describe('drawing helpers', () => {
  it('thins a straight freehand stroke to its ends and keeps a corner', () => {
    const straight: Coordinate[] = Array.from({ length: 50 }, (_, i) => [-122 + i * 1e-5, 54])
    expect(simplifyPath(straight, 0.5)).toEqual([straight[0], straight[49]])
    const corner: Coordinate[] = [...straight, [-122 + 49e-5, 54.001]]
    expect(simplifyPath(corner, 0.5)).toEqual([straight[0], straight[49], corner[50]])
  })

  it('points an arrowhead back along the last segment, ending on the tip', () => {
    const line: Coordinate[] = [
      [-122, 54],
      [-121.99, 54],
    ]
    const head = arrowHead(line)!
    expect(head[1]).toEqual(line[1])
    for (const barb of [head[0], head[2]]) expect(barb[0]).toBeLessThan(line[1][0])
    expect(Math.sign(head[0][1] - 54)).toBe(-Math.sign(head[2][1] - 54))
  })

  it('anchors labels at a pin, a line end and an area centroid', () => {
    expect(noteAnchor(note({}))).toEqual([-122.7, 53.9])
    expect(
      noteAnchor(
        note({
          kind: 'line',
          points: [
            [0, 0],
            [1, 1],
          ],
        }),
      ),
    ).toEqual([1, 1])
    expect(
      noteAnchor(
        note({
          kind: 'area',
          points: [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
          ],
        }),
      ),
    ).toEqual([1, 1])
  })

  it('closes areas and adds arrowheads as their own features', () => {
    const fc = mapNotesGeoJson([
      note({
        kind: 'area',
        points: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      }),
      note({
        id: 'n2',
        kind: 'line',
        points: [
          [0, 0],
          [0.001, 0],
        ],
        arrow: true,
      }),
    ])
    expect(fc.features.map((f) => f.properties?.kind)).toEqual(['area', 'line', 'arrow'])
    const ring = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0]
    expect(ring.at(-1)).toEqual(ring[0])
  })
})
