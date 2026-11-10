import { describe, expect, it } from 'vitest'
import { analyzeCable, offsetCoordinate } from '../engine'
import { parseProject } from '../project'
import type { CableLine, Coordinate, TerrainMetadata, TerrainSource } from '../types'
import { createDemoProject } from '../terrain'
import {
  cableGroundSource,
  compareFieldProfile,
  FIELD_PROFILE_CORRIDOR_M,
  fieldElevationAt,
  fieldProfileErrors,
  parseFieldProfile,
  parseFieldRows,
  reduceSlopeLegs,
  type CableFieldProfile,
} from './fieldProfile'
import { dLineFrame } from './frame'
import { dLineExtras } from './outputs'
import { parseCsv } from '../exportCatalog'
import { cableProfileCsv, cableProfileHtml } from '../profileOutputs'

const start: Coordinate = [-122.72, 53.89]
const line: CableLine = {
  id: 'd1',
  name: 'D-line 1',
  start,
  end: offsetCoordinate(start, 90, 300),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
}
const metadata = { name: 'Flat', kind: 'demo', resolutionM: 1, verticalReference: 'CGVD2013' } as TerrainMetadata
/** Flat at 1,000 m. */
const flat: TerrainSource = { elevationAt: () => 1000 }
const shots: CableFieldProfile = {
  use: true,
  method: 'station-elevation',
  shots: [
    { stationM: 0, elevationM: 1001 },
    { stationM: 100, elevationM: 1004 },
    { stationM: 200, elevationM: 1000 },
  ],
}

describe('D-line frame', () => {
  it('turns a station from the yarder into a position and back, with the yarder at either end', () => {
    for (const yarderAt of ['start', 'end'] as const) {
      const frame = dLineFrame({ ...line, yarderAt })!
      expect(frame.lengthM).toBeCloseTo(300, 3)
      const at = frame.stationOf(frame.at(120))
      expect(at.stationM).toBeCloseTo(120, 2)
      expect(at.offsetM).toBeCloseTo(0, 2)
      expect(frame.chartDistance(120)).toBeCloseTo(yarderAt === 'end' ? 180 : 120, 6)
    }
    // Looking east from the yarder, a point to the south is on the right: a positive offset.
    const frame = dLineFrame(line)!
    expect(frame.stationOf(offsetCoordinate(frame.at(50), 180, 5)).offsetM).toBeCloseTo(5, 2)
  })
})

describe('field shots', () => {
  it('reduces slope legs to horizontal distance and rise', () => {
    const reduced = reduceSlopeLegs(0, 1000, [
      { slopeDistanceM: Math.hypot(100, 30), slopePercent: 30 },
      { slopeDistanceM: Math.hypot(50, 10), slopePercent: -20 },
    ])
    expect(reduced.map((s) => s.stationM)).toEqual([0, expect.closeTo(100, 6), expect.closeTo(150, 6)])
    expect(reduced.map((s) => s.elevationM)).toEqual([1000, expect.closeTo(1030, 6), expect.closeTo(1020, 6)])
  })

  it('reads pasted rows with a header, comments and mixed separators, naming a bad line', () => {
    expect(parseFieldRows('station,elevation\n0, 1001\n# check\n100\t1004\n200 ; 1000\n\n')).toEqual([
      [0, 1001],
      [100, 1004],
      [200, 1000],
    ])
    expect(parseFieldRows('25, 12%\n')).toEqual([[25, 12]])
    expect(() => parseFieldRows('0, 1001\n100, x')).toThrow('Line 2: enter two numbers.')
  })

  it('refuses stations out of order and values out of range, and reads a saved profile back', () => {
    expect(fieldProfileErrors(shots)).toEqual([])
    expect(fieldProfileErrors({ ...shots, shots: [...shots.shots, { stationM: 150, elevationM: 1000 }] })[0]).toMatch(
      /forwards/,
    )
    expect(fieldProfileErrors({ ...shots, shots: [{ stationM: 0, elevationM: 1 }] })[0]).toMatch(/2 to/)
    expect(() => parseFieldProfile({ use: true, method: 'slope', startStationM: 0, legs: [] })).toThrow(
      /D-line field profile/,
    )
    expect(parseFieldProfile(JSON.parse(JSON.stringify(shots)))).toEqual(shots)
  })

  it('interpolates between shots and gives nothing outside them', () => {
    expect(fieldElevationAt(shots.shots, 50)).toBeCloseTo(1002.5, 9)
    expect(fieldElevationAt(shots.shots, 200)).toBe(1000)
    expect(fieldElevationAt(shots.shots, 250)).toBeNull()
  })
})

describe('the D-line reads its field shots in place of the terrain', () => {
  const withShots = { ...line, fieldProfile: shots }

  it('reads the shots on the line, the terrain off it and beyond the last shot', () => {
    const ground = cableGroundSource(withShots, flat)
    const frame = dLineFrame(withShots)!
    expect(ground.elevationAt(...frame.at(100))).toBeCloseTo(1004, 6)
    expect(ground.elevationAt(...offsetCoordinate(frame.at(100), 0, FIELD_PROFILE_CORRIDOR_M + 1))).toBe(1000)
    expect(ground.elevationAt(...frame.at(250))).toBe(1000)
    // The same object for the same terrain and profile, so a layout result stays current.
    expect(cableGroundSource({ ...withShots, name: 'Renamed' }, flat)).toBe(ground)
    expect(cableGroundSource({ ...withShots, fieldProfile: { ...shots, use: false } }, flat)).toBe(flat)
    expect(cableGroundSource(line, flat)).toBe(flat)
  })

  it('changes the profile only when it is on', () => {
    const before = analyzeCable(line, flat)
    const after = analyzeCable(withShots, cableGroundSource(withShots, flat))
    const near = (d: number) =>
      after.samples.reduce((a, b) => (Math.abs(b.distance - d) < Math.abs(a.distance - d) ? b : a))
    const at100 = near(100)
    expect(at100.ground).toBeCloseTo(fieldElevationAt(shots.shots, at100.distance)!, 6)
    expect(at100.ground).toBeGreaterThan(1003)
    expect(after.samples.find((s) => s.distance > 250)!.ground).toBe(1000)
    expect(before.samples.every((s) => s.ground === 1000)).toBe(true)
  })

  it('stations from the yarder when it is at the far end', () => {
    const reversed = { ...withShots, yarderAt: 'end' as const }
    const analysis = analyzeCable(reversed, cableGroundSource(reversed, flat))
    // Physical distance 200 is 100 m from the yarder.
    const at = analysis.samples.reduce((a, b) => (Math.abs(b.distance - 200) < Math.abs(a.distance - 200) ? b : a))
    expect(at.ground).toBeCloseTo(fieldElevationAt(shots.shots, analysis.length - at.distance)!, 6)
    expect(at.ground).toBeGreaterThan(1003)
  })

  it('compares each shot with the terrain and says what the shots cover', () => {
    const c = compareFieldProfile(withShots, flat)!
    expect(c.rows.map((r) => r.differenceM)).toEqual([1, 4, 0])
    expect(c.meanDifferenceM).toBeCloseTo(5 / 3, 9)
    expect(c.largestDifferenceM).toBe(4)
    expect(c.largestAtM).toBe(100)
    expect(c.flagged).toBe(1)
    expect(c.coversLine).toBe(false)
    expect(c.coveredToM).toBe(200)
  })

  it('appends the ground source and its difference to the terrain to the D-line CSV and report', () => {
    const fullShots: CableFieldProfile = {
      ...shots,
      shots: [...shots.shots, { stationM: 300, elevationM: 1002 }],
    }
    const full = { ...line, fieldProfile: fullShots }
    const ground = cableGroundSource(full, flat)
    const analysis = analyzeCable(full, ground)
    const extras = dLineExtras({ line: full, analysis, terrain: flat, ground })
    const { rows } = parseCsv(cableProfileCsv(full, analysis, metadata, extras))
    expect(rows[0].slice(-3)).toEqual(['ground_source', 'terrain_elevation_m', 'field_minus_terrain_m'])
    // Every sample, the last one at the far end included, reads the shots.
    expect(rows.slice(1).every((row) => row.at(-3) === 'field')).toBe(true)
    expect(Number(rows[1].at(-1))).toBeCloseTo(1, 9)
    expect(cableProfileHtml(full, analysis, metadata, extras)).toContain('<h2>Field-measured ground</h2>')
  })

  it('loads old project files and keeps a field profile through a save', () => {
    const project = createDemoProject()
    const saved = parseProject(JSON.parse(JSON.stringify({ ...project, cables: [withShots] })))
    expect(saved.cables[0].fieldProfile).toEqual(shots)
    expect(parseProject(JSON.parse(JSON.stringify({ ...project, cables: [line] }))).cables[0]).not.toHaveProperty(
      'fieldProfile',
    )
  })
})
