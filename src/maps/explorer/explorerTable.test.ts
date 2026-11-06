import { describe, expect, it } from 'vitest'
import { explorerTableColumns } from './explorerTable'
import type { ExplorerItem } from './types'

function item(details: ExplorerItem['details'], timestamp?: number): ExplorerItem {
  return {
    id: 'a',
    datasetId: 'trails',
    geometryType: 'line',
    name: 'A',
    subtitle: '',
    summary: '',
    relevance: 5.4,
    relevanceBreakdown: [],
    bounds: { minLng: 0, minLat: 0, maxLng: 0, maxLat: 0 },
    geometry: { type: 'Point', coordinates: [0, 0] },
    details,
    timestamp,
  }
}

describe('explorerTableColumns', () => {
  it('names columns after the detail rows and keeps numeric details raw for sort and CSV', () => {
    const row = item([
      { label: 'Surface', value: 'Gravel' },
      { label: 'Length (m)', value: '1,250' },
    ])
    const columns = explorerTableColumns([row])
    expect(columns.map((column) => column.header)).toEqual(['Name', 'Relevance', 'Surface', 'Length (m)'])
    const length = columns[3]
    expect(length.type).toBe('numeric')
    expect(length.getValue(row)).toBe('1,250')
    expect(length.getExportValue?.(row)).toBe(1250)
  })

  it('leaves a detail with any text in it as text', () => {
    const rows = [item([{ label: 'Winter', value: '12' }]), item([{ label: 'Winter', value: 'Unknown' }])]
    expect(explorerTableColumns(rows)[2].type).toBe('text')
  })

  it('uses the timestamp in place of a display date', () => {
    const columns = explorerTableColumns([item([{ label: 'Date', value: 'Jan 2 2024' }], 1704153600000)])
    expect(columns.map((column) => column.header)).toEqual(['Name', 'Relevance', 'Date'])
    expect(columns[2].type).toBe('datetime')
  })
})
