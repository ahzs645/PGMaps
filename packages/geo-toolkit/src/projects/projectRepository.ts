/** Inject validation so a host retains its schema, normalization and metadata rules. */
export interface ProjectCodec<T> {
  parse(value: unknown): T
  id(project: T): string
  prepareExport?(project: T): unknown
}
export function createProjectCodec<T>(
  parse: (value: unknown) => T,
  options: {
    id: (project: T) => string
    prepareExport?: (project: T) => unknown
  },
): ProjectCodec<T> {
  return { parse, ...options }
}
export function parseProjectJson<T>(text: string, codec: ProjectCodec<T>): T {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Not a valid JSON file.')
  }
  return codec.parse(value)
}
export interface ProjectJsonExport {
  filename: string
  content: string
  mimeType: 'application/json'
}
export function exportProjectJson<T>(project: T, codec: ProjectCodec<T>): ProjectJsonExport {
  const validated = codec.parse(project)
  const value = codec.prepareExport ? codec.prepareExport(validated) : validated
  // Validate the transport form too; stripping fields must not break the schema.
  codec.parse(value)
  const filename = codec.id(validated).replace(/[^a-zA-Z0-9._-]/g, '_') || 'project'
  return { filename: `${filename}.json`, content: JSON.stringify(value, null, 2), mimeType: 'application/json' }
}
export interface ProjectOperation {
  signal?: AbortSignal
}
export interface ProjectRepository<T> {
  list(options?: ProjectOperation): Promise<T[]>
  get(id: string, options?: ProjectOperation): Promise<T | null>
  save(project: T, options?: ProjectOperation): Promise<T>
  remove(id: string, options?: ProjectOperation): Promise<void>
}
export interface ProjectStoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface ProjectCollectionStore<T> {
  read(): T[]
  write(projects: readonly T[]): T[]
  save(project: T): T[]
  remove(id: string): T[]
}
/** Synchronous adapter also supports existing apps that expose synchronous local lists. */
export function createProjectCollectionStore<T>(
  codec: ProjectCodec<T>,
  storage: ProjectStoragePort,
  key: string,
  options: {
    limit?: number
    /** Ignore obsolete/broken individual records without losing valid siblings. */
    skipInvalid?: boolean
  } = {},
): ProjectCollectionStore<T> {
  const limit = options.limit ?? Infinity
  if (!(limit >= 0) || (Number.isFinite(limit) && !Number.isInteger(limit)))
    throw new Error('Project limit must be a non-negative integer.')
  const read = () => {
    const raw = storage.getItem(key)
    if (!raw) return []
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values)) throw new Error('Project storage must contain an array.')
    const projects: T[] = []
    for (const value of values) {
      try {
        projects.push(codec.parse(value))
      } catch (error) {
        if (options.skipInvalid === false) throw error
      }
    }
    return projects
  }
  const write = (projects: readonly T[]) => {
    const validated = projects.slice(0, limit).map((project) => codec.parse(project))
    storage.setItem(key, JSON.stringify(validated))
    return validated
  }
  return {
    read,
    write,
    save: (project) => {
      const validated = codec.parse(project)
      return write([validated, ...read().filter((entry) => codec.id(entry) !== codec.id(validated))])
    },
    remove: (id) => write(read().filter((entry) => codec.id(entry) !== id)),
  }
}
function checkSignal(options?: ProjectOperation) {
  if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException('Operation aborted', 'AbortError')
}
export function createProjectRepository<T>(
  codec: ProjectCodec<T>,
  store: ProjectCollectionStore<T>,
): ProjectRepository<T> {
  return {
    async list(options) {
      checkSignal(options)
      return store.read()
    },
    async get(id, options) {
      checkSignal(options)
      return store.read().find((entry) => codec.id(entry) === id) ?? null
    },
    async save(project, options) {
      checkSignal(options)
      return store.save(project)[0] ?? codec.parse(project)
    },
    async remove(id, options) {
      checkSignal(options)
      store.remove(id)
    },
  }
}
export function createWebStorageProjectRepository<T>(
  codec: ProjectCodec<T>,
  storage: ProjectStoragePort,
  key: string,
  options?: {
    limit?: number
    skipInvalid?: boolean
  },
): ProjectRepository<T> {
  return createProjectRepository(codec, createProjectCollectionStore(codec, storage, key, options))
}
export function createMemoryProjectRepository<T>(
  codec: ProjectCodec<T>,
  initial: readonly T[] = [],
): ProjectRepository<T> {
  let content = JSON.stringify(initial.map((project) => codec.parse(project)))
  return createWebStorageProjectRepository(
    codec,
    {
      getItem: () => content,
      setItem: (_key, value) => {
        content = value
      },
    },
    'projects',
  )
}
export interface ProjectExportPort {
  write(artifact: ProjectJsonExport, options?: ProjectOperation): Promise<void>
}
export interface ProjectSharePort {
  share(artifact: ProjectJsonExport, options?: ProjectOperation): Promise<{ url: string }>
}
/** File/text transport is structural, so this also works with server-side file readers. */
export async function importProjectFile<T>(
  file: { text(): Promise<string> },
  codec: ProjectCodec<T>,
  repository?: ProjectRepository<T>,
  options?: ProjectOperation,
): Promise<T> {
  checkSignal(options)
  const project = parseProjectJson(await file.text(), codec)
  checkSignal(options)
  return repository ? repository.save(project, options) : project
}
export async function exportProject<T>(
  project: T,
  codec: ProjectCodec<T>,
  port: ProjectExportPort,
  options?: ProjectOperation,
): Promise<void> {
  checkSignal(options)
  await port.write(exportProjectJson(project, codec), options)
}
export async function shareProject<T>(
  project: T,
  codec: ProjectCodec<T>,
  port: ProjectSharePort,
  options?: ProjectOperation,
): Promise<{ url: string }> {
  checkSignal(options)
  return port.share(exportProjectJson(project, codec), options)
}
/** Browser host adapter; servers can inject their own export port instead. */
export function downloadProjectJson(artifact: ProjectJsonExport): void {
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mimeType }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = artifact.filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
