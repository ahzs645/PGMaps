import type { RoadProject } from './types'

/**
 * Projects kept in this browser. Each project lives under `project:<id>` in the workspace's
 * IndexedDB store, `library` lists them for the picker and `active` names the one to reopen.
 * The ids are storage keys only; they never enter the project file.
 */
const DATABASE = 'pgmaps-forestry-roads-v1'
const STORE = 'projects'
/** The single autosave slot used before the library existed; migrated on first read. */
const LEGACY_KEY = 'current'

export interface LibraryEntry {
  id: string
  name: string
  terrain: string
  roads: number
  updatedAt: number
}

/** Newest first, one entry per id. */
export function upsertEntry(entries: readonly LibraryEntry[], entry: LibraryEntry): LibraryEntry[] {
  return [entry, ...entries.filter((e) => e.id !== entry.id)].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function libraryEntry(id: string, project: RoadProject, updatedAt = Date.now()): LibraryEntry {
  return {
    id,
    name: project.name || 'Untitled road project',
    terrain: project.terrain.name,
    roads: project.alignments.length,
    updatedAt,
  }
}

function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result,
        transaction = db.transaction(STORE, mode),
        result = work(transaction.objectStore(STORE))
      transaction.oncomplete = () => {
        db.close()
        resolve(result())
      }
      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}
const get = <T>(store: IDBObjectStore, key: string) => {
  const request = store.get(key)
  return () => request.result as T | undefined
}

/** The library and the project to reopen, moving a pre-library autosave into it once. */
export async function readLibrary(): Promise<{ entries: LibraryEntry[]; activeId: string | null }> {
  const { entries, activeId, legacy } = await withStore('readonly', (store) => {
    const entries = get<LibraryEntry[]>(store, 'library'),
      activeId = get<string>(store, 'active'),
      legacy = get<RoadProject>(store, LEGACY_KEY)
    return () => ({ entries: entries() ?? [], activeId: activeId() ?? null, legacy: legacy() })
  })
  if (entries.length || !legacy) return { entries, activeId }
  const id = crypto.randomUUID()
  await writeProject(id, legacy, [])
  return { entries: [libraryEntry(id, legacy)], activeId: id }
}

export const readProject = (id: string) => withStore('readonly', (store) => get<RoadProject>(store, `project:${id}`))

/** Saves a project, makes it the one to reopen and returns the updated library. */
export function writeProject(id: string, project: RoadProject, entries: readonly LibraryEntry[]) {
  const next = upsertEntry(entries, libraryEntry(id, project))
  return withStore('readwrite', (store) => {
    store.put(project, `project:${id}`)
    store.put(next, 'library')
    store.put(id, 'active')
    return () => next
  })
}

/** Adds a project without opening it, e.g. a duplicate. */
export function addProject(id: string, project: RoadProject, entries: readonly LibraryEntry[]) {
  const next = upsertEntry(entries, libraryEntry(id, project))
  return withStore('readwrite', (store) => {
    store.put(project, `project:${id}`)
    store.put(next, 'library')
    return () => next
  })
}

export function deleteProject(id: string, entries: readonly LibraryEntry[]) {
  const next = entries.filter((e) => e.id !== id)
  return withStore('readwrite', (store) => {
    store.delete(`project:${id}`)
    store.put(next, 'library')
    return () => next
  })
}

/** The training example keeps its own slot outside the library, as before. */
export function writeTraining(project: RoadProject) {
  return withStore('readwrite', (store) => {
    store.put(project, 'training')
    return () => undefined
  })
}
