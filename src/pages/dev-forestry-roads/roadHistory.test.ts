import { describe, expect, it } from 'vitest'
import { parseRoadEvidence, refreshExistingRoadFeature, refreshedRoadEvidence } from './existingRoadEvidence'
import { importExistingRoads, parseBcExistingRoads } from './existingRoads'
import { parseProject, projectGeoJson, serializeProject } from './project'
import {
  deactivatedRoadNeedsReview,
  parseRoadDeactivation,
  roadDeactivationSummary,
  roadHistoryStyle,
  type RoadDeactivationEvidence,
} from './roadHistory'
import { createDemoProject } from './terrain'
import type { ContextFeature, ExistingRoadEvidence } from './types'

const record: RoadDeactivationEvidence = {
  status: 'deactivated',
  basis: 'source-record',
  reference: 'Example completion report D-12',
  deactivatedOn: '2016-09-15',
  observedOn: '2026-11-07',
  sourceUrl: 'https://example.org/road-records/D-12',
}
const evidence = (patch: Partial<ExistingRoadEvidence> = {}): ExistingRoadEvidence => ({
  source: 'bc-ften',
  sourceId: '12',
  lifecycleStatus: 'ACTIVE',
  condition: 'unknown',
  conditionBasis: 'unreviewed',
  reuseAllowed: false,
  ...patch,
})
const road = (patch: Partial<ExistingRoadEvidence> = {}): ContextFeature => ({
  id: 'bc-ften-12-0',
  name: 'Example road',
  kind: 'existing-road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.8, 53.8],
      [-122.79, 53.81],
    ],
  },
  roadEvidence: evidence(patch),
})

describe('physical road history', () => {
  it('keeps unknown event dates distinct from the date a deactivated road was observed', () => {
    const parsed = parseRoadDeactivation({
      status: 'deactivated',
      basis: 'field-observation',
      reference: 'Field note: removed bridge and waterbars',
      observedOn: '2026-11-07',
    })
    expect(parsed.deactivatedOn).toBeUndefined()
    expect(roadDeactivationSummary(parsed)).toBe('Deactivation: date unknown')
    expect(roadDeactivationSummary()).toBe('Physical deactivation: unknown')
  })

  it.each(['2025-02-29', '2026-02-30', '2026-13-01', '2026-11-07T00:00:00Z', 'yesterday', ''])(
    '%s is not an event date',
    (date) => {
      expect(() => parseRoadDeactivation({ ...record, deactivatedOn: date })).toThrow(/date/)
    },
  )

  it('requires provenance, validates chronology and retains separate reactivation evidence', () => {
    expect(() => parseRoadDeactivation({ ...record, reference: ' ' })).toThrow(/reference/)
    expect(() => parseRoadDeactivation({ ...record, sourceUrl: 'javascript:alert(1)' })).toThrow(/HTTP/)
    expect(() => parseRoadDeactivation({ ...record, status: 'unknown' })).toThrow(/status/)
    expect(() => parseRoadDeactivation({ ...record, reactivatedOn: '2025-01-01' })).toThrow(/reactivated status/)
    expect(() => parseRoadDeactivation({ ...record, status: 'reactivated', reactivatedOn: '2010-01-01' })).toThrow(
      /precede/,
    )
    expect(() => parseRoadDeactivation({ ...record, observedOn: '2010-01-01' })).toThrow(/precede/)
    const reactivated = parseRoadDeactivation({ ...record, status: 'reactivated', reactivatedOn: '2024-02-29' })
    expect(reactivated).toMatchObject({ deactivatedOn: '2016-09-15', reactivatedOn: '2024-02-29' })
    expect(roadDeactivationSummary(reactivated)).toBe('Reactivation: 2024-02-29')
  })

  it('never converts a tenure retirement date or ACTIVE status into physical road evidence', () => {
    const [parsed] = parseBcExistingRoads({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: road().geometry,
          properties: {
            OBJECTID: 12,
            LIFE_CYCLE_STATUS_CODE: 'RETIRED',
            AWARD_DATE: Date.UTC(2000, 0, 1),
            RETIREMENT_DATE: Date.UTC(2016, 8, 15),
          },
        },
      ],
    })
    expect(parsed.roadEvidence?.retirementDate).toBe('2016-09-15')
    expect(parsed.roadEvidence?.deactivation).toBeUndefined()
    expect(roadHistoryStyle(parsed.roadEvidence).key).toBe('retired-tenure')
    expect(roadHistoryStyle(evidence()).key).toBe('unknown')
  })

  it('keeps deactivation red when explicitly enabled for reviewed rehabilitation', () => {
    const saved = evidence({ deactivation: record })
    expect(deactivatedRoadNeedsReview(saved)).toBe(true)
    expect(() => parseRoadEvidence({ ...saved, reuseAllowed: true, condition: 'serviceable' })).toThrow(
      /rehabilitation/,
    )
    expect(() => parseRoadEvidence({ ...saved, reuseAllowed: true, condition: 'rehabilitation' })).toThrow(/reviewed/)
    const reviewed = parseRoadEvidence({
      ...saved,
      reuseAllowed: true,
      condition: 'rehabilitation',
      conditionBasis: 'assumed',
    })
    expect(deactivatedRoadNeedsReview(reviewed)).toBe(false)
    expect(roadHistoryStyle(reviewed)).toMatchObject({ key: 'deactivated', color: '#b91c1c', dasharray: [3, 2] })
    expect(roadHistoryStyle(evidence({ condition: 'closed' })).key).toBe('closed')
    expect(roadHistoryStyle(evidence({ condition: 'serviceable', conditionBasis: 'unreviewed' })).key).toBe('unknown')
  })

  it('round trips dated physical evidence through portable projects and road GeoJSON', () => {
    const project = parseProject({ ...createDemoProject(), context: [road({ deactivation: record })] })
    const restored = parseProject(serializeProject(project))
    expect(restored.context[0].roadEvidence?.deactivation).toEqual(record)
    const exported = projectGeoJson({ ...restored, alignments: [], cables: [], profiles: [] }, new Map())
    expect(importExistingRoads(exported)[0].roadEvidence?.deactivation).toEqual(record)
    const raw = importExistingRoads({
      type: 'Feature',
      geometry: road().geometry,
      properties: { RETIREMENT_DATE: Date.UTC(2018, 0, 1), deactivation: record },
    })[0].roadEvidence!
    expect(raw).toMatchObject({ retirementDate: '2018-01-01', deactivation: record, reuseAllowed: false })
  })

  it('preserves separate user history during a source refresh and invalidates changed geometry scope', () => {
    const previous = road({
      deactivation: record,
      condition: 'rehabilitation',
      conditionBasis: 'assumed',
      reuseAllowed: true,
    })
    const refreshed = refreshExistingRoadFeature(road({ retirementDate: '2026-01-01' }), previous)
    expect(refreshed.roadEvidence).toMatchObject({
      deactivation: record,
      reuseAllowed: true,
      retirementDate: '2026-01-01',
    })
    const changed = refreshExistingRoadFeature(
      {
        ...road(),
        geometry: {
          type: 'LineString',
          coordinates: [
            [-122.8, 53.8],
            [-122.78, 53.82],
          ],
        },
      },
      previous,
    )
    expect(changed.roadEvidence).toMatchObject({
      deactivation: record,
      geometryReviewRequired: true,
      reuseAllowed: false,
    })
    expect(refreshedRoadEvidence(evidence({ deactivation: record }), evidence({ reuseAllowed: true }))).toMatchObject({
      deactivation: record,
      reuseAllowed: false,
    })
  })
})
