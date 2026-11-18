import type { ForestryScene } from './scene'
import Dexie, { type Table } from 'dexie'
import { emptyTools, parseTools, type ToolsDocument } from './assessmentTools'
import { keepStoragePersistent } from '@/lib/offline/persistentStorage'

/** A project attachment as kept between visits: its bytes, its name and the field record it is the original of. */
export type StoredAttachment = { key: string; name: string; blob: Blob; recordId?: string | null }
/**
 * An own photo as it stood in the set: which record it is, in what order, and its camera. `state` is the page's own
 * record of it (pose, where each value came from, the last search's summary), read back by the page that wrote it.
 */
export type StoredOwnPhoto = { id: string; name: string; order: number; active: boolean; state: unknown }

/** A photo's depth estimate from one model, kept so it is worked out once. */
export type StoredPhotoDepth = {
  key: string
  recordId: string
  model: string
  width: number
  height: number
  inverse: Float32Array
}

class ToolsDatabase extends Dexie {
  documents!: Table<{ id: string; document: ToolsDocument }, string>
  scenes!: Table<{ id: string; scene: ForestryScene }, string>
  attachments!: Table<StoredAttachment, string>
  ownPhotos!: Table<StoredOwnPhoto, string>
  photoDepth!: Table<StoredPhotoDepth, string>
  constructor() {
    super('pgmaps.forestry-assessment-tools.v1')
    this.version(1).stores({ documents: 'id' })
    this.version(2).stores({ documents: 'id', scenes: 'id' })
    // Project attachments (a photo's original bytes among them) and the own-photo set, so both outlive a reload.
    this.version(3).stores({
      documents: 'id',
      scenes: 'id',
      attachments: 'key',
      ownPhotos: 'id',
      // A photo's depth estimate, by record and model: a second or more of inference, the same every time.
      photoDepth: 'key, recordId',
    })
  }
}
const db = new ToolsDatabase()
export async function loadTools() {
  const saved = await db.documents.get('workspace')
  return saved ? parseTools(saved.document) : emptyTools()
}
export async function saveTools(document: ToolsDocument) {
  await db.documents.put({ id: 'workspace', document })
}

export async function loadCurrentScene() {
  return (await db.scenes.get('current'))?.scene ?? null
}
export async function saveCurrentScene(scene: ForestryScene) {
  // A scene and its photos kept only here must not be cleared with the browser's caches.
  keepStoragePersistent()
  await db.scenes.put({ id: 'current', scene })
}

/** The attachments and the own-photo set kept from the last visit; empty when nothing was kept or storage is shut. */
export async function loadPhotoSet(): Promise<{ attachments: StoredAttachment[]; photos: StoredOwnPhoto[] }> {
  const [attachments, photos] = await Promise.all([db.attachments.toArray(), db.ownPhotos.toArray()])
  return { attachments, photos: photos.sort((a, b) => a.order - b.order) }
}

/**
 * Keeps exactly these attachments. Bytes already kept under a key are left alone, so a set of originals is written
 * once, not on every change to the list.
 */
export async function saveAttachments(list: readonly StoredAttachment[]) {
  await db.transaction('rw', db.attachments, async () => {
    const kept = new Set(await db.attachments.toCollection().primaryKeys())
    const wanted = new Set(list.map((entry) => entry.key))
    const gone = [...kept].filter((key) => !wanted.has(key))
    if (gone.length) await db.attachments.bulkDelete(gone)
    const fresh = list.filter((entry) => !kept.has(entry.key))
    if (fresh.length) await db.attachments.bulkPut(fresh)
    // A photo's original is named for its record after it is first kept: the bytes stay, the link is written.
    for (const entry of list)
      if (kept.has(entry.key) && entry.recordId) await db.attachments.update(entry.key, { recordId: entry.recordId })
  })
}

/** Keeps exactly this own-photo set: its rows are small and rewritten whole. */
export async function saveOwnPhotos(list: readonly StoredOwnPhoto[]) {
  await db.transaction('rw', db.ownPhotos, async () => {
    await db.ownPhotos.clear()
    if (list.length) await db.ownPhotos.bulkPut([...list])
  })
}

const depthKey = (recordId: string, model: string) => `${recordId}|${model}`

/** A photo's kept depth estimate for a model, or null. */
export async function loadPhotoDepth(recordId: string, model: string): Promise<StoredPhotoDepth | null> {
  return (await db.photoDepth.get(depthKey(recordId, model))) ?? null
}

export async function savePhotoDepth(
  recordId: string,
  model: string,
  depth: { width: number; height: number; inverse: Float32Array },
) {
  await db.photoDepth.put({ key: depthKey(recordId, model), recordId, model, ...depth })
}

/** Drops the depth estimates of every photo but these: a removed photo's go with it. */
export async function prunePhotoDepth(keepRecordIds: readonly string[]) {
  const keep = new Set(keepRecordIds)
  const gone = (await db.photoDepth.toArray()).filter((row) => !keep.has(row.recordId)).map((row) => row.key)
  if (gone.length) await db.photoDepth.bulkDelete(gone)
}
