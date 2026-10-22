export type MonitorRelation = {
  schemaName: string
  schemaId: string
  layerName: string
  layerId: string
  submissionId: string
  recId: string
}
export type MonitorPage = {
  fields: string[]
  data: Record<string, string | number | boolean | null>[]
  recordCount: number
  noData: boolean
}
export function nativeId(value: unknown): string {
  const id = String(value)
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Enter a nonnegative native numeric ID.')
  return id
}
export function checkedMonitorRelations(input: unknown): MonitorRelation[] {
  if (!Array.isArray(input)) throw new Error('Invalid monitoring station/schema relations.')
  return input.map((row) => {
    if (!row || typeof row.schemaName !== 'string' || typeof row.layerName !== 'string')
      throw new Error('Invalid monitoring relation names.')
    return {
      schemaName: row.schemaName,
      layerName: row.layerName,
      schemaId: nativeId(row.schemaId),
      layerId: nativeId(row.layerId),
      submissionId: nativeId(row.submissionId),
      recId: nativeId(row.schema_rec_seq_id),
    }
  })
}
export function monitorPageRequest(
  relation: MonitorRelation,
  parentSubmissionId: string,
  page: number,
  pageSize: number,
): Record<string, string> {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
    throw new Error('Monitoring reads require a zero-based page and 1–500 rows.')
  return {
    schemaId: nativeId(relation.schemaId),
    recId: nativeId(relation.recId),
    submissionId: nativeId(parentSubmissionId),
    getDraft: 'true',
    pageSize: String(pageSize),
    pageNumber: String(page),
  }
}
export function checkedMonitorPage(input: unknown, pageSize: number): MonitorPage {
  const raw = input as MonitorPage
  const data = raw && {
    ...raw,
    recordCount:
      typeof raw.recordCount === 'string' && /^\d+$/.test(raw.recordCount) ? Number(raw.recordCount) : raw.recordCount,
  }
  if (data?.noData === true && !data.data) {
    const recordCount = data.recordCount ?? 0
    if (!Number.isSafeInteger(recordCount) || recordCount < 0) throw new Error('Invalid monitoring total.')
    return { fields: [], data: [], recordCount, noData: true }
  }
  if (
    !data ||
    !Array.isArray(data.fields) ||
    data.fields.some((field) => typeof field !== 'string') ||
    new Set(data.fields).size !== data.fields.length ||
    !Array.isArray(data.data) ||
    data.data.length > pageSize ||
    !Number.isSafeInteger(data.recordCount) ||
    data.recordCount < data.data.length
  )
    throw new Error('Invalid or oversized monitoring page.')
  for (const row of data.data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid monitoring row.')
    for (const field of data.fields) {
      const value = row[field]
      if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value))
        throw new Error('Monitoring fields must be scalar values.')
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid monitoring numeric value.')
    }
  }
  return data
}
/** Attributes.js build6268M: monitor rows reached through a portal Layer or Schema, without a form node. */
export function monitorAttributePageRequest(
  mode: 'layer' | 'schema',
  id: string,
  recId: string,
  page: number,
  pageSize: number,
): Record<string, string> {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
    throw new Error('Monitoring reads require a zero-based page and 1–500 rows.')
  return {
    ...(mode === 'layer' ? { layerId: nativeId(id) } : { schemaId: nativeId(id), getSingleLayerInfo: 'true' }),
    recId: nativeId(recId),
    pageSize: String(pageSize),
    pageNumber: String(page),
  }
}
/** Chart source values directly: spreadsheet-safe CSV prefixes must never alter measurements or time-zone offsets. */
export function monitorPageTable(page: MonitorPage): { headers: string[]; records: Record<string, string>[] } {
  return {
    headers: [...page.fields],
    records: page.data.map((row) =>
      Object.fromEntries(
        page.fields.map((field) => [field, row[field] === null || row[field] === undefined ? '' : String(row[field])]),
      ),
    ),
  }
}
/** Native MapPanel.getAttributes response: column names plus a row matrix, not fabricated station IDs. */
export function monitorAttributeRecordIds(input: unknown): string[] {
  const data = input as { attributes: string[]; rows: unknown[][] }
  if (
    !data ||
    !Array.isArray(data.attributes) ||
    !Array.isArray(data.rows) ||
    data.rows.length > 1000 ||
    data.attributes.some((field) => typeof field !== 'string') ||
    new Set(data.attributes).size !== data.attributes.length
  )
    throw new Error('Invalid source Attributes matrix; the record selector supports at most 1,000 rows.')
  const idColumn = data.attributes.indexOf('schema_rec_seq_id'),
    statusColumn = data.attributes.indexOf('monitor_status')
  if (idColumn < 0 || statusColumn < 0)
    throw new Error('This source attribute table does not expose monitoring record IDs/status.')
  const ids = new Set<string>()
  for (const row of data.rows) {
    if (!Array.isArray(row) || row.length !== data.attributes.length)
      throw new Error('Source Attributes columns and rows do not match.')
    if (row[statusColumn] === 'ENABLED') ids.add(nativeId(row[idColumn]))
  }
  return [...ids]
}
export function monitoringSourceContext(input: { layerId?: string; recId?: string }): {
  mode: 'layer' | 'submission'
  sourceId: string
  recordId: string
} {
  return input.layerId !== undefined && input.recId !== undefined
    ? { mode: 'layer', sourceId: input.layerId, recordId: input.recId }
    : { mode: 'submission', sourceId: '', recordId: '' }
}
