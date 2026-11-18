import { useEffect, useMemo, useRef, useState } from 'react'
import { ROAD_LIMIT_MESSAGE, roadLimitReached } from './roadLimits'
import { Button } from '@/components/ui/button'
import { CheckboxField } from '@/components/ui/form-field'
import { ToolSubsection } from '@/components/ui/tool-section'
import { NumberField, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import {
  MAX_JOINT_BOX_M,
  MAX_JOINT_MOVABLE_POINTS,
  MAX_JOINT_SECONDS,
  movementBoxes,
  movementBoxFeatures,
  refinePlanAndProfile,
  type JointMovementLimits,
} from './jointOptimizer'
import { runFullCostComparison } from './fullCostRun'
import { createFullCostRecord } from './fullCostRecord'
import { parseProject } from './project'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { VerticalOptimizationOptions } from './verticalOptimizer'
import type { Alignment } from './types'

const REFINEMENT_BUSY = 'Refining plan and profile…'

export function JointOptimizationControls({
  workspace,
  profile,
  onPreviewBoxes,
}: {
  workspace: RoadWorkspace
  profile?: Partial<VerticalOptimizationOptions>
  /** Each point's movement box for the plan while the section is open or running; null clears them. */
  onPreviewBoxes?: (boxes: GeoJSON.FeatureCollection | null) => void
}) {
  const [stepM, setStep] = useState(5),
    [rounds, setRounds] = useState(2)
  const [objective, setObjective] = useState<'engineering' | 'complete-access'>('engineering')
  // Movement limits: session settings, like the step and rounds, never stored on the project.
  const [fixedIds, setFixedIds] = useState<string[]>([])
  const [acrossM, setAcrossM] = useState<number | null>(null),
    [alongM, setAlongM] = useState<number | null>(null),
    [perpendicularOnly, setPerpendicularOnly] = useState(true),
    [maxSeconds, setMaxSeconds] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  // The road a run started from (and the road it adopted), so the plan keeps the boxes it searched.
  const [runFrom, setRunFrom] = useState<{ origin: Alignment; adoptedId?: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const latest = useRef(workspace)
  latest.current = workspace
  const interior = workspace.alignment.points.slice(1, -1)
  const fixedHere = fixedIds.filter((id) => interior.some((p) => p.id === id))
  const movableCount = interior.length - fixedHere.length
  const limits = useMemo<JointMovementLimits>(
    () => ({
      fixedPointIds: fixedIds,
      acrossM,
      alongM: perpendicularOnly ? null : alongM,
      perpendicularOnly,
    }),
    [fixedIds, acrossM, alongM, perpendicularOnly],
  )
  const running = !!controller.current
  const boxRoad =
    runFrom && (running || workspace.alignment === runFrom.origin || workspace.alignment.id === runFrom.adoptedId)
      ? runFrom.origin
      : workspace.alignment
  const boxes = useMemo(
    () =>
      boxRoad.points.length < 3
        ? null
        : movementBoxFeatures(movementBoxes(boxRoad, { stepM, rounds, limits }), Math.max(1, stepM / 2)),
    [boxRoad, stepM, rounds, limits],
  )
  const showBoxes = open || running
  useEffect(() => onPreviewBoxes?.(showBoxes ? boxes : null), [boxes, showBoxes, onPreviewBoxes])
  useEffect(() => () => onPreviewBoxes?.(null), [onPreviewBoxes])
  useEffect(
    () => () => {
      if (!controller.current) return
      controller.current.abort()
      controller.current = null
      if (latest.current.busy === REFINEMENT_BUSY) latest.current.setBusy('')
    },
    [],
  )
  const run = async () => {
    if (workspace.busy) return
    const project = workspace.project,
      alignment = workspace.alignment,
      source = workspace.source,
      projectId = workspace.projectId
    controller.current?.abort()
    const ownController = new AbortController()
    controller.current = ownController
    const signal = ownController.signal
    const ownsOperation = () =>
      controller.current === ownController &&
      (latest.current.busy === REFINEMENT_BUSY ||
        // A synchronous validation failure can precede the first busy-state render.
        (latest.current === workspace && !workspace.busy))
    const ensureCurrent = (currentProject = latest.current.project) => {
      if (signal.aborted || !ownsOperation()) throw new DOMException('Joint refinement cancelled', 'AbortError')
      if (currentProject !== project || latest.current.source !== source || latest.current.projectId !== projectId)
        throw Error(
          'Inputs changed during refinement; no refined road was adopted. Run it again on the current project.',
        )
    }
    const yieldControl = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      ensureCurrent()
    }
    workspace.setBusy(REFINEMENT_BUSY)
    workspace.setError('')
    setRunFrom({ origin: alignment })
    try {
      if (roadLimitReached(project)) throw Error(ROAD_LIMIT_MESSAGE)
      const result = await refinePlanAndProfile(alignment, source, project.settings, project.context, {
        stepM,
        rounds,
        maxEvaluations: 20,
        limits,
        maxSeconds,
        profile: {
          ...profile,
          objective: 'total',
          referenceSurfaces: workspace.referenceSurfaces,
          verticalReference: project.terrain.verticalReference,
          sharedCrossingCosts: project.sharedCrossingCosts,
          gradeStandards: project.standards,
        },
        signal,
        yieldControl,
        ...(objective === 'complete-access'
          ? {
              evaluate: async (trial: typeof alignment) => {
                const run = await runFullCostComparison(
                  { ...project, alignments: [trial], activeAlignmentId: trial.id },
                  source,
                  { signal, yieldControl, generateTerrainCandidates: false, enteredCandidates: 'active' },
                )
                const row = run.comparison.candidates.find((c) => c.id === trial.id)
                return {
                  score: row?.status === 'feasible' ? row.totalCost : null,
                  blockers: row?.blockers ?? ['No priced route comparison.'],
                }
              },
            }
          : {}),
      })
      ensureCurrent()
      const candidate = structuredClone(result.alignment)
      candidate.id = crypto.randomUUID()
      candidate.name = `${alignment.name} · plan/profile refinement`.slice(0, 200)
      delete candidate.fullCostRecord
      const next = parseProject({
        ...project,
        alignments: [...project.alignments, candidate],
        activeAlignmentId: candidate.id,
      })
      if (objective === 'complete-access') {
        const final = await runFullCostComparison(next, source, {
          signal,
          yieldControl,
          generateTerrainCandidates: false,
          enteredCandidates: 'active',
        })
        const row = final.comparison.candidates.find((c) => c.id === candidate.id)
        if (!row || row.status !== 'feasible')
          throw Error('The final complete-access comparison did not pass; no refined road was adopted.')
        const adopted = next.alignments.find((a) => a.id === candidate.id)!
        adopted.fullCostRecord = createFullCostRecord(adopted, next, row)
      }
      // update reads the workspace's immediate project ref, including edits not yet rendered.
      latest.current.update((currentProject) => {
        ensureCurrent(currentProject)
        return next
      })
      setRunFrom({ origin: alignment, adoptedId: candidate.id })
      const money = (n: number | null) => (n === null ? 'unpriced' : `$${Math.round(n).toLocaleString('en-CA')}`)
      latest.current.setNotice(
        `Plan/profile refinement: ${money(result.initialScore)} → ${money(result.score)} ${objective === 'complete-access' ? 'complete access' : 'engineering'} cost; ${result.evaluations.length} evaluated trials${result.timeLimited ? ', time limit reached' : result.budgetLimited ? ', evaluation budget reached' : ''}. The original is retained. This bounded local search is not a global optimum.`,
      )
    } catch (error) {
      if (ownsOperation())
        latest.current.setError(error instanceof Error ? error.message : 'Could not refine plan and profile.')
    } finally {
      if (controller.current === ownController) {
        const clearBusy = ownsOperation()
        controller.current = null
        if (clearBusy) latest.current.setBusy('')
      }
    }
  }
  return (
    <RoadSection
      title="Joint refinement"
      summary={`${movableCount} of ${interior.length} controls move`}
      open={open}
      onOpenChange={setOpen}
      help={`Moves interior plan controls while redesigning the profile and repricing each complete candidate. Endpoints stay fixed. Templates, materials, controls and rates are retained by chainage; review their location after a plan shift. Complete access uses the reviewed network ledger with no unpriced fallback. At most 20 trials and ${MAX_JOINT_MOVABLE_POINTS} moving controls, so a better route can remain unexplored.`}
    >
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Plan step (m)" value={stepM} min={0.1} max={100} onChange={setStep} />
        <NumberField label="Refinement rounds" value={rounds} min={1} max={5} step={1} onChange={setRounds} />
      </div>
      <ToolSubsection
        title="Movement limits"
        help="As RoadEng's Horizontal Optimization limits: each ticked control moves only inside its box, drawn on the plan while this section is open. The box is square to the line between the control's neighbours where the run starts. A move that would leave it is shortened to its edge. Blank limits leave the step schedule as the only bound (drawn dashed at its reach)."
      >
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label="Across limit (m)"
            value={acrossM}
            min={0}
            max={MAX_JOINT_BOX_M}
            placeholder="no limit"
            hint="How far each control may end up either side of where it starts, square to the road."
            onChange={setAcrossM}
          />
          <OptionalNumberField
            label="Along limit (m)"
            value={perpendicularOnly ? null : alongM}
            min={0}
            max={MAX_JOINT_BOX_M}
            placeholder={perpendicularOnly ? 'across only' : 'no limit'}
            disabled={perpendicularOnly}
            hint="How far each control may move along the road. Applies once moves along the road are on."
            onChange={setAlongM}
          />
        </div>
        <CheckboxField
          label="Move across the road only"
          checked={perpendicularOnly}
          onCheckedChange={setPerpendicularOnly}
        />
        <OptionalNumberField
          label="Time limit (s)"
          value={maxSeconds}
          min={1}
          max={MAX_JOINT_SECONDS}
          step={1}
          placeholder="none"
          hint="Ends the search with the best checked trial once this time has passed, as the trial budget does. The start and its profile-only redesign are always checked."
          onChange={setMaxSeconds}
        />
        {interior.length > 0 && (
          <div className="grid grid-cols-3 gap-x-2" role="group" aria-label="Controls that may move">
            {workspace.alignment.points.map((point, i) =>
              i === 0 || i === workspace.alignment.points.length - 1 ? null : (
                <CheckboxField
                  key={point.id}
                  label={`Point ${i + 1}`}
                  aria-label={`Point ${i + 1} may move`}
                  checked={!fixedHere.includes(point.id)}
                  onCheckedChange={(on) =>
                    setFixedIds((ids) => (on ? ids.filter((id) => id !== point.id) : [...ids, point.id]))
                  }
                />
              ),
            )}
          </div>
        )}
      </ToolSubsection>
      <label className="mt-2 block text-xs">
        Refinement objective
        <RoadSelect
          className={roadFieldClass}
          ariaLabel="Joint refinement objective"
          value={objective}
          onValueChange={(value) => setObjective(value as typeof objective)}
        >
          <option value="engineering">Complete engineering estimate</option>
          <option value="complete-access" disabled={!workspace.project.totalCostPlanning}>
            Complete access including network/supply
          </option>
        </RoadSelect>
      </label>
      <Button
        className="mt-2 w-full"
        size="sm"
        disabled={!!workspace.busy || workspace.alignment.points.length < 3 || movableCount === 0}
        onClick={() => void run()}
      >
        Refine plan and profile
      </Button>
      {controller.current && (
        <Button className="mt-1 w-full" size="sm" variant="outline" onClick={() => controller.current?.abort()}>
          Cancel refinement
        </Button>
      )}
    </RoadSection>
  )
}
