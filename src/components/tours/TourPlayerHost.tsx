import { useMemo } from 'react'
import type {
  TutorialContextActionResolver,
  TutorialManifest,
  TutorialSemanticAction,
  TutorialStep,
} from 'tourkit/core'
import {
  NEUTRAL_TUTORIAL_DOM_POLICY,
  TutorialPlayer,
  type TutorialCompletionAction,
  type TutorialDomPolicy,
  type TutorialExecutionContext,
} from 'tourkit/player'
import type { TourActionStream } from '@/lib/tours/tourActions'
import { tourkitMode, type TourLaunchMode } from '@/lib/tours/tourLaunch'
import { tourStoresFor } from './tourStores'
import './tours.css'

/**
 * The dialogs that pause a lesson: Tourkit's neutral ARIA selector, less Radix popovers. A popover
 * (a searchable dropdown's list, a toolbar popover) is `role="dialog"` with `data-state="open"` but
 * blocks nothing outside it, so it must not pause the step whose control opened it. Radix portals
 * every popover inside `[data-radix-popper-content-wrapper]`; modal dialogs are never inside one.
 * A step whose own outcome opens a dialog is named by the page's `stepExpectsDialog`.
 */
export const PGMAPS_TOUR_DIALOG_SELECTOR = [
  'dialog[open]',
  '[aria-modal="true"]',
  '[role="dialog"][data-state="open"]:not([data-radix-popper-content-wrapper] *)',
].join(', ')
const domPolicy = (stepExpectsDialog: (step: TutorialStep) => boolean): TutorialDomPolicy => ({
  ...NEUTRAL_TUTORIAL_DOM_POLICY,
  applicationDialogSelector: PGMAPS_TOUR_DIALOG_SELECTOR,
  stepExpectsDialog,
})
const NO_DIALOG_STEPS = () => false

export interface TourPlayerHostProps {
  /** Separates this page's saved progress and completions from another page's (`pgmaps-road-design`). */
  namespace: string
  manifest: TutorialManifest
  mode: TourLaunchMode
  /** The page's snapshot, a new object whenever what a check reads changes. */
  state: unknown
  /** Watch: runs one action through the page's own operations, without reporting it as the learner's. */
  execute: (action: TutorialSemanticAction, signal?: AbortSignal) => void | Promise<unknown>
  actions: TourActionStream
  /** The action that brings a step's control back on screen ("Take me back"), or null. */
  returnAction?: (step: TutorialStep) => TutorialSemanticAction | null
  /** The actions that restore a step's `context` view; Practice offers them, Watch runs them. */
  contextActions?: TutorialContextActionResolver
  /** Whether a step's own outcome opens a dialog, so the player works with it open (default: none). */
  stepExpectsDialog?: (step: TutorialStep) => boolean
  completionActions?: readonly TutorialCompletionAction[]
  /** The run finished (`complete`) or the learner stopped it (`stop`). */
  onEnd: (reason: 'complete' | 'stop') => void
}

/**
 * Tourkit's player with PGMaps' defaults: the neutral DOM policy, a namespaced progress and completion
 * store, PGMaps' card colours (`tours.css`) and the arrow keys for Next and Back. Load it lazily:
 * it is the only module that brings Tourkit's player, Zod and driver.js into the bundle.
 */
export default function TourPlayerHost({
  namespace,
  manifest,
  mode,
  state,
  execute,
  actions,
  returnAction,
  contextActions,
  stepExpectsDialog = NO_DIALOG_STEPS,
  completionActions,
  onEnd,
}: TourPlayerHostProps) {
  const policy = useMemo(() => domPolicy(stepExpectsDialog), [stepExpectsDialog])
  const { progress, completions } = tourStoresFor(namespace)
  const playerMode = tourkitMode(mode)
  const executeAction = useMemo(
    () => (action: TutorialSemanticAction, context: TutorialExecutionContext) => execute(action, context.signal),
    [execute],
  )
  return (
    <TutorialPlayer
      manifest={manifest}
      mode={playerMode}
      state={state}
      domPolicy={policy}
      onExecuteAction={executeAction}
      subscribeToActions={actions.subscribe}
      resolveReturnAction={returnAction}
      resolveContextActions={contextActions}
      progressStore={progress}
      keyboardNavigation
      appearance={{ closeIcon: 'close' }}
      completionActions={completionActions}
      onComplete={() => {
        completions.mark(manifest.id, playerMode)
        // Without completion choices the player unmounts at once; with them, it waits for one.
        if (!completionActions?.length) onEnd('complete')
      }}
      onDismissCompletion={() => onEnd('complete')}
      onStop={() => onEnd('stop')}
    />
  )
}
