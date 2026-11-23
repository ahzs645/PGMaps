/**
 * The site checkpoint: the open site kept in this browser as a project file (`writeProjectArchive`, the format Save &
 * export's *Project* writes), so a reload brings back what nothing else keeps. The scene, the saved views of the
 * scene open, the workspace, the attachments and the own photos each have a store of their own and come back on
 * their own; the checkpoint carries the rest: the views shelved at other places, every view's picture, caption,
 * analysis sheet and viewpoint record, the before-harvest renders, other engines' figures, the package's renderer and
 * recipe and the project's title. It holds no attachment or photo bytes (`useOwnPhotoPersistence` keeps those) and no
 * workspace (`saveTools` keeps it), so writing it after each change stays cheap.
 *
 * One slot, the `current` row beside the previous site (`toolsStorage.ts`), owned by one site: a site is named by a
 * random id kept beside the scene and replaced at every switch (`transitionSite`), and a checkpoint for any other site
 * is never opened. A write never replaces a newer one (`checkpointMayReplace`), and opening one never replaces newer
 * state on the page (`mergeCheckpoint`). No DOM or network access.
 */
import type { SavedDriveView } from './previewState'
import type { ProjectState } from './projectFile'
import { renderJobIsFor } from './renderJobKey'
import { parseScene, serializeScene, type ForestryScene } from './scene'
import { sceneFingerprint } from './sceneInput'

/** How long the page must stand still after a change before the checkpoint is written. */
export const CHECKPOINT_DELAY_MS = 1500
/** Where this browser names the open site (`newSiteId`), written at once beside the scene. */
export const SITE_ID_STORAGE_KEY = 'pgmaps.forestry-visuals.site-id.v1'

/** A checkpoint as kept: the site it is of, the scene revision it was built at, when, and the project file. */
export type SiteCheckpoint = {
  siteId: string
  sceneRevision: number
  savedAt: string
  name: string
  blob: Blob
}

/** The state of the checkpoint, for the page's quiet line (`checkpointLine`). */
export type CheckpointStatus =
  | { kind: 'idle' }
  | { kind: 'kept'; savedAt: string; restored?: boolean }
  | { kind: 'not-kept'; reason: string }

/**
 * A scene's fingerprint as it reads back from storage. A scene made in the page (a sample just opened) leaves out
 * empty parts its stored copy spells out, so the two fingerprints differ for the same scene; comparing a checkpoint's
 * scene with the page's goes through this on both sides.
 */
export function comparableFingerprint(scene: ForestryScene): string | null {
  try {
    const read = parseScene(JSON.parse(serializeScene(scene)))
    return sceneFingerprint(read ?? scene)
  } catch {
    return sceneFingerprint(scene)
  }
}

/** A fresh name for a site, from the platform's random numbers. */
export function newSiteId(random: () => string = () => crypto.randomUUID()): string {
  return `site-${random()}`
}

/**
 * Whether `next` may replace the checkpoint stored. One for another site always may: the page writes only the site it
 * has open. One for the same site may not when the stored one was built at a later scene revision, or at the same
 * revision later (a slow build finishing after a newer one, or another tab further on).
 */
export function checkpointMayReplace(
  stored: Pick<SiteCheckpoint, 'siteId' | 'sceneRevision' | 'savedAt'> | null,
  next: Pick<SiteCheckpoint, 'siteId' | 'sceneRevision' | 'savedAt'>,
): boolean {
  if (!stored || stored.siteId !== next.siteId) return true
  if (stored.sceneRevision !== next.sceneRevision) return stored.sceneRevision < next.sceneRevision
  return stored.savedAt <= next.savedAt
}

/** Why a stored checkpoint is not opened, or null when it is the open site's. */
export function checkpointRefusal(checkpoint: Pick<SiteCheckpoint, 'siteId'> | null, siteId: string): string | null {
  if (!checkpoint) return 'nothing kept'
  if (checkpoint.siteId !== siteId) return 'it is another site’s'
  return null
}

/** What the page holds when a checkpoint is opened. */
export type PageParts = {
  /** The fingerprint of the scene open, as it reads back from storage (`comparableFingerprint`). */
  key: string | null
  /** The scene's newest revision read when the page opened (`usePersistentScene`'s `revisions.loaded`). */
  loadedRevision: number
  /** Whether this browser's Saved views record holds the scene open: its views (even none) are then the newer. */
  savedRecordHoldsKey: boolean
  views: SavedDriveView[]
  shelved: Array<{ key: string; views: SavedDriveView[] }>
  images: Record<string, unknown>
  capturedBefore: Record<string, unknown>
  engineFigures: Record<string, unknown>
  pkg: { renderer: string | null; recipeId: string | null }
  title: string | null
}

/** What the page takes from a checkpoint: each part null where the page keeps its own. */
export type CheckpointMerge = {
  /** The checkpoint's scene, only when it was built after the scene the page read (the scene store fell behind). */
  scene: ProjectState['scene'] | null
  /**
   * The saved views: the checkpoint's where the page has no record of its own for the scene, else the page's own under
   * the ids the checkpoint kept for them (`withKeptIds`); null when the page's stand.
   */
  views: SavedDriveView[] | null
  shelved: Array<{ key: string; views: SavedDriveView[] }>
  images: Record<string, unknown>
  capturedBefore: Record<string, unknown>
  engineFigures: Record<string, unknown>
  renderer: string | null
  recipeId: string | null
  title: string | null
}

/** A saved view's content without its id, as the Saved views record and the project file both read it back. */
const withoutId = (view: SavedDriveView) => {
  const rest: Partial<SavedDriveView> = { ...view }
  delete rest.id
  return JSON.stringify(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/**
 * The page's views under the ids the checkpoint kept for them. This browser's Saved views record renumbers its views
 * (`parsePreview`: `view-0`, `view-1`…), so after a reload every picture, figure and render, all kept by view id,
 * would find no view. Each view takes the id of the kept view with the same content, each kept view used once; null
 * when no id changes.
 */
function withKeptIds(views: SavedDriveView[], kept: SavedDriveView[]): SavedDriveView[] | null {
  const unused = new Map<string, SavedDriveView[]>()
  for (const view of kept) unused.set(withoutId(view), [...(unused.get(withoutId(view)) ?? []), view])
  let changed = false
  const out = views.map((view) => {
    const match = unused.get(withoutId(view))?.shift()
    if (!match || match.id === view.id) return view
    changed = true
    return { ...view, id: match.id }
  })
  return changed ? out : null
}

/**
 * The page's parts with the checkpoint's under them: what the page already holds stays (a view saved, a picture taken
 * or a choice made since it opened), and the checkpoint fills only what it lacks. Its scene is taken only when it is
 * newer than the scene read (`sceneRevision` above `loadedRevision`); its saved views only for the scene it was built
 * on, and only when this browser's Saved views record does not hold that scene, which is written at once and so is
 * never older; the record's views then take back the ids it renumbered. Pictures come back only for the views the page then holds.
 */
export function mergeCheckpoint(
  page: PageParts,
  checkpoint: {
    state: ProjectState
    title: string | null
    /** The fingerprint of the checkpoint's scene (`comparableFingerprint`). */
    key: string | null
    sceneRevision: number
  },
): CheckpointMerge {
  const { state: kept, key: keptKey, sceneRevision } = checkpoint
  const scene = sceneRevision > page.loadedRevision ? kept.scene : null
  const sameScene = keptKey !== null && (scene ? true : keptKey === page.key)
  const views = !sameScene
    ? null
    : !page.savedRecordHoldsKey && !page.views.length && kept.views.length
      ? kept.views
      : withKeptIds(page.views, kept.views)
  const openKey = scene ? keptKey : page.key
  // Views saved for a scene that has moved on since go with the shelved places, as a save shelves them.
  const keptAway = [
    ...kept.shelved,
    ...(!sameScene && keptKey !== null && kept.views.length ? [{ key: keptKey, views: kept.views }] : []),
  ]
  const shelvedKeys = new Set(page.shelved.map((entry) => entry.key))
  const shelved = [...page.shelved, ...keptAway.filter((entry) => entry.key !== openKey && !shelvedKeys.has(entry.key))]
  const held = new Set([...(views ?? page.views), ...shelved.flatMap((entry) => entry.views)].map((view) => view.id))
  const under = (mine: Record<string, unknown>, theirs: Record<string, unknown>, holds: (key: string) => boolean) => ({
    ...Object.fromEntries(Object.entries(theirs).filter(([key]) => holds(key))),
    ...mine,
  })
  return {
    scene,
    views,
    shelved,
    images: under(page.images, kept.images, (id) => held.has(id)),
    capturedBefore: under(page.capturedBefore, kept.capturedBefore, (id) => held.has(id)),
    engineFigures: under(page.engineFigures, kept.engineFigures, (key) => renderJobIsFor(key, held)),
    renderer: page.pkg.renderer ?? kept.pkg.renderer,
    recipeId: page.pkg.recipeId ?? kept.pkg.recipeId,
    title: page.title ?? checkpoint.title,
  }
}

/**
 * The sets a restore adds to the page's shelved views: the merge's sets the page's shelf does not hold (`shelf`, the
 * shelved state itself), less the page's saved set while it stays the saved set. The saved set is listed among the
 * page's shelved places while it is under another scene (`shelvedWithSaved`) but lives in no shelf; when the restore
 * replaces it with views under another key (`openKey`), it is shelved here, as a design change shelves it, or the next
 * checkpoint keeps it nowhere.
 */
export function restoredShelves<V>(
  merged: { views: V[] | null; shelved: Array<{ key: string; views: V[] }> },
  saved: { key: string | null; views: readonly V[] },
  openKey: string | null,
  shelf: ReadonlyArray<{ key: string }>,
): Array<{ key: string; views: V[] }> {
  const savedStays = !merged.views || saved.key === openKey
  return merged.shelved.filter(
    (entry) =>
      entry.views.length > 0 &&
      !shelf.some((held) => held.key === entry.key) &&
      !(savedStays && entry.key === saved.key),
  )
}

/** The page's line for the checkpoint, or null when there is nothing to say. `time` formats an instant for the page. */
export function checkpointLine(status: CheckpointStatus, time: (iso: string) => string): string | null {
  if (status.kind === 'kept')
    return status.restored
      ? `Brought back from this browser (kept ${time(status.savedAt)})`
      : `Kept in this browser ${time(status.savedAt)}`
  if (status.kind === 'not-kept') return `Not kept in this browser: ${status.reason}`
  return null
}
