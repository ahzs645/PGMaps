/**
 * Keeps the open site's checkpoint (`siteCheckpoint.ts`) and opens it again after a reload. Browser-only.
 *
 * Order matters. Nothing is written until the scene has been read and the kept checkpoint opened (or found to be
 * another site's): the page starts without its pictures, and writing that would erase them. Writes wait for the page
 * to stand still (`CHECKPOINT_DELAY_MS`) and go one at a time. A write is for the site open when it started: one that
 * finishes after a switch (`newSite`) is dropped, and the row names its site, so a stray one is never opened for
 * another. A slow build never replaces a newer checkpoint (`saveSiteCheckpoint`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ProjectState } from './projectFile'
import {
  CHECKPOINT_DELAY_MS,
  SITE_ID_STORAGE_KEY,
  checkpointRefusal,
  newSiteId,
  type CheckpointStatus,
  type SiteCheckpoint,
} from './siteCheckpoint'
import { PREVIOUS_SITE_MAX_BYTES } from './siteTransition'
import { clearSiteCheckpoint, loadSiteCheckpoint, saveSiteCheckpoint } from './toolsStorage'

/** The open site's id from this browser, or a new one written there. */
function readSiteId(): string {
  try {
    const kept = localStorage.getItem(SITE_ID_STORAGE_KEY)
    if (kept) return kept
    const fresh = newSiteId()
    localStorage.setItem(SITE_ID_STORAGE_KEY, fresh)
    return fresh
  } catch {
    // Storage shut: the id lives for this page only, and nothing kept is opened again.
    return newSiteId()
  }
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

export type SiteCheckpointOptions = {
  /** The scene has been read from this browser (`usePersistentScene`'s `ready`). */
  ready: boolean
  /**
   * What the checkpoint holds, compared by identity: a change writes it again once the page stands still. Always the
   * same length, as an effect's dependencies are.
   */
  watch: readonly unknown[]
  /** The site as it stands, as a project's state with its title and a name for the row. */
  build: () => { state: ProjectState; title: string | null; name: string }
  /** The scene revision now (`usePersistentScene`'s `revisions.current`). */
  sceneRevision: () => number
  /** Hands the opened checkpoint to the page, which keeps what it already holds (`mergeCheckpoint`). */
  restore: (kept: { state: ProjectState; title: string | null }, checkpoint: SiteCheckpoint) => void
}

export function useSiteCheckpoint({ ready, watch, build, sceneRevision, restore }: SiteCheckpointOptions) {
  const [status, setStatus] = useState<CheckpointStatus>({ kind: 'idle' })
  const [phase, setPhase] = useState<'waiting' | 'reading' | 'ready'>('waiting')
  const [firstSite] = useState(readSiteId)
  const siteId = useRef(firstSite)
  const latest = useRef({ build, sceneRevision, restore })
  latest.current = { build, sceneRevision, restore }
  const queue = useRef(Promise.resolve())
  /** Set by a restore: the render that takes the checkpoint in writes nothing back. */
  const skipNext = useRef(false)

  /** Runs storage work after what was asked before it, so a clear and a write never cross. */
  const enqueue = useCallback((work: () => Promise<void>) => {
    queue.current = queue.current.then(work, work).catch(() => undefined)
    return queue.current
  }, [])

  // Open what was kept for this site, once, before anything is written.
  useEffect(() => {
    if (!ready || phase !== 'waiting') return
    setPhase('reading')
    const site = siteId.current
    void enqueue(async () => {
      try {
        const row = await loadSiteCheckpoint()
        const refusal = checkpointRefusal(row, site)
        if (refusal || !row) {
          // Another site's copy (left by a switch that never wrote this one's) is of no use here.
          if (row) await clearSiteCheckpoint(site)
          return
        }
        const { openProjectArchive } = await import('./projectArchive')
        const { state, media } = await openProjectArchive(row.blob)
        if (siteId.current !== site) return
        latest.current.restore({ state, title: media.title }, row)
        // The render that takes it in is no change of the reviewer's: the copy kept is already what it holds.
        skipNext.current = true
        setStatus({ kind: 'kept', savedAt: row.savedAt, restored: true })
      } catch (error) {
        if (siteId.current === site)
          setStatus({
            kind: 'not-kept',
            reason: `the copy kept could not be read (${error instanceof Error ? error.message : String(error)})`,
          })
      } finally {
        setPhase('ready')
      }
    })
  }, [ready, phase, enqueue])

  /** Writes the checkpoint for `site`, the site open when the write was asked for; nothing once another opens. */
  const write = useCallback(async (site: string) => {
    if (siteId.current !== site) return
    try {
      const revision = latest.current.sceneRevision()
      const { state, title, name } = latest.current.build()
      const savedAt = new Date()
      const { writeProjectArchive } = await import('./projectArchive')
      // The project file's own format; attachments, photos and the workspace are kept by their own stores.
      const blob = await writeProjectArchive(
        { ...state, workspace: null },
        { title, attachments: [], photo: null, photos: [] },
        savedAt,
      )
      if (siteId.current !== site) return
      if (blob.size > PREVIOUS_SITE_MAX_BYTES) {
        setStatus({
          kind: 'not-kept',
          reason: `its pictures come to ${megabytes(blob.size)} MB, more than the ${megabytes(PREVIOUS_SITE_MAX_BYTES)} MB this browser keeps. Save a Project from Save & export.`,
        })
        return
      }
      const written = await saveSiteCheckpoint({
        siteId: site,
        sceneRevision: revision,
        savedAt: savedAt.toISOString(),
        name,
        blob,
      })
      if (siteId.current !== site) return
      setStatus(
        written
          ? { kind: 'kept', savedAt: savedAt.toISOString() }
          : { kind: 'not-kept', reason: 'a newer copy of this site is kept (another tab?). Reload to see it.' },
      )
    } catch (error) {
      if (siteId.current === site)
        setStatus({ kind: 'not-kept', reason: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // Write once the page stands still after a change to what the checkpoint holds.
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (phase !== 'ready') return
    if (skipNext.current) {
      skipNext.current = false
      return
    }
    const site = siteId.current
    timer.current = window.setTimeout(() => void enqueue(() => write(site)), CHECKPOINT_DELAY_MS)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `watch` is the list of what the checkpoint holds
  }, [phase, enqueue, write, ...watch])

  /**
   * A site switch (`transitionSite`): the next site gets its own id, written beside the scene at once, and the last
   * site's checkpoint goes (it is kept to reopen as the previous site). A write still building for it is dropped.
   */
  const newSite = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const site = newSiteId()
    siteId.current = site
    try {
      localStorage.setItem(SITE_ID_STORAGE_KEY, site)
    } catch {
      /* Storage shut: nothing kept is opened again anyway. */
    }
    setStatus({ kind: 'idle' })
    void enqueue(() => clearSiteCheckpoint(site))
  }, [enqueue])

  return { status, newSite, restoring: phase !== 'ready' } as const
}
