import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccessHistoryCandidates } from './AccessHistoryCandidates'
import { historicalRoadCandidates } from './accessHistoryCandidateRanking'
import { assessHistoricalCoverage } from './accessHistorySummary'
import { createAccessHistoryState } from './accessHistory'
import type { HistoricalSource } from './accessHistoryTypes'
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import type { ContextFeature, Coordinate } from './types'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))

const at = (x: number, y = 0): Coordinate => [-123 + x / 65000, 54 + y / 111195]
function fixture() {
  const block: ContextFeature = {
    id: 'block',
    name: 'Fixture block',
    kind: 'harvest',
    geometry: { type: 'Polygon', coordinates: [[at(0), at(100), at(100, 100), at(0, 100), at(0)]] },
    harvestEvidence: { source: 'bc-ften', openingId: '99001', sourceId: 'fixture-block', yearMethod: 'unknown' },
  }
  const road = (id: string, y: number): ContextFeature => ({
    id,
    name: id,
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: [at(-100, y), at(200, y)] },
    roadEvidence: {
      ...unreviewedRoadEvidence('bc-ften'),
      forestFileId: 'R12345',
      roadSectionId: id,
      clientNumber: '00000123',
      timberMark: 'ROADMARK',
    },
  })
  const sources: HistoricalSource[] = [
    {
      id: 'identity',
      dataset: 'Synthetic identity fixture',
      recordId: '99001',
      url: 'https://example.invalid/identity',
      retrievedAt: '2026-11-09T00:00:00Z',
      publishedOn: null,
      synthetic: true,
      description: 'Test only.',
      blockIdentity: {
        entityId: 'opening:99001',
        openingId: '99001',
        source: 'ften-cutblock',
        clientNumber: '00000123',
        timberMark: 'BLOCKMARK',
      },
    },
  ]
  const roads = [road('nearby', -80), road('inside', 50), road('outside-range', 1500)]
  return { block, roads, context: [block, ...roads], sources }
}

const views: ReactTestRenderer[] = []
afterEach(async () => {
  for (const view of views.splice(0)) await act(async () => view.unmount())
  vi.restoreAllMocks()
})

describe('historical road candidate review', () => {
  it('shows intersection and distance in order without manufacturing an access connection', () => {
    const input = fixture(),
      before = structuredClone(input)
    const candidates = historicalRoadCandidates(input)
    expect(candidates.map((candidate) => candidate.road.id)).toEqual(['inside', 'nearby'])
    expect(candidates[0]).toMatchObject({ distanceM: 0, client: 'same', timberMark: 'different' })
    expect(candidates[1].distanceM).toBeCloseTo(80, 0)
    expect(input).toEqual(before)
    expect(candidates.every((candidate) => candidate.road.roadEvidence?.reuseAllowed === false)).toBe(true)
  })
  it('measures every retained part of the same footprint, but only the scoped roads', () => {
    const input = fixture()
    const part = structuredClone(input.block)
    part.id = 'block-part-2'
    part.geometry = {
      type: 'Polygon',
      coordinates: [[at(0, 1450), at(100, 1450), at(100, 1550), at(0, 1550), at(0, 1450)]],
    }
    input.context.push(part)
    expect(historicalRoadCandidates(input).find(({ road }) => road.id === 'outside-range')?.distanceM).toBe(0)
    expect(historicalRoadCandidates({ ...input, roads: [input.roads[0]] }).map(({ road }) => road.id)).toEqual([
      'nearby',
    ])
  })
  it('does not infer matching codes from absent, foreign-opening or conflicting identity records', () => {
    const input = fixture()
    expect(historicalRoadCandidates({ ...input, sources: [] })[0]).toMatchObject({
      client: 'unknown',
      timberMark: 'unknown',
    })
    const foreign = structuredClone(input.sources[0])
    foreign.blockIdentity!.openingId = '99002'
    expect(historicalRoadCandidates({ ...input, sources: [foreign] })[0].client).toBe('unknown')
    const conflicting = structuredClone(input.sources[0])
    conflicting.id = 'different-identity'
    conflicting.blockIdentity!.clientNumber = '00000999'
    expect(historicalRoadCandidates({ ...input, sources: [...input.sources, conflicting] })[0].client).toBe(
      'conflicting',
    )
  })
  it('locates actual source coordinates and opens the same record when a candidate is selected', async () => {
    const input = fixture(),
      state = createAccessHistoryState('1997-07-01')
    state.sources = input.sources
    const coverage = assessHistoricalCoverage({ context: input.context, state, blockId: input.block.id })
    const inspect = vi.fn(),
      locate = vi.fn()
    let view: ReactTestRenderer
    await act(async () => {
      view = create(
        createElement(AccessHistoryCandidates, {
          coverage,
          context: input.context,
          disabled: false,
          onInspect: inspect,
          onLocate: locate,
        }),
      )
    })
    views.push(view!)
    const selected = view!.root.findByProps({ 'aria-label': 'Inspect nearby road inside' })
    await act(async () => selected.props.onClick())
    expect(inspect).toHaveBeenCalledWith('road', 'inside')
    expect(locate).toHaveBeenCalledWith(input.roads[1].geometry.coordinates)
    expect(view!.root.findAllByProps({ 'aria-label': 'Inspect nearby road outside-range' })).toHaveLength(0)
    await act(async () => view!.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'NEARBY' } }))
    expect(view!.root.findAllByProps({ 'aria-label': 'Inspect nearby road inside' })).toHaveLength(0)
    expect(view!.root.findAllByProps({ 'aria-label': 'Inspect nearby road nearby' })).not.toHaveLength(0)
    await act(async () => view!.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'R12345' } }))
    expect(view!.root.findAllByProps({ 'aria-label': 'Inspect nearby road inside' })).not.toHaveLength(0)
  })
  it('does not mix the nearby candidate list into a selected historical route', async () => {
    const input = fixture(),
      state = createAccessHistoryState()
    const coverage = assessHistoricalCoverage({ context: input.context, state, blockId: input.block.id })
    let view: ReactTestRenderer
    await act(async () => {
      view = create(
        createElement(AccessHistoryCandidates, {
          coverage: { ...coverage, scope: 'selected-path' },
          context: input.context,
          disabled: false,
          onInspect: vi.fn(),
        }),
      )
    })
    views.push(view!)
    expect(view!.toJSON()).toBeNull()
  })
})
