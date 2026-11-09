import { describe, expect, it } from 'vitest'
import { createAccessHistoryState, parseAccessHistoryState } from './accessHistory'
import { assessHistoricalCoverage } from './accessHistorySummary'
import type { HistoricalSource } from './accessHistoryTypes'
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import { createAccessHistoryTrainingProject, ACCESS_HISTORY_TRAINING_IDS as ids } from './trainingAccessHistoryScenario'
import type { ContextFeature, Coordinate } from './types'

const at = (x: number, y = 0): Coordinate => [-123 + x / 65000, 54 + y / 111195]
const source = (id: string, patch: Partial<HistoricalSource> = {}): HistoricalSource => ({
  id,
  dataset: 'Test source snapshot',
  recordId: id,
  url: 'https://example.gov.bc.ca/record',
  retrievedAt: '2026-11-09T00:00:00Z',
  publishedOn: null,
  description: 'Retained inventory identity, not a use record.',
  synthetic: false,
  ...patch,
})
function setup() {
  const block: ContextFeature = {
    id: 'real-block',
    name: 'FTEN block',
    kind: 'harvest',
    geometry: { type: 'Polygon', coordinates: [[at(0), at(100), at(100, 100), at(0, 100), at(0)]] },
    harvestEvidence: { source: 'bc-ften', openingId: '60677', yearMethod: 'unknown' },
  }
  const road: ContextFeature = {
    id: 'real-road',
    name: 'Mapped FTEN segment',
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: [at(0), at(-500)] },
    roadEvidence: { ...unreviewedRoadEvidence('bc-ften'), forestFileId: '1234', roadSectionId: '001' },
  }
  const state = createAccessHistoryState('2010-06-30')
  state.sources = [
    source('results:60677', {
      blockIdentity: {
        entityId: 'results:60677',
        source: 'results-opening',
        openingId: '60677',
        forestFileId: 'A16828',
        disturbanceStartDate: '2009-01-01',
        disturbanceEndDate: '2010-01-01',
      },
    }),
    source('ften:123', {
      blockIdentity: {
        entityId: 'ften:123',
        source: 'ften-cutblock',
        openingId: '60677',
        forestFileId: 'A16828',
      },
    }),
    source('different-opening', {
      blockIdentity: {
        entityId: 'results:999',
        source: 'results-opening',
        openingId: '999',
        forestFileId: 'OTHER',
      },
    }),
  ]
  return { block, road, context: [block, road], state, blockId: block.id }
}

describe('honest historical evidence coverage', () => {
  it('reports retained opening identity and nearby mapped geometry without inventing harvest, build or use dates', () => {
    const input = setup()
    const summary = assessHistoricalCoverage(input)
    expect(summary.scope).toBe('loaded-study-area')
    expect(summary.scopeLabel).toBe('Nearby loaded candidates')
    expect(summary.identity).toMatchObject({ snapshotCount: 2, entityCount: 2, conflicts: [] })
    expect(summary.identity.matchedDatasets).toEqual(['ften-cutblock', 'results-opening'])
    expect(summary.harvest.label).toBe('Harvest date unknown')
    expect(summary.roadCoverage).toMatchObject({
      total: 1,
      unknown: 1,
      compatible: 0,
      withoutDatedPhysicalEvidence: 1,
      withSourceKeys: 1,
    })
    expect(summary.pathCoverage).toMatchObject({ total: 0, documented: 0 })
    expect(summary.queryCoverage.every((query) => query.status === 'not-retained')).toBe(true)
    expect(summary.findings.find((finding) => finding.id === 'crossing-coverage')?.message).toContain(
      'does not establish',
    )
    expect(summary.findings.find((finding) => finding.id === 'disturbance-not-harvest')).toBeDefined()
    expect(summary.nextStep).toBe('place-entrance')
  })
  it('distinguishes FTEN reported harvest dates from RESULTS disturbance activity dates', () => {
    const input = setup()
    input.state.sources[1].blockIdentity!.disturbanceStartDate = '2009-01-01'
    input.state.sources[1].blockIdentity!.disturbanceEndDate = '2010-01-01'
    input.block.harvestEvidence = {
      ...input.block.harvestEvidence!,
      startDate: '2009-01-01',
      endDate: '2010-01-01',
      startYear: 2009,
      endYear: 2010,
      yearMethod: 'estimated-range',
    }
    const summary = assessHistoricalCoverage(input)
    expect(summary.harvest.label).toContain('estimated harvest')
    expect(summary.findings.find((finding) => finding.id === 'disturbance-not-harvest')?.message).toContain('RESULTS')
    expect(summary.findings.find((finding) => finding.id === 'ften-harvest-dates')?.message).toContain(
      'actual or estimated',
    )
  })

  it('separates successful zero rows from a skipped query, and retains source versions without counting duplicate entities', () => {
    const input = setup()
    input.state.sources.push(
      source('results:v2', { blockIdentity: { ...input.state.sources[0].blockIdentity!, forestFileId: 'CHANGED' } }),
      source('road-empty', {
        query: {
          source: 'ften-road-segment',
          status: 'success',
          openingId: '60677',
          recordCount: 0,
          requestUrl: 'https://example.gov.bc.ca/query',
          bounds: [-123.02, 53.99, -122.98, 54.02],
        },
      }),
      source('ften-skipped', {
        query: {
          source: 'ften-cutblock',
          status: 'skipped',
          openingId: '60677',
          recordCount: 0,
          requestUrl: '',
          reason: 'This fixture deliberately did not request polygons.',
        },
      }),
    )
    input.state = parseAccessHistoryState(input.state, input.context)
    const summary = assessHistoricalCoverage(input)
    expect(summary.identity).toMatchObject({ snapshotCount: 3, entityCount: 2 })
    expect(summary.identity.conflicts[0]).toMatchObject({ field: 'forestFileId', values: ['A16828', 'CHANGED'] })
    expect(summary.queryCoverage.find((query) => query.source === 'ften-road-segment')).toMatchObject({
      status: 'success',
      recordCount: 0,
    })
    expect(summary.queryCoverage.find((query) => query.source === 'ften-cutblock')?.status).toBe('skipped')
    expect(summary.findings.find((finding) => finding.id === 'empty-ften-road-segment')?.message).toContain(
      'stated request',
    )
    expect(summary.findings.find((finding) => finding.id === 'skipped-ften-cutblock')).toBeDefined()
    // A successful empty request does not delete a separately retained segment or claim a complete absence.
    expect(summary.roadCoverage.total).toBe(1)
  })

  it('excludes distant records, nearby unconnected synthetic evidence and unrelated global outlets for a real block', () => {
    const input = setup()
    input.context.push(
      { ...input.road, id: 'remote', geometry: { type: 'LineString', coordinates: [at(10000), at(11000)] } },
      { ...input.road, id: 'synthetic', roadEvidence: unreviewedRoadEvidence('scenario') },
    )
    input.state.sources.push(source('invented', { synthetic: true }))
    input.state.structures.push({
      id: 'invented-bridge',
      name: 'Invented nearby bridge',
      kind: 'bridge',
      coordinate: at(-50),
      sourceIds: ['invented'],
      crossingSiteId: 'SYNTHETIC:1',
      structureId: 'SYNTHETIC:2',
      sourceRowId: 'row',
      roadId: 'synthetic',
      roadKey: null,
      attachment: 'reviewed',
      attachmentToleranceM: 2,
      construction: null,
      removal: null,
      evidence: [],
    })
    input.state.anchors.push(
      {
        id: 'remote-outlet',
        name: 'Other project outlet',
        role: 'outlet',
        coordinate: at(10000),
        roadId: 'remote',
        blockId: null,
        sourceIds: [],
      },
      {
        id: 'example-outlet',
        name: 'Nearby synthetic outlet',
        role: 'outlet',
        coordinate: at(-500),
        roadId: 'synthetic',
        blockId: null,
        sourceIds: ['invented'],
      },
      {
        id: 'real-entrance',
        name: 'Block access',
        role: 'entrance',
        coordinate: at(0),
        roadId: 'real-road',
        blockId: input.blockId,
        sourceIds: [],
      },
    )
    const summary = assessHistoricalCoverage(input)
    expect(summary.roads.map((item) => item.feature.id)).toEqual(['real-road'])
    expect(summary.structures).toEqual([])
    expect(summary.anchors.outlets).toEqual([])
    expect(summary.nextStep).toBe('place-outlet')
    input.state.anchors.find((anchor) => anchor.id === 'real-entrance')!.roadId = 'synthetic'
    const explicit = assessHistoricalCoverage(input)
    expect(explicit.roads.map((item) => item.feature.id)).toContain('synthetic')
    expect(explicit.findings.find((finding) => finding.id === 'synthetic-mixing')?.tone).toBe('warning')
  })

  it('uses the selected saved path and frozen date, then falls back when that assertion becomes stale', () => {
    const project = createAccessHistoryTrainingProject()
    const state = project.accessHistory!
    state.selectedPathId = state.paths.find((path) => path.blockId === ids.blockA)!.id
    state.settings.asOf = '2022-08-01'
    const summary = assessHistoricalCoverage({ context: project.context, state, blockId: ids.blockA })
    expect(summary.scope).toBe('selected-path')
    expect(summary.asOf).toBe('2010-06-30')
    expect(summary.roadCoverage.total).toBe(summary.selectedPath!.roadIds.length)
    expect(summary.structures.map((item) => item.structure.id)).toEqual([ids.bridge])
    expect(summary.anchors.outlets.map((anchor) => anchor.id)).toEqual([ids.outlet])
    expect(summary.nextStep).toBe('review')
    state.structures[0].removal = { earliest: '2009-01-01', latest: '2009-01-01' }
    const stale = assessHistoricalCoverage({ context: project.context, state, blockId: ids.blockA })
    expect(stale.scope).toBe('loaded-study-area')
    expect(stale.selectedPath).toBeNull()
    expect(stale.pathCoverage.stale).toBeGreaterThan(0)
    expect(stale.findings.some((finding) => finding.id === 'selected-path-unavailable')).toBe(true)
  })

  it('does not count an invalid entrance as ready or extend the study area to its distant coordinate', () => {
    const input = setup()
    input.state.anchors = [
      {
        id: 'bad-entrance',
        name: 'Misplaced entrance',
        role: 'entrance',
        coordinate: at(100000),
        roadId: input.road.id,
        blockId: input.blockId,
        sourceIds: [],
      },
    ]
    const summary = assessHistoricalCoverage(input)
    expect(summary.anchors.entrances).toEqual([])
    expect(summary.anchorIssues[0].reasons.join(' ')).toContain('outside its cutblock')
    expect(summary.scopeBounds![2]).toBeLessThan(-122.9)
    expect(summary.nextStep).toBe('place-entrance')
  })
  it('retains a deliberately assigned distant outlet and scopes the corridor to it', () => {
    const input = setup()
    input.context.push({
      ...input.road,
      id: 'distant-road',
      geometry: { type: 'LineString', coordinates: [at(10000), at(11000)] },
    })
    input.state.anchors = [
      {
        id: 'entrance',
        name: 'Block access',
        role: 'entrance',
        coordinate: at(0),
        roadId: input.road.id,
        blockId: input.blockId,
        sourceIds: [],
      },
      {
        id: 'assigned-outlet',
        name: 'Deliberate destination',
        role: 'outlet',
        coordinate: at(10000),
        roadId: 'distant-road',
        blockId: input.blockId,
        sourceIds: [],
      },
    ]
    const summary = assessHistoricalCoverage(input)
    expect(summary.anchors.outlets.map((anchor) => anchor.id)).toEqual(['assigned-outlet'])
    expect(summary.roads.map((item) => item.feature.id)).toContain('distant-road')
    expect(summary.scopeBounds![2]).toBeGreaterThan(at(10000)[0])
    expect(summary.nextStep).toBe('resolve-evidence')
  })
})
