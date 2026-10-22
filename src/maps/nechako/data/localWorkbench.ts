import Dexie, { liveQuery, type Table } from 'dexie'

/** Device-local, explicit saves only. Never pass account state, cookies or gateway capabilities. */
export const LOCAL_WORKBENCH_KINDS = [
  'layer',
  'style',
  'schema',
  'submission',
  'attachment',
  'monitoring',
  'geopaparazzi',
  'project',
] as const
export type LocalWorkbenchKind = (typeof LOCAL_WORKBENCH_KINDS)[number] | (string & {})
export type LocalWorkbenchSource = {
  url?: string
  portal?: string
  recordId?: string
  importedAt?: string
  access?: 'public' | 'private' | 'unknown'
  notes?: string
}
export type LocalWorkbenchRecord<T = unknown> = {
  id: string
  kind: LocalWorkbenchKind
  name: string
  createdAt: string
  updatedAt: string
  data: T
  blob?: Blob
  filename?: string
  mime?: string
  source?: LocalWorkbenchSource
  /** UTF-8 JSON payload plus original binary bytes; excludes IndexedDB implementation overhead. */
  bytes: number
}
export type LocalWorkbenchSave<T = unknown> = Pick<LocalWorkbenchRecord<T>, 'kind' | 'name' | 'data'> & {
  id?: string
  /** Omit to retain an existing binary; null explicitly removes it. */
  blob?: Blob | null
  filename?: string
  mime?: string
  source?: LocalWorkbenchSource
}
export class LocalWorkbenchError extends Error {
  readonly cause?: unknown
  constructor(
    public readonly code: 'unavailable' | 'quota' | 'invalid' | 'conflict' | 'storage',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = 'LocalWorkbenchError'
    this.cause = options?.cause
  }
}
export const LOCAL_WORKBENCH_DATABASE = 'pgmaps.nechako.local-workbench.v1'
class WorkbenchDatabase extends Dexie {
  records!: Table<LocalWorkbenchRecord, string>
  constructor() {
    super(LOCAL_WORKBENCH_DATABASE)
    this.version(1).stores({ records: 'id,kind,updatedAt,[kind+updatedAt]' })
  }
}
const database = new WorkbenchDatabase()

function storageError(reason: unknown): LocalWorkbenchError {
  if (reason instanceof LocalWorkbenchError) return reason
  const error = reason as { name?: string; message?: string; inner?: { name?: string } }
  if (error?.name === 'QuotaExceededError' || error?.inner?.name === 'QuotaExceededError')
    return new LocalWorkbenchError(
      'quota',
      'This browser has insufficient storage. Export a backup, then remove local items before saving again.',
      { cause: reason },
    )
  if (['MissingAPIError', 'SecurityError', 'InvalidStateError'].includes(error?.name ?? ''))
    return new LocalWorkbenchError(
      'unavailable',
      'Browser storage is unavailable. Allow site storage or use another browser; download your work before closing this page.',
      { cause: reason },
    )
  return new LocalWorkbenchError(
    'storage',
    'The browser could not read or save the local workbench. Your last successful save remains available; retry or export a backup.',
    { cause: reason },
  )
}
function invalid(message: string): never {
  throw new LocalWorkbenchError('invalid', message)
}
function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return invalid(`${label} must contain 1–${maximum} characters without control characters.`)
  return value.trim()
}
function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return invalid(`Invalid ${label}.`)
  return value
}
function checkedSource(value: LocalWorkbenchSource | undefined): LocalWorkbenchSource | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Invalid source provenance.')
  const allowed = ['url', 'portal', 'recordId', 'importedAt', 'access', 'notes']
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    return invalid(
      'Source provenance accepts only URL, portal, record ID, import date, access and notes. Do not store login information.',
    )
  const output: LocalWorkbenchSource = {}
  for (const key of ['portal', 'notes'] as const)
    if (value[key] !== undefined) output[key] = text(value[key], `Source ${key}`, key === 'notes' ? 4000 : 500)
  if (value.recordId !== undefined) {
    text(value.recordId, 'Source recordId', 500)
    output.recordId = value.recordId
  }
  if (value.access !== undefined) {
    if (!['public', 'private', 'unknown'].includes(value.access)) return invalid('Invalid source access label.')
    output.access = value.access
  }
  if (value.importedAt !== undefined) output.importedAt = timestamp(value.importedAt, 'source import date')
  if (value.url !== undefined) {
    let url: URL
    try {
      url = new URL(value.url)
    } catch {
      return invalid('Source provenance needs an absolute HTTP or HTTPS URL.')
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return invalid('Source URLs cannot contain login credentials.')
    if (
      [...url.searchParams.keys()].some((key) =>
        /^(?:access[_-]?token|api[_-]?key|password|passwd|token|secret|authorization|capability|session(?:id)?)$/i.test(
          key,
        ),
      )
    )
      return invalid('Remove credentials and session tokens from the source URL before saving.')
    output.url = url.toString()
  }
  return output
}

/** Produces a JSON copy. Domain field names are preserved, including a form field called password. */
export function localWorkbenchJson<T>(value: T): { value: T; json: string } {
  let json: string | undefined
  try {
    json = JSON.stringify(value, (_key, item: unknown) => {
      if (['bigint', 'function', 'symbol'].includes(typeof item)) throw new Error('Not JSON.')
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Not finite.')
      if (
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        throw new Error('Not a plain JSON object.')
      return item
    })
  } catch {
    return invalid(
      'Local item data must be finite JSON without cycles, functions or embedded binary objects. Store the original file as its Blob.',
    )
  }
  if (json === undefined) return invalid('Local item data is required.')
  return { value: JSON.parse(json) as T, json }
}

export function checkedLocalWorkbenchRecord(input: LocalWorkbenchRecord): LocalWorkbenchRecord {
  if (!input || typeof input !== 'object') return invalid('Invalid local workbench item.')
  const id = text(input.id, 'Local item ID', 250)
  if (id !== input.id) return invalid('Local item IDs cannot start or end with whitespace; IDs are never rewritten.')
  const kind = text(input.kind, 'Local item kind', 80)
  if (!/^[a-z][a-z0-9-]*$/.test(kind))
    return invalid('Local item kind must use lowercase letters, numbers and hyphens.')
  const name = text(input.name, 'Local item name', 200)
  const { value: data, json } = localWorkbenchJson(input.data)
  if (input.blob !== undefined && !(input.blob instanceof Blob)) return invalid('The original file must be a Blob.')
  return {
    id,
    kind,
    name,
    data,
    createdAt: timestamp(input.createdAt, 'creation date'),
    updatedAt: timestamp(input.updatedAt, 'update date'),
    ...(input.blob === undefined ? {} : { blob: input.blob }),
    ...(input.filename === undefined ? {} : { filename: text(input.filename, 'Original filename', 500) }),
    ...(input.mime === undefined ? {} : { mime: text(input.mime, 'Media type', 200) }),
    ...(input.source === undefined ? {} : { source: checkedSource(input.source) }),
    bytes: new TextEncoder().encode(json).byteLength + (input.blob?.size ?? 0),
  }
}
export async function listLocalWorkbench(kind?: LocalWorkbenchKind): Promise<LocalWorkbenchRecord[]> {
  try {
    const records =
      kind === undefined
        ? await database.records.toArray()
        : await database.records.where('kind').equals(kind).toArray()
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  } catch (reason) {
    throw storageError(reason)
  }
}
export async function getLocalWorkbench<T = unknown>(id: string): Promise<LocalWorkbenchRecord<T> | undefined> {
  try {
    return (await database.records.get(id)) as LocalWorkbenchRecord<T> | undefined
  } catch (reason) {
    throw storageError(reason)
  }
}
export async function saveLocalWorkbench<T>(input: LocalWorkbenchSave<T>): Promise<LocalWorkbenchRecord<T>> {
  try {
    return await database.transaction('rw', database.records, async () => {
      const id = input.id ?? crypto.randomUUID()
      const previous = await database.records.get(id)
      if (previous && previous.kind !== input.kind)
        throw new LocalWorkbenchError('conflict', 'This local item ID belongs to another kind. Save it with a new ID.')
      const now = new Date().toISOString()
      const record = checkedLocalWorkbenchRecord({
        ...previous,
        ...input,
        id,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        blob: input.blob === null ? undefined : (input.blob ?? previous?.blob),
        bytes: 0,
      }) as LocalWorkbenchRecord<T>
      await database.records.put(record)
      return record
    })
  } catch (reason) {
    throw storageError(reason)
  }
}
export async function deleteLocalWorkbench(id: string): Promise<void> {
  try {
    await database.records.delete(id)
  } catch (reason) {
    throw storageError(reason)
  }
}
export async function clearLocalWorkbench(kind?: LocalWorkbenchKind): Promise<void> {
  try {
    if (kind === undefined) await database.records.clear()
    else await database.records.where('kind').equals(kind).delete()
  } catch (reason) {
    throw storageError(reason)
  }
}
/** Validates first, then restores all records atomically. A conflict never partially imports a bundle. */
export async function importLocalWorkbench(
  records: LocalWorkbenchRecord[],
  options: { overwrite?: boolean } = {},
): Promise<number> {
  const checked = records.map(checkedLocalWorkbenchRecord)
  if (new Set(checked.map((item) => item.id)).size !== checked.length)
    return invalid('An import contains duplicate local item IDs.')
  try {
    await database.transaction('rw', database.records, async () => {
      if (!options.overwrite && (await database.records.bulkGet(checked.map((item) => item.id))).some(Boolean))
        throw new LocalWorkbenchError(
          'conflict',
          'Some item IDs already exist on this device. Review the import and choose Replace matching IDs to continue.',
        )
      await database.records.bulkPut(checked)
    })
    return checked.length
  } catch (reason) {
    throw storageError(reason)
  }
}
/** Dexie observes committed writes in this tab and other tabs; callbacks contain no private payload. */
export function subscribeLocalWorkbench(listener: () => void): () => void {
  const subscription = liveQuery(() => database.records.toArray()).subscribe({
    next: () => listener(),
    error: () => listener(),
  })
  return () => subscription.unsubscribe()
}
export async function localWorkbenchStorage(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.storage) return {}
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate?.() ?? Promise.resolve({}),
      navigator.storage.persisted?.(),
    ])
    return { usage: estimate.usage, quota: estimate.quota, persisted }
  } catch {
    return {}
  }
}
/** Call only after an explicit Keep storage request; the browser may decline. */
export async function persistLocalWorkbenchStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch (reason) {
    throw storageError(reason)
  }
}
