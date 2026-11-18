/**
 * Own photos across a reload. Before this, a reload kept each photo's field record and lost everything else: the
 * originals were held in the page's memory only, the set came back empty, and a photo reopened from its record was
 * its 1,600-pixel copy with no EXIF, no time and no lens.
 *
 * Kept in this browser's database (`toolsStorage.ts`), beside the workspace the records are in: every project
 * attachment's bytes, and for each photo in the set its order and its camera (pose, where each value came from, the
 * last search's summary), the same things a project file keeps. When the page opens and the workspace has loaded, the
 * set is opened again from the originals, as a project file's photos are (`openSavedPhotos`).
 *
 * What ends it: removing a photo removes its original and its row; closing the set (*Close my photos*) empties the
 * set's rows but leaves the originals with their records; opening a project replaces both with the project's.
 * Nothing here is uploaded, and nothing here is in the scene or the run.
 *
 * Browser-only.
 */
import { useEffect, useRef, useState } from 'react'

import type { ProjectAttachment } from './projectArchive'
import { loadPhotoSet, prunePhotoDepth, saveAttachments, saveOwnPhotos, type StoredAttachment } from './toolsStorage'
import type { SavedOwnPhoto } from './useFieldPhoto'

/** What is kept of one photo in the set, beside its bytes. */
export type KeptOwnPhoto = {
  id: string
  name: string
  state: Pick<SavedOwnPhoto, 'pose' | 'sources' | 'search'>
}

/** How long the set must stand still before its cameras are written: a nudge is many changes a second. */
const SAVE_DELAY_MS = 700

/** A key for an attachment's bytes that is the same on every render: its record, else what the file is. */
function attachmentKeys(list: readonly ProjectAttachment[]): StoredAttachment[] {
  const seen = new Map<string, number>()
  return list.map((entry) => {
    const base = entry.recordId ? `record:${entry.recordId}` : `file:${entry.name}:${entry.blob.size}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return { key: count ? `${base}#${count}` : base, name: entry.name, blob: entry.blob, recordId: entry.recordId }
  })
}

export function useOwnPhotoPersistence({
  ready,
  attachments,
  setAttachments,
  photos,
  activeId,
  hasRecord,
  restore,
}: {
  /** The workspace has loaded: a restored photo's acceptance and jobs are read from its record. */
  ready: boolean
  attachments: readonly ProjectAttachment[]
  setAttachments: (update: (current: ProjectAttachment[]) => ProjectAttachment[]) => void
  /** The set as it stands, in order. */
  photos: readonly KeptOwnPhoto[]
  activeId: string | null
  /** Whether the workspace still holds this photo's record: a photo whose record is gone is not brought back. */
  hasRecord: (id: string) => boolean
  /** Opens kept photos into the set (`openSavedPhotos`). */
  restore: (entries: Array<{ file: File; saved: SavedOwnPhoto }>, activeId: string | null) => Promise<boolean>
}): { restoring: boolean } {
  // Nothing is written until what was kept has been read: the page starts empty, and writing that would erase it.
  const [phase, setPhase] = useState<'waiting' | 'reading' | 'ready'>('waiting')
  const latest = useRef({ hasRecord, restore, setAttachments })
  latest.current = { hasRecord, restore, setAttachments }

  useEffect(() => {
    if (!ready || phase !== 'waiting') return
    setPhase('reading')
    void (async () => {
      try {
        const kept = await loadPhotoSet()
        if (kept.attachments.length)
          latest.current.setAttachments((current) =>
            current.length
              ? current
              : kept.attachments.map(({ name, blob, recordId }) => ({ name, blob, ...(recordId ? { recordId } : {}) })),
          )
        const original = new Map(kept.attachments.flatMap((entry) => (entry.recordId ? [[entry.recordId, entry]] : [])))
        const entries = kept.photos.flatMap((row) => {
          const bytes = original.get(row.id)
          if (!bytes || !latest.current.hasRecord(row.id)) return []
          const state = row.state as KeptOwnPhoto['state']
          if (!state?.pose) return []
          return [
            {
              file: new File([bytes.blob], row.name),
              saved: { ...state, recordId: row.id, blob: bytes.blob } satisfies SavedOwnPhoto,
            },
          ]
        })
        if (entries.length) await latest.current.restore(entries, kept.photos.find((row) => row.active)?.id ?? null)
      } catch {
        /* Storage shut (a private window) or unreadable: the page works from memory, as it did before. */
      } finally {
        setPhase('ready')
      }
    })()
  }, [ready, phase])

  useEffect(() => {
    if (phase !== 'ready') return
    void saveAttachments(attachmentKeys(attachments)).catch(() => undefined)
    // A photo's depth estimate goes when its original does.
    void prunePhotoDepth(attachments.flatMap((entry) => (entry.recordId ? [entry.recordId] : []))).catch(
      () => undefined,
    )
  }, [phase, attachments])

  // By content, so a re-render with the same set writes nothing.
  const set = JSON.stringify(photos.map((photo, order) => ({ ...photo, order, active: photo.id === activeId })))
  useEffect(() => {
    if (phase !== 'ready') return
    const timer = window.setTimeout(() => void saveOwnPhotos(JSON.parse(set)).catch(() => undefined), SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [phase, set])

  return { restoring: phase === 'reading' }
}
