import { describe, expect, it } from 'vitest'
import { snapIndex, snapNotice, snapToRoads, type SnapLine } from './drawSnap'
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
