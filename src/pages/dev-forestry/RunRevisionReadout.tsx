import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import type { AnalysisResult } from './types'
import {
  EMPTY_REVISION,
  describeRevision,
  matchingDesignName,
  nextRevision,
  runHeadline,
  type Movement,
  type RevisionReadout,
  type RevisionState,
} from './runRevision'

/**
 * Keeps the previous run's headline figures in page state, never the result,
 * and moves them along when a new run arrives. `result` is the current
 * (non-stale) run and `scene` the scene it was run on.
 */
export function useRunRevision(
  result: AnalysisResult | null,
  scene: ForestryScene,
  options: ReadonlyArray<{ name: string; scene: ForestryScene }>,
): RevisionReadout | null {
  const [state, setState] = useState<{ result: AnalysisResult | null; revision: RevisionState }>({
    result: null,
    revision: EMPTY_REVISION,
  })
  // Derived during render, once per new run: a stale period (result null) keeps the last pair.
  if (result && result !== state.result) {
    const headline = runHeadline(result, findSceneLandform(scene), scene.thresholds, matchingDesignName(options, scene))
    setState({ result, revision: nextRevision(state.revision, headline) })
  }
  return result ? describeRevision(state.revision) : null
}

const MOVEMENT_TONE: Record<Movement, 'success' | 'danger' | 'neutral' | 'warning'> = {
  'now-within': 'success',
  'still-within': 'neutral',
  'now-over': 'danger',
  'still-over': 'warning',
  withheld: 'neutral',
}

/** Step 3's before/after line: the previous run's verdict beside this one's, per scale. */
export function RunRevisionReadout({ readout }: { readout: RevisionReadout }) {
  const design =
    readout.currentDesign && readout.currentDesign !== readout.previousDesign
      ? `Design “${readout.currentDesign}”`
      : null
  return (
    <section
      className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs"
      aria-label="Since the previous run"
      data-run-revision
    >
      <p className="font-medium text-foreground">
        Since the previous run
        <span className="block text-2xs font-normal text-muted-foreground">
          {readout.landformName} · {readout.objectiveLabel.toLowerCase()} objective
        </span>
      </p>
      <ul className="space-y-1.5">
        {readout.lines.map((line) => (
          <li key={line.basis} data-revision-scale={line.basis}>
            <span className="block text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {line.scale}
            </span>
            <span className="flex flex-wrap items-center gap-1 tabular-nums text-foreground">
              {line.change.split(' → ').map((part, index) => (
                <span key={index} className="inline-flex items-center gap-1">
                  {index > 0 && <ArrowRight className="size-3 text-muted-foreground" aria-label="to" />}
                  <span className={index > 0 ? 'font-semibold' : undefined}>{part}</span>
                </span>
              ))}
            </span>
            <Badge tone={MOVEMENT_TONE[line.movement]} size="sm" className="mt-0.5">
              {line.verdict}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="text-2xs leading-4 text-muted-foreground">
        {design ? `${design} · ` : ''}
        {readout.changed.length ? `Changed: ${readout.changed.join(', ')}.` : 'Same inputs.'} Figures are the two runs’
        own; each is read against its own scale’s range.
      </p>
    </section>
  )
}
