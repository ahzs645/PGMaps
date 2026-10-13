export type CollectionKind = 'project' | 'submission' | 'story' | 'document'
export type CollectionImportKind = CollectionKind | 'auto'
export const COLLECTION_FILE_LIMIT = 20 * 1024 * 1024
export const COLLECTION_SESSION_LIMIT = 50 * 1024 * 1024
const RECORD_LIMIT = 10_000
const NODE_LIMIT = 200_000

/** Names and IDs verified in the anonymous Project grid on October 12, 2026.
 * This index contains no saved-project payloads, permissions or source files. */
export const OBSERVED_PORTAL_PROJECTS = [
  [4, 'EchoScreen Cummulative Impacts Study'],
  [6, 'IWRG Collated Project for PLOS Water 2024'],
  [9, 'Census_subdivision_history'],
  [10, 'Koh_Wetlands_Teacher_Resources'],
  [12, 'NWR Annual Meeting 2023'],
  [14, 'Climate and Health'],
  [15, 'Cheslatta Carrier Nation Archives'],
  [21, 'Large Lakes Monitoring Working Group'],
  [27, '"Welcome to the Nechako Watershed" Learning Module'],
] as const

export type CollectionReference = { url: string; label: string; sizeBytes?: number; endpoint: boolean }
export type CollectionRecord = {
  kind: CollectionKind
  sourceId?: string | number
  title: string
  description: string
  metadata: { label: string; value: string }[]
  references: CollectionReference[]
  raw: Record<string, unknown>
}
export type CollectionFile = {
  name: string
  bytes: number
  sourceText: string
  importKind: CollectionImportKind
  records: CollectionRecord[]
}
export type CollectionSession = { files: CollectionFile[] }
export const EMPTY_COLLECTION_SESSION: CollectionSession = { files: [] }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}
function first(row: Record<string, unknown>, names: string[]): unknown {
  return names.map((name) => row[name]).find((value) => value !== undefined && value !== null && value !== '')
}
function checkedTree(value: unknown) {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length) {
    const item = pending.pop()!
    if (++nodes > NODE_LIMIT) throw new Error('Export exceeds the 200,000-value review limit.')
    if (item.depth > 64) throw new Error('Export exceeds the 64-level nesting limit.')
    if (object(item.value) || Array.isArray(item.value)) {
      const children = Object.values(item.value)
      if (children.length + pending.length + nodes > NODE_LIMIT)
        throw new Error('Export exceeds the 200,000-value review limit.')
      for (const child of children) pending.push({ value: child, depth: item.depth + 1 })
    }
  }
}

/** Safe links only; imported markup is always displayed as text, never injected. */
export function collectionSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function references(row: Record<string, unknown>): CollectionReference[] {
  const found = new Map<string, CollectionReference>()
  const visit = (value: unknown, key = '', parent: Record<string, unknown> = {}) => {
    if (typeof value === 'string') {
      const urls = value.match(/https:\/\/[^\s<>"'\\]+/g) || []
      for (const candidate of urls) {
        const url = collectionSourceUrl(candidate)
        if (!url) continue
        const bytes = first(parent, ['size_bytes', 'sizeBytes', 'byte_size', 'fileSizeBytes'])
        const sizeBytes = typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined
        const existing = found.get(url)
        // Conflicting size declarations remain unmeasured rather than selecting one.
        found.set(url, {
          url,
          label: scalar(first(parent, ['title', 'name', 'label'])) || key || 'Source reference',
          sizeBytes: existing && existing.sizeBytes !== sizeBytes ? undefined : sizeBytes,
          endpoint: existing?.endpoint === true || /download/i.test(key) || /\/[^/]+\.php(?:\?|$)/i.test(url),
        })
      }
    } else if (Array.isArray(value)) value.forEach((child) => visit(child, key, parent))
    else if (object(value)) Object.entries(value).forEach(([name, child]) => visit(child, name, value))
  }
  visit(row)
  if (found.size > 1_000) throw new Error('One record exceeds the 1,000-reference review limit.')
  return [...found.values()]
}

function record(
  row: Record<string, unknown>,
  kind: CollectionImportKind,
  inherited?: CollectionKind,
): CollectionRecord {
  const fields = object(row.attributes) ? { ...row, ...row.attributes } : row
  const explicit = scalar(first(fields, ['kind', 'type'])).toLowerCase()
  const detected: CollectionKind = ['project', 'submission', 'story', 'document'].includes(explicit)
    ? (explicit as CollectionKind)
    : object(fields.workspace) && fields.workspace.type === 'story-map'
      ? 'story'
      : fields.schema === 'nechako-workspace-v1' ||
          (Array.isArray(fields.coordinates) && Array.isArray(fields.layers)) ||
          (object(fields.workspace) && fields.workspace.type === 'map-explorer')
        ? 'project'
        : first(fields, ['submissionId', 'submission_id', 'sub_id']) !== undefined
          ? 'submission'
          : inherited || 'document'
  const resolved = kind === 'auto' ? detected : kind
  const sourceId = first(fields, [
    'id',
    'projectId',
    'project_id',
    'submissionId',
    'submission_id',
    'sub_id',
    'documentId',
  ])
  if (typeof sourceId === 'number' && !Number.isSafeInteger(sourceId))
    throw new Error('Numeric source IDs must be safe integers. Export larger identifiers as strings.')
  const description = scalar(first(fields, ['description', 'projectDescription', 'text', 'body', 'content', 'summary']))
  return {
    kind: resolved,
    sourceId: typeof sourceId === 'string' || typeof sourceId === 'number' ? sourceId : undefined,
    title:
      scalar(first(fields, ['title', 'name', 'projectName', 'project_name', 'submissionName', 'label'])) ||
      `Untitled ${resolved}`,
    description,
    metadata: Object.entries(fields)
      .filter(
        ([name, value]) =>
          !['description', 'projectDescription', 'text', 'body', 'content', 'summary'].includes(name) &&
          scalar(value) !== '',
      )
      .map(([label, value]) => ({ label, value: scalar(value) })),
    references: references(row),
    raw: row,
  }
}

function records(value: unknown, kind: CollectionImportKind): CollectionRecord[] {
  const normalizeRows = (rows: unknown[], inherited?: CollectionKind) => {
    if (rows.length > RECORD_LIMIT) throw new Error('Export exceeds the 10,000-record review limit.')
    if (!rows.every(object)) throw new Error('Every collection entry must be a JSON object.')
    return rows.map((row) => record(row as Record<string, unknown>, kind, inherited))
  }
  if (Array.isArray(value)) return normalizeRows(value)
  if (object(value)) {
    if (value.success === false || value.error)
      throw new Error('This export contains a portal error, not a collection.')
    const lists: [string, CollectionKind | undefined][] = [
      ['projects', 'project'],
      ['submissions', 'submission'],
      ['stories', 'story'],
      ['documents', 'document'],
      ['records', undefined],
      ['items', undefined],
      ['attributes', undefined],
    ]
    // Map/package objects are one record even when they contain document lists.
    if (collectionWorkspaceCandidate(value) || value.workspace) return normalizeRows([value])
    const present = lists.filter(([name]) => Array.isArray(value[name]))
    if (present.length) {
      const total = present.reduce((sum, [name]) => sum + (value[name] as unknown[]).length, 0)
      if (total > RECORD_LIMIT) throw new Error('Export exceeds the 10,000-record review limit.')
      return present.flatMap(([name, inherited]) => normalizeRows(value[name] as unknown[], inherited))
    }
    if (object(value.attributes)) return records(value.attributes, kind)
    return normalizeRows([value])
  }
  throw new Error('Expected a JSON object or an array of records.')
}

/** One original export or our lossless, browser-only collection container. */
export function parseCollectionFiles(
  text: string,
  name: string,
  kind: CollectionImportKind = 'auto',
): CollectionFile[] {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > COLLECTION_FILE_LIMIT) throw new Error('JSON import exceeds 20 MiB.')
  const value: unknown = JSON.parse(text)
  checkedTree(value)
  if (object(value) && value.schema === 'nechako-collection-v1') {
    if (!Array.isArray(value.files) || value.files.length > 100)
      throw new Error('Invalid collection file list (maximum 100).')
    const files = value.files.map((entry) => {
      if (!object(entry) || typeof entry.name !== 'string' || typeof entry.sourceText !== 'string')
        throw new Error('Collection entries require the original filename and JSON text.')
      const importKind = entry.importKind
      if (!['auto', 'project', 'submission', 'story', 'document'].includes(String(importKind)))
        throw new Error('Unknown collection record type.')
      const original: unknown = JSON.parse(entry.sourceText)
      checkedTree(original)
      if (object(original) && original.schema === 'nechako-collection-v1')
        throw new Error('Nested collection containers are unsupported.')
      const originalBytes = new TextEncoder().encode(entry.sourceText).length
      if (originalBytes > COLLECTION_FILE_LIMIT) throw new Error('An original JSON export exceeds 20 MiB.')
      return {
        name: entry.name,
        bytes: originalBytes,
        sourceText: entry.sourceText,
        importKind: importKind as CollectionImportKind,
        records: records(original, importKind as CollectionImportKind),
      }
    })
    validateCollectionBudget(files)
    return files
  }
  return [{ name, bytes, sourceText: text, importKind: kind, records: records(value, kind) }]
}

export function validateCollectionBudget(files: CollectionFile[]) {
  if (files.length > 100) throw new Error('A browser collection can contain at most 100 original files.')
  if (files.reduce((total, file) => total + file.bytes, 0) > COLLECTION_SESSION_LIMIT)
    throw new Error('Collection exceeds 50 MiB of original JSON.')
  if (files.reduce((total, file) => total + file.records.length, 0) > RECORD_LIMIT)
    throw new Error('Collection exceeds 10,000 records.')
}

export function exportCollection(files: CollectionFile[]): string {
  validateCollectionBudget(files)
  const text = JSON.stringify(
    {
      schema: 'nechako-collection-v1',
      files: files.map(({ name, sourceText, importKind }) => ({ name, sourceText, importKind })),
    },
    null,
    2,
  )
  // The resulting file must be importable through the same review boundary.
  if (new TextEncoder().encode(text).length > COLLECTION_FILE_LIMIT)
    throw new Error(
      'Combined collection exceeds the 20 MiB import limit. Download the individual original files instead.',
    )
  return text
}

export function collectionStats(files: CollectionFile[]) {
  const links = new Map<string, number | undefined>()
  for (const file of files)
    for (const item of file.records)
      for (const reference of item.references) {
        if (!links.has(reference.url)) links.set(reference.url, reference.sizeBytes)
        else if (links.get(reference.url) !== reference.sizeBytes) links.set(reference.url, undefined)
      }
  const declaredBytes = [...links.values()].reduce<number>((sum, size) => sum + (size ?? 0), 0)
  return {
    files: files.length,
    records: files.reduce((sum, file) => sum + file.records.length, 0),
    jsonBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    references: links.size,
    declaredBytes: Number.isSafeInteger(declaredBytes) ? declaredBytes : undefined,
    unmeasuredReferences: [...links.values()].filter((size) => size === undefined).length,
  }
}

export function collectionWorkspaceCandidate(row: Record<string, unknown>): unknown | undefined {
  if (row.schema === 'nechako-workspace-v1' || (Array.isArray(row.coordinates) && Array.isArray(row.layers))) return row
  for (const key of ['attributes', 'workspace', 'project', 'data']) {
    const value = row[key]
    if (
      object(value) &&
      (value.schema === 'nechako-workspace-v1' || (Array.isArray(value.coordinates) && Array.isArray(value.layers)))
    )
      return value
  }
  return undefined
}

export function collectionBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('en-CA')} B`
  const unit = bytes < 1024 * 1024 ? 'KiB' : 'MiB'
  return `${(bytes / (unit === 'KiB' ? 1024 : 1024 * 1024)).toLocaleString('en-CA', { maximumFractionDigits: 2 })} ${unit}`
}
