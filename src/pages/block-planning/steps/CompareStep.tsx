import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { InlineAlert } from '@/components/ui/map-panels'
import { SelectField } from '@/components/ui/form-field'
import { ToolSection, ToolDisclosure } from '@/components/ui/tool-section'
import { explainPatches } from '../../forest-patches/explanation'
import { movementTowardTarget, table } from '../../forest-patches/project'
import { BoardCheckSection } from '../BoardCheckSection'
import { FieldPriorities } from '../FieldPriorities'
import { OldForestSection } from '../OldForestSection'
import { PatchExplanation } from '../PatchExplanation'
import { CalculationFormula, CalculationTable } from '@/components/ui/calculation-results'
import { NumberField } from '@/components/ui/form-field'
import { publishedUnit, type PublishedUnit } from '../observations'
import {
  DEFAULT_INDEX_WEIGHTS,
  INDEX_INDICATORS,
  indexFormula,
  MAX_INDEX_WEIGHT,
  planningIndex,
  type IndexWeights,
} from '../planningIndex'
import { footprintName, periodYears } from '../plan'
import { scheduleProject, type PlanAnalysis } from '../planAnalysis'
import { shownResult } from '../usePlanAnalysis'
import type { StepProps } from './types'

const pct = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

const raw = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** Index Lab's way of ranking options, over the schedules; labelled as a planning aid throughout. */
function PlanningIndexSection({ plan, edit, result }: Pick<StepProps, 'plan' | 'edit'> & { result: PlanAnalysis }) {
  const weights: IndexWeights = { ...DEFAULT_INDEX_WEIGHTS, ...plan.indexWeights }
  const { rows, leftOut } = planningIndex(plan, result, weights)
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  return (
    <ToolSection
      title="Planning index"
      help="Ranks the schedules on measured indicators, each scaled from the worst schedule (0) to the best (1), weighted and averaged. It is for weighing options, as Index Lab weighs places."
      summary={rows[0]?.score == null ? 'No score' : `${names[rows[0].schedule]} ranks first`}
    >
      <InlineAlert tone="warning" title="Not a legal test">
        The order sets a trend toward each class’s target and no score. This index never feeds the review, a D.5 pathway
        or a finding.
      </InlineAlert>
      <div className="grid grid-cols-2 gap-2">
        {INDEX_INDICATORS.map((ind) => (
          <NumberField
            key={ind.id}
            label={`${ind.label} (${ind.better} is better)`}
            description={ind.explain}
            value={weights[ind.id]}
            min={0}
            max={MAX_INDEX_WEIGHT}
            step={1}
            updateOn="commit"
            onValueChange={(w) => edit((p) => ({ ...p, indexWeights: { ...weights, [ind.id]: w } }))}
          />
        ))}
      </div>
      <CalculationFormula expression={indexFormula(weights)} />
      <div data-testid="block-planning-index">
        <CalculationTable
          caption="Schedules ranked by the planning index · raw value (scaled 0–1)"
          rows={rows}
          rowKey={(r) => r.schedule}
          columns={[
            { label: 'Schedule', render: (r) => names[r.schedule] },
            { label: 'Index', render: (r) => (r.score === null ? null : raw.format(r.score)) },
            ...INDEX_INDICATORS.map((ind, i) => ({
              label: `${ind.label} (${ind.unit})`,
              render: (r: (typeof rows)[number]) => {
                const part = r.parts[i]
                return part.raw === null
                  ? null
                  : `${raw.format(part.raw)}${part.scaled === null ? '' : ` (${part.scaled.toFixed(2)})`}`
              },
            })),
          ]}
        />
      </div>
      {leftOut.length > 0 && (
        <p className="text-2xs text-muted-foreground">
          Left out because a schedule has no value: {leftOut.join(', ')}.
        </p>
      )}
    </ToolSection>
  )
}

/** The Board's 2015 and 2018 shares for the reporting unit, with what changed between them. */
function PublishedFigures({
  unit,
  plan,
  edit,
}: {
  unit: PublishedUnit
  plan: StepProps['plan']
  edit: StepProps['edit']
}) {
  return (
    <ToolSection
      title="Published 2015 and 2018"
      help="The Forest Practices Board's measured distributions for this district and sub-unit. They came from other inventories; the 2018 interim analysis used the revised 2017 guidance, so the change between them mixes the landscape's change with the method's. Comparability is unconfirmed."
      summary={unit.source.label}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="block-planning-published">
          <thead>
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">Patch size</th>
              <th className="py-1 pr-2 font-medium">Target</th>
              {unit.observations.map((o) => (
                <th key={o.year} className="py-1 pr-2 font-medium">
                  {o.year}
                </th>
              ))}
              {unit.movement && <th className="py-1 pr-2 font-medium">2015 → 2018</th>}
            </tr>
          </thead>
          <tbody>
            {table.labels.map((label, b) => (
              <tr key={label} className="border-t">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {label}
                </th>
                <td className="py-1 pr-2">{pct.format(unit.target[b])}%</td>
                {unit.observations.map((o) => (
                  <td key={o.year} className="py-1 pr-2">
                    {pct.format(o.shares[b])}%
                  </td>
                ))}
                {unit.movement && (
                  <td className="py-1 pr-2">
                    <Movement
                      before={unit.observations[0].shares[b]}
                      after={unit.observations[1].shares[b]}
                      target={unit.target[b]}
                    />
                    <span className="text-muted-foreground"> {pct.format(Math.abs(unit.movement[b] ?? 0))} pts</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="text-2xs text-muted-foreground">
        {unit.observations.map((o) => (
          <li key={o.year}>
            {o.year}: {o.method}
          </li>
        ))}
      </ul>
      <a className="text-2xs underline" href={unit.source.url} target="_blank" rel="noreferrer">
        {unit.source.label}
      </a>
      <ToolDisclosure label="Check the method against these figures">
        <BoardCheckSection plan={plan} edit={edit} />
      </ToolDisclosure>
    </ToolSection>
  )
}

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
export function CompareStep({ plan, edit, analysis, shown, setShown }: StepProps) {
  const result = shownResult(analysis)
  const years = periodYears(plan.area.startYear)
  const names = Object.fromEntries(plan.schedules.map((s) => [s.id, s.name]))
  const nameOf = (id: string) => footprintName(plan, id)
  const published = publishedUnit(plan.area.district, plan.area.ndu)
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

      {published && <PublishedFigures unit={published} plan={plan} edit={edit} />}

      <OldForestSection plan={plan} edit={edit} shown={shown} />

      <PlanningIndexSection plan={plan} edit={edit} result={result} />

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
