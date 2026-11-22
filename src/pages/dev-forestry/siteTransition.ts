/**
 * The session's site generation: one number the page bumps whenever the site changes under it (*New site*, a sample,
 * a Saved views file, a project, *Reopen previous site*). Work that awaits (an import, a save's screenshot and analysis
 * sheet, a capture, a background render) takes a guard when it starts and checks it after every await, so nothing
 * finished for one site is written into the next. No DOM access.
 */
import { createEmptyScene, createSampleScene, type ForestryScene } from './scene'
import { createRoadsideDriveScene } from './driveScenario'
import { createPurdenLakeScene } from './purdenLakeScenario'

export type SiteGuard = () => boolean

export type SiteGeneration = {
  /** The generation now. */
  readonly current: number
  /** Starts a new site: every guard taken before it reads false from now on. */
  next: () => number
  /** A check bound to the site now: true while no transition has happened since it was taken. */
  guard: () => SiteGuard
}

export function createSiteGeneration(): SiteGeneration {
  let generation = 0
  return {
    get current() {
      return generation
    },
    next: () => ++generation,
    guard: () => {
      const at = generation
      return () => at === generation
    },
  }
}

/**
 * The largest last site kept to reopen (*Reopen previous site*), bytes. A project file past it is not kept in this
 * browser: the reviewer saves it or leaves it, asked once.
 */
export const PREVIOUS_SITE_MAX_BYTES = 150 * 1024 * 1024

/** What a site holds, for whether it is kept to reopen when the page switches away from it. */
export type SiteContents = {
  scene: ForestryScene
  /** Saved views here and shelved at other places. */
  views: number
  attachments: number
  ownPhotos: number
  /** Whether the workspace holds any of the site's records (`workspaceHoldsSiteRecords`). */
  workspaceRecords: boolean
}

/** The sites a switch can open that hold nothing of the reviewer's yet: a new site and the three samples. */
const UNTOUCHED_SITES: ReadonlyArray<() => ForestryScene> = [
  createEmptyScene,
  createSampleScene,
  createRoadsideDriveScene,
  createPurdenLakeScene,
]

/**
 * A scene's content without its ids, for comparing with a freshly created one: every string an object's `id` holds
 * is replaced, wherever it appears (`activeLandformId`, a view's `blockId`), by its place in the order the ids were
 * met, and empty values (absent, null, false, an empty string, list or record) are left out, so a parsed copy that fills in
 * empty defaults reads the same.
 */
function withoutIds(scene: ForestryScene): string {
  const ids = new Map<string, string>()
  const collect = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.id === 'string' && !ids.has(record.id)) ids.set(record.id, `#${ids.size}`)
      Object.values(record).forEach(collect)
    }
  }
  collect(scene)
  const strip = (value: unknown): unknown => {
    if (typeof value === 'string') return ids.get(value) ?? (value === '' ? undefined : value)
    if (Array.isArray(value)) return value.length ? value.map(strip) : undefined
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([name, inner]) => [name, strip(inner)] as const)
        .filter(([, inner]) => inner !== undefined && inner !== null)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return entries.length ? Object.fromEntries(entries) : undefined
    }
    return value === false ? undefined : (value ?? undefined)
  }
  return JSON.stringify(strip(scene) ?? null)
}

/**
 * Whether a site is worth keeping to reopen: anything the reviewer made or added. Only a site that is exactly a new
 * site or a sample as it opens (its ids aside) and holds nothing else (no view, attachment, photo or workspace record)
 * is passed over: keeping it would take the place of the site before it. Anything else is kept, whatever it is: a
 * Visuals paragraph or measures, a route card or a step 4 judgement (`viaReview`), report fields, a mask, an adopted
 * landform, a road or block moved by a metre, a changed setting.
 */
export function siteWorthKeeping(site: SiteContents): boolean {
  if (site.views || site.attachments || site.ownPhotos || site.workspaceRecords) return true
  const own = withoutIds(site.scene)
  return !UNTOUCHED_SITES.some((create) => withoutIds(create()) === own)
}

/** The workspace fields that are the reviewer's own rather than a site's: they stay through a switch (`startNewSite`). */
const REVIEWER_FIELDS = new Set(['version', 'currentScene', 'growthCurve', 'growthSource', 'curveLibrary'])

/**
 * Whether the stored workspace (`storedWorkspaceJson`, parsed) holds any of the site's records: design options, views,
 * field records, runs, reference measurements, block curve assignments, or anything a newer workspace adds. Only the
 * reviewer's own inputs (the growth curve and the Castor library) are not the site's.
 */
export function workspaceHoldsSiteRecords(workspace: unknown): boolean {
  if (!workspace || typeof workspace !== 'object') return false
  return Object.entries(workspace as Record<string, unknown>).some(([name, value]) => {
    if (REVIEWER_FIELDS.has(name)) return false
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object') return Object.keys(value).length > 0
    return false
  })
}

/**
 * Every set of views the site holds away from the scene open now (`key`), for the project file and the keep: the
 * shelved sets, and the saved set itself when it was saved under another design or road (`saved.key !== key`), as a
 * save shelves it. Without it, views saved under an earlier design were left out of both.
 */
export function shelvedWithSaved<V>(
  saved: { key: string | null; views: readonly V[] },
  key: string | null,
  shelved: ReadonlyArray<{ key: string; views: V[] }>,
): Array<{ key: string; views: V[] }> {
  const away = saved.key && saved.key !== key && saved.views.length ? { key: saved.key, views: [...saved.views] } : null
  return [
    ...shelved.filter((entry) => entry.key !== key && entry.views.length && entry.key !== away?.key),
    ...(away ? [away] : []),
  ]
}

/**
 * The project opens asked for (`openProjectFile`): only the newest may open, and a site switch made since a request
 * was asked for supersedes it. A switch supersedes only the requests asked before it started (`latest` then), so a
 * project picked while the last site was still being kept is not dropped when that keep ends: the most recent wins.
 */
export type OpenRequests = {
  /** A new request's number. */
  next: () => number
  /** The newest request's number. */
  readonly latest: number
  /** Whether a request may still open: it is the newest and no switch has superseded it. */
  current: (request: number) => boolean
  /** A switch committed: every request numbered up to `upTo` is superseded. */
  supersede: (upTo: number) => void
}

export function createOpenRequests(): OpenRequests {
  let latest = 0
  let floor = 0
  return {
    next: () => ++latest,
    get latest() {
      return latest
    },
    current: (request) => request === latest && request > floor,
    supersede: (upTo) => {
      floor = Math.max(floor, upTo)
    },
  }
}
