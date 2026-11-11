import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { MapPin } from 'lucide-react'
import { NumberField } from './Controls'
import { RoadSection } from './SidebarParts'
import { parseProject } from './project'
import { distinctRoadColors } from './roadColors'
import {
  comparisonSummary,
  compareRoutes,
  DEFAULT_CROSS_DRAIN_COST,
  probeSteeperGrades,
  ROUTE_GOALS,
  type RouteComparison,
  type RouteComparisonInput,
  type RouteGoal,
  type RouteRow,
} from './routeComparison'
import { routeStopParts } from './routeSearchStop'
import { applySearchPreset } from './searchPresets'
import { STEEPER_GRADE_STEPS_PERCENT } from './steeperGrades'
import { RouteSearchPresets } from './RouteSearchPresets'
import { RouteFailureRow } from './RouteFailureRow'
import { FoundRoadSearchNote } from './FoundRoadSearchNote'
import type { RoutePreviewLine } from './routePreviewFeatures'
import { corridorSearchResolution, MAX_SEARCH_RADIUS_M, MIN_SEARCH_RADIUS_M } from './corridorOptimizer'
import { DEFAULT_GROUND_WINDOW_M, resolvedGroundWindow } from './groundTrend'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { localMetricGrid } from './terrain'
import { SwitchbackSettings } from './SwitchbackSettings'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { RoadDrawing } from './DesignSidebarBody'
export type { RoutePreviewLine } from './routePreviewFeatures'

const MAX_ROADS = 20
const money = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${Math.round(n).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`
const whole = (n: number) => Math.round(n).toLocaleString('en-CA')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const GOAL_LABEL = Object.fromEntries(ROUTE_GOALS.map((goal) => [goal.id, goal.label])) as Record<RouteGoal, string>
/** Pick the ends, pick what matters, and see designed roads priced beside the one you have. */
export function RouteFinder({
  workspace: w,
  full,
  drawing,
  onPegRoad,
  onPreview,
  onShowCompare,
  onSelectRoad,
}: {
  workspace: RoadWorkspace
  full: boolean
  /** A road line still being pegged on the plan: a search waits until it is finished. */
  drawing?: RoadDrawing | null
  onPegRoad: () => void
  onPreview?: (lines: RoutePreviewLine[] | null) => void
  onShowCompare?: () => void
  onSelectRoad?: (id: string) => void
}) {
  const { project, source, alignment, analysis } = w
  const [goals, setGoals] = useState<RouteGoal[]>(['cost', 'shortest', 'gentle', 'drainage'])
  const [halfWidth, setHalfWidth] = useState(180)
  const [crossDrainCost, setCrossDrainCost] = useState(DEFAULT_CROSS_DRAIN_COST)
  const [run, setRun] = useState<{
    comparison: RouteComparison
    roadKey: string
    inputs: string
    source: typeof source
    /** What the run searched: Try steeper searches the same ends and corridor, whichever road is open now. */
    searched: ReturnType<typeof searchInput>
  } | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  /** The failure row whose stop is marked on the plan, chosen from the row or from its mark. */
  const [focused, setFocused] = useState<string | null>(null)
  const [trySteeper, setTrySteeper] = useState(false)
  const failureRefs = useRef(new Map<string, HTMLButtonElement>())
  const abort = useRef<AbortController | null>(null)
  // Leaving mid-run stops the search and hands the workspace back: a remounted panel has its own
  // controller ref, so nothing else would ever clear this run's busy toast.
  const setBusy = w.setBusy
  useEffect(
    () => () => {
      if (!abort.current) return
      abort.current.abort()
      abort.current = null
      setBusy('')
    },
    [setBusy],
  )
  const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
  const groundWindowM = resolvedGroundWindow(route, project.terrain.resolutionM)
  const roadKey = JSON.stringify([alignment.id, alignment.points.map((p) => p.coordinate), alignment.vertical.length])
  // By value: keeping a road rewrites the project, and that must not expire the other results.
  // The switchback search's rules and the side-hill limit decide what the search finds too.
  const searchKey = JSON.stringify([
    project.routeSearch?.switchbacks ?? null,
    project.routeSearch?.maxTerrainSlopePercent ?? null,
  ])
  const inputs = useMemo(
    () => JSON.stringify([project.settings, project.context]) + searchKey,
    [project.settings, project.context, searchKey],
  )
  const inProject = useMemo(() => new Set(project.alignments.map((road) => road.id)), [project.alignments])
  const stale =
    !!run &&
    (run.inputs !== inputs ||
      run.source !== source ||
      (roadKey !== run.roadKey && !run.comparison.rows.some((row) => row.alignment?.id === alignment.id)))
  const showLines = !!run && !stale
  // Goals that failed for one reason read as one line, not one row each.
  const failures = useMemo(() => failureGroups(run?.comparison.rows ?? []), [run])
  /** From the plan: select the row, and bring it into view in the sidebar. */
  const selectFromPlan = useCallback((key: string) => {
    setFocused(key)
    failureRefs.current.get(key)?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const lines = useMemo<RoutePreviewLine[] | null>(
    () =>
      showLines
        ? [
            ...run!.comparison.rows
              .filter((row) => row.goal !== 'current' && row.alignment && !inProject.has(row.alignment.id))
              .map((row) => ({
                id: row.id,
                label: row.label,
                color: row.color,
                selected: row.id === hovered,
                coordinates: row.coordinates,
              })),
            // Where each failed search stopped, tied to its row.
            ...failures.flatMap((group) =>
              group.stop
                ? routeStopParts(group.key, group.label, group.color, group.stop).map((part) => ({
                    id: part.id,
                    label: part.label,
                    color: part.color,
                    selected: focused === group.key || hovered === group.key,
                    coordinates: part.coordinates,
                    stop: part.role,
                    onSelect: () => selectFromPlan(group.key),
                  }))
                : [],
            ),
          ]
        : null,
    [showLines, run, hovered, focused, inProject, failures, selectFromPlan],
  )
  useEffect(() => onPreview?.(lines), [lines, onPreview])
  useEffect(() => () => onPreview?.(null), [onPreview])

  /** What a search reads, shared by Compare and Try steeper so both search the same corridor. */
  const searchInput = () =>
    ({
      base: alignment,
      terrain: source,
      settings: project.settings,
      context: project.context,
      routeOptions: route,
      options: {
        goals,
        corridorHalfWidthM: halfWidth,
        groundWindowM,
        crossingCost: route.crossingCost,
        crossDrainCost,
        drainage: project.drainage?.settings ?? DEFAULT_DRAINAGE_SETTINGS,
        ...(trySteeper ? { steeperGrades: true } : {}),
      },
    }) satisfies Partial<RouteComparisonInput>

  /**
   * Searches a failed goal's corridor again over the grade limit and writes what it found on the
   * goal's rows. Information only: the project, its roads and its grade limit are not touched.
   */
  const steeper = async (rows: RouteRow[]) => {
    if (abort.current || w.busy || !run) return
    const controller = new AbortController()
    abort.current = controller
    const stop = () => {
      controller.abort()
      if (abort.current === controller) abort.current = null
      w.setBusy('')
      w.setNotice('Steeper-grade search cancelled. Nothing was changed.')
    }
    const started = run
    w.setError('')
    w.setBusy('Trying steeper grades…')
    w.setBusyCancel({ label: 'Cancel steeper-grade search', title: 'Trying steeper grades', onCancel: stop })
    try {
      const result = await probeSteeperGrades(started.searched, {
        signal: controller.signal,
        onDetail: (text, share) => {
          if (abort.current !== controller) return
          w.setBusy(`Trying steeper grades · ${text}${share === undefined ? '' : ` · ${Math.floor(share * 100)}%`}`)
        },
      })
      if (abort.current !== controller) return
      const ids = new Set(rows.map((row) => row.id))
      setRun((now) =>
        now === started
          ? {
              ...now,
              comparison: {
                ...now.comparison,
                rows: now.comparison.rows.map((row) => (ids.has(row.id) ? { ...row, steeper: result } : row)),
              },
            }
          : now,
      )
    } catch (cause) {
      if (abort.current !== controller) return
      w.setError(cause instanceof Error ? cause.message : 'Could not try steeper grades.')
    } finally {
      if (abort.current === controller) {
        abort.current = null
        w.setBusy('')
      }
    }
  }

  const toggleGoal = (goal: RouteGoal) =>
    setGoals((now) => (now.includes(goal) ? now.filter((g) => g !== goal) : [...now, goal]))

  const compare = async () => {
    // The plan shows the line being pegged, but the project still holds the saved road.
    if (abort.current || w.busy || drawing) return
    const controller = new AbortController()
    abort.current = controller
    // Cancel hands the workspace back at once; the search stops at its next slice, a few milliseconds on.
    const stop = () => {
      controller.abort()
      // Cancel always hands the workspace back, even if this panel no longer owns the run.
      if (abort.current === controller) abort.current = null
      w.setBusy('')
      w.setNotice('Route comparison cancelled. No road was changed.')
    }
    setRun(null)
    setFocused(null)
    w.setError('')
    w.setBusy('Starting…')
    w.setBusyCancel({ label: 'Cancel route comparison', title: 'Comparing routes', onCancel: stop })
    const searched = searchInput()
    try {
      const comparison = await compareRoutes(
        {
          ...searched,
          baseAnalysis: analysis,
          resolutionM: project.terrain.resolutionM,
          gridAt: localMetricGrid,
          analysisOptions: {
            referenceSurfaces: w.referenceSurfaces,
            verticalReference: project.terrain.verticalReference,
            sharedCrossingCosts: project.sharedCrossingCosts,
          },
        },
        {
          signal: controller.signal,
          onStep: ({ message, detail, step, total }) => {
            if (abort.current !== controller) return
            w.setBusy(detail ? `${message} · ${detail}` : message)
            w.setBusyProgress({ step, total })
          },
        },
      )
      if (abort.current !== controller) return
      setRun({ comparison, roadKey, inputs, source, searched })
      // A run that found nothing is a failure, whatever else it finished.
      const summary = comparisonSummary(comparison)
      if (summary.found) w.setNotice(summary.message)
      else w.setError(summary.message)
    } catch (cause) {
      if (abort.current !== controller) return
      w.setError(cause instanceof Error ? cause.message : 'Could not compare routes.')
    } finally {
      if (abort.current === controller) {
        abort.current = null
        w.setBusy('')
      }
    }
  }

  /** Adds roads to the project, and opens `open` so every chart and table shows it. */
  const add = (rows: RouteRow[], open: RouteRow) => {
    const roads = rows.flatMap((row) => (row.alignment && !inProject.has(row.alignment.id) ? [row.alignment] : []))
    if (project.alignments.length + roads.length > MAX_ROADS) {
      w.setError(`A project holds at most ${MAX_ROADS} roads. Delete one first.`)
      return false
    }
    if (!roads.length) return true
    w.commit(
      parseProject({
        ...project,
        alignments: [...project.alignments, ...roads],
        activeAlignmentId: open.alignment!.id,
      }),
    )
    w.setStation(0)
    return true
  }
  const view = (row: RouteRow) => {
    if (!row.alignment) return
    if (inProject.has(row.alignment.id)) onSelectRoad?.(row.alignment.id)
    else add([row], row)
  }

  const rows = run?.comparison.rows ?? []
  const current = rows.find((row) => row.goal === 'current')
  const designed = rows.filter((row) => row.goal !== 'current' && row.alignment)
  // What a search of this corridor works at, so the numbers are known before a run rather than after.
  const resolution = corridorSearchResolution(
    alignment.points.map((p) => p.coordinate),
    halfWidth,
  )
  const colors = distinctRoadColors([
    ...project.alignments,
    ...designed.filter((row) => !inProject.has(row.alignment!.id)).map((row) => row.alignment!),
  ])
  return (
    <RoadSection
      title="Find the best route"
      data-testid="road-route-finder"
      help={
        <>
          Designs a road between the same two ends for each goal, then measures every road. Each goal goes to the road
          that actually leads it, so one road can win several and a road that leads nothing is left out.
          <br />
          Prices are build cost plus a placeholder allowance per stream crossing and cross-drain. Planning comparison
          only: searches are bounded, so a better line can exist.
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="road-route-ends">
            {whole(analysis.length)} m · {plural(alignment.points.length, 'point')}
          </p>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onPegRoad} disabled={full}>
            <MapPin className="size-3" />
            New ends on map
          </Button>
        </div>
        <FoundRoadSearchNote alignment={alignment} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Route goals">
          {ROUTE_GOALS.map((goal) => (
            <Button
              key={goal.id}
              size="sm"
              variant={goals.includes(goal.id) ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              aria-pressed={goals.includes(goal.id)}
              title={goal.help}
              onClick={() => toggleGoal(goal.id)}
            >
              {goal.label}
            </Button>
          ))}
        </div>
        <RouteSearchPresets
          settings={project.settings}
          disabled={full}
          onApply={(preset) =>
            w.update((x) => ({ ...x, settings: applySearchPreset(x.settings, preset) }), `${preset.label} preset`, {
              ownStep: true,
            })
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Grade limit %"
            value={project.settings.maxGradePercent}
            min={1}
            max={30}
            step={0.5}
            onChange={(maxGradePercent) => w.update((x) => ({ ...x, settings: { ...x.settings, maxGradePercent } }))}
          />
          <NumberField
            label="Tightest curve (m)"
            value={project.settings.minRadius}
            min={0}
            max={MAX_SEARCH_RADIUS_M}
            step={5}
            hint={
              project.settings.minRadius < MIN_SEARCH_RADIUS_M
                ? `The search draws no curve tighter than ${MIN_SEARCH_RADIUS_M} m.`
                : undefined
            }
            onChange={(minRadius) => w.update((x) => ({ ...x, settings: { ...x.settings, minRadius } }))}
          />
        </div>
        {/* The drawing's own card on the plan counts its points and finishes it; this only says why
            the search waits. */}
        {drawing && (
          <InlineAlert tone="info">
            <span data-testid="road-route-drawing">
              {drawing.kind === 'extend'
                ? 'Finish the extension on the plan to search between its ends.'
                : 'Finish the new road on the plan to search between its ends.'}
            </span>
          </InlineAlert>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!goals.length || full || !!drawing}
          title={drawing ? 'Finish the road being drawn on the plan first' : undefined}
          onClick={() => void compare()}
          data-testid="road-compare-routes"
        >
          Compare {goals.length === 1 ? 'route' : `${goals.length} routes`}
        </Button>
        <details className="group text-xs">
          <summary className="cursor-pointer text-muted-foreground">Search settings</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="Corridor ±m"
              value={halfWidth}
              min={25}
              max={600}
              step={25}
              hint="How far either side of your road the search may wander."
              onChange={setHalfWidth}
            />
            <NumberField
              label="Ground trend (m)"
              value={groundWindowM}
              min={0}
              max={100}
              step={2}
              hint={`Grades are judged on ground averaged over this width, so stumps and ruts in LiDAR do not block a route. ${DEFAULT_GROUND_WINDOW_M} m on LiDAR; 0 on coarse terrain. Sections and quantities always use the source terrain.`}
              onChange={(groundWindowM) => w.update((x) => ({ ...x, routeSearch: { ...route, groundWindowM } }))}
            />
            <NumberField
              label="Stream crossing ($)"
              value={route.crossingCost}
              max={1e8}
              step={500}
              hint="Placeholder allowance per stream crossing without a culvert."
              onChange={(crossingCost) => w.update((x) => ({ ...x, routeSearch: { ...route, crossingCost } }))}
            />
            <NumberField
              label="Cross-drain ($)"
              value={crossDrainCost}
              max={1e6}
              step={100}
              hint="Placeholder allowance per low point that needs a cross-drain."
              onChange={setCrossDrainCost}
            />
          </div>
          {resolution && (
            <p className="mt-2 text-2xs leading-4 text-muted-foreground" data-testid="road-route-resolution">
              Searches on {resolution.cellM.toFixed(1)} m cells in {resolution.stepM.toFixed(0)} m strides and{' '}
              {resolution.headings} headings; ground is read every {resolution.sampleM} m along each line.{' '}
              <InfoTip label="About the search resolution">
                The corridor is divided into at most 140 cells a side, never finer than 3 m, so a longer road or a wider
                corridor is searched more coarsely. Each search stops after 50,000 trial positions or 3.5 million ground
                readings; the progress line shows how much of that it has used.
              </InfoTip>
            </p>
          )}
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={trySteeper}
              onChange={(event) => setTrySteeper(event.target.checked)}
              data-testid="road-route-steeper-option"
            />
            <span className="min-w-0 flex-1">
              When a goal finds no line, try {STEEPER_GRADE_STEPS_PERCENT.map((step) => `+${step}%`).join(' and ')}
            </span>
            <InfoTip label="About trying steeper grades">
              A goal that finds no line is searched again at the grade limit plus{' '}
              {STEEPER_GRADE_STEPS_PERCENT.map((step) => `${step}%`).join(', then ')}, and its row says whether the ends
              connect. Information only: no road over the limit is added, and the grade limit is not changed. Each try
              is one more search, so a failed run takes longer with this on. A failed row also has its own button.
            </InfoTip>
          </label>
          <SwitchbackSettings
            route={route}
            minRadiusM={project.settings.minRadius}
            maxGradePercent={project.settings.maxGradePercent}
            onChange={(routeSearch) => w.update((x) => ({ ...x, routeSearch }))}
          />
        </details>
        {stale && !drawing && (
          <InlineAlert tone="warning">
            The road, limits or terrain changed.{' '}
            <button className="underline" onClick={() => void compare()}>
              Compare again
            </button>
          </InlineAlert>
        )}
        {showLines && (
          <div className="space-y-1" data-testid="road-route-results">
            {rows
              .filter((row) => row.alignment)
              .map((row) => (
                <RouteResult
                  key={row.id}
                  row={row}
                  color={colors.get(row.alignment!.id) ?? row.color}
                  current={current}
                  viewing={row.alignment?.id === alignment.id}
                  onView={() => view(row)}
                  onHover={(on) => setHovered(on ? row.id : null)}
                />
              ))}
            {failures.map((group) => (
              <RouteFailureRow
                key={group.key}
                ref={(element) => {
                  if (element) failureRefs.current.set(group.key, element)
                  else failureRefs.current.delete(group.key)
                }}
                goals={group.rows}
                message={group.message}
                stop={group.stop}
                steeper={group.steeper}
                limitPercent={project.settings.maxGradePercent}
                selected={focused === group.key}
                busy={!!w.busy}
                onToggle={() => setFocused((now) => (now === group.key ? null : group.key))}
                onHover={(on) => setHovered(on ? group.key : null)}
                onTrySteeper={() => void steeper(group.rows)}
              />
            ))}
            {!designed.length && !failures.length && (
              <p className="text-2xs leading-4 text-muted-foreground">No new road beat yours on these goals.</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <p className="min-w-0 flex-1 text-2xs leading-4 text-muted-foreground">Click a road to open it.</p>
              {designed.length > 0 && onShowCompare && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  onClick={() => {
                    if (add(designed, designed.find((row) => row.alignment!.id === alignment.id) ?? designed[0]))
                      onShowCompare()
                  }}
                >
                  Compare all
                </Button>
              )}
              <InfoTip label="About these prices">
                Build is the engineering estimate at this project's rates, the same figure Compare shows. The drainage
                part is the placeholder allowance from Search settings. New roads carry your template but no culverts,
                materials or haul inputs, so add those before relying on the gap.
              </InfoTip>
            </div>
          </div>
        )}
      </div>
    </RoadSection>
  )
}

function RouteResult({
  row,
  color,
  current,
  viewing,
  onView,
  onHover,
}: {
  row: RouteRow
  color: string
  current?: RouteRow
  viewing: boolean
  onView: () => void
  onHover: (on: boolean) => void
}) {
  const saving =
    current?.totalCost && row.totalCost !== null && row !== current
      ? Math.round(((row.totalCost - current.totalCost) / current.totalCost) * 100)
      : null
  return (
    <button
      className={`block w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 ${viewing ? 'border-primary bg-primary/5' : ''}`}
      data-route-row={row.goal}
      aria-pressed={viewing}
      aria-label={`Open ${row.label}`}
      onClick={onView}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <span className="flex items-start gap-1.5">
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
        <span className="min-w-0 flex-1 font-medium">{row.label}</span>
        <span className="shrink-0 text-right font-semibold tabular-nums">
          {row.totalCost !== null ? money(row.totalCost) : '—'}
          {saving !== null && saving !== 0 && (
            <span
              className={`ml-1 font-normal ${saving < 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}
            >
              {saving > 0 ? '+' : '−'}
              {Math.abs(saving)}%
            </span>
          )}
        </span>
      </span>
      <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground tabular-nums">
        {whole(row.lengthM!)} m · {row.maxGradePercent!.toFixed(1)}% · {whole(row.earthworksM3!)} m³
        {row.drainage && (
          <>
            {' · '}
            {plural(row.drainage.crossings, 'stream')} · {plural(row.drainage.crossDrains, 'drain')}
          </>
        )}
      </span>
      {row.drainage && row.constructionCost !== null && (
        <span className="block text-2xs leading-4 text-muted-foreground tabular-nums">
          {money(row.constructionCost)} build + {money(row.drainage.allowance)} drainage
        </span>
      )}
      {row.goal === 'current' && row.best.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-1">
          {row.best.map((goal) => (
            <span
              key={goal}
              className="rounded bg-emerald-100 px-1 text-2xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            >
              {GOAL_LABEL[goal]}
            </span>
          ))}
        </span>
      )}
      {row.blockers.map((blocker) => (
        <span key={blocker} className="mt-0.5 block text-2xs leading-4 text-amber-700 dark:text-amber-400">
          {blocker}
        </span>
      ))}
      {row.notes.map((note) => (
        <span key={note} className="mt-0.5 block text-2xs leading-4 text-muted-foreground">
          {note}
        </span>
      ))}
      {viewing && <span className="mt-0.5 block text-2xs font-medium text-primary">Viewing</span>}
    </button>
  )
}

interface FailureGroup {
  key: string
  message: string
  label: string
  color: string
  rows: RouteRow[]
  stop?: RouteRow['stop']
  steeper?: RouteRow['steeper']
}
/** Goals that failed for one reason, as one row: they share the search that stopped, and its mark. */
function failureGroups(rows: RouteRow[]): FailureGroup[] {
  const groups = new Map<string, RouteRow[]>()
  for (const row of rows.filter((row) => !row.alignment)) {
    const message = row.blockers[0] ?? 'No route found.'
    groups.set(message, [...(groups.get(message) ?? []), row])
  }
  return [...groups].map(([message, members]) => ({
    key: `failure:${members.map((row) => row.goal).join('+')}`,
    message,
    label: members.map((row) => row.label).join(' · '),
    color: members[0].color,
    rows: members,
    stop: members.find((row) => row.stop)?.stop,
    steeper: members.find((row) => row.steeper)?.steeper,
  }))
}
