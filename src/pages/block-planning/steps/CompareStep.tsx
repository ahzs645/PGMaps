import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { InlineAlert } from '@/components/ui/map-panels'
import { SelectField } from '@/components/ui/form-field'
import { ToolSection, ToolDisclosure } from '@/components/ui/tool-section'
import { explainPatches } from '../../forest-patches/explanation'
import { movementTowardTarget, table } from '../../forest-patches/project'
import { FieldPriorities } from '../FieldPriorities'
import { PatchExplanation } from '../PatchExplanation'
import { footprintName, periodYears } from '../plan'
import { scheduleProject, type PlanAnalysis } from '../planAnalysis'
import { shownResult } from '../usePlanAnalysis'
import type { StepProps } from './types'

const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** The engine's own result shape for one schedule, so its explanation tools read it unchanged. */
export function asEngineAnalysis(result: PlanAnalysis, schedule: string) {
  const run = result.runs.find((r) => r.schedule === schedule)!
  return {
    timeline: run.periods,
    patchMap: {
      type: 'FeatureCollection' as const,
      features: result.shown.schedule === schedule ? result.shown.patches : [],
    },
  }
}

function Movement({ before, after, target }: { before: number | null; after: number | null; target: number }) {
  const moved = movementTowardTarget(before, after, target)
  if (moved === null) return <span className="text-muted-foreground">—</span>
  if (Math.abs(moved) < 0.05) return <Minus className="inline size-3 text-muted-foreground" aria-label="no change" />
  return moved > 0 ? (
    <span className="inline-flex items-center text-foreground">
      <ArrowDownRight className="size-3" aria-hidden />
      closer
    </span>
  ) : (
    <span className="inline-flex items-center font-medium text-warning">
      <ArrowUpRight className="size-3" aria-hidden />
      farther
    </span>
  )
}

/** Step 4: the schedules side by side at the year on the map, and the tools that explain a figure. */
export function CompareStep({ plan, analysis, shown, setShown }: StepProps) {
  const result = shownResult(analysis)
  const years = periodYears(plan.area.startYear)
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const nameOf = (id: string) => footprintName(plan, id)
  const project = scheduleProject(plan, shown.schedule)
  const engine =
    result && result.shown.schedule === shown.schedule && result.shown.year === shown.year
      ? asEngineAnalysis(result, shown.schedule)
      : undefined
  const explanation = engine ? explainPatches(engine, shown.year, 'proposed') : undefined
  if (analysis.status === 'not-ready')
    return <InlineAlert tone="info">{analysis.reason} The comparison needs the reporting unit (step 1).</InlineAlert>
  if (analysis.status === 'failed') return <InlineAlert tone="error">{analysis.error}</InlineAlert>
  if (!result) return <InlineAlert loading>Calculating the young-forest patches…</InlineAlert>
  const index = years.indexOf(shown.year)
  return (
    <>
      <ToolSection
        title={`All schedules in ${shown.year}`}
        help="Each class’s share of young forest, and whether it moved closer to or farther from its Table 7 target since the period before. The order looks for a trend toward each target; it gives no pass mark for the four together."
        summary={`${result.runs.length} schedules`}
        defaultOpen
      >
        {analysis.status === 'running' && <InlineAlert loading>Recalculating…</InlineAlert>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="block-planning-compare">
            <thead>
              <tr className="text-left">
                <th className="py-1 pr-2 font-medium">Patch size</th>
                <th className="py-1 pr-2 font-medium">Target</th>
                {result.runs.map((run) => (
                  <th key={run.schedule} className="py-1 pr-2 font-medium">
                    {names[run.schedule]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.labels.map((label, b) => {
                const target = result.runs[0].periods[index].classes[b].target
                return (
                  <tr key={label} className="border-t align-top">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {label}
                    </th>
                    <td className="py-1 pr-2">{pct.format(target)}%</td>
                    {result.runs.map((run) => {
                      const now = run.periods[index].classes[b].percent
                      const before = index > 0 ? run.periods[index - 1].classes[b].percent : null
                      return (
                        <td key={run.schedule} className="py-1 pr-2">
                          <div>{now === null ? '—' : `${pct.format(now)}%`}</div>
                          {index > 0 && (
                            <div className="text-2xs">
                              <Movement before={before} after={now} target={target} />
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              <tr className="border-t">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  Young forest
                </th>
                <td />
                {result.runs.map((run) => (
                  <td key={run.schedule} className="py-1 pr-2">
                    {pct.format(run.periods[index].totalHa)} ha
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-muted-foreground">
          Periods in which a class moved farther from its target:{' '}
          {result.runs
            .map(
              (run) =>
                `${names[run.schedule]} ${run.movedAway.filter((v) => v === true).length} of ${years.length - 1}`,
            )
            .join(' · ')}
          .
        </p>
      </ToolSection>

      <ToolSection
        title="Explain a figure"
        help="Which footprints make each patch, and how much a wrong disturbance date could change the result."
        summary={`${names[shown.schedule]} · ${shown.year}`}
      >
        <SelectField
          label="Schedule to explain"
          value={shown.schedule}
          onValueChange={(schedule) => setShown({ schedule })}
        >
          {plan.schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {explanation ? (
          <>
            <PatchExplanation
              key={shown.schedule + shown.year}
              project={project}
              explanation={explanation}
              year={shown.year}
              scenario="proposed"
              onComparison={() => {}}
              nameOf={nameOf}
            />
            <ToolDisclosure label="Field measurement priorities">
              <FieldPriorities
                key={shown.schedule + shown.year + 'priorities'}
                project={project}
                year={shown.year}
                scenario="proposed"
                onResult={() => {}}
                nameOf={nameOf}
              />
            </ToolDisclosure>
          </>
        ) : (
          <InlineAlert loading>Calculating the patches on the map…</InlineAlert>
        )}
      </ToolSection>
    </>
  )
}
