import { describe, expect, it, vi } from 'vitest'
import { tableCsvText } from '@/components/map/mapTableModel'
import type { MapTableSource } from '@/components/map/useMapTable'
import { contextHistoryBounds, contextHistoryProperties, historyTableSources } from './historyPresentation'
import type { ContextFeature, ExistingRoadEvidence } from './types'
import type { HarvestEvidence } from './harvestHistory'

// The source factory is a type-erasing identity function; browser table hooks are outside these pure data tests.
vi.mock('@/components/map/useMapTable', () => ({ defineTableSource: (source: unknown) => source }))

const polygon: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.02, 53],
      [-122, 53],
      [-122, 53.01],
      [-122.02, 53.01],
      [-122.02, 53],
    ],
    [
      [-122.015, 53.002],
      [-122.005, 53.002],
      [-122.005, 53.008],
      [-122.015, 53.008],
      [-122.015, 53.002],
    ],
  ],
}
const harvest = (id: string, harvestEvidence?: HarvestEvidence): ContextFeature => ({
  id,
  name: `Cutblock ${id}`,
  kind: 'harvest',
  geometry: polygon,
  ...(harvestEvidence ? { harvestEvidence } : {}),
})
const road = (id: string, evidence: Partial<ExistingRoadEvidence> = {}): ContextFeature => ({
  id,
  name: `Road ${id}`,
  kind: 'existing-road',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.03, 53.001],
      [-122.01, 53.005],
      [-122.02, 53.009],
    ],
  },
  roadEvidence: {
    source: 'bc-ften',
    condition: 'unknown',
    conditionBasis: 'unreviewed',
    reuseAllowed: false,
    ...evidence,
  },
})
const source = (context: ContextFeature[], id: string, year = 2026): MapTableSource => {
  const value = historyTableSources(context, year).find((entry) => entry.id === id)
  if (!value) throw Error(`Expected table ${id}`)
  return value
}
const exported = (table: MapTableSource, row: ContextFeature) =>
  Object.fromEntries(table.columns.map((column) => [column.id, column.getExportValue?.(row)]))

const datedBlock = harvest('bc-harvest-123-part-1', {
  source: 'bc-consolidated',
  status: 'harvested',
  sourceId: '123',
  openingId: '987654',
  sourceUrl: 'https://example.test/harvest/123',
  retrievedAt: '2026-11-07T16:45:30Z',
  dataSource: 'RESULTS',
  sourceDate: '2024-09-30',
  publishedDate: '2025-01-31',
  areaHectares: 42.25,
  startDate: '2000-09-01',
  endDate: '2002-03-15',
  startYear: 2000,
  endYear: 2002,
  midYear: 2001,
  yearMethod: 'estimated-range',
})

describe('history tables', () => {
  it('offers only supplied context kinds and uses source-stable IDs and complete geometry bounds for map/table linking', () => {
    const line = road('ften-123')
    const stream: ContextFeature = { ...line, id: 'stream', kind: 'stream', roadEvidence: undefined }
    const tables = historyTableSources([datedBlock, line, stream], 2026)
    expect(tables.map((table) => table.id)).toEqual(['cutblock-history', 'road-history'])
    expect(tables[0].rows).toEqual([datedBlock])
    expect(tables[1].rows).toEqual([line])
    expect(tables[0].getRowId(datedBlock)).toBe('bc-harvest-123-part-1')
    expect(tables[1].getRowId(line)).toBe('ften-123')
    expect(tables[0].getRowBounds?.(datedBlock)).toEqual([-122.02, 53, -122, 53.01])
    expect(tables[0].getRowCenter?.(datedBlock)?.[0]).toBeCloseTo(-122.01, 8)
    expect(tables[0].getRowCenter?.(datedBlock)?.[1]).toBeCloseTo(53.005, 8)
    expect(contextHistoryBounds(line)).toEqual([-122.03, 53.001, -122.01, 53.009])
    expect(historyTableSources([stream], 2026)).toEqual([])
    expect(historyTableSources([datedBlock], 2026).map((table) => table.id)).toEqual(['cutblock-history'])
  })

  it('exports raw harvest years and provenance without substituting midpoint, publication or retrieval dates for completion', () => {
    const table = source([datedBlock], 'cutblock-history')
    expect(table.exportFileName).toBe('cutblock-history-2026.csv')
    expect(exported(table, datedBlock)).toMatchObject({
      name: 'Cutblock bc-harvest-123-part-1',
      age: 'About 24–26 calendar years since estimated harvest (2000–2002)',
      year: 2026,
      start: 2000,
      end: 2002,
      midpoint: 2001,
      startDate: '2000-09-01',
      endDate: '2002-03-15',
      area: '42.25',
      yearMethod: 'estimated-range',
      dataSource: 'RESULTS',
      sourceDate: '2024-09-30',
      publishedDate: '2025-01-31',
      source: 'bc-consolidated',
      sourceId: '123',
      openingId: '987654',
      sourceUrl: 'https://example.test/harvest/123',
      retrieved: '2026-11-07T16:45:30Z',
      id: 'bc-harvest-123-part-1',
    })
    const area = table.columns.find((column) => column.id === 'area')!
    expect(area.type).toBe('text')
    expect(area.header).toContain('repeated for parts')
    const otherPart = { ...datedBlock, id: 'bc-harvest-123-part-2' }
    expect(exported(table, otherPart).area).toBe('42.25')
    expect(exported(table, otherPart).id).toBe('bc-harvest-123-part-2')
    const csv = tableCsvText([datedBlock], table.columns)
    expect(csv).toContain('"2000","2002","2001","2000-09-01","2002-03-15"')
    expect(csv).toContain('"estimated-range","RESULTS","2024-09-30","2025-01-31"')
    expect(csv).toContain('"2026-11-07T16:45:30Z"')
  })

  it('leaves absent evidence blank in numeric/date exports, retaining an explicit unknown age', () => {
    const unknown = harvest('undated')
    const table = source([unknown], 'cutblock-history')
    expect(exported(table, unknown)).toMatchObject({
      age: 'Harvest date unknown',
      year: 2026,
      start: null,
      end: null,
      midpoint: null,
      startDate: '',
      endDate: '',
      sourceDate: '',
      publishedDate: '',
      sourceId: '',
      sourceUrl: '',
      retrieved: '',
    })
    expect(tableCsvText([unknown], table.columns)).not.toContain('"0"')
    expect(table.columns.find((column) => column.id === 'id')?.defaultHidden).toBe(true)
  })

  it('keeps tenure retirement and observation dates separate from a known physical event and exports event provenance', () => {
    const feature = road('retired-and-deactivated', {
      status: 'RETIRED',
      retirementDate: '2010-04-01',
      sourceUrl: 'https://example.test/tenures/1',
      retrievedAt: '2026-11-07T00:15:02.123Z',
      condition: 'rehabilitation',
      conditionBasis: 'field-verified',
      reuseAllowed: true,
      deactivation: {
        status: 'deactivated',
        basis: 'source-record',
        reference: 'Completed works report "A", section 3',
        deactivatedOn: '2016-09-15',
        observedOn: '2026-10-01',
        sourceUrl: 'https://example.test/event/1',
        notes: 'Segment 2.1–4.6 km; dates describe different events.',
      },
    })
    const table = source([feature], 'road-history')
    const row = exported(table, feature)
    expect(row).toMatchObject({
      status: 'Recorded deactivation',
      deactivation: '2016-09-15',
      reactivation: '',
      eventSource: 'Completed works report "A", section 3',
      eventBasis: 'source-record',
      observed: '2026-10-01',
      eventUrl: 'https://example.test/event/1',
      eventNotes: 'Segment 2.1–4.6 km; dates describe different events.',
      tenure: 'RETIRED',
      retired: '2010-04-01',
      reuse: 'Yes — planning input',
      source: 'https://example.test/tenures/1',
      retrieved: '2026-11-07T00:15:02.123Z',
      id: 'retired-and-deactivated',
    })
    expect(String(row.physical)).toContain('2016-09-15')
    expect(String(row.physical)).not.toContain('2010-04-01')
    expect(tableCsvText([feature], table.columns)).toContain('"Completed works report ""A"", section 3"')
    expect(contextHistoryProperties(feature, 2026)).toMatchObject({
      historyKey: 'deactivated',
      historyColor: '#b91c1c',
      historyDash: [3, 2],
    })
  })

  it('exports unknown physical dates when only a retirement date exists', () => {
    const feature = road('retired-only', { retirementDate: '2010-04-01', lifecycleStatus: 'RETIRED' })
    const row = exported(source([feature], 'road-history'), feature)
    expect(row).toMatchObject({
      status: 'Retired tenure · condition unknown',
      retired: '2010-04-01',
      deactivation: '',
      reactivation: '',
      observed: '',
      eventSource: '',
      eventBasis: '',
      reuse: 'No',
    })
    expect(String(row.physical)).toContain('unknown')
    expect(contextHistoryProperties(feature, 2026)).toMatchObject({
      historyKey: 'retired-tenure',
      historyColor: '#475569',
      historyDash: [1, 3],
    })
  })
})

describe('map history properties', () => {
  it('changes both age description and colour when the saved reference year crosses an age boundary', () => {
    const feature = harvest('2016', { source: 'user', status: 'harvested', endYear: 2016, yearMethod: 'reported-year' })
    expect(contextHistoryProperties(feature, 2026)).toEqual({
      historyKey: 'recent',
      historyLabel: 'Harvest 0–10 calendar years ago',
      historyColor: '#d97706',
    })
    expect(contextHistoryProperties(feature, 2027)).toEqual({
      historyKey: 'medium',
      historyLabel: 'Harvest 11–30 calendar years ago',
      historyColor: '#0d9488',
    })
    expect(exported(source([feature], 'cutblock-history', 2027), feature)).toMatchObject({
      age: '11 calendar years since reported harvest (2016)',
      year: 2027,
    })
  })

  it('visually separates proposed, undated, cross-bin and older harvest records without implying road condition', () => {
    const proposed = harvest('proposed', { source: 'user', status: 'proposed', yearMethod: 'unknown' })
    const uncertain = harvest('uncertain', {
      source: 'bc-consolidated',
      startYear: 2015,
      endYear: 2017,
      yearMethod: 'estimated-range',
    })
    const old = harvest('old', { source: 'scenario', endYear: 1990, yearMethod: 'reported-year' })
    expect(contextHistoryProperties(proposed, 2026)).toMatchObject({ historyKey: 'proposed', historyColor: '#7c3aed' })
    expect(contextHistoryProperties(harvest('unknown'), 2026)).toMatchObject({
      historyKey: 'unknown',
      historyColor: '#64748b',
    })
    expect(contextHistoryProperties(uncertain, 2026)).toMatchObject({ historyKey: 'unknown', historyColor: '#64748b' })
    expect(contextHistoryProperties(old, 2026)).toMatchObject({ historyKey: 'older', historyColor: '#166534' })
    expect(contextHistoryProperties(old, 2026)).not.toHaveProperty('historyDash')
  })

  it('keeps active tenure and unreviewed condition grey, and identifies reactivation without granting serviceability', () => {
    const active = road('active', { status: 'ACTIVE', lifecycleStatus: 'ACTIVE' })
    const unreviewed = road('unreviewed', { condition: 'serviceable', conditionBasis: 'unreviewed' })
    const reactivated = road('reactivated', {
      deactivation: {
        status: 'reactivated',
        basis: 'source-record',
        reference: 'Works record 1',
        deactivatedOn: '2010-01-01',
        reactivatedOn: '2020-01-01',
      },
    })
    expect(contextHistoryProperties(active, 2026)).toMatchObject({ historyKey: 'unknown', historyColor: '#64748b' })
    expect(contextHistoryProperties(unreviewed, 2026)).toMatchObject({ historyKey: 'unknown', historyColor: '#64748b' })
    expect(contextHistoryProperties(reactivated, 2026)).toMatchObject({
      historyKey: 'reactivated',
      historyLabel: 'Recorded reactivation · review condition',
      historyColor: '#2563eb',
      historyDash: [5, 1],
    })
    expect(exported(source([reactivated], 'road-history'), reactivated)).toMatchObject({
      deactivation: '2010-01-01',
      reactivation: '2020-01-01',
      reuse: 'No',
    })
  })

  it('does not give stream and review-area context a harvest age or a road condition', () => {
    expect(contextHistoryProperties({ ...datedBlock, kind: 'avoid' }, 2026)).toEqual({})
    expect(contextHistoryProperties({ ...road('stream'), kind: 'stream' }, 2026)).toEqual({})
  })
})
