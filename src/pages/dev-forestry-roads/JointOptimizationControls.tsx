import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NumberField, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { refinePlanAndProfile } from './jointOptimizer'
import { runFullCostComparison } from './fullCostRun'
import { createFullCostRecord } from './fullCostRecord'
import { parseProject } from './project'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { VerticalOptimizationOptions } from './verticalOptimizer'

const REFINEMENT_BUSY = 'Refining plan and profile…'

export function JointOptimizationControls({
  workspace,
  profile,
}: {
  workspace: RoadWorkspace
  profile?: Partial<VerticalOptimizationOptions>
}) {
  const [stepM, setStep] = useState(5),
    [rounds, setRounds] = useState(2)
  const [objective, setObjective] = useState<'engineering' | 'complete-access'>('engineering')
  const controller = useRef<AbortController | null>(null)
  const latest = useRef(workspace)
  latest.current = workspace
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
    try {
      if (project.alignments.length >= 20) throw Error('The project already has 20 road alternatives.')
      const result = await refinePlanAndProfile(alignment, source, project.settings, project.context, {
        stepM,
        rounds,
        maxEvaluations: 20,
        profile: {
          ...profile,
          objective: 'total',
          referenceSurfaces: workspace.referenceSurfaces,
          verticalReference: project.terrain.verticalReference,
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
      const money = (n: number | null) => (n === null ? 'unpriced' : `$${Math.round(n).toLocaleString('en-CA')}`)
      latest.current.setNotice(
        `Plan/profile refinement: ${money(result.initialScore)} → ${money(result.score)} ${objective === 'complete-access' ? 'complete access' : 'engineering'} cost; ${result.evaluations.length} evaluated trials${result.budgetLimited ? ', evaluation budget reached' : ''}. The original is retained. This bounded local search is not a global optimum.`,
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
      title="Refine plan and profile"
      help="Moves interior plan controls while redesigning the profile and repricing each complete candidate. Endpoints stay fixed. Templates, materials, controls and rates are retained by chainage; review their location after a plan shift. Complete access uses the reviewed network ledger with no unpriced fallback."
    >
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Plan step (m)" value={stepM} min={0.1} max={100} onChange={setStep} />
        <NumberField label="Refinement rounds" value={rounds} min={1} max={5} step={1} onChange={setRounds} />
      </div>
      <label className="mt-2 block text-xs">
        Refinement objective
        <select
          className={roadFieldClass}
          aria-label="Joint refinement objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value as typeof objective)}
        >
          <option value="engineering">Complete engineering estimate</option>
          <option value="complete-access" disabled={!workspace.project.totalCostPlanning}>
            Complete access including network/supply
          </option>
        </select>
      </label>
      <Button
        className="mt-2 w-full"
        size="sm"
        disabled={!!workspace.busy || workspace.alignment.points.length < 3}
        onClick={() => void run()}
      >
        Refine plan and profile
      </Button>
      {controller.current && (
        <Button className="mt-1 w-full" size="sm" variant="outline" onClick={() => controller.current?.abort()}>
          Cancel refinement
        </Button>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        At most 20 trials and 12 interior plan controls. Every trial is checked; search limits can leave a better route
        unexplored.
      </p>
    </RoadSection>
  )
}
