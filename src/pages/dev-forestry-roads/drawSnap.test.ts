import { describe, expect, it } from 'vitest'
import { roadSnapLines, snapIndex, snapNotice, snapToRoads, type SnapLine } from './drawSnap'
import type { Coordinate } from './types'

// Near Prince George; 1e-5° of longitude is about 0.66 m there, of latitude about 1.1 m.
const at = (east: number, north: number): Coordinate => [-122.75 + east * 1e-5, 53.9 + north * 1e-5]
const main: SnapLine = { id: 'main', name: 'Main road', kind: 'design', coordinates: [at(0, 0), at(1000, 0)] }
const spur: SnapLine = { id: 'spur', name: 'FSR 123', kind: 'existing', coordinates: [at(0, 500), at(0, 900)] }
const index = snapIndex([main, spur])

describe('snapToRoads', () => {
  it('lands a click near a road exactly on its line, as a branch', () => {
    const snap = snapToRoads(at(500, 3), index, 1)!
    expect(snap).toMatchObject({ lineId: 'main', at: 'line', kind: 'design' })
    expect(snap.coordinate[1]).toBeCloseTo(at(500, 0)[1], 9)
    expect(snap.coordinate[0]).toBeCloseTo(at(500, 0)[0], 7)
  })

  it('prefers a road end within reach over a nearer point along the line', () => {
    expect(snapToRoads(at(10, 1), index, 1)).toMatchObject({ lineId: 'main', at: 'start' })
    expect(snapToRoads(at(10, 1), index, 1)!.coordinate).toEqual(main.coordinates[0])
  })

  it('snaps to existing roads on the map too', () => {
    expect(snapToRoads(at(2, 700), index, 1)).toMatchObject({ lineId: 'spur', kind: 'existing', at: 'line' })
  })

  it('leaves a click beyond the tolerance where it is', () => {
    // 1 m per pixel and 12 px: 30 m north of the road is out of reach.
    expect(snapToRoads(at(500, 30), index, 1)).toBeNull()
    // Zoomed out, the same click is within 12 px.
    expect(snapToRoads(at(500, 30), index, 5)).toMatchObject({ lineId: 'main' })
  })

  it('says what the snap means', () => {
    expect(snapNotice(snapToRoads(at(500, 3), index, 1)!, true)).toBe('This road branches from Main road.')
    expect(snapNotice(snapToRoads(at(999, 1), index, 1)!, false)).toBe('Ends at the end of Main road.')
  })
})

describe('roadSnapLines', () => {
  it('takes design roads as drawn and existing road lines, never the placeholder or other features', () => {
    const point = (id: string, coordinate: Coordinate) => ({ id, coordinate, radiusM: 0 })
    const road = (id: string) => ({ id, name: id, points: [point('a', at(0, 0)), point('b', at(100, 0))] })
    const project = {
      designPlaceholderId: 'placeholder',
      alignments: [road('drawn'), road('unanalysed'), road('placeholder')],
      context: [
        {
          id: 'fsr',
          name: 'FSR',
          kind: 'existing-road',
          geometry: { type: 'LineString', coordinates: [at(0, 5), at(9, 5)] },
        },
        {
          id: 'parts',
          name: 'Two-part road',
          kind: 'existing-road',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [at(0, 7), at(3, 7)],
              [at(5, 7), at(9, 7)],
            ],
          },
        },
        {
          id: 'creek',
          name: 'Creek',
          kind: 'stream',
          geometry: { type: 'LineString', coordinates: [at(0, 9), at(9, 9)] },
        },
      ],
    } as unknown as Parameters<typeof roadSnapLines>[0]
    const curve = [at(0, 0), at(50, 2), at(100, 0)]
    const lines = roadSnapLines(project, new Map([['drawn', { centerline: curve }]]))
    expect(lines.map((line) => [line.id, line.kind])).toEqual([
      ['drawn', 'design'],
      ['unanalysed', 'design'],
      ['fsr', 'existing'],
      ['parts', 'existing'],
      ['parts', 'existing'],
    ])
    expect(lines[0].coordinates).toBe(curve)
    expect(lines[1].coordinates).toEqual([at(0, 0), at(100, 0)])
  })
})
