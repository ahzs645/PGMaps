import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileDropField } from '@/components/ui/file-drop-field'
import { downloadText } from '@/lib/download'
import { KeyValueRows } from '@/components/ui/map-panels'
import { AccessHistoryPanel } from './AccessHistoryPanel'
import { accessHistoryBundle } from './AccessHistoryIO'
import * as historySources from './accessHistorySources'
import * as pilotSources from './bcAccessPilot'
import type { AccessHistorySelection } from './AccessHistorySelection'
import { Field } from './Controls'
import { parseProject } from './project'
import { ACCESS_HISTORY_TRAINING_IDS, createAccessHistoryTrainingProject } from './trainingAccessHistoryScenario'
import type { ContextFeature, RoadProject } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('./SidebarParts', () => ({
  RoadSection: ({ children }: { children: ReactNode }) => createElement('section', {}, children),
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children }: { children: ReactNode }) => createElement('div', { role: 'alert' }, children),
  KeyValueRows: ({ rows }: { rows: ({ key: string; label: string; value: ReactNode } | null)[] }) =>
    createElement(
      'dl',
      {},
      rows.filter(Boolean).map((row) => createElement('div', { key: row!.key }, `${row!.label}: `, row!.value)),
    ),
}))
vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))

const views: ReactTestRenderer[] = []
afterEach(async () => {
  for (const view of views.splice(0)) await act(async () => view.unmount())
  vi.restoreAllMocks()
})

async function harness(initial = parseProject(createAccessHistoryTrainingProject())) {
  let project = initial
  let selection: AccessHistorySelection | null = null
  let renderer: ReactTestRenderer
  const locate = vi.fn()
  const notice = vi.fn()
  const update = vi.fn((change: (project: RoadProject) => RoadProject) => {
    project = change(project)
    renderer.update(view())
  })
  const workspace = () =>
    ({
      project,
      projectId: 'history-test',
      alignment: project.alignments[0],
      busy: '',
      update,
      setNotice: notice,
      canUndo: false,
      undo: vi.fn(),
    }) as unknown as RoadWorkspace
  const view = () => createElement(AccessHistoryPanel, { workspace: workspace(), onLocate: locate, selection })
  await act(async () => {
    renderer = create(view())
  })
  views.push(renderer!)
  return {
    renderer: renderer!,
    locate,
    notice,
    update,
    get project() {
      return project
    },
    replace(next: RoadProject) {
      project = next
      renderer.update(view())
    },
    select(next: AccessHistorySelection) {
      selection = next
      renderer.update(view())
    },
  }
}

function button(renderer: ReactTestRenderer, label: string) {
  const found = renderer.root.findAllByType('button').find((node) => node.children.join('') === label)
  if (!found) throw Error(`Missing button: ${label}`)
  return found
}
function control(renderer: ReactTestRenderer, label: string, type: 'input' | 'textarea' = 'input') {
  return renderer.root
    .findAllByType(Field)
    .find((node) => node.props.label === label)!
    .findByType(type)
}
function fileField(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType(FileDropField).find((node) => node.props.label === 'Access history bundle')!
}

const content = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(content).join('')

/** Invented test geometry and codes exercise live-source semantics without storing a ministry extract. */
function pilotFixture(): pilotSources.BcAccessPilotResult {
  const template = createAccessHistoryTrainingProject()
  const openingId = pilotSources.BC_ACCESS_PILOT_RECIPE.openingId
  const retrievedAt = '2026-11-09T18:00:00Z'
  const original = template.context.find((feature) => feature.id === ACCESS_HISTORY_TRAINING_IDS.blockA)!
  if (original.geometry.type !== 'Polygon') throw Error('Expected test polygon.')
  const block: ContextFeature = {
    id: 'fixture-ministry-block',
    name: 'Fixture ministry block',
    kind: 'harvest',
    geometry: {
      type: 'Polygon',
      coordinates: original.geometry.coordinates.map((ring) => ring.map(([x, y]) => [x - 1, y + 1])),
    },
    harvestEvidence: {
      source: 'bc-ften',
      sourceId: '99001',
      openingId,
      yearMethod: 'estimated-range',
      startDate: '2004-06-01',
      endDate: '2005-06-01',
      startYear: 2004,
      endYear: 2005,
      retrievedAt,
      sourceUrl: 'https://example.invalid/fixture-block',
    },
  }
  const start = block.geometry.type === 'Polygon' ? block.geometry.coordinates[0][0] : [0, 0]
  const road: ContextFeature = {
    id: 'fixture-ministry-road',
    name: 'Fixture nearby road',
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates: [start, [start[0] + 0.001, start[1]]] },
    roadEvidence: {
      source: 'bc-ften',
      sourceId: 'ften-road-segment:99002',
      sourceUrl: 'https://example.invalid/fixture-road',
      retrievedAt,
      forestFileId: '000012',
      roadSectionId: '01',
      segmentStartStation: 0,
      segmentEndStation: 1.8934000000000002,
      clientNumber: '00000991',
      condition: 'unknown',
      conditionBasis: 'unreviewed',
      reuseAllowed: false,
    },
  }
  const identity: historySources.BlockIdentityLookup = {
    openingId,
    retrievedAt,
    missingSources: [],
    records: (['results-opening', 'ften-cutblock'] as const).map((source) => ({
      id: `fixture-${source}`,
      source,
      sourceUrl: 'https://example.invalid/fixture-identity',
      retrievedAt,
      openingId,
      forestFileId: '000012',
      cuttingPermitId: '002',
      cutBlockId: 'A01',
      timberMark: 'TEST01',
      clientNumber: '00000991',
    })),
    matches: [
      {
        resultsRecordId: 'fixture-results-opening',
        ftenRecordId: 'fixture-ften-cutblock',
        basis: 'opening-id',
        conflicts: [],
      },
    ],
  }
  const bounds: [number, number, number, number] = [start[0] - 0.01, start[1] - 0.01, start[0] + 0.02, start[1] + 0.02]
  const queries = (['results-opening', 'ften-cutblock', 'ften-road-segment'] as const).map((source) => ({
    source,
    status: 'success' as const,
    recordCount: 1,
    openingId,
    requestUrl: `https://example.invalid/${source}`,
    ...(source === 'ften-road-segment' ? { bounds } : {}),
  }))
  return {
    status: 'loaded',
    openingId,
    retrievedAt,
    bounds,
    blocks: [block],
    roads: [road],
    identity,
    queries,
    sources: [
      ...historySources.blockIdentitySources(identity),
      ...historySources.roadSegmentSources([road]),
      ...queries.map((query) => pilotSources.makeHistoricalSourceQuery(query, retrievedAt)),
    ],
    findings: [
      {
        id: 'unknown-road-dates',
        kind: 'gap',
        text: 'Physical road dates are missing in this test fixture.',
        sourceIds: [],
      },
    ],
    roadCandidates: [
      {
        roadId: road.id,
        distanceM: 0,
        sharedClient: true,
        sharedTimberMark: false,
        sourceIds: ['ften-road-segment:99002'],
      },
    ],
  }
}

describe('historical access workflow', () => {
  it('previews actual-source records before adding them and keeps unrelated training records out of the selected-block summary', async () => {
    const result = pilotFixture()
    vi.spyOn(pilotSources, 'loadBcAccessPilot').mockResolvedValue(result)
    const h = await harness()
    const before = h.project
    await act(async () => button(h.renderer, 'Load actual BC records').props.onClick())
    expect(h.project).toBe(before)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-pilot-preview' })).toHaveLength(1)
    await act(async () => button(h.renderer, 'Add records to this project').props.onClick())
    expect(h.project.context).toHaveLength(before.context.length + 2)
    expect(h.project.accessHistory!.anchors).toEqual(before.accessHistory!.anchors)
    expect(h.project.accessHistory!.paths).toEqual(before.accessHistory!.paths)
    const overview = content(h.renderer.root.findByProps({ 'data-testid': 'history-block-overview' }))
    expect(overview).toContain('Fixture ministry block')
    expect(overview).toContain('1 road record · 0 structure records')
    expect(overview).toContain('connection not established')
    expect(overview).toContain('Roads with dated physical evidence: 0 / 1')
    expect(overview).toContain('2004-06-01')
    expect(overview).toContain('completion or range may be estimated')
    expect(h.locate).toHaveBeenCalledWith(
      result.blocks[0].geometry.type === 'Polygon' ? result.blocks[0].geometry.coordinates[0] : [],
    )
    expect(h.project.context.find((feature) => feature.id === result.roads[0].id)?.roadEvidence?.reuseAllowed).toBe(
      false,
    )
    await act(async () => h.select({ kind: 'road', id: result.roads[0].id, revision: 1 }))
    const roadText = content(h.renderer.root.findByProps({ 'data-testid': 'history-selected-road-record' }))
    expect(roadText).toContain('Source stations: 0 – 1.8934')
    expect(roadText).not.toContain('1.8934000000000002')
    expect(
      h.project.context.find((feature) => feature.id === result.roads[0].id)?.roadEvidence?.segmentEndStation,
    ).toBe(1.8934000000000002)
  })

  it('opens readable road and structure records from map selection and keeps the selected block in sync', async () => {
    const h = await harness()
    await act(async () => h.select({ kind: 'block', id: ACCESS_HISTORY_TRAINING_IDS.blockB, revision: 1 }))
    expect(
      h.project.accessHistory!.paths.find((path) => path.id === h.project.accessHistory!.selectedPathId)?.blockId,
    ).toBe(ACCESS_HISTORY_TRAINING_IDS.blockB)
    await act(async () => h.select({ kind: 'road', id: ACCESS_HISTORY_TRAINING_IDS.west, revision: 2 }))
    const road = content(h.renderer.root.findByProps({ 'data-testid': 'history-selected-road-record' }))
    expect(road).toContain('009900')
    expect(road).toContain('001')
    expect(road).toContain('1988-06-01')
    await act(async () => h.select({ kind: 'structure', id: ACCESS_HISTORY_TRAINING_IDS.bridge, revision: 3 }))
    const structure = content(h.renderer.root.findByProps({ 'data-testid': 'history-selected-structure-record' }))
    expect(structure).toContain('SYNTHETIC-BRIDGE-01')
    expect(structure).toContain('Invented closure effective 2019-01-01')
    expect(structure).toContain('reported 0 t')
  })

  it('rejects a stale pilot preview and distinguishes a source failure from an empty response', async () => {
    const loader = vi.spyOn(pilotSources, 'loadBcAccessPilot').mockResolvedValue(pilotFixture())
    const h = await harness()
    await act(async () => button(h.renderer, 'Load actual BC records').props.onClick())
    const replacement = parseProject(createAccessHistoryTrainingProject())
    await act(async () => h.replace(replacement))
    await act(async () => button(h.renderer, 'Add records to this project').props.onClick())
    expect(h.project).toBe(replacement)
    expect(h.update).not.toHaveBeenCalled()
    loader.mockRejectedValue(Error('Source unavailable; retry the request.'))
    await act(async () => button(h.renderer, 'Load actual BC records').props.onClick())
    expect(h.project).toBe(replacement)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-pilot-preview' })).toHaveLength(0)
    expect(content(h.renderer.root.findByProps({ 'data-testid': 'history-block-overview' }))).toContain(
      'Source unavailable; retry the request.',
    )
  })

  it('retains successful empty query coverage without clearing the selected route', async () => {
    const result = pilotFixture()
    result.status = 'no-block-found'
    result.blocks = []
    result.roads = []
    result.roadCandidates = []
    result.identity = {
      ...result.identity,
      records: [],
      matches: [],
      missingSources: ['results-opening', 'ften-cutblock'],
    }
    result.queries = result.queries.map((query) => ({
      ...query,
      recordCount: 0,
      ...(query.source === 'ften-road-segment'
        ? ({ status: 'skipped', reason: 'No cutblock footprint was returned.' } as const)
        : {}),
    }))
    result.sources = result.queries.map((query) => pilotSources.makeHistoricalSourceQuery(query, result.retrievedAt))
    vi.spyOn(pilotSources, 'loadBcAccessPilot').mockResolvedValue(result)
    const h = await harness()
    const selected = h.project.accessHistory!.selectedPathId
    const count = h.project.context.length
    await act(async () => button(h.renderer, 'Load actual BC records').props.onClick())
    expect(content(h.renderer.root.findByProps({ 'data-testid': 'history-pilot-preview' }))).toContain(
      '0 block polygons',
    )
    await act(async () => button(h.renderer, 'Add records to this project').props.onClick())
    expect(h.project.context).toHaveLength(count)
    expect(h.project.accessHistory!.selectedPathId).toBe(selected)
    expect(
      h.project
        .accessHistory!.sources.filter((source) => source.query)
        .map((source) => [source.query!.status, source.query!.recordCount]),
    ).toEqual([
      ['success', 0],
      ['success', 0],
      ['skipped', 0],
    ])
  })

  it('cancels a pilot request and ignores a late response without changing the project', async () => {
    let finish!: (result: pilotSources.BcAccessPilotResult) => void
    const pending = new Promise<pilotSources.BcAccessPilotResult>((resolve) => {
      finish = resolve
    })
    const loader = vi.spyOn(pilotSources, 'loadBcAccessPilot').mockReturnValue(pending)
    const h = await harness()
    const before = h.project
    await act(async () => button(h.renderer, 'Load actual BC records').props.onClick())
    await act(async () => button(h.renderer, 'Cancel source request').props.onClick())
    expect(loader.mock.calls[0][1]?.aborted).toBe(true)
    await act(async () => {
      finish(pilotFixture())
      await pending
    })
    expect(h.project).toBe(before)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-pilot-preview' })).toHaveLength(0)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('traces, selects and locates a candidate without enabling road reuse', async () => {
    const h = await harness()
    await act(async () =>
      h.renderer.root
        .findByProps({ 'aria-label': 'Access-history cutblock' })
        .props.onChange({ target: { value: ACCESS_HISTORY_TRAINING_IDS.blockA } }),
    )
    expect(
      h.project.accessHistory!.paths.find((path) => path.id === h.project.accessHistory!.selectedPathId)?.blockId,
    ).toBe(ACCESS_HISTORY_TRAINING_IDS.blockA)
    await act(async () => button(h.renderer, 'Trace historical access').props.onClick())
    const selected = h.project.accessHistory!.paths.find((path) => path.id === h.project.accessHistory!.selectedPathId)!
    expect(selected.blockId).toBe(ACCESS_HISTORY_TRAINING_IDS.blockA)
    expect(selected.relationship).toBe('inferred-access')
    expect(selected.roadIds).not.toContain(ACCESS_HISTORY_TRAINING_IDS.bypass)
    const rows = h.renderer.root.findAllByType(KeyValueRows).flatMap((node) => node.props.rows)
    const roadNames = rows.find((row) => row?.key === 'roads')?.value as string
    expect(roadNames.indexOf('spur A')).toBeLessThan(roadNames.indexOf('bridge road'))
    expect(roadNames.indexOf('bridge road')).toBeLessThan(roadNames.indexOf('mainline west'))
    expect(
      h.project.context
        .filter((feature) => feature.roadEvidence)
        .every((feature) => !feature.roadEvidence!.reuseAllowed),
    ).toBe(true)
    await act(async () => h.renderer.root.findByProps({ 'aria-label': 'Locate historical route' }).props.onClick())
    expect(h.locate).toHaveBeenCalledWith(selected.coordinates)
  })

  it('invalidates latest trace diagnostics when inputs change while retaining dated assertions', async () => {
    const h = await harness()
    await act(async () => button(h.renderer, 'Trace historical access').props.onClick())
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-trace-results' })).toHaveLength(1)
    const history = h.project.accessHistory!
    await act(async () =>
      h.replace({
        ...h.project,
        accessHistory: { ...history, paths: history.paths.map((path) => ({ ...path, relationship: 'proximity' })) },
      }),
    )
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-trace-results' })).toHaveLength(1)
    await act(async () => control(h.renderer, 'Historical date').props.onChange({ target: { value: '2020-06-30' } }))
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-trace-results' })).toHaveLength(0)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-trace-changed' })).toHaveLength(1)
    expect(h.project.accessHistory!.paths.every((path) => path.period.earliest === '2010-06-30')).toBe(true)
  })

  it('rejects a refreshed road with changed business fields without altering saved evidence', async () => {
    const initial = parseProject(createAccessHistoryTrainingProject())
    const road = initial.context.find((feature) => feature.id === ACCESS_HISTORY_TRAINING_IDS.west)!
    const changed = { ...road, roadEvidence: { ...road.roadEvidence!, segmentStartStation: 100 } }
    const loader = vi.spyOn(historySources, 'loadBcRoadSegments').mockResolvedValue([changed])
    const h = await harness(initial)
    await act(async () => {
      button(h.renderer, 'Load open road segments').props.onClick()
    })
    expect(loader).toHaveBeenCalledTimes(1)
    expect(h.project).toBe(initial)
    expect(
      h.renderer.root
        .findAllByProps({ role: 'alert' })
        .some((node) => node.children.join('').includes('changed source fields')),
    ).toBe(true)
  })

  it('saves an explicit reviewed assertion with its source and preserves current reuse choices', async () => {
    const h = await harness()
    await act(async () => {
      h.renderer.root
        .findByProps({ 'aria-label': 'Reviewed relationship' })
        .props.onChange({ target: { value: 'documented-use' } })
      h.renderer.root
        .findByProps({ 'aria-label': 'Review source' })
        .props.onChange({ target: { value: 'example-haul-ledger' } })
      control(h.renderer, 'Reviewer').props.onChange({ target: { value: 'Training reviewer' } })
      control(h.renderer, 'Evidence reference and reasoning', 'textarea').props.onChange({
        target: { value: 'Synthetic haul ledger, route entry B.' },
      })
    })
    expect(button(h.renderer, 'Save reviewed assertion').props.disabled).toBe(false)
    await act(async () => button(h.renderer, 'Save reviewed assertion').props.onClick())
    const reviewed = h.project.accessHistory!.paths.find((path) => path.review)
    expect(reviewed?.relationship).toBe('documented-use')
    expect(reviewed?.sourceIds).toContain('example-haul-ledger')
    expect(reviewed?.review?.reviewer).toBe('Training reviewer')
    expect(h.project.context.some((feature) => feature.roadEvidence?.reuseAllowed)).toBe(false)
  })

  it('retains invalid editor drafts and the saved project on validation failure', async () => {
    const h = await harness()
    await act(async () => button(h.renderer, 'Edit saved ledger').props.onClick())
    await act(async () =>
      control(h.renderer, 'Access history JSON draft', 'textarea').props.onChange({ target: { value: '{invalid' } }),
    )
    const before = h.project
    await act(async () => button(h.renderer, 'Validate and save ledger').props.onClick())
    expect(h.project).toBe(before)
    expect(control(h.renderer, 'Access history JSON draft', 'textarea').props.value).toBe('{invalid')
    expect(h.renderer.root.findAllByProps({ role: 'alert' }).length).toBeGreaterThan(1)
  })

  it('prevents a draft from overwriting a later history change and allows recovery of its text', async () => {
    const h = await harness()
    await act(async () => button(h.renderer, 'Edit saved ledger').props.onClick())
    const draft = control(h.renderer, 'Access history JSON draft', 'textarea').props.value
    await act(async () =>
      h.replace({
        ...h.project,
        accessHistory: {
          ...h.project.accessHistory!,
          settings: { ...h.project.accessHistory!.settings, asOf: '2020-06-30' },
        },
      }),
    )
    expect(button(h.renderer, 'Validate and save ledger').props.disabled).toBe(true)
    expect(control(h.renderer, 'Access history JSON draft', 'textarea').props.value).toBe(draft)
    await act(async () => button(h.renderer, 'Download draft').props.onClick())
    expect(downloadText).toHaveBeenCalledWith(draft, 'forestry-access-history-draft.txt', 'text/plain')
  })

  it('stages a valid bundle before applying and leaves the project untouched for invalid files', async () => {
    const h = await harness()
    const before = h.project
    await act(async () =>
      fileField(h.renderer).props.onFiles([
        { path: 'bad.json', file: { name: 'bad.json', size: 2, text: async () => '{}' } },
      ]),
    )
    expect(h.project).toBe(before)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-import-preview' })).toHaveLength(0)
    const text = accessHistoryBundle(before.context, before.accessHistory!)
    await act(async () =>
      fileField(h.renderer).props.onFiles([
        { path: 'history.json', file: { name: 'history.json', size: text.length, text: async () => text } },
      ]),
    )
    expect(h.project).toBe(before)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-import-preview' })).toHaveLength(1)
    await act(async () => button(h.renderer, 'Apply imported history').props.onClick())
    expect(h.project.accessHistory).toEqual(before.accessHistory)
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-import-preview' })).toHaveLength(0)
  })

  it('does not apply an import to a project changed while the file was read', async () => {
    const h = await harness()
    const text = accessHistoryBundle(h.project.context, h.project.accessHistory!)
    let finish!: (text: string) => void
    const promise = new Promise<string>((resolve) => {
      finish = resolve
    })
    let pending: Promise<void>
    await act(async () => {
      pending = fileField(h.renderer).props.onFiles([
        { path: 'history.json', file: { name: 'history.json', size: text.length, text: () => promise } },
      ])
    })
    const replacement = parseProject(createAccessHistoryTrainingProject())
    await act(async () => h.replace(replacement))
    await act(async () => {
      finish(text)
      await pending
    })
    expect(h.project).toBe(replacement)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.renderer.root.findAllByProps({ 'data-testid': 'history-import-preview' })).toHaveLength(0)
  })
})
