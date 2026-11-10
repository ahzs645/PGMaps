import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import type { SidebarProps } from './DesignSidebarBody'
import { runCooperatively } from './cooperative'
import { groundTrendTerrain, resolvedGroundWindow } from './groundTrend'
import { withAddedAlignments } from './investigationWorkspace'
import {
  DEFAULT_LANDING_OPTIONS,
  landingMapFeatures,
  screenLandingSites,
  type LandingScreen,
  type LandingScreenOptions,
} from './landingSites'
import { parseProject } from './project'
import { roadFromRoute } from './routeFit'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import {
  DEFAULT_OFF_BLOCK_M,
  DEFAULT_SKID_RULE,
  MAX_OFF_BLOCK_M,
  MAX_SKID_REACH_M,
  MIN_SKID_REACH_M,
  skidReachMapFeatures,
  skidReachSteps,
  skidRoadsFromProject,
  type SkidReachResult,
  type SkidReachRule,
} from './skidReach'
import { DEFAULT_SPUR_OPTIONS, MAX_SKID_SPURS, suggestSpursSteps, type SpurSuggestion } from './skidSpurs'
import { localMetricGrid } from './terrain'
import type { Alignment, ContextFeature, Coordinate } from './types'

const MAX_ROADS = 20
const SPUR_COLOR = '#ea580c'
const pct = (share: number) => `${(100 * share).toFixed(share > 0 && share < 0.01 ? 1 : 0)}%`
const metres = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`)

interface SkidRun {
  key: string
  source: unknown
  context: unknown
  alignments: unknown
  result: SkidReachResult
  spurs: SpurSuggestion | null
  adopted: string[]
}

/**
 * How far a skidder drags each part of a block to a road, the share within reach, spurs that would
 * bring the rest in, and flat places for landings. Everything here is a candidate: a spur becomes a
 * road only when it is added.
 */
export function SkidReachPanel(p: SidebarProps) {
  const w = p.workspace
  const { project, source } = w
  const blocks = useMemo(
    () => project.context.filter((feature) => feature.kind === 'harvest' && feature.geometry.type === 'Polygon'),
    [project.context],
  )
  const [blockId, setBlockId] = useState('')
  const block: ContextFeature | undefined = blocks.find((b) => b.id === blockId) ?? blocks[0]
  const [rule, setRule] = useState<SkidReachRule>(DEFAULT_SKID_RULE)
  const [offBlockM, setOffBlockM] = useState(DEFAULT_OFF_BLOCK_M)
  const [countMapped, setCountMapped] = useState(true)
  const [countDesigned, setCountDesigned] = useState(true)
  const [streamsStop, setStreamsStop] = useState(false)
  const [landing, setLanding] = useState<LandingScreenOptions>(DEFAULT_LANDING_OPTIONS)
  const [targetPercent, setTargetPercent] = useState(DEFAULT_SPUR_OPTIONS.targetShare * 100)
  const [maxSpurs, setMaxSpurs] = useState(DEFAULT_SPUR_OPTIONS.maxSpurs)
  const [haulExit, setHaulExit] = useState<Coordinate | null>(null)
  const [picking, setPicking] = useState(false)
  const [showOnPlan, setShowOnPlan] = useState(true)
  const [run, setRun] = useState<SkidRun | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const key = JSON.stringify([block?.geometry, rule, offBlockM, countMapped, countDesigned, streamsStop])
  const stale = !!run && (run.key !== key || run.source !== source || run.context !== project.context)
  const current = run && !stale ? run : null
  const roadsChanged = !!current && current.alignments !== project.alignments

  // The landing screen is cheap, so it follows its inputs without a new run.
  const landings = useMemo((): LandingScreen | null => {
    if (!current) return null
    const sg = current.result.skidGrid
    const spurRoads = (current.spurs?.spurs ?? []).map((spur) => ({
      road: { id: spur.id, name: `Spur ${spur.index}`, kind: 'spur' as const, coordinates: spur.coordinates },
      xy: spur.coordinates.map((c) => sg.toGrid(c)),
    }))
    try {
      return screenLandingSites(sg, [...sg.roads, ...spurRoads], project.context, landing)
    } catch {
      return null
    }
  }, [current, landing, project.context])

  const { onPreviewSkidReach, onPickOnPlan } = p
  const features = useMemo(() => {
    if (!current || !showOnPlan) return null
    return [
      ...skidReachMapFeatures(current.result),
      ...(landings ? landingMapFeatures(landings) : []),
      ...(current.spurs?.spurs ?? [])
        .filter((spur) => !current.adopted.includes(spur.id))
        .map(
          (spur): GeoJSON.Feature => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: spur.coordinates },
            properties: {
              kind: 'skid-spur',
              color: SPUR_COLOR,
              label: `Spur ${spur.index} · +${spur.gainHa.toFixed(1)} ha`,
            },
          }),
        ),
    ]
  }, [current, landings, showOnPlan])
  useEffect(() => onPreviewSkidReach?.(features), [features, onPreviewSkidReach])
  useEffect(() => () => onPreviewSkidReach?.(null), [onPreviewSkidReach])
  useEffect(() => () => onPickOnPlan?.(null), [onPickOnPlan])

  const ground = () =>
    groundTrendTerrain(source, resolvedGroundWindow(project.routeSearch, project.terrain.resolutionM))
  const start = (label: string) => {
    const controller = new AbortController()
    abort.current = controller
    w.setError('')
    w.setBusy(label)
    w.setBusyCancel({ label: 'Cancel', title: 'Skid reach', onCancel: () => controller.abort() })
    return controller
  }
  const progress = ({ phase, done, total }: { phase: string; done: number; total: number }) =>
    w.setBusyProgress({ step: Math.min(done, total), total: Math.max(1, total), text: phase })

  const runReach = async () => {
    if (!block || abort.current || w.busy) return
    const controller = start('Reading skid reach…')
    try {
      const ring = (block.geometry as GeoJSON.Polygon).coordinates[0]
      const projection = localMetricGrid([ring[0][0], ring[0][1]])
      const roads = skidRoadsFromProject(
        project,
        new Map([...w.analyses].map(([id, analysis]) => [id, analysis.centerline])),
        { mapped: countMapped, designed: countDesigned },
      )
      const barriers = streamsStop
        ? project.context
            .filter((f) => f.kind === 'stream' && f.geometry.type === 'LineString')
            .map((f) => (f.geometry as GeoJSON.LineString).coordinates.map((c) => [c[0], c[1]] as Coordinate))
        : []
      const result = await runCooperatively(
        skidReachSteps({
          block: block.geometry as GeoJSON.Polygon,
          roads,
          barriers,
          ground: ground(),
          toGrid: projection.toGrid,
          toLonLat: projection.toLonLat,
          rule,
          offBlockM,
        }),
        { signal: controller.signal, onProgress: progress },
        'Skid reach cancelled.',
      )
      setRun({
        key,
        source,
        context: project.context,
        alignments: project.alignments,
        result,
        spurs: null,
        adopted: [],
      })
      const s = result.summary
      w.setNotice(
        `${block.name}: ${pct(s.coveredShare)} of ${s.blockHa.toFixed(1)} ha within skid reach of ${roads.length} road${roads.length === 1 ? '' : 's'}, read on a ${s.cellM.toFixed(0)} m grid.`,
      )
    } catch (cause) {
      if (controller.signal.aborted) w.setNotice('Skid reach cancelled. Nothing was changed.')
      else w.setError(cause instanceof Error ? cause.message : 'Could not read skid reach.')
    } finally {
      abort.current = null
      w.setBusy('')
    }
  }

  const suggest = async () => {
    if (!current || abort.current || w.busy) return
    const controller = start('Suggesting spurs…')
    try {
      const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
      const spurs = await runCooperatively(
        suggestSpursSteps(current.result, {
          terrain: source,
          ground: ground(),
          settings: project.settings,
          context: project.context,
          routeOptions: { ...route, groundWindowM: resolvedGroundWindow(route, project.terrain.resolutionM) },
          options: { targetShare: targetPercent / 100, maxSpurs, haulExit },
        }),
        { signal: controller.signal, onProgress: progress },
        'Spur suggestion cancelled.',
      )
      setRun({ ...current, spurs, adopted: [] })
      w.setNotice(
        spurs.spurs.length
          ? `${spurs.spurs.length} spur candidate${spurs.spurs.length === 1 ? '' : 's'}: ${pct(spurs.before.coveredOfSkiddable)} → ${pct(spurs.after.coveredOfSkiddable)} of the skiddable ground within reach. Add the ones you want as roads.`
          : 'No spur was suggested. The list says why.',
      )
    } catch (cause) {
      if (controller.signal.aborted) w.setNotice('Spur suggestion cancelled. Nothing was changed.')
      else w.setError(cause instanceof Error ? cause.message : 'Could not suggest spurs.')
    } finally {
      abort.current = null
      w.setBusy('')
    }
  }

  const adopt = (spurId: string) => {
    const spur = current?.spurs?.spurs.find((s) => s.id === spurId)
    if (!current || !spur || !block) return
    if (project.alignments.filter((a) => a.id !== project.designPlaceholderId).length >= MAX_ROADS) {
      w.setError(`A project holds at most ${MAX_ROADS} roads. Delete one first.`)
      return
    }
    try {
      const fitted = roadFromRoute(spur.coordinates, source, project.context, project.settings.minRadius)
      const road: Alignment = {
        id: crypto.randomUUID(),
        name: `${block.name} spur ${spur.index}`.slice(0, 200),
        color: SPUR_COLOR,
        points: fitted.points.map((point) => ({
          id: crypto.randomUUID(),
          coordinate: point.coordinate,
          radiusM: point.radiusM,
        })),
        vertical: [],
        template: { ...w.alignment.template },
        overrides: [],
      }
      const next = parseProject(withAddedAlignments(project, [road]))
      w.commit(next)
      // Parsing rebuilds the context list; carry it so the run reads as roads changed, not as stale,
      // and the other spurs stay on the list to add.
      setRun({ ...current, context: next.context, adopted: [...current.adopted, spur.id] })
      w.setNotice(
        `Added ${road.name}, ${metres(spur.lengthM)} from ${spur.parentName}. Its landing is not designed: check the junction, grade and crossings, and run skid reach again.`,
      )
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not add the spur.')
    }
  }

  const pickExit = () => {
    if (!onPickOnPlan) return
    if (picking) {
      setPicking(false)
      onPickOnPlan(null)
      return
    }
    setPicking(true)
    onPickOnPlan('Click where loaded trucks leave the area.', (at) => {
      setPicking(false)
      setHaulExit(at)
    })
  }

  const s = current?.result.summary
  const spurs = current?.spurs
  return (
    <RoadSection
      title="Skid reach"
      data-testid="skid-reach-panel"
      summary={s ? `${pct(s.coveredShare)} within reach` : 'Not run'}
      help={
        <>
          How far a ground skidder drags each part of a block to the nearest road or landing, measured along the ground
          over the terrain grid, not in a straight line. Mapped roads and designed roads count as landings.
          <br />
          The default limit is a field rule of thumb, not a standard: 350 m on level ground, falling to 200 m where logs
          are dragged uphill to the road at 30 % (percent, not degrees), and 350 m downhill. Ground steeper than 40 % is
          not ground-skidded and is reported as cable or another system.
          <br />
          Missing terrain is never counted as covered: ground reachable only across it is reported unknown.
        </>
      }
    >
      {!blocks.length ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">Draw or import a harvest block first.</p>
          {p.onDrawBlock && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={p.onDrawBlock}>
              Draw block
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <Field label="Block">
            <RoadSelect
              ariaLabel="Skid reach block"
              value={block?.id ?? ''}
              onValueChange={setBlockId}
              options={blocks.map((b) => ({ value: b.id, label: b.name }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Level reach (m)"
              value={rule.flatReachM}
              min={MIN_SKID_REACH_M}
              max={MAX_SKID_REACH_M}
              step={10}
              onChange={(flatReachM) =>
                setRule((r) => ({ ...r, flatReachM, adverseReachM: Math.min(r.adverseReachM, flatReachM) }))
              }
            />
            <NumberField
              label="Uphill reach (m)"
              value={rule.adverseReachM}
              min={MIN_SKID_REACH_M}
              max={rule.flatReachM}
              step={10}
              onChange={(adverseReachM) => setRule((r) => ({ ...r, adverseReachM }))}
            />
            <NumberField
              label="at uphill grade (%)"
              value={rule.adverseSlopePercent}
              min={1}
              max={200}
              step={1}
              hint="Percent. The field rule's 30 is read as 30 %, about 17°; 30° would be 58 %."
              onChange={(adverseSlopePercent) => setRule((r) => ({ ...r, adverseSlopePercent }))}
            />
            <NumberField
              label="Ground skid limit (%)"
              value={rule.maxGroundSlopePercent}
              min={1}
              max={200}
              step={1}
              hint="Steeper ground is reported as cable or another system."
              onChange={(maxGroundSlopePercent) => setRule((r) => ({ ...r, maxGroundSlopePercent }))}
            />
            <NumberField
              label="Skid outside block (m)"
              value={offBlockM}
              min={0}
              max={MAX_OFF_BLOCK_M}
              step={10}
              hint="How far a skid path may run outside the block to reach a road."
              onChange={setOffBlockM}
            />
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={countMapped} onChange={(e) => setCountMapped(e.target.checked)} />
              Mapped roads count as landings
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={countDesigned} onChange={(e) => setCountDesigned(e.target.checked)} />
              Designed roads count as landings
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={streamsStop} onChange={(e) => setStreamsStop(e.target.checked)} />
              Streams stop skidding
              <InfoTip label="About streams and skidding">
                Off: skid paths cross mapped streams freely. On: no skid path crosses any mapped stream line, whatever
                its size.
              </InfoTip>
            </label>
          </div>
          <Button
            size="sm"
            className="h-8 w-full"
            disabled={!block || !!p.drawing}
            onClick={() => void runReach()}
            data-testid="skid-reach-run"
          >
            {run ? 'Run skid reach again' : 'Run skid reach'}
          </Button>
          {stale && (
            <InlineAlert tone="warning">
              The block, limits, terrain or mapped data changed since the last run.
            </InlineAlert>
          )}
          {roadsChanged && (
            <InlineAlert tone="info">Roads changed since this run. Run again for the current coverage.</InlineAlert>
          )}

          {s && current && (
            <div className="space-y-2" data-testid="skid-reach-results">
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
                <dt className="text-muted-foreground">Within reach</dt>
                <dd>
                  {pct(s.coveredShare)} · {s.coveredHa.toFixed(1)} ha
                </dd>
                <dt className="text-muted-foreground">Beyond reach</dt>
                <dd>
                  {pct(s.beyondShare)} · {s.beyondHa.toFixed(1)} ha
                </dd>
                <dt className="text-muted-foreground">Too steep (cable/other)</dt>
                <dd>
                  {pct(s.steepShare)} · {s.steepHa.toFixed(1)} ha
                </dd>
                <dt className="text-muted-foreground">Unknown</dt>
                <dd>
                  {pct(s.unknownShare)} · {s.unknownHa.toFixed(1)} ha
                </dd>
                <dt className="text-muted-foreground">Farthest cell</dt>
                <dd>{s.farthest ? `${metres(s.farthest.skidM)}${s.farthest.covered ? '' : ' (beyond)'}` : '—'}</dd>
              </dl>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showOnPlan} onChange={(e) => setShowOnPlan(e.target.checked)} />
                Show on plan
                <InfoTip label="About the skid reach layer">
                  Outlines: red is beyond reach, purple too steep to skid, grey unknown. Orange lines are spur
                  candidates; blue rectangles are landing candidates.
                </InfoTip>
              </label>

              <div className="space-y-1.5 border-t pt-2">
                <div className="flex items-center gap-1 font-medium">
                  Spurs
                  <InfoTip label="About spur suggestions">
                    Closest uncovered ground first: each spur is routed from the nearest road by the route search, with
                    its grade limit, exclusions and crossing prices, and cut back to the shortest length that keeps its
                    coverage. It ends at its landing. With a haul exit or a known haul direction it joins swept back, so
                    a loaded truck turns 90° or less onto the parent road. Unreviewed streams block every crossing.
                    Adapted from LANDIS-II Forest Roads (Apache-2.0).
                  </InfoTip>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Target (%)"
                    value={targetPercent}
                    min={1}
                    max={100}
                    step={1}
                    hint="Of the block's known ground-skiddable area."
                    onChange={setTargetPercent}
                  />
                  <NumberField
                    label="Most spurs"
                    value={maxSpurs}
                    min={1}
                    max={MAX_SKID_SPURS}
                    step={1}
                    onChange={(value) => setMaxSpurs(Math.round(value))}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={picking ? 'default' : 'outline'}
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={!onPickOnPlan}
                    aria-pressed={picking}
                    onClick={pickExit}
                  >
                    <Crosshair className="size-3" />
                    {haulExit ? 'Haul exit set' : 'Pick haul exit'}
                  </Button>
                  {haulExit && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setHaulExit(null)}>
                      Clear
                    </Button>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full"
                  onClick={() => void suggest()}
                  data-testid="skid-reach-suggest"
                >
                  Suggest spurs
                </Button>
                {spurs && (
                  <ul className="space-y-1" data-testid="skid-spur-list">
                    {spurs.spurs.map((spur) => {
                      const added = current.adopted.includes(spur.id)
                      return (
                        <li key={spur.id} className="flex items-start gap-1 rounded-md border px-2 py-1.5">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">
                              Spur {spur.index} · {metres(spur.lengthM)}
                            </span>
                            <span className="block text-2xs text-muted-foreground tabular-nums">
                              +{spur.gainHa.toFixed(1)} ha ({spur.gainPoints.toFixed(1)} pts) · {spur.crossings}{' '}
                              crossing
                              {spur.crossings === 1 ? '' : 's'} · from {spur.parentName}
                              {spur.loadedTurnDeg !== null ? ` · loaded turn ${Math.round(spur.loadedTurnDeg)}°` : ''}
                            </span>
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 gap-1 px-2 text-xs"
                            disabled={added}
                            onClick={() => adopt(spur.id)}
                            aria-label={`Add spur ${spur.index} as a road`}
                          >
                            {added ? (
                              'Added'
                            ) : (
                              <>
                                <Plus className="size-3" />
                                Add
                              </>
                            )}
                          </Button>
                        </li>
                      )
                    })}
                    <li className="text-2xs text-muted-foreground">
                      {spurs.stopped === 'already-met'
                        ? 'The block already meets the target.'
                        : spurs.stopped === 'target-met'
                          ? `Meets the target: ${pct(spurs.after.coveredOfSkiddable)} of the skiddable ground.`
                          : spurs.stopped === 'spur-budget'
                            ? `Stopped at ${maxSpurs} spurs with ${pct(spurs.after.coveredOfSkiddable)} of the skiddable ground covered.`
                            : `No further spur found; ${pct(spurs.after.coveredOfSkiddable)} of the skiddable ground covered.`}
                    </li>
                    {spurs.skipped.map((skip, i) => (
                      <li key={i} className="text-2xs text-muted-foreground">
                        {skip.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1.5 border-t pt-2">
                <div className="flex items-center gap-1 font-medium">
                  Landing sites
                  <InfoTip label="About the landing screen">
                    Footprints beside the roads and at their ends whose mean ground slope is within the limit, flattest
                    first. A candidate is not designed: nothing is levelled and no turnaround is added.
                  </InfoTip>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <NumberField
                    label="Max slope (%)"
                    value={landing.maxMeanSlopePercent}
                    min={0.5}
                    max={50}
                    step={0.5}
                    onChange={(maxMeanSlopePercent) => setLanding((l) => ({ ...l, maxMeanSlopePercent }))}
                  />
                  <NumberField
                    label="Width (m)"
                    value={landing.widthM}
                    min={5}
                    max={200}
                    step={5}
                    onChange={(widthM) => setLanding((l) => ({ ...l, widthM }))}
                  />
                  <NumberField
                    label="Length (m)"
                    value={landing.lengthM}
                    min={5}
                    max={200}
                    step={5}
                    onChange={(lengthM) => setLanding((l) => ({ ...l, lengthM }))}
                  />
                </div>
                {!landings ? (
                  <p className="text-muted-foreground">Enter a valid landing size and slope.</p>
                ) : landings.candidates.length ? (
                  <ol className="space-y-0.5 tabular-nums" data-testid="skid-landing-list">
                    {landings.candidates.map((c) => (
                      <li key={c.id}>
                        {c.rank}. {c.meanSlopePercent.toFixed(1)} % mean, {c.maxSlopePercent.toFixed(0)} % max ·{' '}
                        {c.placement === 'road-end' ? 'road end' : 'beside road'} · {c.roadName}
                        {c.insideBlock ? '' : ' · outside block'}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-muted-foreground">No footprint near the block is flat enough.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </RoadSection>
  )
}
