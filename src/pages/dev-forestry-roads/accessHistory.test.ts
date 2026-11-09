import { describe, expect, it } from 'vitest'
import { distance as distanceForTest } from './engine'
import {
  assessHistoricalPath,
  assessHistoricalStructure,
  assessHistoricalStructures,
  assessHistoricalWindow,
  createAccessHistoryState,
  historicalInputFingerprint,
  historicalSharedUsage,
  mergeHistoricalTrace,
  parseAccessHistoryState,
  reviewHistoricalPath,
  roadGeometryFingerprint,
  traceHistoricalAccess,
} from './accessHistory'
import {
  buildHistoricalRoadTopology,
  buildRoadNetwork,
  createRoadNetworkEvidence,
  createRoadNetworkPolicy,
  shortestHistoricalTopologyPath,
} from './roadNetwork'
import type { HistoricalRoadEvent, HistoricalStructure } from './accessHistoryTypes'
import type { ContextFeature, Coordinate } from './types'

const at = (x: number, y = 0): Coordinate => [
  -123 + x / (111195.0802335329 * Math.cos((54 * Math.PI) / 180)),
  54 + y / 111195.0802335329,
]
const when = (value: string) => ({ earliest: value, latest: value })
function road(id: string, coordinates: Coordinate[]): ContextFeature {
  return {
    id,
    name: id,
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates },
    roadEvidence: {
      source: 'scenario',
      sourceId: id,
      forestFileId: '001234',
      roadSectionId: id,
      condition: 'closed',
      conditionBasis: 'unreviewed',
      reuseAllowed: false,
      network: { ...createRoadNetworkEvidence(), level: 0 },
    },
  }
}
function event(
  feature: ContextFeature,
  kind: HistoricalRoadEvent['kind'] = 'constructed',
  value = '2000-01-01',
): HistoricalRoadEvent {
  return {
    id: `${kind}-${feature.id}-${value}`,
    roadId: feature.id,
    kind,
    when: when(value),
    observedOn: '2026-11-08',
    sourceIds: ['record'],
    geometryFingerprint: roadGeometryFingerprint(feature),
  }
}
function setup(detour = false) {
  const direct = road('direct', [at(0), at(100)])
  const context: ContextFeature[] = [
    direct,
    {
      id: 'block',
      name: 'Harvested block',
      kind: 'harvest',
      geometry: { type: 'Polygon', coordinates: [[at(90, -10), at(110, -10), at(110, 10), at(90, 10), at(90, -10)]] },
      harvestEvidence: { source: 'scenario', status: 'harvested', yearMethod: 'reported-year', endYear: 2010 },
    },
  ]
  if (detour) context.push(road('detour', [at(0), at(0, 100), at(100, 100), at(100)]))
  const state = createAccessHistoryState('2010-06-30')
  state.sources = [
    {
      id: 'record',
      dataset: 'Synthetic construction and access records',
      recordId: 'SYNTHETIC-1',
      url: '',
      retrievedAt: '2026-11-08T12:00:00Z',
      publishedOn: '2026-01-01',
      description: 'Invented test evidence, not a provincial record.',
      synthetic: true,
    },
  ]
  state.events = context.filter((f) => f.kind === 'existing-road').map((f) => event(f))
  state.anchors = [
    {
      id: 'entrance',
      name: 'Block boundary entrance',
      role: 'entrance',
      coordinate: at(100),
      roadId: 'direct',
      blockId: 'block',
      sourceIds: ['record'],
    },
    {
      id: 'outlet',
      name: 'Network outlet',
      role: 'outlet',
      coordinate: at(0),
      roadId: 'direct',
      blockId: null,
      sourceIds: ['record'],
    },
  ]
  return { context, state, direct }
}
function bridge(patch: Partial<HistoricalStructure> = {}): HistoricalStructure {
  return {
    id: 'bridge',
    name: 'Invented bridge',
    kind: 'bridge',
    coordinate: at(50),
    sourceIds: ['record'],
    crossingSiteId: 'SITE-1',
    structureId: 'BRIDGE-1',
    sourceRowId: 'ROW-1',
    roadId: 'direct',
    roadKey: { forestFileId: '001234', roadSectionId: 'direct' },
    attachment: 'identifier-match',
    attachmentToleranceM: 2,
    construction: when('2000-01-01'),
    removal: null,
    evidence: [],
    ...patch,
  }
}
const trace = (f: ReturnType<typeof setup>) =>
  traceHistoricalAccess({ context: f.context, state: f.state, blockId: 'block' })

describe('historical event chronology', () => {
  it('uses physical event intervals, not publication or observation dates', () => {
    const f = setup(),
      e = f.state.events[0]
    expect(assessHistoricalWindow(when('2010-01-01'), [e]).status).toBe('compatible')
    e.when = { earliest: '2011-01-01', latest: '2012-12-31' }
    expect(assessHistoricalWindow(when('2010-01-01'), [e]).status).toBe('contradicted')
    e.kind = 'present-observed'
    expect(assessHistoricalWindow(when('2010-01-01'), [e]).status).toBe('unknown')
  })
  it('keeps uncertain build dates and physical deactivation/reactivation separate', () => {
    const f = setup(),
      built = f.state.events[0]
    built.when = { earliest: '2008-01-01', latest: '2012-01-01' }
    expect(assessHistoricalWindow(when('2010-01-01'), [built]).status).toBe('unknown')
    built.when = when('2000-01-01')
    const closed = event(f.direct, 'deactivated', '2005-01-01'),
      reopened = event(f.direct, 'reactivated', '2012-01-01')
    expect(assessHistoricalWindow(when('2010-01-01'), [built, closed, reopened]).status).toBe('contradicted')
    expect(assessHistoricalWindow(when('2013-01-01'), [built, closed, reopened]).status).toBe('compatible')
  })
  it('does not let uncertain physical closure timing become a known available road', () => {
    const f = setup(),
      closed = event(f.direct, 'closed')
    closed.when = { earliest: null, latest: null }
    expect(assessHistoricalWindow(when('2010-01-01'), [...f.state.events, closed]).status).toBe('unknown')
  })
  it('reports incompatible incarnation records as conflict', () => {
    const f = setup()
    expect(
      assessHistoricalWindow(when('2010-01-01'), [...f.state.events, event(f.direct, 'constructed', '2015-01-01')])
        .status,
    ).toBe('conflict')
  })
})

describe('historical graph and association', () => {
  it('shares strict topology while leaving current-use eligibility unchanged', () => {
    const f = setup(),
      result = trace(f)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0].relationship).toBe('inferred-access')
    expect(result.paths[0].lengthM).toBeCloseTo(100, 1)
    expect(f.direct.roadEvidence!.reuseAllowed).toBe(false)
    expect(f.direct.roadEvidence!.condition).toBe('closed')
    expect(
      buildRoadNetwork(
        [
          {
            id: 'direct',
            name: 'direct',
            coordinates: [at(0), at(100)],
            evidence: f.direct.roadEvidence,
            network: f.direct.roadEvidence!.network,
          },
        ],
        createRoadNetworkPolicy('2010-06-30'),
      ).edges.size,
    ).toBe(0)
  })
  it('does not invent a junction where two line interiors cross', () => {
    const graph = buildHistoricalRoadTopology(
      [
        { id: 'east-west', name: 'EW', coordinates: [at(-100), at(100)], level: 0, junctions: [] },
        { id: 'north-south', name: 'NS', coordinates: [at(0, -100), at(0, 100)], level: 0, junctions: [] },
      ],
      { snapToleranceM: 1, attachmentToleranceM: 1, allowUnverifiedEndpointSnaps: false },
      [
        { id: 'start', roadId: 'east-west', coordinate: at(-100) },
        { id: 'end', roadId: 'north-south', coordinate: at(0, 100) },
      ],
    )
    expect(graph.mode).toBe('historical-topology')
    expect(shortestHistoricalTopologyPath(graph, 'start', 'end')).toBeNull()
    expect([...graph.edges.values()].every((e) => !e.reused && e.costItems.length === 0)).toBe(true)
  })
  it('requires a real entrance associated with the footprint, never a centroid fallback', () => {
    const f = setup()
    f.state.anchors = f.state.anchors.filter((a) => a.role !== 'entrance')
    expect(trace(f).paths).toEqual([])
    f.state.anchors.push({
      id: 'wrong',
      name: 'Wrong entrance',
      role: 'entrance',
      coordinate: at(0),
      roadId: 'direct',
      blockId: 'block',
      sourceIds: [],
    })
    const result = trace(f)
    expect(result.paths).toEqual([])
    expect(result.unresolved.join(' ')).toContain('outside the selected cutblock')
  })
  it('blocks future construction even when unknown timing is allowed', () => {
    const f = setup()
    f.state.events = [event(f.direct, 'constructed', '2016-01-01')]
    f.state.settings.allowUnknownTime = true
    expect(trace(f).paths).toEqual([])
    expect(trace(f).excludedRoads[0].reasons.join(' ')).toContain('after the analysis date')
  })
  it('requires an explicit unknown-time assumption and records it on the path', () => {
    const f = setup()
    f.state.events = []
    expect(trace(f).paths).toEqual([])
    f.state.settings.allowUnknownTime = true
    expect(trace(f).paths[0].assumptions.join(' ')).toContain('Unknown historical timing was explicitly allowed')
  })
  it('finds bounded alternatives while retaining exact segment paths and unknown prices', () => {
    const f = setup(true),
      result = trace(f)
    expect(result.paths).toHaveLength(2)
    expect(result.paths[0].roadIds).toEqual(['direct'])
    expect(result.paths[1].roadIds).toEqual(['detour'])
    expect(result.paths[1].lengthM).toBeGreaterThan(299)
    const saved = mergeHistoricalTrace(f.state, result)
    expect(parseAccessHistoryState(JSON.parse(JSON.stringify(saved)), f.context)).toEqual(saved)
    expect(historicalSharedUsage(saved.paths).constructionCost).toBeNull()
  })
  it('keeps prior dated paths fresh when only the date selector changes', () => {
    const f = setup(),
      saved = mergeHistoricalTrace(f.state, trace(f)),
      path = saved.paths[0]
    saved.settings.asOf = '2020-01-01'
    expect(assessHistoricalPath(path, saved, f.context).stale).toBe(false)
    expect(path.settings.asOf).toBe('2010-06-30')
    f.direct.roadEvidence!.forestFileId = 'DIFFERENT'
    expect(assessHistoricalPath(path, saved, f.context).stale).toBe(true)
  })
  it('marks changed geometry stale and does not reuse event scope on a refreshed line', () => {
    const f = setup(),
      saved = mergeHistoricalTrace(f.state, trace(f)),
      path = saved.paths[0]
    f.direct.geometry = { type: 'LineString', coordinates: [at(0, 1), at(100)] }
    expect(assessHistoricalPath(path, saved, f.context).temporalStatus).toBe('conflict')
    expect(trace({ ...f, state: saved }).paths).toEqual([])
    expect(() =>
      reviewHistoricalPath(
        saved,
        path.id,
        'documented-use',
        { reviewer: 'Reviewer', reviewedOn: '2026-11-08', reference: 'Report A' },
        ['record'],
        f.context,
      ),
    ).toThrow(/Retrace/)
  })
  it('requires an explicit reviewed assertion for planned or documented use', () => {
    const f = setup(),
      saved = mergeHistoricalTrace(f.state, trace(f)),
      id = saved.paths[0].id
    expect(() =>
      reviewHistoricalPath(
        saved,
        id,
        'documented-use',
        { reviewer: 'Reviewer', reviewedOn: '2026-11-08', reference: 'Haul record A' },
        [],
        f.context,
      ),
    ).toThrow(/actual/)
    const planned = reviewHistoricalPath(
      saved,
      id,
      'planned-access',
      { reviewer: 'Reviewer', reviewedOn: '2026-11-08', reference: 'Access plan A, not proof of use' },
      ['record'],
      f.context,
    )
    expect(mergeHistoricalTrace(planned, trace(f)).paths[0].relationship).toBe('planned-access')
    expect(trace(f).paths[0].relationship).toBe('inferred-access')
  })
})

describe('historical structure identity and dates', () => {
  it('joins an identified structure only within its explicit physical-road tolerance', () => {
    const f = setup()
    f.state.structures = [bridge()]
    expect(trace(f).paths[0].structureIds).toEqual(['bridge'])
    f.state.structures[0].coordinate = at(50, 100)
    const result = trace(f)
    expect(result.paths[0].structureIds).toEqual([])
    expect(result.unresolved.join(' ')).toContain('attachment tolerance')
    f.state.structures[0].coordinate = at(50)
    f.state.structures[0].roadKey!.forestFileId = 'WRONG'
    expect(trace(f).unresolved.join(' ')).toContain('does not match')
  })
  it('keeps an explicitly reviewed road key binding while allowing an unkeyed manual association', () => {
    const f = setup()
    f.state.structures = [bridge({ attachment: 'reviewed' })]
    expect(assessHistoricalStructures(f.state, f.context)[0].binding).toBe('matched')
    f.direct.roadEvidence!.roadSectionId = 'replacement-section'
    expect(assessHistoricalStructures(f.state, f.context)[0].binding).toBe('unresolved')
    expect(assessHistoricalStructures(f.state, f.context)[0].status).toBe('unknown')
    f.state.structures[0].roadKey = null
    expect(assessHistoricalStructures(f.state, f.context)[0].binding).toBe('matched')
  })
  it('blocks only the dated closed crossing and can still use an independent detour', () => {
    const f = setup(true)
    f.state.structures = [
      bridge({
        evidence: [
          {
            id: 'closure',
            kind: 'closure',
            sourceIds: ['record'],
            validFrom: '2008-01-01',
            validUntil: null,
            ratedLoadTonnes: null,
            description: 'Closed at the historical date',
          },
        ],
      }),
    ]
    const result = trace(f)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0].roadIds).toEqual(['detour'])
    expect(result.structures[0].status).toBe('contradicted')
  })
  it('does not carry a later closure backwards into an earlier period', () => {
    const f = setup()
    f.state.structures = [
      bridge({
        evidence: [
          {
            id: 'closure',
            kind: 'closure',
            sourceIds: ['record'],
            validFrom: '2019-01-01',
            validUntil: null,
            ratedLoadTonnes: null,
            description: 'Later closure',
          },
        ],
      }),
    ]
    expect(trace(f).paths).toHaveLength(1)
    f.state.settings.asOf = '2020-01-01'
    expect(trace(f).paths).toHaveLength(0)
  })
  it('does not let another row for the same physical bridge override its closure', () => {
    const f = setup()
    f.state.structures = [
      bridge(),
      bridge({
        id: 'bridge-closed-row',
        sourceRowId: 'ROW-2',
        evidence: [
          {
            id: 'closed-report',
            kind: 'closure',
            sourceIds: ['record'],
            validFrom: '2008-01-01',
            validUntil: null,
            ratedLoadTonnes: null,
            description: 'Separate report closes this same physical bridge.',
          },
        ],
      }),
    ]
    const result = trace(f)
    expect(result.paths).toEqual([])
    expect(result.structures.every((s) => s.status === 'conflict')).toBe(true)
  })
  it.each(['future construction', 'earlier removal'])(
    'does not let an undated duplicate row override %s',
    (caseName) => {
      const f = setup()
      f.state.settings.allowUnknownTime = true
      f.state.structures = [
        bridge(
          caseName === 'future construction' ? { construction: when('2015-01-01') } : { removal: when('2005-01-01') },
        ),
        bridge({ id: 'undated-copy', sourceRowId: 'ROW-UNDATE', construction: null }),
      ]
      const result = trace(f)
      expect(result.paths).toEqual([])
      expect(result.structures.every((s) => s.status === 'contradicted')).toBe(true)
      expect(assessHistoricalStructures(f.state, f.context).map((s) => s.status)).toEqual(
        result.structures.map((s) => s.status),
      )
    },
  )
  it('can use a distinct documented predecessor without backdating its replacement', () => {
    const f = setup()
    f.state.structures = [
      bridge({ id: 'old-bridge', structureId: 'OLD', removal: when('2014-01-01') }),
      bridge({ id: 'new-bridge', structureId: 'NEW', construction: when('2015-01-01') }),
    ]
    const result = trace(f)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0].structureIds).toEqual(['old-bridge'])
  })
  it('does not use a bridge constructed after harvesting without an established predecessor', () => {
    const f = setup()
    f.state.structures = [bridge({ construction: when('2015-01-01') })]
    f.state.settings.allowUnknownTime = true
    expect(trace(f).paths).toEqual([])
  })
  it('preserves conflicting open-ended dated ratings and ignores undated inventory as historic capacity', () => {
    const reports = [40, 0].map((ratedLoadTonnes, i) => ({
      id: `rating-${i}`,
      kind: 'load-rating' as const,
      sourceIds: ['record'],
      validFrom: '2008-01-01',
      validUntil: null,
      ratedLoadTonnes,
      description: `Separate source report ${i}`,
    }))
    expect(assessHistoricalStructure(bridge({ evidence: reports }), '2010-01-01').status).toBe('conflict')
    expect(
      assessHistoricalStructure(bridge({ evidence: reports.map((r) => ({ ...r, validFrom: null })) }), '2010-01-01')
        .status,
    ).toBe('compatible')
  })
  it('includes missing, removed, conflicted and re-bound structures when assessing a saved path', () => {
    const f = setup()
    f.state.structures = [bridge()]
    const saved = mergeHistoricalTrace(f.state, trace(f)),
      path = saved.paths[0]
    saved.structures[0].removal = when('2009-01-01')
    expect(assessHistoricalPath(path, saved, f.context).temporalStatus).toBe('contradicted')
    expect(() =>
      reviewHistoricalPath(
        saved,
        path.id,
        'documented-use',
        { reviewer: 'Reviewer', reviewedOn: '2026-11-08', reference: 'Claim' },
        ['record'],
        f.context,
      ),
    ).toThrow(/Retrace/)
    saved.structures = []
    expect(assessHistoricalPath(path, saved, f.context).connectivity).toBe('unresolved')
  })
})

describe('portable evidence integrity and shared segments', () => {
  it('rejects invalid dates, unsafe links, dangling sources and forged disconnected paths', () => {
    const f = setup(),
      saved = mergeHistoricalTrace(f.state, trace(f))
    expect(() => parseAccessHistoryState({ ...saved, settings: { ...saved.settings, asOf: '2010-02-30' } })).toThrow(
      /real/,
    )
    expect(() =>
      parseAccessHistoryState({ ...saved, sources: [{ ...saved.sources[0], url: 'javascript:alert(1)' }] }),
    ).toThrow(/HTTP/)
    expect(() => parseAccessHistoryState({ ...saved, sources: [] })).toThrow(/missing/)
    const changed = structuredClone(saved)
    changed.paths[0].lengthM += 10
    expect(() => parseAccessHistoryState(changed)).toThrow(/total/)
    changed.paths[0] = structuredClone(saved.paths[0])
    changed.paths[0].coordinates[0] = at(0, 100)
    expect(() => parseAccessHistoryState(changed)).toThrow(/geometry/)
  })
  it('deduplicates shared physical road length and structure sites, without inventing costs', () => {
    const f = setup()
    f.state.structures = [bridge()]
    const paths = trace(f).paths
    const same = { ...paths[0], id: 'other-block-path', blockId: 'other-block' }
    const usage = historicalSharedUsage([...paths, same], f.state)
    expect(usage.summedPathRoadLengthM).toBeCloseTo(200, 1)
    expect(usage.uniqueRoadLengthM).toBeCloseTo(100, 1)
    expect(usage.sharedRoadLengthM).toBeCloseTo(100, 1)
    expect(usage.uniqueStructureCount).toBe(1)
    expect(usage.constructionCost).toBeNull()
  })
  it('does not count an old and translated replacement geometry as the same physical segment', () => {
    const f = setup(),
      first = trace(f).paths[0]
    const moved = structuredClone(first)
    moved.id = 'replacement'
    for (const segment of moved.segments)
      segment.coordinates = segment.coordinates.map((c) => [c[0], c[1] + 0.01]) as [Coordinate, Coordinate]
    expect(historicalSharedUsage([first, moved]).uniqueRoadLengthM).toBeGreaterThan(199)
  })
  it('fingerprints topology and identifiers but not present condition or the selected route', () => {
    const f = setup(),
      before = historicalInputFingerprint(f.context, f.state)
    f.direct.roadEvidence!.condition = 'serviceable'
    expect(historicalInputFingerprint(f.context, f.state)).toBe(before)
    f.direct.roadEvidence!.roadSectionId = 'new-section'
    expect(historicalInputFingerprint(f.context, f.state)).not.toBe(before)
  })
  it('retains structured RESULTS and FTEN business keys without converting leading zeroes', () => {
    const f = setup()
    f.state.sources[0].blockIdentity = {
      entityId: 'results:60677',
      source: 'results-opening',
      openingId: '60677',
      forestFileId: 'A16828',
      cuttingPermitId: '249',
      cutBlockId: '001',
      timberMark: 'F78383',
      clientNumber: '00001430',
      disturbanceStartDate: '2009-01-01',
      disturbanceEndDate: '2010-06-01',
    }
    expect(parseAccessHistoryState(f.state).sources[0].blockIdentity).toEqual(f.state.sources[0].blockIdentity)
  })
  it('rejects a self-consistent edited path that leaves its identified source roads', () => {
    const f = setup(),
      saved = mergeHistoricalTrace(f.state, trace(f)),
      path = saved.paths[0]
    for (const segment of path.segments) {
      segment.coordinates = segment.coordinates.map((p) => [p[0], p[1] + 0.0001]) as [Coordinate, Coordinate]
      segment.lengthM = distanceForTest(segment.coordinates[0], segment.coordinates[1])
    }
    path.coordinates = [path.segments[0].coordinates[0], ...path.segments.map((s) => s.coordinates[1])]
    path.lengthM = path.segments.reduce((n, s) => n + s.lengthM, 0)
    expect(() => parseAccessHistoryState(saved, f.context)).toThrow(/identified source segments/)
    expect(assessHistoricalPath(path, saved, f.context).connectivity).toBe('unresolved')
  })
  it('retains distinct applicable structure-report provenance on a derived path', () => {
    const f = setup()
    f.state.sources.push({
      ...f.state.sources[0],
      id: 'separate-rating',
      recordId: 'RATING-4',
      description: 'Separate dated report',
    })
    f.state.structures = [
      bridge({
        evidence: [
          {
            id: 'rating',
            kind: 'load-rating',
            sourceIds: ['separate-rating'],
            validFrom: '2005-01-01',
            validUntil: '2012-01-01',
            ratedLoadTonnes: 40,
            description: 'A dated rating report',
          },
        ],
      }),
    ]
    expect(trace(f).paths[0].sourceIds).toContain('separate-rating')
  })
  it('counts shared source segments once even when the travel directions are opposite', () => {
    const f = setup(),
      path = trace(f).paths[0],
      reverse = structuredClone(path)
    reverse.id = 'opposite-travel'
    reverse.segments.reverse()
    for (const segment of reverse.segments) {
      segment.forward = !segment.forward
      segment.coordinates.reverse()
    }
    reverse.coordinates.reverse()
    expect(historicalSharedUsage([path, reverse]).uniqueRoadLengthM).toBeCloseTo(100, 1)
  })
})
