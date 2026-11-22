/**
 * The session's site generation: one number the page bumps whenever the site changes under it (*New site*, a sample,
 * a Saved views file, a project, *Reopen previous site*). Work that awaits (an import, a save's screenshot and analysis
 * sheet, a capture, a background render) takes a guard when it starts and checks it after every await, so nothing
 * finished for one site is written into the next. No DOM access.
 */
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
