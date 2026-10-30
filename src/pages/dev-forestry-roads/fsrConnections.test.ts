import { describe, expect, it } from 'vitest'
import { suggestFsrConnections } from './fsrConnections'
import { parseProject, serializeProject } from './project'
import { createDemoProject } from './terrain'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const RAD = Math.PI / 180,
  R = 6371008.8
const origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const xy = (coordinate: Coordinate) => [
  (coordinate[0] - origin[0]) * R * RAD * Math.cos(origin[1] * RAD),
  (coordinate[1] - origin[1]) * R * RAD,
]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 20,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const flat: TerrainSource = { elevationAt: () => 800 }
const fsr = (id: string, x: number, y = 0): ContextFeature => ({
  id,
  name: `FSR ${id}`,
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates: [point(x, y - 50), point(x, y + 50)] },
  roadEvidence: {
    source: 'user',
    roadClass: 'fsr',
    condition: 'unknown',
    conditionBasis: 'unreviewed',
    reuseAllowed: false,
  },
})
const exclusion = (x: number): ContextFeature => ({
  id: 'avoid',
  name: 'Protected area',
  kind: 'avoid',
  geometry: {
    type: 'Polygon',
    coordinates: [[point(x - 10, -10), point(x + 10, -10), point(x + 10, 10), point(x - 10, 10), point(x - 10, -10)]],
  },
})

describe('proposed connections to mapped FSRs', () => {
  it('honours a specific farther FSR without substituting the nearest one', () => {
    const result = suggestFsrConnections(
      origin,
      flat,
      settings,
      [fsr('near', 200), fsr('chosen', 400)],
      {},
      'nearest',
      'chosen',
    )
    expect(result.selected.target.featureId).toBe('chosen')
    expect(result.attempts.map((attempt) => attempt.target.featureId)).toEqual(['chosen'])
    expect(result.selected.coordinates.at(-1)).toEqual(result.selected.target.coordinate)
    expect(result.message).toContain('Used only the selected FSR')
  })

  it('reports a blocked or unavailable selected FSR without choosing another destination', () => {
    const context = [fsr('near', 200), fsr('chosen', 400), exclusion(400)]
    expect(() => suggestFsrConnections(origin, flat, settings, context, {}, 'nearest', 'chosen')).toThrow(
      /selected FSR connection did not pass/,
    )
    expect(() => suggestFsrConnections(origin, flat, settings, context, {}, 'nearest', 'removed')).toThrow(
      /no longer among/,
    )
  })

  it('round-trips the chosen destination and scope while rejecting invalid connection evidence', () => {
    const project = createDemoProject()
    const record = {
      targetFeatureId: 'chosen',
      targetName: 'Named FSR',
      targetCoordinate: point(400, 0),
      originCoordinate: origin,
      originAlignmentId: project.activeAlignmentId,
      endpoint: 'end' as const,
      preference: 'chosen' as const,
      networkScope: 'User-provided FSR network',
      straightLineDistanceM: 400,
      routeLengthM: 450,
      searchCost: 45000,
    }
    project.alignments[0].fsrConnection = record
    expect(parseProject(serializeProject(project)).alignments[0].fsrConnection).toEqual(record)
    expect(() =>
      parseProject({
        ...project,
        alignments: [{ ...project.alignments[0], fsrConnection: { ...record, routeLengthM: NaN } }],
      }),
    ).toThrow(/route length/)
  })
  it('connects exactly to a segment footpoint and preserves the original inputs', () => {
    const road = fsr('near', 200),
      context = [road, fsr('far', 350)]
    const before = JSON.stringify({ origin, context })
    const result = suggestFsrConnections(origin, flat, settings, context)
    expect(result.selected.target.featureId).toBe('near')
    expect(result.selected.coordinates[0]).toEqual(origin)
    expect(result.selected.coordinates.at(-1)).toEqual(result.selected.target.coordinate)
    expect(xy(result.selected.target.coordinate)[0]).toBeCloseTo(200, 3)
    expect(xy(result.selected.target.coordinate)[1]).toBeCloseTo(0, 3)
    expect(result.selected.target.fraction).toBeCloseTo(0.5, 5)
    expect(result.attempts).toHaveLength(1)
    expect(JSON.stringify({ origin, context })).toBe(before)
  })

  it('skips a blocked nearest target and explains the bounded attempt', () => {
    const context = [fsr('blocked', 200), fsr('reachable', 350), exclusion(200)]
    const result = suggestFsrConnections(origin, flat, settings, context, { exclusionBufferM: 5 })
    expect(result.selected.target.featureId).toBe('reachable')
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0].error).toMatch(/endpoint.*exclusion/)
    expect(result.message).toContain('loaded FSR network')
    expect(result.message).toContain('up to 3')
  })

  it('compares all three nearest target routes when asked for lowest screening cost', () => {
    // The nearest footpoint is inside a priced zone; the other target can be approached outside it.
    const price: ContextFeature = {
      id: 'price',
      name: 'Expensive ground',
      kind: 'avoid',
      routeCostPerM: 100000,
      geometry: {
        type: 'Polygon',
        coordinates: [[point(150, -55), point(230, -55), point(230, 55), point(150, 55), point(150, -55)]],
      },
    }
    const result = suggestFsrConnections(
      origin,
      flat,
      settings,
      [fsr('near-expensive', 200), fsr('far-cheaper', 300, 120), fsr('third', 450, 120), price],
      {},
      'lowest-cost',
    )
    expect(result.attempts).toHaveLength(3)
    expect(result.selected.target.featureId).toBe('far-cheaper')
    expect(result.connections.map((connection) => connection.cost)).toEqual(
      result.connections.map((connection) => connection.cost).sort((a, b) => a - b),
    )
  })

  it('does not bridge missing terrain or silently target generic permit roads', () => {
    const gap: TerrainSource = {
      elevationAt: (longitude, latitude) => {
        const [x] = xy([longitude, latitude])
        return x > 90 && x < 110 ? NaN : 800
      },
    }
    expect(() => suggestFsrConnections(origin, gap, settings, [fsr('other-side', 200)])).toThrow(
      /No connector.*terrain and route constraints/,
    )
    const permit = fsr('permit', 200)
    permit.roadEvidence = { ...permit.roadEvidence!, roadClass: 'permit' }
    expect(() => suggestFsrConnections(origin, flat, settings, [permit])).toThrow(/No mapped FSR targets/)
  })

  it('rejects a near-zero connector and excludes a closed road', () => {
    expect(() => suggestFsrConnections(origin, flat, settings, [fsr('already-near', 1)])).toThrow(/within 2 m/)
    const closed = fsr('closed', 100)
    closed.roadEvidence = { ...closed.roadEvidence!, condition: 'closed' }
    expect(() => suggestFsrConnections(origin, flat, settings, [closed])).toThrow(/No mapped FSR targets/)
  })
})
