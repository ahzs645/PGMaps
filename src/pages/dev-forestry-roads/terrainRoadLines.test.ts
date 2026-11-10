import { describe, expect, it } from 'vitest'
import { parseRoadEvidence } from './existingRoadEvidence'
import { isActiveRoad, pickActiveRoad } from './accessReview'
import { parseProject } from './project'
import { createDemoProject } from './terrain'
import { describeLineOrigin, roadLineFeature } from './terrainRoadLines'
import type { Coordinate } from './types'

const line: Coordinate[] = [
  [-122.8, 53.9],
  [-122.799, 53.901],
  [-122.798, 53.9015],
]

describe('traced and terrain-found road lines', () => {
  const feature = roadLineFeature({
    id: 'traced-1',
    name: 'Traced road 1',
    coordinates: line,
    origin: {
      method: 'terrain-trace',
      createdAt: '2026-11-10T00:00:00.000Z',
      terrainCellM: 1,
      segments: 3,
      snappedSegments: 2,
    },
  })

  it('is an unreviewed user road that can be picked as a road to connect to', () => {
    expect(feature.kind).toBe('existing-road')
    expect(feature.roadEvidence).toMatchObject({
      source: 'user',
      roadClass: 'user',
      condition: 'unknown',
      conditionBasis: 'unreviewed',
      reuseAllowed: false,
    })
    expect(isActiveRoad(feature)).toBe(true)
    expect(pickActiveRoad([-122.799, 53.901], [feature])?.id).toBe('traced-1')
  })

  it('keeps its origin record through a project save and load', () => {
    const project = createDemoProject()
    const parsed = parseProject(JSON.parse(JSON.stringify({ ...project, context: [...project.context, feature] })))
    const road = parsed.context.find((f) => f.id === 'traced-1')!
    expect(road.roadEvidence?.lineOrigin).toEqual(feature.roadEvidence?.lineOrigin)
    expect(describeLineOrigin(road.roadEvidence!.lineOrigin!)).toBe(
      'Traced on 1 m terrain: 2 of 3 segments followed a road bench',
    )
  })

  it('rejects an origin record out of bounds, and old files without one still load', () => {
    const evidence = { source: 'user', condition: 'unknown', conditionBasis: 'unreviewed', reuseAllowed: false }
    expect(parseRoadEvidence(evidence).lineOrigin).toBeUndefined()
    expect(() => parseRoadEvidence({ ...evidence, lineOrigin: { method: 'guess', createdAt: '2026-11-10' } })).toThrow(
      /method/,
    )
    expect(() =>
      parseRoadEvidence({ ...evidence, lineOrigin: { method: 'clicks', createdAt: '2026-11-10', foundPercent: 140 } }),
    ).toThrow(/foundPercent/)
    const searched = {
      method: 'terrain-relocation',
      createdAt: '2026-11-10',
      scoredWith: 'terrain+vegetation',
      corridorM: 40,
      confidence: 0.1,
      flatToleranceM: 0.15,
      drivableWidthM: 4.2,
      vegetationPercent: 12,
      stateScore: 70.8,
      stateClass: 2,
    }
    expect(parseRoadEvidence({ ...evidence, lineOrigin: searched }).lineOrigin).toEqual(searched)
    expect(() => parseRoadEvidence({ ...evidence, lineOrigin: { ...searched, stateClass: 2.5 } })).toThrow(/stateClass/)
    expect(() => parseRoadEvidence({ ...evidence, lineOrigin: { ...searched, scoredWith: 'guess' } })).toThrow(
      /scoredWith/,
    )
    expect(() => parseRoadEvidence({ ...evidence, lineOrigin: { method: 'clicks', createdAt: 'yesterday' } })).toThrow(
      /date/,
    )
  })

  it('describes a relocation and a plain click trace', () => {
    expect(
      describeLineOrigin({
        method: 'terrain-relocation',
        createdAt: '2026-11-10',
        fromName: 'R01234',
        terrainCellM: 1,
        foundPercent: 92,
        medianShiftM: 7.4,
      }),
    ).toBe('Found on 1 m terrain from R01234: bench along 92%, median 7.4 m from the record')
    expect(
      describeLineOrigin({
        method: 'terrain-relocation',
        createdAt: '2026-11-10',
        terrainCellM: 1,
        foundPercent: 92,
        stateClass: 2,
        stateScore: 60.4,
      }),
    ).toBe('Found on 1 m terrain: bench along 92%; LiDAR state class 2 (score 60.4)')
    expect(describeLineOrigin({ method: 'clicks', createdAt: '2026-11-10', segments: 4 })).toMatch(
      /not checked against terrain/,
    )
  })
})
