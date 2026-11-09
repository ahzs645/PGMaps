import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Crosshair, MapPin, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import type { SidebarProps } from './DesignSidebarBody'
import {
  ACCESS_START_COLORS,
  accessEndPoint,
  accessStarts,
  compareAccessRoutes,
  MAX_ACCESS_STARTS,
  isActiveRoad,
  pickActiveRoad,
  type AccessEnd,
  type AccessReview,
  type AccessRow,
  type AccessStart,
  type AccessStartMode,
  accessConnector,
  type AccessOrigin,
} from './accessReview'
import { nearestFsrConnections } from './fsrNetwork'
import { distance } from './engine'
import { DEFAULT_CROSS_DRAIN_COST, ROUTE_GOALS, type RouteGoal } from './routeComparison'
import { resolvedGroundWindow } from './groundTrend'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { loadRegionalTerrain, localMetricGrid } from './terrain'
import { parseProject } from './project'
import type { Coordinate, RoadProject, TerrainSource } from './types'

const MAX_ROADS = 20
const CORRIDOR_HALF_WIDTH_M = 180
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}k`)
const length = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`)
const grade = (p: number | null) => (p === null ? '—' : `${p.toFixed(1)}%`)
const GOAL_LABEL = Object.fromEntries(ROUTE_GOALS.map((goal) => [goal.id, goal.label])) as Record<RouteGoal, string>

/** A point the plan shows for the review: the end, or where a road would join an existing one. */
export interface AccessMark {
  coordinate: Coordinate
  label: string
  color: string
}

/**
 * Pick where a new road has to reach, and compare roads to it from the roads it could leave: the
 * nearest active FSRs, or a road picked on the plan. Each start is compared by the route goals; the
 * plan shows every variant, and one can be added as a road.
 */
export function AccessReviewPanel({ full, ...p }: SidebarProps & { full: boolean }) {
  const w = p.workspace
  const { project, source } = w
  const blocks = useMemo(
    () =>
      project.context
        .filter((feature) => feature.kind === 'harvest' && feature.geometry.type === 'Polygon')
        // Planned blocks are what access is for; a harvested block is still offered for a re-entry.
        .sort(
          (a, b) => Number(b.harvestEvidence?.status === 'proposed') - Number(a.harvestEvidence?.status === 'proposed'),
        ),
    [project.context],
  )
  const [endKind, setEndKind] = useState<'point' | 'block' | 'road'>(blocks.length ? 'block' : 'point')
  // "This road": the active road's start or end, for a connector that extends it to an FSR.
  const [roadEnd, setRoadEnd] = useState<'start' | 'end'>('end')
  const [regional, setRegional] = useState(false)
  const [scope, setScope] = useState('')
  const [endPoint, setEndPoint] = useState<Coordinate | null>(null)
  const [chosenBlock, setChosenBlock] = useState('')
  const block = blocks.find((candidate) => candidate.id === chosenBlock) ?? blocks[0]
  const [startKind, setStartKind] = useState<'nearest' | 'road'>('nearest')
  const [count, setCount] = useState(3)
  const [roadId, setRoadId] = useState<string | null>(null)
  const pickedRoad = project.context.find((feature) => feature.id === roadId)
  const [goals, setGoals] = useState<RouteGoal[]>(['cost', 'shortest', 'gentle', 'drainage'])
  const [picking, setPicking] = useState<'end' | 'road' | null>(null)
  const [run, setRun] = useState<{
    review: AccessReview
    key: string
    source: typeof source
    scope: string
    origin: AccessOrigin | null
    picked: boolean
    /** Set when the run searched regional terrain; adding a road then opens it as its own project. */
    regional: { source: TerrainSource; metadata: RoadProject['terrain'] } | null
  } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  // Memoised: the start preview and the plan marks follow these, and a new object every render
  // would send new marks to the page every render.
  const active = w.alignment
  const origin = useMemo(
    (): AccessOrigin | null =>
      endKind === 'road'
        ? {
            alignmentId: active.id,
            alignmentName: active.name,
            endpoint: roadEnd,
            coordinate: (roadEnd === 'start' ? active.points[0] : active.points.at(-1)!).coordinate,
          }
        : null,
    [endKind, roadEnd, active],
  )
  const end = useMemo((): AccessEnd | null => {
    if (origin) return { kind: 'point', coordinate: origin.coordinate }
    if (endKind === 'point') return endPoint ? { kind: 'point', coordinate: endPoint } : null
    return block ? { kind: 'block', block } : null
  }, [origin, endKind, endPoint, block])
  const endName = origin
    ? `${origin.alignmentName} ${origin.endpoint}`
    : endKind === 'block' && block
      ? block.name
      : 'Picked end'
  // The FSRs a road could be picked from, nearest first, when starting from a road you choose.
  const nearby = useMemo(
    () => (end ? nearestFsrConnections(accessEndPoint(end), project.context, 10) : []),
    [end, project.context],
  )
  const mode = useMemo(
    (): AccessStartMode | null =>
      startKind === 'nearest' ? { kind: 'nearest', count } : roadId ? { kind: 'road', roadId } : null,
    [startKind, count, roadId],
  )
  // A road chosen and then closed or retired stays chosen and blocks the run, rather than the
  // review quietly starting from another road.
  const pickedUnavailable = startKind === 'road' && !!roadId && (!pickedRoad || !isActiveRoad(pickedRoad))
  // What the review was asked: by value, so re-saving the same project does not expire it.
  const key = JSON.stringify([
    end?.kind === 'point' ? end.coordinate : end?.block.geometry,
    mode,
    goals,
    regional,
    project.settings,
  ])
  const stale = !!run && (run.key !== key || run.source !== source)
  const review = run && !stale ? run.review : null

  // Where roads would start, shown before anything is run: the snapped junctions on the plan.
  const previewStarts = useMemo((): AccessStart[] => {
    if (!end || !mode) return []
    try {
      return accessStarts(end, project.context, mode)
    } catch {
      return []
    }
  }, [end, mode, project.context])
  const { onPreviewAccessMarks, onPreviewRoutes, onPickOnPlan } = p
  // The plan shows the review only while its section is open: a block is the default end, so an
  // unopened panel would otherwise put start chips on every scenario's plan and legend.
  const [open, setOpen] = useState(false)
  const marks = useMemo((): AccessMark[] | null => {
    if (!open) return null
    const starts = review ? review.attempts.map((attempt) => attempt.start) : previewStarts
    const all = [
      ...(end?.kind === 'point' ? [{ coordinate: end.coordinate, label: 'End', color: '#0f172a' }] : []),
      ...starts.map((start, i) => ({
        coordinate: start.target.coordinate,
        label: `Start ${i + 1} · ${start.target.name}`,
        color: ACCESS_START_COLORS[i % ACCESS_START_COLORS.length],
      })),
    ]
    return all.length ? all : null
  }, [open, review, previewStarts, end])
  useEffect(() => onPreviewAccessMarks?.(marks), [marks, onPreviewAccessMarks])
  useEffect(() => () => onPreviewAccessMarks?.(null), [onPreviewAccessMarks])
  const lines = useMemo(
    () =>
      open && review
        ? review.rows.map((row) => ({
            id: `access-${row.id}`,
            label: `${row.startIndex + 1}. ${row.label}`,
            color: ACCESS_START_COLORS[row.startIndex % ACCESS_START_COLORS.length],
            selected: row.id === selected,
            coordinates: row.coordinates,
          }))
        : null,
    [open, review, selected],
  )
  useEffect(() => onPreviewRoutes?.(lines), [lines, onPreviewRoutes])
  useEffect(() => () => onPreviewRoutes?.(null), [onPreviewRoutes])
  useEffect(() => () => onPickOnPlan?.(null), [onPickOnPlan])

  const pick = (what: 'end' | 'road') => {
    if (!onPickOnPlan) return
    if (picking === what) {
      setPicking(null)
      onPickOnPlan(null)
      return
    }
    setPicking(what)
    onPickOnPlan(
      what === 'end' ? 'Click the plan where the road has to reach.' : 'Click the road it should start from.',
      (at) => {
        setPicking(null)
        if (what === 'end') setEndPoint(at)
        else {
          const road = pickActiveRoad(at, w.project.context)
          if (road) choose(road.id)
          else w.setError('No active road within 250 m of that point. Load roads, or click closer to one.')
        }
      },
    )
  }

  /** Picks the road to start from and highlights it on the plan. */
  const choose = (id: string) => {
    setRoadId(id)
    const road = w.project.context.find((feature) => feature.id === id)
    if (road) p.onReviewRoad?.(road, true)
  }
  const findNearby = async () => {
    if (!end || !p.onLoadFsrsNear || abort.current || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    w.setBusy('Finding nearby FSRs…')
    try {
      const loaded = await p.onLoadFsrsNear(accessEndPoint(end), controller.signal)
      if (loaded && !controller.signal.aborted) {
        setScope(loaded.scope)
        w.setNotice(
          `${nearestFsrConnections(accessEndPoint(end), loaded.context, 10).length} nearby FSR choices. ${loaded.scope}`,
        )
      }
    } catch (cause) {
      if (!controller.signal.aborted) w.setError(cause instanceof Error ? cause.message : 'Could not load nearby FSRs.')
    } finally {
      abort.current = null
      w.setBusy('')
    }
  }

  const compare = async () => {
    if (!end || !mode || abort.current || w.busy) return
    const controller = new AbortController()
    abort.current = controller
    setRun(null)
    w.setError('')
    w.setBusy('Finding roads to start from…')
    w.setBusyCancel({ label: 'Cancel access review', title: 'Reviewing access', onCancel: () => controller.abort() })
    try {
      // Nearest starts need the FSR network loaded around the end; a picked road is already here.
      let context = project.context
      let networkScope = scope || 'The loaded project road network was searched.'
      if (mode.kind === 'nearest' && p.onLoadFsrsNear) {
        const loaded = await p.onLoadFsrsNear(accessEndPoint(end), controller.signal)
        if (controller.signal.aborted) return
        if (loaded) {
          context = loaded.context
          networkScope = loaded.scope
        }
      }
      const starts = accessStarts(end, context, mode)
      const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
      // Regional terrain spans the end and every start, so routes can leave the loaded terrain.
      let terrain = source
      let terrainMetadata = project.terrain
      if (regional && starts.length) {
        const points = [accessEndPoint(end), ...starts.map((start) => start.target.coordinate)]
        const margin = Math.max(1000, route.searchMarginM ?? 0, ...starts.map((s) => s.target.distanceM * 0.4))
        const dLat = margin / 111195
        const dLon = dLat / Math.cos((points[0][1] * Math.PI) / 180)
        w.setBusy('Loading regional terrain across the access…')
        const loaded = await loadRegionalTerrain(
          [
            Math.min(...points.map((q) => q[0])) - dLon,
            Math.min(...points.map((q) => q[1])) - dLat,
            Math.max(...points.map((q) => q[0])) + dLon,
            Math.max(...points.map((q) => q[1])) + dLat,
          ],
          controller.signal,
        )
        if (controller.signal.aborted) return
        terrain = loaded.source
        terrainMetadata = loaded.metadata
      }
      const result = await compareAccessRoutes(
        {
          starts,
          endName,
          template: w.alignment.template,
          terrain,
          resolutionM: terrainMetadata.resolutionM,
          settings: project.settings,
          context,
          routeOptions: route,
          gridAt: localMetricGrid,
          analysisOptions: {
            referenceSurfaces: w.referenceSurfaces,
            verticalReference: project.terrain.verticalReference,
            sharedCrossingCosts: project.sharedCrossingCosts,
          },
          options: {
            goals,
            corridorHalfWidthM: CORRIDOR_HALF_WIDTH_M,
            groundWindowM: resolvedGroundWindow(route, terrainMetadata.resolutionM),
            crossingCost: route.crossingCost,
            crossDrainCost: DEFAULT_CROSS_DRAIN_COST,
            drainage: project.drainage?.settings ?? DEFAULT_DRAINAGE_SETTINGS,
          },
        },
        {
          signal: controller.signal,
          onStep: ({ message, step, total }) => {
            w.setBusy(message)
            w.setBusyProgress({ step, total })
          },
        },
      )
      setRun({
        review: result,
        key,
        source,
        scope: networkScope,
        origin,
        picked: mode.kind === 'road',
        regional: regional ? { source: terrain, metadata: terrainMetadata } : null,
      })
      const lead = result.rows.find((row) => row.overallBest.includes(goals[0])) ?? result.rows[0]
      setSelected(lead?.id ?? null)
      if (!result.rows.length)
        throw Error(
          `No road to ${endName} passed the terrain and route limits. ${result.attempts
            .filter((a) => a.error)
            .map((a) => `${a.start.target.name}: ${a.error}`)
            .join(' ')}`,
        )
      w.setNotice(
        `${result.rows.length} roads from ${starts.length} start${starts.length === 1 ? '' : 's'}. Click one to see it on the plan. ${networkScope}`.trim(),
      )
    } catch (cause) {
      if (controller.signal.aborted) w.setNotice('Access review cancelled. No road was changed.')
      else w.setError(cause instanceof Error ? cause.message : 'Could not review access.')
    } finally {
      abort.current = null
      w.setBusy('')
    }
  }

  const add = async (row: AccessRow) => {
    if (!row.alignment || !run) return
    if (project.alignments.length >= MAX_ROADS) {
      w.setError(`A project holds at most ${MAX_ROADS} roads. Delete one first.`)
      return
    }
    if (project.alignments.some((road) => road.id === row.alignment!.id)) {
      p.onSelectRoad?.(row.alignment.id)
      return
    }
    try {
      // From a road's end, the road extends it: it runs from that end to the junction and keeps a
      // connection record. Otherwise it runs from the junction to the end.
      const road = run.origin
        ? accessConnector(row, run.origin, run.scope, run.picked ? 'chosen' : 'nearest')
        : row.alignment
      const next = parseProject({
        ...project,
        ...(run.regional
          ? {
              name: `${project.name} · regional access`.slice(0, 200),
              terrain: run.regional.metadata,
              scenario: undefined,
            }
          : {}),
        alignments: [...project.alignments, road],
        activeAlignmentId: road.id,
      })
      p.onReviewRoad?.(null)
      if (run.regional) {
        // Regional terrain is a separate reconnaissance project; the original stays saved as it was.
        await w.flush()
        w.startProject(next, run.regional.source)
      } else w.commit(next)
      setRun(null)
      w.setStation(0)
      w.setNotice(
        `Added the road ${run.origin ? 'connecting to' : 'from'} ${row.start.target.name}.${run.regional ? ' Opened a separate regional reconnaissance project; your original terrain project remains saved.' : ''} Check its junction, profile and curves, and run the final checks before relying on it.`,
      )
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not add the road.')
    }
  }

  // The active road's connection record, when it was made as an FSR connector.
  const record = active.fsrConnection
  const junctionEdited =
    record &&
    (distance(active.points[0].coordinate, record.originCoordinate) > 0.1 ||
      distance(active.points.at(-1)!.coordinate, record.targetCoordinate) > 0.1)

  const rows = review?.rows ?? []
  const selectedRow = rows.find((row) => row.id === selected) ?? null
  // Arrow keys move through the variants, as a list of options does.
  const step = (event: KeyboardEvent, by: number) => {
    if (!rows.length) return
    event.preventDefault()
    const index = Math.max(
      0,
      rows.findIndex((row) => row.id === selected),
    )
    const next = rows[(index + by + rows.length) % rows.length]
    setSelected(next.id)
    document.querySelector<HTMLElement>(`[data-access-row="${CSS.escape(next.id)}"]`)?.focus()
  }

  return (
    <RoadSection
      title="Access from FSR"
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next && picking) {
          setPicking(null)
          onPickOnPlan?.(null)
        }
      }}
      // Always a summary, so the section stays one collapsible section before and after a run.
      summary={review ? `${rows.length} roads` : end ? endName : 'No end yet'}
      data-testid="road-access-review"
      help={
        <>
          A new road has to leave an existing one, so pick where it has to reach and compare roads back to the roads it
          could start from. Each start is compared by the route goals; ★ marks the overall leader of a goal across every
          start.
          <br />
          Loaded trucks run from the end back to the FSR: <em>Loaded ↑</em> is the steepest climb against a load,{' '}
          <em>Empty ↑</em> the steepest climb on the way in. Grades are sampled ground; junctions, access rights and
          road condition need review.
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <div className="space-y-1.5">
          <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">End</p>
          <SegmentedControl
            size="sm"
            label="Access end"
            value={endKind}
            onChange={setEndKind}
            options={[
              { value: 'block', label: 'Planned block', disabled: !blocks.length },
              { value: 'point', label: 'Point on plan' },
              { value: 'road', label: 'This road' },
            ]}
          />
          {endKind === 'road' ? (
            // Extends the active road: the new road leaves an FSR and meets this road's start or end.
            <div className="flex items-center gap-2">
              <div className="w-28 shrink-0">
                <RoadSelect
                  ariaLabel="Connect from"
                  value={roadEnd}
                  onValueChange={(value) => setRoadEnd(value as 'start' | 'end')}
                  options={[
                    { value: 'end', label: 'Road end' },
                    { value: 'start', label: 'Road start' },
                  ]}
                />
              </div>
              <span className="min-w-0 truncate text-muted-foreground" title={active.name}>
                of {active.name}
              </span>
            </div>
          ) : endKind === 'block' ? (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <RoadSelect
                  ariaLabel="Harvest block"
                  value={block?.id ?? ''}
                  onValueChange={setChosenBlock}
                  options={blocks.map((candidate) => {
                    const e = candidate.harvestEvidence
                    const year = e?.endYear ?? e?.startYear ?? e?.midYear
                    return {
                      value: candidate.id,
                      label:
                        e?.status === 'proposed'
                          ? candidate.name
                          : `${candidate.name} · harvested${year === undefined ? '' : ` ${year}`}`,
                    }
                  })}
                />
              </div>
              {p.onDrawBlock && (
                <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={full} onClick={p.onDrawBlock}>
                  Draw block
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={picking === 'end' ? 'default' : 'outline'}
                className="h-8 gap-1"
                disabled={full || !onPickOnPlan}
                aria-pressed={picking === 'end'}
                onClick={() => pick('end')}
              >
                <MapPin className="size-3.5" />
                {picking === 'end' ? 'Click the plan…' : endPoint ? 'Move end' : 'Pick end on plan'}
              </Button>
              <span className="min-w-0 truncate text-muted-foreground">
                {endPoint ? `${endPoint[1].toFixed(5)}, ${endPoint[0].toFixed(5)}` : 'No end yet'}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Start from</p>
          <SegmentedControl
            size="sm"
            label="Access start"
            value={startKind}
            onChange={setStartKind}
            options={[
              { value: 'nearest', label: 'Nearest FSRs' },
              { value: 'road', label: 'A road I pick' },
            ]}
          />
          {startKind === 'nearest' ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Try the</span>
              <div className="w-16">
                <RoadSelect
                  ariaLabel="FSRs to try"
                  value={String(count)}
                  onValueChange={(value) => setCount(Number(value))}
                  options={Array.from({ length: MAX_ACCESS_STARTS }, (_, i) => ({
                    value: String(i + 1),
                    label: String(i + 1),
                  }))}
                />
              </div>
              <span className="text-muted-foreground">nearest active FSRs</span>
            </div>
          ) : (
            // Choose from the nearby FSRs, or click any active road on the plan.
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <RoadSelect
                    ariaLabel="FSR to connect to"
                    value={roadId ?? ''}
                    placeholder={nearby.length ? 'Choose a nearby FSR' : 'No FSR loaded nearby'}
                    onValueChange={choose}
                    options={[
                      ...nearby.map((target, i) => ({
                        value: target.featureId,
                        label: `${i + 1}. ${target.name} · ${length(target.distanceM)} away`,
                      })),
                      // A road picked on the plan need not be one of the nearest FSRs.
                      ...(pickedRoad && !nearby.some((target) => target.featureId === pickedRoad.id)
                        ? [{ value: pickedRoad.id, label: pickedRoad.name }]
                        : []),
                    ]}
                  />
                </div>
                <Button
                  size="icon"
                  variant={picking === 'road' ? 'default' : 'outline'}
                  className="size-8 shrink-0"
                  disabled={full || !onPickOnPlan}
                  aria-pressed={picking === 'road'}
                  aria-label="Pick road on plan"
                  title={picking === 'road' ? 'Click a road on the plan…' : 'Pick the road on the plan'}
                  onClick={() => pick('road')}
                >
                  <Crosshair className="size-4" />
                </Button>
              </div>
              {pickedUnavailable && (
                <InlineAlert tone="warning">
                  The selected FSR is unavailable. Refresh the choices or choose another section.
                </InlineAlert>
              )}
              {p.onLoadFsrsNear && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={!end || full}
                    onClick={() => void findNearby()}
                  >
                    Find nearby FSRs
                  </Button>
                  {scope && <span className="min-w-0 flex-1 text-2xs text-muted-foreground">{scope}</span>}
                </div>
              )}
            </div>
          )}
          {previewStarts.length > 0 && !review && (
            <p className="text-2xs text-muted-foreground">
              Joins {previewStarts.map((s) => `${s.target.name} (${length(s.target.distanceM)})`).join(', ')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Access goals">
          {ROUTE_GOALS.map((goal) => (
            <Button
              key={goal.id}
              size="sm"
              variant={goals.includes(goal.id) ? 'default' : 'outline'}
              className="h-7 px-2 text-xs"
              aria-pressed={goals.includes(goal.id)}
              title={goal.help}
              onClick={() =>
                setGoals((now) => (now.includes(goal.id) ? now.filter((g) => g !== goal.id) : [...now, goal.id]))
              }
            >
              {goal.label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={regional} onChange={(event) => setRegional(event.target.checked)} />
          Search on regional terrain (screening)
          <InfoTip label="About regional terrain">
            Loads the regional DEM across the end and every start, so a route can leave the loaded terrain. It is
            coarse: adding a road from this run opens a separate reconnaissance project and leaves this one as it was.
          </InfoTip>
        </label>
        <Button
          size="sm"
          className="h-8 w-full"
          disabled={!end || !mode || !goals.length || full || pickedUnavailable}
          onClick={() => void compare()}
          data-testid="road-access-compare"
        >
          Compare access routes
        </Button>
        {stale && (
          <InlineAlert tone="warning">
            The end, starts, goals or terrain changed.{' '}
            <button className="underline" onClick={() => void compare()}>
              Compare again
            </button>
          </InlineAlert>
        )}

        {review && (
          <div className="space-y-2" data-testid="road-access-results">
            <div role="radiogroup" aria-label="Access routes" className="space-y-2">
              {review.attempts.map((attempt, startIndex) => {
                const color = ACCESS_START_COLORS[startIndex % ACCESS_START_COLORS.length]
                const startRows = rows.filter((row) => row.startIndex === startIndex)
                return (
                  <div key={startIndex} className="overflow-hidden rounded-md border" data-access-start={startIndex}>
                    <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1.5">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-medium" title={attempt.start.target.name}>
                        {startIndex + 1}. {attempt.start.target.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {length(attempt.start.target.distanceM)} away
                      </span>
                    </div>
                    {attempt.error && <p className="px-2 py-1.5 text-muted-foreground">{attempt.error}</p>}
                    {startRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        role="radio"
                        aria-checked={row.id === selected}
                        tabIndex={row.id === selected || (!selected && row === rows[0]) ? 0 : -1}
                        data-access-row={row.id}
                        className={cn(
                          'block w-full border-t px-2 py-1.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          row.id === selected && 'bg-accent shadow-[inset_3px_0_0_var(--access-color)]',
                        )}
                        style={{ '--access-color': color } as React.CSSProperties}
                        onClick={() => setSelected(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') step(event, 1)
                          else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') step(event, -1)
                        }}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          <span className="min-w-0 flex-1 truncate">{row.label}</span>
                          {row.overallBest.map((goal) => (
                            <span
                              key={goal}
                              className="shrink-0 rounded bg-amber-100 px-1 text-3xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                              title={`Leads ${GOAL_LABEL[goal].toLowerCase()} across every start`}
                            >
                              ★ {GOAL_LABEL[goal]}
                            </span>
                          ))}
                        </span>
                        <span className="mt-0.5 block tabular-nums text-muted-foreground">
                          {row.lengthM === null ? '—' : length(row.lengthM)} · max {grade(row.maxGradePercent)} · loaded
                          ↑ {grade(row.loadedUphillPercent)} · empty ↑ {grade(row.emptyUphillPercent)}
                          {row.totalCost === null ? '' : ` · ${money(row.totalCost)}`}
                        </span>
                        {row.blockers[0] && (
                          <span className="mt-0.5 block text-amber-700 dark:text-amber-400">{row.blockers[0]}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                className="h-8 flex-1 gap-1"
                disabled={!selectedRow || full}
                onClick={() => selectedRow && void add(selectedRow)}
              >
                <Plus className="size-3.5" />
                Add as road
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setRun(null)}>
                Clear
              </Button>
              <InfoTip label="About adding an access road">
                The road starts at the junction on the existing road (chainage 0) and ends at the picked end. Its
                curves, profile and costs are designed like any other road; the junction and access rights still need
                review.
              </InfoTip>
            </div>
          </div>
        )}
        {record && (
          <div className="space-y-1.5 rounded-md border p-2.5 text-2xs" data-testid="road-fsr-connection-record">
            <p className="font-medium">Recorded FSR connection: {record.targetName}</p>
            <p className="text-muted-foreground">
              {length(record.straightLineDistanceM)} straight-line · {length(record.routeLengthM)} road at creation.{' '}
              {record.networkScope}
            </p>
            {junctionEdited && (
              <InlineAlert tone="warning">
                The road endpoints have changed since this connection was made. Verify the junction again.
              </InlineAlert>
            )}
            {p.onCompareCompleteCosts && (
              <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={p.onCompareCompleteCosts}>
                Review final checks & complete costs
              </Button>
            )}
          </div>
        )}
      </div>
    </RoadSection>
  )
}
