/**
 * The session's site generation: one number the page bumps whenever the site changes under it (*New site*, a sample,
 * a Saved views file, a project, *Reopen previous site*). Work that awaits (an import, a save's screenshot and analysis
 * sheet, a capture, a background render) takes a guard when it starts and checks it after every await, so nothing
 * finished for one site is written into the next. No DOM access.
 */
import type { ForestryScene } from './scene'

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

/** Where the samples' blocks say they come from (`createSampleScene`, the roadside and Purden Lake demos). */
const SAMPLE_SOURCES = ['Sample scenario', 'Illustrative driving demo']

/** What a site holds, for whether it is kept to reopen when the page switches away from it. */
export type SiteContents = {
  scene: Pick<ForestryScene, 'targets' | 'viewpoint' | 'viewsOfInterest'>
  /** Saved views here and shelved at other places. */
  views: number
  attachments: number
  ownPhotos: number
  /** Whether the workspace holds any of the site's records (field records, runs, design options…). */
  workspaceRecords: boolean
}

/**
 * Whether a site is worth keeping to reopen: anything the reviewer made or added. A new site still empty, and a sample
 * as it was opened with nothing saved at it, are not: keeping either would take the place of the site before it.
 */
export function siteWorthKeeping(site: SiteContents): boolean {
  if (site.views || site.attachments || site.ownPhotos || site.workspaceRecords) return true
  const { targets, viewpoint, viewsOfInterest } = site.scene
  // Views placed are the reviewer's, whatever the ground.
  if (viewsOfInterest?.length) return true
  if (!targets.length && !viewpoint.coordinates.length) return false
  const blocks = targets.filter((target) => target.role === 'block')
  const sample =
    blocks.length > 0 && blocks.every((block) => SAMPLE_SOURCES.some((source) => block.source.startsWith(source)))
  return !sample
}
