import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { MapPin } from 'lucide-react'
import { NumberField } from './Controls'
import { RoadSection } from './SidebarParts'
import { parseProject } from './project'
import {
  compareRoutes,
  DEFAULT_CROSS_DRAIN_COST,
  ROUTE_GOALS,
  type RouteComparison,
  type RouteGoal,
  type RouteRow,
} from './routeComparison'
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
const GOAL_LABEL: Record<RouteGoal, string> = {
  cost: 'Cheapest',
  shortest: 'Shortest',
  gentle: 'Gentlest',
  drainage: 'Best drainage',
}
/** The engine's messages describe its budgets; a row needs to say what to try next. */
const failure = (message: string, limit: number) =>
  /budget|No verified candidate|No terrain-cost/.test(message)
    ? `No route within ${limit}%. Raise the limit or move an end off the steep ground.`
    : message

/** Pick the ends, pick what matters, and see designed roads priced beside the one you have. */
export function RouteFinder({
  workspace: w,
  full,
  onPegRoad,
  onPreview,
  onShowCompare,
}: {
  workspace: RoadWorkspace
  full: boolean
  onPegRoad: () => void
  onPreview?: (lines: RoutePreviewLine[] | null) => void
  onShowCompare?: () => void
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
  const [selected, setSelected] = useState<string | null>(null)
  const [kept, setKept] = useState<string[]>([])
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
  const groundWindowM = resolvedGroundWindow(route, project.terrain.resolutionM)
  const roadKey = JSON.stringify([alignment.id, alignment.points.map((p) => p.coordinate), alignment.vertical.length])
  // By value: keeping a road rewrites the project, and that must not expire the other results.
  const inputs = useMemo(() => JSON.stringify([project.settings, project.context]), [project.settings, project.context])
  const stale =
    !!run &&
    (run.inputs !== inputs || run.source !== source || (roadKey !== run.roadKey && !kept.includes(alignment.id)))
  const showLines = !!run && !stale
  const lines = useMemo(
    () =>
      showLines
        ? run!.comparison.rows
            .filter((row) => row.goal !== 'current' && row.alignment && !kept.includes(row.alignment.id))
            .map((row) => ({
              id: row.id,
              label: row.label,
              color: row.color,
              selected: row.id === selected,
              coordinates: row.coordinates,
            }))
        : null,
    [showLines, run, selected, kept],
  )
  useEffect(() => onPreview?.(lines), [lines, onPreview])
  useEffect(() => () => onPreview?.(null), [onPreview])

  const toggleGoal = (goal: RouteGoal) =>
    setGoals((now) => (now.includes(goal) ? now.filter((g) => g !== goal) : [...now, goal]))

  const compare = async () => {
    if (abort.current || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    setRun(null)
    setSelected(null)
    setKept([])
    w.setError('')
    w.setBusy('Comparing routes…')
    w.setBusyCancel({ label: 'Cancel route comparison', onCancel: () => controller.abort() })
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
        { signal: controller.signal, onStep: (message) => w.setBusy(message) },
      )
      setRun({ comparison, roadKey, inputs, source })
      w.setNotice('Routes ready. Your road has not changed.')
    } catch (cause) {
      if (controller.signal.aborted) w.setNotice('Route comparison cancelled. No road was changed.')
      else w.setError(cause instanceof Error ? cause.message : 'Could not compare routes.')
    } finally {
      abort.current = null
      w.setBusy('')
    }
  }

  const keep = (rows: RouteRow[]) => {
    const roads = rows.flatMap((row) => (row.alignment ? [row.alignment] : []))
    if (!roads.length) return
    if (project.alignments.length + roads.length > MAX_ROADS) {
      w.setError(`A project holds at most ${MAX_ROADS} roads. Delete one first.`)
      return
    }
    w.commit(
      parseProject({
        ...project,
        alignments: [...project.alignments, ...roads],
        activeAlignmentId: roads[0].id,
      }),
    )
    w.setStation(0)
    setKept((now) => [...now, ...roads.map((road) => road.id)])
    w.setNotice(roads.length === 1 ? `Added ${roads[0].name}.` : `Added ${roads.length} roads to compare.`)
  }

  const rows = run?.comparison.rows ?? []
  const current = rows.find((row) => row.goal === 'current')
  const usable = rows.filter((row) => row.goal !== 'current' && row.alignment && !kept.includes(row.alignment.id))
  return (
    <RoadSection
      title="Find the best route"
      data-testid="road-route-finder"
      help={
        <>
          Takes the ends of the active road and designs one road per goal: corridor search, fitted curves and profile,
          then a price from the same engine as the rest of this page. Each road is also screened for stream crossings
          and cross-drains, priced as a placeholder allowance you can change.
          <br />
          Planning comparison only. Searches are bounded, so a better line can exist.
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
            {rows.map((row) => (
              <RouteResult
                key={row.id}
                row={row}
                current={current}
                limit={project.settings.maxGradePercent}
                selected={row.id === selected}
                kept={!!row.alignment && kept.includes(row.alignment.id)}
                onSelect={() => setSelected(row.id === selected ? null : row.id)}
                onKeep={() => keep([row])}
              />
            ))}
            <div className="flex items-center gap-2 pt-1">
              {usable.length > 1 && (
                <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => keep(usable)}>
                  Keep all {usable.length}
                </Button>
              )}
              {kept.length > 0 && onShowCompare && (
                <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={onShowCompare}>
                  Open Compare
                </Button>
              )}
              <InfoTip label="About these prices">
                Build is the engineering estimate at this project's rates. Total adds the drainage allowance. New roads
                carry your template but no culverts, materials or haul inputs, so add those before relying on the gap.
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
  current,
  limit,
  selected,
  kept,
  onSelect,
  onKeep,
}: {
  row: RouteRow
  current?: RouteRow
  limit: number
  selected: boolean
  kept: boolean
  onSelect: () => void
  onKeep: () => void
}) {
  if (!row.alignment)
    return (
      <div className="rounded-md border border-dashed px-2 py-1.5 text-xs" data-route-row={row.goal}>
        <p className="font-medium">{row.label}</p>
        <p className="text-2xs leading-4 text-muted-foreground">{failure(row.blockers[0] ?? '', limit)}</p>
      </div>
    )
  const saving =
    current?.totalCost && row.totalCost !== null && row !== current
      ? Math.round(((row.totalCost - current.totalCost) / current.totalCost) * 100)
      : null
  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-xs ${selected ? 'border-primary bg-muted/50' : ''}`}
      data-route-row={row.goal}
    >
      <div className="flex items-start gap-1.5">
        <button className="min-w-0 flex-1 text-left" onClick={onSelect} aria-pressed={selected}>
          <span className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden="true" />
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="ml-auto shrink-0 font-semibold tabular-nums">
              {row.totalCost !== null ? money(row.totalCost) : '—'}
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
            {saving !== null && saving !== 0 && (
              <span className={saving < 0 ? ' text-emerald-700 dark:text-emerald-400' : ''}>
                {' · '}
                {saving > 0 ? '+' : ''}
                {saving}%
              </span>
            )}
          </span>
          {row.best.length > 0 && (
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
        </button>
        {row.goal !== 'current' &&
          (kept ? (
            <span className="pt-0.5 text-2xs text-muted-foreground">Added</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 px-1.5 text-2xs"
              aria-label={`Use ${row.label}`}
              onClick={onKeep}
            >
              Use
            </Button>
          ))}
      </div>
    </div>
  )
}
