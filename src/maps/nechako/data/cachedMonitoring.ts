import { checkedMonitorPage, monitorPageTable } from './monitoringRelations'
import { normalizeMonitoring, type MonitoringMapping } from './monitoring'

export function cachedMonitoringTable(input: unknown): {
  table: ReturnType<typeof monitorPageTable>
  mapping?: MonitoringMapping
  coverage: string
} {
  if (!input || typeof input !== 'object') throw new Error('Invalid cached monitoring record.')
  const value = input as Record<string, unknown>
  if (value.schema === 'nechako-monitor-extract-v1') {
    if (
      !['complete', 'partial'].includes(String(value.status)) ||
      !Array.isArray(value.rows) ||
      value.downloadedRows !== value.rows.length
    )
      throw new Error('The cached extract row count does not match its data.')
    const page = checkedMonitorPage(
      { fields: value.fields, data: value.rows, recordCount: value.expectedRows, noData: !value.rows.length },
      1000000,
    )
    if (value.status === 'complete' && page.data.length !== page.recordCount)
      throw new Error('A complete cached extract must contain the advertised row count.')
    return {
      table: monitorPageTable(page),
      coverage: `${value.status === 'complete' ? 'Complete extract' : 'Partial extract'}: ${page.data.length.toLocaleString()} / ${page.recordCount.toLocaleString()} source rows. Download verification is retained in Local workbench.`,
    }
  }
  if (
    value.schema !== 'nechako-local-monitoring-v1' ||
    !Array.isArray(value.headers) ||
    !Array.isArray(value.records) ||
    value.records.length > 1000000
  )
    throw new Error('This saved item is not a supported monitoring table.')
  if (value.headers.some((field) => typeof field !== 'string') || new Set(value.headers).size !== value.headers.length)
    throw new Error('Invalid cached monitoring columns.')
  const headers = value.headers as string[]
  const records = value.records as Record<string, string>[]
  for (const row of records)
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      headers.some((field) => typeof row[field] !== 'string')
    )
      throw new Error('Invalid cached monitoring CSV row.')
  const mapping = value.mapping as MonitoringMapping
  if (
    !mapping ||
    typeof mapping !== 'object' ||
    ['timestamp', 'station', 'primary', 'secondary', 'primaryUnit', 'secondaryUnit', 'timezone'].some(
      (key) => typeof (mapping as unknown as Record<string, unknown>)[key] !== 'string',
    )
  )
    throw new Error('The cached monitoring column mapping is invalid.')
  for (const key of ['timestamp', 'station', 'primary', 'secondary', 'timezoneColumn'] as const)
    if (mapping[key] && !headers.includes(mapping[key]!))
      throw new Error('A cached monitoring mapping column is missing.')
  // Re-run validation rather than trusting previously computed observations.
  normalizeMonitoring(records, mapping)
  return {
    table: { headers, records },
    mapping,
    coverage: `${records.length.toLocaleString()} rows from the original imported CSV. Source database coverage was not independently verified.`,
  }
}
