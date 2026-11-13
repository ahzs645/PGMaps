import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ToolSection, type ToolSectionProps } from '@/components/ui/tool-section'
import { formatRoadStation } from './Charts'
import { CheckCard } from './CheckCard'
import { safeAnalyzeRoad } from './analysisResult'
import { BENCH_MARGIN_M, BENCH_TAPER_GRADE, fullBenchProfile } from './fullBench'
import { caseSummary, designedGradeCase, terrainCases, type CaseSummary, type TerrainCaseResult } from './terrainCases'
import type { RoadAnalysis } from './types'
import {
  FULL_BENCH_SIDESLOPE_PERCENT,
  incompleteStretches,
  STEEP_FILL_JOIN_GAP_M,
  steepFillPlan,
  stretchFixes,
  type StretchFix,
} from './sectionFixes'
import type { RoadWorkspace } from './useRoadWorkspace'

export { MAX_SECTION_REACH_M } from './sectionLimits'

/**
 * A sidebar section with its explanation behind an (i) in the heading, not printed under it.
 * `summary` folds it to one row that states the section's current values; content stays mounted.
 * The shared `ToolSection`, with the road designer's `toggleTestId` hook.
 */
export function RoadSection({
  toggleTestId,
  ...props
}: Omit<ToolSectionProps, 'toggleProps'> & { toggleTestId?: string }) {
  return <ToolSection {...props} toggleProps={toggleTestId ? { 'data-testid': toggleTestId } : undefined} />
}

/**
 * Why sections are incomplete and what would close them (`sectionFixes.ts`), as one Review row: the
 * count, the side slopes against the batter and the leading fix while folded; opened, each stretch
 * with its fixes and the buttons that apply them. A longer reach is offered only where the batter is
 * steeper than the ground; on side slopes from `FULL_BENCH_SIDESLOPE_PERCENT` a full bench leads and a
 * 1:1 fill is the quantities stopgap. Nothing is applied until a button is pressed.
 */
export function SectionReachAlert({
  workspace,
  onFindTerrain,
}: {
  workspace: RoadWorkspace
  /** Opens Load 1 m DEM on this road, at the LidarBC source. */
  onFindTerrain?: (alignmentId: string) => void
}) {
  const { analysis, project, alignment, update, updateAlignment, setStation, setNotice, source, referenceSurfaces } =
    workspace
  const stretches = useMemo(() => incompleteStretches(analysis.stations, alignment), [analysis.stations, alignment])
  const [error, setError] = useState<string | null>(null)
  // Best and worst case, worked out on request for the analysis they were asked of.
  const [cases, setCases] = useState<{ of: RoadAnalysis; table: CaseTable } | null>(null)
  const [comparing, setComparing] = useState(false)
  const designing = useRef<AbortController | null>(null)
  useEffect(() => () => designing.current?.abort(), [])
  if (!stretches.length) return null
  const shownCases = cases?.of === analysis ? cases.table : null
  const compareCases = () => {
    setComparing(true)
    // After the button has drawn its busy state: each case is a full analysis of the road.
    window.setTimeout(() => {
      try {
        const built = terrainCases(alignment, analysis.stations, project.settings, analysis.length, {
          id: () => crypto.randomUUID(),
          stationLabel: label,
        })
        if (!built) return
        const run = (c: TerrainCaseResult): CaseColumn =>
          'error' in c
            ? { error: c.error }
            : {
                change: c.change,
                summary: caseSummary(
                  safeAnalyzeRoad(c.alignment, source, c.settings, project.context, {
                    referenceSurfaces,
                    verticalReference: project.terrain.verticalReference,
                    sharedCrossingCosts: project.sharedCrossingCosts,
                    gradeStandards: project.standards,
                  }),
                ),
              }
        const table: CaseTable = {
          asIs: caseSummary(analysis),
          best: run(built.best),
          designed: 'pending',
          worst: run(built.worst),
        }
        setCases({ of: analysis, table })
        // The designed case runs the profile optimizer in slices; the table fills in when it is done.
        designing.current?.abort()
        const controller = new AbortController()
        designing.current = controller
        const options = {
          referenceSurfaces,
          verticalReference: project.terrain.verticalReference,
          sharedCrossingCosts: project.sharedCrossingCosts,
          gradeStandards: project.standards,
        }
        designedGradeCase(alignment, analysis.length, source, project.settings, project.context, options, {
          id: () => crypto.randomUUID(),
          stationLabel: label,
          signal: controller.signal,
        }).then(
          (designed) => {
            if (!controller.signal.aborted) setCases({ of: analysis, table: { ...table, designed: run(designed) } })
          },
          (failure: unknown) => {
            if (!controller.signal.aborted)
              setCases({
                of: analysis,
                table: {
                  ...table,
                  designed: { error: failure instanceof Error ? failure.message : 'The grade line search failed.' },
                },
              })
          },
        )
      } finally {
        setComparing(false)
      }
    }, 0)
  }
  const incomplete = analysis.stations.filter((s) => !s.complete).length
  const reach = project.settings.crossSectionHalfWidth
  const fixes = stretches.map((stretch) => ({ stretch, fixes: stretchFixes(stretch) }))
  const steepFill = fixes.filter((f) => f.fixes.some((x) => x.kind === 'steep-fill')).map((f) => f.stretch)
  const bench = fixes
    .filter((f) => f.stretch.batter === 'fill' && f.fixes[0]?.kind === 'full-bench')
    .map((f) => f.stretch)
  const reaches = fixes.flatMap((f) => f.fixes.flatMap((x) => (x.kind === 'reach' ? [x.reachM] : [])))
  const reachTo = reaches.length ? Math.max(...reaches) : null
  const coarse = project.terrain.resolutionM > 5
  const label = formatRoadStation
  const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`
  const fixName = (fix: StretchFix) =>
    fix.kind === 'steep-fill'
      ? '1:1 fill'
      : fix.kind === 'reach'
        ? `reach ${fix.reachM} m`
        : fix.kind === 'full-bench'
          ? 'full bench (end haul)'
          : fix.kind === 'steeper-cut'
            ? 'steeper cut or wall'
            : 'terrain ran out'
  // The folded line: the ground against the batter, then what leads, counted by stretch.
  const grounds = stretches.flatMap((s) => (s.groundPercent === null ? [] : [Math.round(s.groundPercent)]))
  const batters = [
    ...new Set(stretches.flatMap((s) => (s.batterPercent === null ? [] : [Math.round(s.batterPercent)]))),
  ]
  const leading = new Map<string, number>()
  for (const { fixes: list } of fixes)
    if (list[0]) leading.set(fixName(list[0]), (leading.get(fixName(list[0])) ?? 0) + 1)
  const measured = [
    grounds.length
      ? `Ground ${Math.min(...grounds) === Math.max(...grounds) ? Math.min(...grounds) : `${Math.min(...grounds)}–${Math.max(...grounds)}`}% beyond the formation${batters.length === 1 ? ` against a ${batters[0]}% batter` : ''}`
      : null,
    [...leading].map(([name, n]) => `${name} on ${n}`).join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
  const result = `${plural(incomplete, 'incomplete section')} in ${plural(stretches.length, 'stretch', 'stretches')}`
  const applyFullBench = () => {
    const plan = fullBenchProfile(alignment, analysis.stations, bench, () => crypto.randomUUID())
    if ('error' in plan) {
      setError(plan.error)
      return
    }
    setError(null)
    setNotice(
      `Full bench: formation lowered up to ${plan.maxLoweringM.toFixed(1)} m over ${Math.round(plan.loweredLengthM)} m${plan.createdProfile ? `; the road now has a profile of ${plan.vertical.length} PVIs at the ground it followed elsewhere` : ''}. The cut it adds is end haul: check the mass haul.`,
    )
    updateAlignment((a) => ({ ...a, vertical: plan.vertical }), 'Full bench on steep side slopes')
  }
  const applySteepFill = () => {
    const planned = steepFillPlan(alignment, steepFill, analysis.length, {
      id: () => crypto.randomUUID(),
      stationLabel: label,
    })
    if ('error' in planned) setError(planned.error)
    else {
      setError(null)
      updateAlignment(() => planned.alignment, '1:1 fill on steep side slopes')
    }
  }
  return (
    <ul className="mt-2" data-testid="road-section-reach-alert">
      <CheckCard
        tone="todo"
        result={result}
        title="Sections close inside the section reach"
        label={`Sections close inside the section reach: ${result}`}
        measured={<p>{measured}</p>}
        action={
          <Button
            size="2xs"
            variant="outline"
            className="shrink-0 px-1.5"
            onClick={() => setStation(stretches[0].from)}
          >
            Go to {label(stretches[0].from)}
          </Button>
        }
        details={
          <>
            <ul className="space-y-0.5 py-0.5" data-testid="road-section-fix-list">
              {fixes.map(({ stretch, fixes: list }) => (
                <li key={`${stretch.from}-${stretch.side}-${stretch.batter}`} className="flex items-baseline gap-2">
                  <button
                    type="button"
                    className="shrink-0 font-medium tabular-nums underline-offset-2 hover:underline"
                    onClick={() => setStation(stretch.from)}
                  >
                    {stretch.from === stretch.to ? label(stretch.from) : `${label(stretch.from)}–${label(stretch.to)}`}
                  </button>
                  <span className="min-w-0">
                    {stretch.side} {stretch.batter === 'unknown' ? 'batter' : stretch.batter}
                    {stretch.groundPercent !== null ? ` on ${Math.round(stretch.groundPercent)}%` : ''}
                    <span className="text-muted-foreground"> → {list.map(fixName).join(' or ')}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!alignment.vertical.length && (
              <p className="text-muted-foreground">
                No vertical design: the formation follows the ground at the centreline, so on a side slope half the road
                is on fill. A full bench lowers the formation until the road is all in cut; set it with PVIs on the
                profile.
              </p>
            )}
            {error && <p className="text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {bench.length > 0 && (
                <Button
                  size="2xs"
                  variant="outline"
                  className="px-1.5"
                  title={`Lower the formation on each fill stretch from ${FULL_BENCH_SIDESLOPE_PERCENT}% side slope until the downhill edge and its ditch are ${BENCH_MARGIN_M} m into the hill, easing in and out at no more than ${BENCH_TAPER_GRADE * 100}% grade. A road that follows the ground gets a PVI at every station at the level it had, so the rest of it does not move. One undo step.`}
                  onClick={applyFullBench}
                >
                  Full bench on {plural(bench.length, 'stretch', 'stretches')}
                </Button>
              )}
              {steepFill.length > 0 && (
                <Button
                  size="2xs"
                  variant="outline"
                  className="px-1.5"
                  title={`Steepen the failing side's fill to 1:1 from the station before each stretch to the station after, joining stretches less than ${STEEP_FILL_JOIN_GAP_M} m apart, through template station assignments. On side slopes from ${FULL_BENCH_SIDESLOPE_PERCENT}% this closes the sections for quantities; it is not a design until the fill material is confirmed to stand at 1:1. One undo step.`}
                  onClick={applySteepFill}
                >
                  1:1 fill on {plural(steepFill.length, 'stretch', 'stretches')}
                </Button>
              )}
              {reachTo !== null && reachTo > reach && (
                <Button
                  size="2xs"
                  variant="outline"
                  className="px-1.5"
                  title="Every stretch listed with a reach meets the ground within this reach."
                  onClick={() =>
                    update(
                      (x) => ({ ...x, settings: { ...x.settings, crossSectionHalfWidth: reachTo } }),
                      'Extend section reach',
                    )
                  }
                >
                  Reach {reachTo} m
                </Button>
              )}
              {coarse && onFindTerrain && (
                <Button
                  size="2xs"
                  variant="outline"
                  className="px-1.5"
                  title={`The terrain is ${project.terrain.resolutionM.toFixed(0)} m; ground slopes, and so these fixes, are approximate.`}
                  onClick={() => onFindTerrain(alignment.id)}
                >
                  Find 1 m terrain…
                </Button>
              )}
            </div>
            {shownCases ? (
              <CaseComparison
                table={shownCases}
                terrainM={project.terrain.resolutionM}
                gradeLimit={project.settings.maxGradePercent}
              />
            ) : (
              <Button
                size="2xs"
                variant="ghost"
                className="px-1.5"
                disabled={comparing}
                title="Work out the road's cut, fill, haul and estimate with the 1:1 fill (best case), with a grade line fitted inside the grade limits (designed) and with every fill stretch benched (worst case), without changing the road."
                onClick={compareCases}
              >
                {comparing ? 'Comparing…' : 'Compare best and worst case'}
              </Button>
            )}
            <p className="text-muted-foreground">
              Check: sections close inside the {reach} m section reach. Judged on: the ground&apos;s slope beyond the
              formation against the template batter; a longer reach only where the batter is steeper; full bench and end
              haul lead from {FULL_BENCH_SIDESLOPE_PERCENT}% side slope (a screen, not a BC rule).
            </p>
          </>
        }
        data-check="section-fixes"
        data-state="attention"
        data-severity="todo"
      />
    </ul>
  )
}

type CaseColumn = { change: string; summary: CaseSummary } | { error: string }
interface CaseTable {
  asIs: CaseSummary
  best: CaseColumn
  /** Fitted by the profile optimizer after the other two; `pending` while it runs. */
  designed: CaseColumn | 'pending'
  worst: CaseColumn
}

const m3 = (value: number) => `${Math.round(value).toLocaleString('en-CA')}`
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${m3(Math.abs(value))}`

/**
 * As imported, best case and worst case side by side (`terrainCases.ts`): the range the road's
 * quantities and estimate can fall in until terrain that resolves its side slopes is loaded.
 */
function CaseComparison({ table, terrainM, gradeLimit }: { table: CaseTable; terrainM: number; gradeLimit: number }) {
  const columns: { name: string; column: CaseColumn }[] = [
    { name: 'As is', column: { change: 'Sections that close', summary: table.asIs } },
    { name: 'Best', column: table.best },
    { name: 'Worst', column: table.worst },
    // Last, and named for what it holds: it answers a different question from the two beside it.
    {
      name: `≤${gradeLimit}% grade`,
      column: table.designed === 'pending' ? { error: 'Fitting a grade line…' } : table.designed,
    },
  ]
  const row = (label: string, value: (s: CaseSummary) => string) => (
    <tr className="border-t">
      <th scope="row" className="py-0.5 pr-2 text-left font-normal text-muted-foreground">
        {label}
      </th>
      {columns.map(({ name, column }) => (
        <td key={name} className="py-0.5 pl-2 text-right tabular-nums">
          {'error' in column ? '—' : value(column.summary)}
        </td>
      ))}
    </tr>
  )
  const unpriced = columns.some(({ column }) => !('error' in column) && !column.summary.disposalPriced)
  return (
    <div className="space-y-1" data-testid="road-terrain-cases">
      <table className="w-full text-2xs">
        <thead>
          <tr>
            <th />
            {columns.map(({ name }) => (
              <th key={name} scope="col" className="pb-0.5 pl-2 text-right font-medium">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Complete', (s) => `${Math.round(s.completePercent)}%`)}
          {row('Cut m³', (s) => m3(s.cutM3))}
          {row('Fill m³', (s) => m3(s.fillM3))}
          {row('Usable cut − fill', (s) => signed(s.balanceM3))}
          {row('Estimate', (s) => `$${m3(s.estimatedCost)}${s.disposalPriced ? '' : '*'}`)}
          {row('Max grade', (s) => `${s.maxGradePercent.toFixed(0)}%`)}
        </tbody>
      </table>
      <p className="text-muted-foreground">
        {columns
          .slice(1)
          .map(({ name, column }) => `${name}: ${'error' in column ? column.error : column.change}.`)
          .join(' ')}{' '}
        As is leaves out the sections that do not close, so its totals are partial. Best case: the ground under the
        drawn line is no steeper than a 1:1 fill can take. Worst case: the ground is as steep as the{' '}
        {Math.round(terrainM)} m terrain shows, and every fill stretch is cut into the hill. Both keep the road&apos;s
        grades as drawn. ≤{gradeLimit}% grade: a grade line fitted inside the project&apos;s grade limits on the same
        line; on coarse terrain it can cost the most, because the line was not drawn on this ground. No case is applied.
        {unpriced && ' * The surplus cut sent to waste costs nothing: no end-haul or waste rate is entered.'}
      </p>
    </div>
  )
}
