import { useEffect, useMemo, useRef, useState } from 'react'
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
  ROUTE_GOALS,
  type RouteComparison,
  type RouteGoal,
  type RouteRow,
} from './routeComparison'
import { corridorSearchResolution } from './corridorOptimizer'
import { DEFAULT_GROUND_WINDOW_M, resolvedGroundWindow } from './groundTrend'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { localMetricGrid } from './terrain'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { Coordinate } from './types'

const MAX_ROADS = 20
export interface RoutePreviewLine {
  id: string
  label: string
  color: string
  selected: boolean
  coordinates: Coordinate[]
}
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
  onPegRoad,
  onPreview,
  onShowCompare,
  onSelectRoad,
}: {
  workspace: RoadWorkspace
  full: boolean
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
  } | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
  const groundWindowM = resolvedGroundWindow(route, project.terrain.resolutionM)
  const roadKey = JSON.stringify([alignment.id, alignment.points.map((p) => p.coordinate), alignment.vertical.length])
  // By value: keeping a road rewrites the project, and that must not expire the other results.
  const inputs = useMemo(() => JSON.stringify([project.settings, project.context]), [project.settings, project.context])
  const inProject = useMemo(() => new Set(project.alignments.map((road) => road.id)), [project.alignments])
  const stale =
    !!run &&
    (run.inputs !== inputs ||
      run.source !== source ||
      (roadKey !== run.roadKey && !run.comparison.rows.some((row) => row.alignment?.id === alignment.id)))
  const showLines = !!run && !stale
  const lines = useMemo(
    () =>
      showLines
        ? run!.comparison.rows
            .filter((row) => row.goal !== 'current' && row.alignment && !inProject.has(row.alignment.id))
            .map((row) => ({
              id: row.id,
              label: row.label,
              color: row.color,
              selected: row.id === hovered,
              coordinates: row.coordinates,
            }))
        : null,
    [showLines, run, hovered, inProject],
  )
  useEffect(() => onPreview?.(lines), [lines, onPreview])
  useEffect(() => () => onPreview?.(null), [onPreview])

  const toggleGoal = (goal: RouteGoal) =>
    setGoals((now) => (now.includes(goal) ? now.filter((g) => g !== goal) : [...now, goal]))

  const compare = async () => {
    if (abort.current || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    // Cancel hands the workspace back at once; the search stops at its next slice, a few milliseconds on.
    const stop = () => {
      controller.abort()
      if (abort.current !== controller) return
      abort.current = null
      w.setBusy('')
      w.setNotice('Route comparison cancelled. No road was changed.')
    }
    setRun(null)
    w.setError('')
    w.setBusy('Starting…')
    w.setBusyCancel({ label: 'Cancel route comparison', title: 'Comparing routes', onCancel: stop })
    try {
      const comparison = await compareRoutes(
        {
          base: alignment,
          baseAnalysis: analysis,
          terrain: source,
          resolutionM: project.terrain.resolutionM,
          settings: project.settings,
          context: project.context,
          routeOptions: route,
          gridAt: localMetricGrid,
          analysisOptions: {
            referenceSurfaces: w.referenceSurfaces,
            verticalReference: project.terrain.verticalReference,
            sharedCrossingCosts: project.sharedCrossingCosts,
          },
          options: {
            goals,
            corridorHalfWidthM: halfWidth,
            groundWindowM,
            crossingCost: route.crossingCost,
            crossDrainCost,
            drainage: project.drainage?.settings ?? DEFAULT_DRAINAGE_SETTINGS,
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
      setRun({ comparison, roadKey, inputs, source })
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
  // Goals that failed for one reason read as one line, not one row each.
  const failures = new Map<string, RouteRow[]>()
  for (const row of rows.filter((row) => !row.alignment)) {
    const message = row.blockers[0] ?? 'No route found.'
    failures.set(message, [...(failures.get(message) ?? []), row])
  }
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
            min={5}
            max={1000}
            step={5}
            onChange={(minRadius) => w.update((x) => ({ ...x, settings: { ...x.settings, minRadius } }))}
          />
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={!goals.length || full}
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
        </details>
        {stale && (
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
            {[...failures].map(([message, goals]) => (
              <div
                key={message}
                className="rounded-md border border-dashed px-2 py-1.5 text-xs"
                data-route-row={goals[0].goal}
              >
                <p className="font-medium">{goals.map((row) => row.label).join(' · ')}</p>
                <p className="text-2xs leading-4 text-muted-foreground">{message}</p>
              </div>
            ))}
            {!designed.length && !failures.size && (
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
