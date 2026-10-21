import { describe, expect, it } from 'vitest'
import { cachedMonitoringTable } from './cachedMonitoring'
describe('reopening cached monitoring', () => {
  it('keeps zero, false, signed dates and null values separate without spreadsheet escaping', () => {
    const result = cachedMonitoringTable({
      schema: 'nechako-monitor-extract-v1',
      fields: ['n', 'b', 'date', 'missing'],
      rows: [{ n: 0, b: false, date: '-0030', missing: null }],
      downloadedRows: 1,
      expectedRows: 1,
      status: 'complete',
    })
    expect(result.table.records).toEqual([{ n: '0', b: 'false', date: '-0030', missing: '' }])
    expect(result.coverage).toContain('1 / 1')
  })
  it('rejects an incomplete payload labelled complete', () => {
    expect(() =>
      cachedMonitoringTable({
        schema: 'nechako-monitor-extract-v1',
        fields: ['n'],
        rows: [{ n: 0 }],
        downloadedRows: 1,
        expectedRows: 2,
        status: 'complete',
      }),
    ).toThrow('advertised row count')
  })
  it('revalidates the original ingested CSV mapping', () => {
    const mapping = {
      timestamp: 'time',
      station: '',
      primary: 'temp',
      secondary: '',
      primaryUnit: 'C',
      secondaryUnit: '',
      timezone: 'UTC',
      timezoneColumn: '',
      dateFormat: 'iso',
    }
    const value = {
      schema: 'nechako-local-monitoring-v1',
      headers: ['time', 'temp'],
      records: [{ time: '2025-01-01T00:00:00Z', temp: '0' }],
      mapping,
    }
    expect(cachedMonitoringTable(value).mapping).toEqual(mapping)
    expect(() => cachedMonitoringTable({ ...value, mapping: { ...mapping, primary: 'absent' } })).toThrow('missing')
  })
})
