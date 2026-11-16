import type { TutorialSemanticAction } from 'tourkit/core'

/** One user operation, in the shape Tourkit's player matches against a step's action. */
export type TourObservedAction = TutorialSemanticAction
export type TourActionArgs = NonNullable<TutorialSemanticAction['args']>
export type TourActionListener = (action: TourObservedAction) => void

/**
 * The stream a page reports its user operations to, so a running lesson can tell that the learner
 * did a step. It imports nothing from Tourkit at run time: a page reports to it always, and Tourkit
 * itself loads only when a lesson starts (`TourPlayerHost`).
 *
 * Report only what the person did. A lesson's Watch run executes the same operations through the
 * page's executor, which must not report them again.
 */
export function createTourActionStream() {
  const listeners = new Set<TourActionListener>()
  return {
    observe(id: string, args?: TourActionArgs) {
      const action: TourObservedAction = args ? { id, args, match: 'subset' } : { id, match: 'subset' }
      for (const listener of [...listeners]) listener(action)
    },
    /** The player's `subscribeToActions`. */
    subscribe(listener: TourActionListener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export type TourActionStream = ReturnType<typeof createTourActionStream>
