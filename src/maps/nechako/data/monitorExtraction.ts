import { checkedMonitorPage, type MonitorPage } from './monitoringRelations'
import type { ProjectRead } from './projectManager'

export type MonitorExtraction = {
  schema: 'nechako-monitor-extract-v1'
  startedAt: string
  completedAt: string
  source: { endpoint: string; params: Record<string, string> }
  fields: string[]
  rows: MonitorPage['data']
  expectedRows: number
  downloadedRows: number
  pageSize: number
  pagesRead: number
  bytes: number
  status: 'complete' | 'partial'
  verification: {
    countMatches: boolean
    boundaryPagesRechecked: boolean
    terminalPageEmpty: boolean
    uniqueKey?: string
    uniqueIdsChecked: boolean
    atomicSnapshot: false
  }
  notes: string[]
}
export type ExtractionProgress = { rows: number; total: number; pages: number; phase: 'download' | 'verify' }
const ENDPOINT = 'rest/portal/getMonitorData.php'
const PAGE_SIZE = 500
const signature = (page: MonitorPage) => JSON.stringify([page.fields, page.data])
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('The download was cancelled.', 'AbortError')
}

/** Sequential bounded reads. A matching count is not an atomic source snapshot. */
export async function extractMonitoring({
  params,
  read,
  signal,
  maxRows = 100000,
  maxBytes = 64 * 1024 * 1024,
  uniqueKey,
  onProgress,
  now = () => new Date().toISOString(),
}: {
  params: Record<string, string>
  read: ProjectRead
  signal?: AbortSignal
  maxRows?: number
  maxBytes?: number
  uniqueKey?: string
  onProgress?: (progress: ExtractionProgress) => void
  now?: () => string
}): Promise<MonitorExtraction> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1000000)
    throw new Error('Choose a download limit from 1 to 1,000,000 rows.')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024)
    throw new Error('The download byte limit must be between 1 byte and 256 MiB.')
  const sourceParams = { ...params }
  delete sourceParams.pageNumber
  delete sourceParams.pageSize
  const allowed = new Set(['schemaId', 'layerId', 'recId', 'submissionId', 'getDraft', 'getSingleLayerInfo'])
  if (Object.keys(sourceParams).some((key) => !allowed.has(key)))
    throw new Error('Unexpected monitoring source parameter.')
  if (!sourceParams.recId || !(sourceParams.schemaId || sourceParams.layerId))
    throw new Error('Select the source schema/layer and its actual monitoring record ID.')
  if (sourceParams.schemaId && sourceParams.layerId)
    throw new Error('Choose one monitoring source scope: a schema or a layer.')
  for (const key of ['schemaId', 'layerId', 'recId', 'submissionId']) {
    const value = sourceParams[key]
    if (
      value !== undefined &&
      (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647)
    )
      throw new Error('Monitoring source IDs must be positive native numeric identifiers.')
  }
  for (const key of ['getDraft', 'getSingleLayerInfo'])
    if (sourceParams[key] !== undefined && !['true', 'false'].includes(sourceParams[key]))
      throw new Error('Monitoring flags must be true or false.')
  const startedAt = now()
  const fetchPage = async (page: number) => {
    abort(signal)
    const raw = await read(ENDPOINT, { ...sourceParams, pageSize: String(PAGE_SIZE), pageNumber: String(page) }, signal)
    const result = checkedMonitorPage(raw, PAGE_SIZE)
    abort(signal)
    return {
      ...result,
      totalAdvertised: !!raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'recordCount'),
    }
  }
  const first = await fetchPage(0)
  const expectedRows = first.recordCount
  const target = Math.min(maxRows, expectedRows)
  const fields = [...first.fields]
  if (uniqueKey && !fields.includes(uniqueKey)) throw new Error('The selected unique-ID column is absent.')
  const rows: MonitorPage['data'] = []
  const pageSignatures = new Set<string>()
  const ids = new Set<string>()
  let pagesRead = 0
  let bytes = 0
  let last: MonitorPage = first
  let lastNumber = 0
  const append = (page: MonitorPage, pageNumber: number) => {
    if (page.recordCount !== expectedRows) throw new Error('The source total changed during the download. Restart it.')
    if (JSON.stringify(page.fields) !== JSON.stringify(fields))
      throw new Error('The source columns changed during the download. Restart it.')
    const expectedSize = Math.min(PAGE_SIZE, Math.max(0, expectedRows - pageNumber * PAGE_SIZE))
    if (page.data.length !== expectedSize)
      throw new Error(
        `Page ${pageNumber + 1} returned ${page.data.length} rows; ${expectedSize} were required by the source total.`,
      )
    const hash = signature(page)
    if (page.data.length && pageSignatures.has(hash))
      throw new Error('The source repeated an entire page. Stable paging cannot be verified.')
    pageSignatures.add(hash)
    const selected = page.data.slice(0, target - rows.length)
    for (const row of selected) {
      if (uniqueKey) {
        const value = row[uniqueKey]
        if (value === null || value === undefined || value === '') throw new Error('A source row has no unique ID.')
        if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))
          throw new Error(
            'A numeric source ID exceeds exact JavaScript integer precision. Import an export that retains IDs as text.',
          )
        const id = JSON.stringify([typeof value, value])
        if (ids.has(id)) throw new Error(`The source repeated a value in unique-ID column ${uniqueKey}.`)
        ids.add(id)
      }
      bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength
      if (bytes > maxBytes)
        throw new Error('The monitoring download exceeded its browser memory limit. Use a smaller scope or row limit.')
      rows.push(row)
    }
    pagesRead++
    last = page
    lastNumber = pageNumber
    onProgress?.({ rows: rows.length, total: expectedRows, pages: pagesRead, phase: 'download' })
  }
  append(first, 0)
  for (let page = 1; rows.length < target; page++) append(await fetchPage(page), page)
  const complete = rows.length === expectedRows
  let boundaryPagesRechecked = false
  let terminalPageEmpty = false
  if (complete) {
    onProgress?.({ rows: rows.length, total: expectedRows, pages: pagesRead, phase: 'verify' })
    const firstAgain = await fetchPage(0)
    if (firstAgain.recordCount !== expectedRows || signature(firstAgain) !== signature(first))
      throw new Error('The first page or source total changed during verification. Restart the download.')
    if (lastNumber > 0) {
      const lastAgain = await fetchPage(lastNumber)
      if (lastAgain.recordCount !== expectedRows || signature(lastAgain) !== signature(last))
        throw new Error('The final page changed during verification. Restart the download.')
    }
    boundaryPagesRechecked = true
    if (expectedRows > 0) {
      const terminal = await fetchPage(Math.ceil(expectedRows / PAGE_SIZE))
      if (
        terminal.data.length ||
        !(terminal.recordCount === expectedRows || (terminal.noData && !terminal.totalAdvertised))
      )
        throw new Error('The source returned rows beyond its advertised total. Completeness could not be verified.')
    }
    terminalPageEmpty = true
  }
  abort(signal)
  return {
    schema: 'nechako-monitor-extract-v1',
    startedAt,
    completedAt: now(),
    source: { endpoint: ENDPOINT, params: sourceParams },
    fields,
    rows,
    expectedRows,
    downloadedRows: rows.length,
    pageSize: PAGE_SIZE,
    pagesRead,
    bytes,
    status: complete ? 'complete' : 'partial',
    verification: {
      countMatches: complete,
      boundaryPagesRechecked,
      terminalPageEmpty,
      uniqueKey: uniqueKey || undefined,
      uniqueIdsChecked: !!uniqueKey,
      atomicSnapshot: false,
    },
    notes: [
      ...(complete
        ? []
        : [
            `Stopped at the selected ${maxRows.toLocaleString()}-row limit; ${expectedRows.toLocaleString()} rows were advertised.`,
          ]),
      'Rows retain source order, scalar types and IDs; no deduplication, interpolation or missing-value replacement was applied.',
      'Stable counts and boundary pages are checked. The source supplies no snapshot token; changes inside middle pages cannot be ruled out.',
      ...(!uniqueKey
        ? ['No unique row key was selected; distinct record identity is not verified by a matching count.']
        : []),
    ],
  }
}
