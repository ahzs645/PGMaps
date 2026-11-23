import type { ForestryScene } from './scene'
import Dexie, { type Table } from 'dexie'
import { emptyTools, parseTools, type ToolsDocument } from './assessmentTools'
import { keepStoragePersistent } from '@/lib/offline/persistentStorage'
import { checkpointMayReplace, type SiteCheckpoint } from './siteCheckpoint'

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

/**
 * The last site, written as a project file when the page switched away from it (*New site*, a sample, a file opened),
 * so *Reopen previous site* brings back its photos, attachments and pictures. One slot: the next switch replaces it.
 */
export type StoredPreviousSite = { id: 'previous'; savedAt: string; name: string; blob: Blob }
/**
 * The site open now, kept as a project file after each change (`siteCheckpoint.ts`) beside the previous site, so a
 * reload brings back its pictures, figures and shelved views. One slot, owned by one site (`siteId`).
 */
export type StoredSiteCheckpoint = SiteCheckpoint & { id: 'current' }

class ToolsDatabase extends Dexie {
  documents!: Table<{ id: string; document: ToolsDocument }, string>
  scenes!: Table<{ id: string; scene: ForestryScene; revision?: number }, string>
  attachments!: Table<StoredAttachment, string>
  ownPhotos!: Table<StoredOwnPhoto, string>
  photoDepth!: Table<StoredPhotoDepth, string>
  previousSites!: Table<StoredPreviousSite | StoredSiteCheckpoint, string>
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
    // The last site as a project file, for *Reopen previous site*.
    this.version(4).stores({
      documents: 'id',
      scenes: 'id',
      attachments: 'key',
      ownPhotos: 'id',
      photoDepth: 'key, recordId',
      previousSites: 'id',
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

/** The scene kept here and its revision (0 for one kept before revisions were), or null. */
export async function loadCurrentScene(): Promise<{ scene: ForestryScene; revision: number } | null> {
  const row = await db.scenes.get('current')
  return row ? { scene: row.scene, revision: row.revision ?? 0 } : null
}
export async function saveCurrentScene(scene: ForestryScene, revision: number) {
  // A scene and its photos kept only here must not be cleared with the browser's caches.
  keepStoragePersistent()
  await db.scenes.put({ id: 'current', scene, revision })
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

/** Keeps the last site's project file in the one slot, replacing what was there. */
export async function savePreviousSite(site: { name: string; savedAt: string; blob: Blob }) {
  // The last site's photos and pictures may now be kept only here: they must not go with the browser's caches.
  keepStoragePersistent()
  await db.previousSites.put({ id: 'previous', ...site })
}

/** The last site kept, or null when none was or storage is shut. */
export async function loadPreviousSite(): Promise<StoredPreviousSite | null> {
  const row = await db.previousSites.get('previous')
  return row?.id === 'previous' ? row : null
}

/**
 * Keeps the open site's checkpoint in its slot unless the one there is newer (`checkpointMayReplace`). Resolves
 * whether it was written.
 */
export async function saveSiteCheckpoint(checkpoint: SiteCheckpoint): Promise<boolean> {
  // The site's pictures and figures are kept only here until a project is saved: not to go with the browser's caches.
  keepStoragePersistent()
  return db.transaction('rw', db.previousSites, async () => {
    const stored = await db.previousSites.get('current')
    if (stored?.id === 'current' && !checkpointMayReplace(stored, checkpoint)) return false
    await db.previousSites.put({ ...checkpoint, id: 'current' })
    return true
  })
}

/** The open site's checkpoint as kept, or null. */
export async function loadSiteCheckpoint(): Promise<StoredSiteCheckpoint | null> {
  const row = await db.previousSites.get('current')
  return row?.id === 'current' ? row : null
}

/** Drops the checkpoint, of whichever site it was; `unlessSite` keeps one already written for that site. */
export async function clearSiteCheckpoint(unlessSite?: string) {
  await db.transaction('rw', db.previousSites, async () => {
    const stored = await db.previousSites.get('current')
    if (stored?.id === 'current' && stored.siteId !== unlessSite) await db.previousSites.delete('current')
  })
}
