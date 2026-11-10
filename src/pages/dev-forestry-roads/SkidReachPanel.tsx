import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import type { SidebarProps } from './DesignSidebarBody'
import { runCooperatively } from './cooperative'
import { ExtractionReachFields } from './ExtractionReachFields'
import { ExtractionReachResults } from './ExtractionReachResults'
import { CableCoverageResults } from './CableCoverageResults'
import { cableLineFeatures, type CableCoverageResult } from './cableCoverage'
import { runCableCoverage } from './cableCoverageRun'
import { screenCoverLines } from './cableLayout/cableLayoutClient'
import { DEFAULT_CABLE_SELECTION, selectCableLines, type CableSelectionRule } from './cableLineSelection'
import {
  asSkidReachResult,
  compareExtraction,
  comparisonMapFeatures,
  DEFAULT_EXTRACTION_SETTINGS,
  extractionMapFeatures,
  extractionOnGrid,
  extractionSpurModel,
  parseClassBounds,
  prepareExtractionGrid,
  type ExtractionArea,
  type ExtractionComparison,
  type ExtractionGrid,
  type ExtractionResult,
  type ExtractionSettings,
} from './extractionReach'
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
import { localFrame } from './junctionTurn'
import { loopTurnaroundFit, turningTemplate } from './turningTemplate'
import { roadFromRoute } from './routeFit'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import {
  DEFAULT_OFF_BLOCK_M,
  DEFAULT_SKID_CELL_M,
  skidRoadsFromProject,
  type SkidProgress,
  type SkidRoad,
} from './skidReach'
import { DEFAULT_SPUR_OPTIONS, MAX_SKID_SPURS, suggestSpursSteps, type SpurSuggestion } from './skidSpurs'
import { localMetricGrid } from './terrain'
import type { Alignment, ContextFeature, Coordinate } from './types'

const MAX_ROADS = 20
const SPUR_COLOR = '#ea580c'
const MACHINE_NAMES = { skidder: 'Skidder', forwarder: 'Forwarder', cable: 'Cable yarder' } as const
const pct = (share: number) => `${(100 * share).toFixed(share > 0 && share < 0.01 ? 1 : 0)}%`
const metres = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`)

/** Roads listed for a trail/truck choice: those within this distance of the block. */
const ROAD_USE_RADIUS_M = 1000
const MAX_ROAD_USE_ROWS = 30
const AREA_TREATMENTS = [
  { value: 'ignore', label: 'Not used' },
  { value: 'no-machines', label: 'No machines' },
  { value: 'no-extraction', label: 'No extraction' },
]

interface SkidRun {
  key: string
  source: unknown
  context: unknown
  /** The geometry of the roads the run counted, so only a change to them reads as "roads changed". */
  roadsFingerprint: string
  result: ExtractionResult
  comparison: ExtractionComparison | null
  spurs: SpurSuggestion | null
  adopted: string[]
  /** The cable yarder's lines, when the run was for one. */
  cable: CableCoverageResult | null
}

/**
 * Extraction reach: how a skidder or forwarder brings each part of a block to a truck road, the
 * share within reach and by how far, spurs that would bring the rest in, and flat places for
 * landings. Everything here is a candidate: a spur becomes a road only when it is added.
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
  const [settings, setSettings] = useState<ExtractionSettings>(DEFAULT_EXTRACTION_SETTINGS)
  const [classText, setClassText] = useState(DEFAULT_EXTRACTION_SETTINGS.classBoundsM.join(';'))
  const [offBlockM, setOffBlockM] = useState(DEFAULT_OFF_BLOCK_M)
  const [cellM, setCellM] = useState(DEFAULT_SKID_CELL_M)
  const [trails, setTrails] = useState<Record<string, true>>({})
  const [areaUse, setAreaUse] = useState<Record<string, ExtractionArea['treatment']>>({})
  const [compare, setCompare] = useState(false)
  const [countMapped, setCountMapped] = useState(true)
  const [countDesigned, setCountDesigned] = useState(true)
  const [streamsStop, setStreamsStop] = useState(false)
  const [landing, setLanding] = useState<LandingScreenOptions>(DEFAULT_LANDING_OPTIONS)
  const [targetPercent, setTargetPercent] = useState(DEFAULT_SPUR_OPTIONS.targetShare * 100)
  const [maxSpurs, setMaxSpurs] = useState(DEFAULT_SPUR_OPTIONS.maxSpurs)
  const [haulExit, setHaulExit] = useState<Coordinate | null>(null)
  const [picking, setPicking] = useState(false)
  const [showOnPlan, setShowOnPlan] = useState(true)
  const [lineRule, setLineRule] = useState<CableSelectionRule>(DEFAULT_CABLE_SELECTION)
  const [run, setRun] = useState<SkidRun | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const classParse = useMemo(() => {
    try {
      return { bounds: parseClassBounds(classText), error: '' }
    } catch (cause) {
      return { bounds: null, error: cause instanceof Error ? cause.message : 'Check the distance classes.' }
    }
  }, [classText])
  const closedAreas = useMemo(
    () => project.context.filter((feature) => feature.kind === 'avoid' && feature.geometry.type === 'Polygon'),
    [project.context],
  )
  const roadsFor = (include: { mapped: boolean; designed: boolean }): SkidRoad[] =>
    skidRoadsFromProject(
      project,
      new Map([...w.analyses].map(([id, analysis]) => [id, analysis.centerline])),
      include,
    ).map((road) => (trails[road.id] ? { ...road, use: 'track' as const } : road))
  // Roads near the block, for the trail/truck choice.
  const nearbyRoads = useMemo(() => {
    if (!block) return []
    const ring = (block.geometry as GeoJSON.Polygon).coordinates[0]
    const projection = localMetricGrid([ring[0][0], ring[0][1]])
    const xy = ring.map((c) => projection.toGrid([c[0], c[1]]))
    const minX = Math.min(...xy.map((p) => p[0])),
      maxX = Math.max(...xy.map((p) => p[0])),
      minY = Math.min(...xy.map((p) => p[1])),
      maxY = Math.max(...xy.map((p) => p[1]))
    return skidRoadsFromProject(project, new Map(), { mapped: countMapped, designed: countDesigned })
      .map((road) => {
        let near = Infinity
        for (const c of road.coordinates) {
          const [x, y] = projection.toGrid(c)
          near = Math.min(near, Math.hypot(Math.max(minX - x, 0, x - maxX), Math.max(minY - y, 0, y - maxY)))
        }
        return { road, near }
      })
      .filter((entry) => entry.near <= ROAD_USE_RADIUS_M)
      .sort((a, b) => a.near - b.near)
      .slice(0, MAX_ROAD_USE_ROWS)
      .map((entry) => entry.road)
  }, [block, project, countMapped, countDesigned])

  // What the run's roads were, by id, use and centreline: an edit elsewhere on an alignment (its
  // search settings, a label) leaves this unchanged and must not say the roads changed.
  const roadsFingerprint = useMemo(
    () =>
      JSON.stringify(
        skidRoadsFromProject(project, new Map([...w.analyses].map(([id, analysis]) => [id, analysis.centerline])), {
          mapped: countMapped,
          designed: countDesigned,
        }).map((road) => [
          road.id,
          trails[road.id] ? 'track' : '',
          road.coordinates.map((c) => [Math.round(c[0] * 1e7), Math.round(c[1] * 1e7)]),
        ]),
      ),
    [project, w.analyses, trails, countMapped, countDesigned],
  )

  const key = JSON.stringify([
    block?.geometry,
    settings,
    classText,
    offBlockM,
    cellM,
    trails,
    areaUse,
    compare,
    countMapped,
    countDesigned,
    streamsStop,
  ])
  const stale = !!run && (run.key !== key || run.source !== source || run.context !== project.context)
  const current = run && !stale ? run : null
  const roadsChanged = !!current && current.roadsFingerprint !== roadsFingerprint

  // Suggested cable lines: a fast greedy pass, so it follows its settings without a new run.
  const cableSelection = useMemo(() => {
    if (!current?.cable) return null
    try {
      const eg = current.result.grid
      return selectCableLines(eg, current.cable.landings, current.cable.lines, eg.settings.cable.lateralM, lineRule)
    } catch {
      return null
    }
  }, [current, lineRule])

  // The landing screen is cheap, so it follows its inputs without a new run.
  const landings = useMemo((): LandingScreen | null => {
    if (!current) return null
    const sg = current.result.grid.sg
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
  // Whether a loaded truck can loop round on each candidate: the candidate's road's design vehicle,
  // else the active road's, at its steering lock.
  const turnarounds = useMemo(() => {
    const fits = new Map<string, string>()
    for (const c of landings?.candidates ?? []) {
      const road =
        project.alignments.find((a) => a.id === c.roadId) ??
        project.alignments.find((a) => a.id === project.activeAlignmentId)
      const check =
        road?.vehicleCheck ?? project.alignments.find((a) => a.id === project.activeAlignmentId)?.vehicleCheck
      if (!check || check.vehicle.steeringLockDeg === undefined) continue
      try {
        const frame = localFrame(c.centre)
        const fit = loopTurnaroundFit(turningTemplate(check.vehicle, { clearanceM: check.clearanceM }), [
          [c.footprint.map(frame.toLocal)],
        ])
        fits.set(
          c.id,
          fit.fits
            ? ` · ${check.vehicle.name}: loop turnaround fits`
            : ` · ${check.vehicle.name}: loop turnaround does not fit (${fit.shortM.toFixed(1)} m short in radius)`,
        )
      } catch {
        /* A vehicle that cannot settle at its lock gets no turnaround note. */
      }
    }
    return fits
  }, [landings, project.alignments, project.activeAlignmentId])

  const { onPreviewSkidReach, onPickOnPlan } = p
  const features = useMemo(() => {
    if (!current || !showOnPlan) return null
    const chosen = new Set(cableSelection?.ids ?? [])
    return [
      ...(current.comparison
        ? comparisonMapFeatures(current.result, current.comparison)
        : extractionMapFeatures(current.result)),
      ...(current.cable
        ? cableLineFeatures(
            current.result.grid,
            current.cable.lines.filter((line) => chosen.has(line.id)),
          )
        : []),
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
  }, [current, landings, showOnPlan, cableSelection])
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
    w.setBusyCancel({ label: 'Cancel', title: 'Extraction reach', onCancel: () => controller.abort() })
    return controller
  }
  const progress = ({ phase, done, total }: { phase: string; done: number; total: number }) =>
    w.setBusyProgress({ step: Math.min(done, total), total: Math.max(1, total), text: phase })

  const runReach = async () => {
    if (!block || abort.current || w.busy) return
    if (!classParse.bounds) {
      w.setError(classParse.error)
      return
    }
    const controller = start('Reading extraction reach…')
    try {
      const ring = (block.geometry as GeoJSON.Polygon).coordinates[0]
      const projection = localMetricGrid([ring[0][0], ring[0][1]])
      const roads = roadsFor({ mapped: countMapped, designed: countDesigned })
      const barriers = streamsStop
        ? project.context
            .filter((f) => f.kind === 'stream' && f.geometry.type === 'LineString')
            .map((f) => (f.geometry as GeoJSON.LineString).coordinates.map((c) => [c[0], c[1]] as Coordinate))
        : []
      const areas: ExtractionArea[] = closedAreas
        .filter((area) => areaUse[area.id])
        .map((area) => ({ polygon: area.geometry as GeoJSON.Polygon, treatment: areaUse[area.id] }))
      const withDesigned = compare && countDesigned && roads.some((road) => road.kind === 'design')
      type Prepared = { eg: ExtractionGrid; after: ExtractionResult | null; before: ExtractionResult | null }
      const steps = function* (): Generator<SkidProgress, Prepared> {
        const eg = yield* prepareExtractionGrid({
          block: block.geometry as GeoJSON.Polygon,
          roads,
          barriers,
          ground: ground(),
          toGrid: projection.toGrid,
          toLonLat: projection.toLonLat,
          settings: { ...settings, classBoundsM: classParse.bounds! },
          areas,
          offBlockM,
          cellM,
        })
        if (eg.settings.machine === 'cable') return { eg, after: null, before: null }
        const after = yield* extractionOnGrid(eg)
        const before = withDesigned ? yield* extractionOnGrid(eg, (road) => road.kind !== 'design') : null
        return { eg, after, before }
      }
      const prepared = await runCooperatively(
        steps(),
        { signal: controller.signal, onProgress: progress },
        'Extraction reach cancelled.',
      )
      // The cable yarder's lines are tested in the cable-layout worker; Cancel terminates it.
      const cable =
        prepared.eg.settings.machine === 'cable'
          ? await runCableCoverage(
              { eg: prepared.eg, terrain: source, compare: withDesigned, barriersStop: streamsStop },
              (batches, onProgress, signal) =>
                screenCoverLines(batches, { signal, onProgress: (done, lines) => onProgress(done, lines) }),
              { signal: controller.signal, onProgress: progress },
            )
          : null
      const after = cable ? cable.after : prepared.after!
      const before = cable ? cable.before : prepared.before
      setRun({
        key,
        source,
        context: project.context,
        roadsFingerprint,
        result: after,
        comparison: before ? compareExtraction(before, after) : null,
        spurs: null,
        adopted: [],
        cable: cable?.coverage ?? null,
      })
      const s = after.summary
      w.setNotice(
        `${block.name}: ${pct(s.coveredShare)} of ${s.blockHa.toFixed(1)} ha within ${MACHINE_NAMES[settings.machine].toLowerCase()} reach of ${roads.length} road${roads.length === 1 ? '' : 's'}, read on a ${s.cellM.toFixed(0)} m grid.${cable ? ` ${cable.coverage.lines.length} of ${cable.coverage.stats.candidates} lines work.` : ''}${compare && !before ? ' No designed road to compare.' : ''}`,
      )
    } catch (cause) {
      if (controller.signal.aborted) w.setNotice('Extraction reach cancelled. Nothing was changed.')
      else w.setError(cause instanceof Error ? cause.message : 'Could not read extraction reach.')
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
        suggestSpursSteps(asSkidReachResult(current.result), {
          terrain: source,
          ground: ground(),
          settings: project.settings,
          context: project.context,
          routeOptions: { ...route, groundWindowM: resolvedGroundWindow(route, project.terrain.resolutionM) },
          options: { targetShare: targetPercent / 100, maxSpurs, haulExit },
          model: extractionSpurModel(current.result),
        }),
        { signal: controller.signal, onProgress: progress },
        'Spur suggestion cancelled.',
      )
      setRun({ ...current, spurs, adopted: [] })
      w.setNotice(
        spurs.spurs.length
          ? `${spurs.spurs.length} spur candidate${spurs.spurs.length === 1 ? '' : 's'}: ${pct(spurs.before.coveredOfSkiddable)} → ${pct(spurs.after.coveredOfSkiddable)} of the extractable ground within reach. Add the ones you want as roads.`
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
        `Added ${road.name}, ${metres(spur.lengthM)} from ${spur.parentName}. Its landing is not designed: check the junction, grade and crossings, and run extraction reach again.`,
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
      title="Extraction reach"
      data-testid="skid-reach-panel"
      summary={s ? `${MACHINE_NAMES[s.machine]} · ${pct(s.coveredShare)} within reach` : 'Not run'}
      help={
        <>
          How a skidder, forwarder or cable yarder brings each part of a block to a truck road: driving over the ground,
          winching along straight lines, forwarding in straight runs, loading with its crane, or yarding along skylines
          from landings on the road. Distances follow the ground over the terrain grid. Mapped and designed roads are
          truck roads unless marked as skid trails.
          <br />
          The skidder&apos;s default reach is a field rule of thumb, not a standard: 350 m on level ground, falling to
          200 m where logs are dragged uphill to the road at 30 % (percent, not degrees). It does not drive on ground
          steeper than 40 % but can winch logs off it. Winching and forwarder rules follow Sylvaccess (INRAE).
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
              ariaLabel="Extraction reach block"
              value={block?.id ?? ''}
              onValueChange={setBlockId}
              options={blocks.map((b) => ({ value: b.id, label: b.name }))}
            />
          </Field>
          <ExtractionReachFields
            settings={settings}
            onSettings={setSettings}
            offBlockM={offBlockM}
            onOffBlockM={setOffBlockM}
            cellM={cellM}
            onCellM={setCellM}
            classText={classText}
            onClassText={setClassText}
            classError={classParse.error}
          />
          <div className="space-y-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={countMapped} onChange={(e) => setCountMapped(e.target.checked)} />
              Mapped roads count
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={countDesigned} onChange={(e) => setCountDesigned(e.target.checked)} />
              Designed roads count
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={streamsStop} onChange={(e) => setStreamsStop(e.target.checked)} />
              Streams stop extraction
              <InfoTip label="About streams and extraction">
                Off: machines and winch lines cross mapped streams freely. On: no ground path or winch line crosses any
                mapped stream line, whatever its size.
              </InfoTip>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              Compare with mapped roads only
              <InfoTip label="About the before and after comparison">
                Runs the block twice, without and with the designed roads, and shows the ground they bring within reach
                and how much they shorten extraction.
              </InfoTip>
            </label>
          </div>
          {settings.machine === 'cable' && (
            <p className="text-2xs text-muted-foreground">
              Cable lines start from truck roads; skid trails are not used.
            </p>
          )}
          <RoadSection
            title="Skid trails"
            summary={`${Object.keys(trails).filter((id) => nearbyRoads.some((r) => r.id === id)).length} of ${nearbyRoads.length} roads`}
            help="A skid trail carries machines, not trucks: logs are dragged or forwarded along it to a truck road. A trail that joins no truck road is left out and named."
          >
            {nearbyRoads.length ? (
              <ul className="space-y-1" data-testid="extraction-trails">
                {nearbyRoads.map((road) => (
                  <li key={road.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!trails[road.id]}
                        onChange={(e) =>
                          setTrails((t) => {
                            const next = { ...t }
                            if (e.target.checked) next[road.id] = true
                            else delete next[road.id]
                            return next
                          })
                        }
                      />
                      <span className="min-w-0 truncate">{road.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                No counted road within {ROAD_USE_RADIUS_M / 1000} km of the block.
              </p>
            )}
          </RoadSection>
          <RoadSection
            title="Closed areas"
            summary={`${Object.keys(areaUse).filter((id) => closedAreas.some((a) => a.id === id)).length} of ${closedAreas.length} used`}
            help="Exclusion areas are used only when you say how. No machines: no driving, but winch lines may cross. No extraction: neither."
          >
            {closedAreas.length ? (
              <ul className="space-y-1" data-testid="extraction-areas">
                {closedAreas.map((area) => (
                  <li key={area.id} className="grid grid-cols-[1fr_9rem] items-center gap-2">
                    <span className="min-w-0 truncate">{area.name}</span>
                    <RoadSelect
                      ariaLabel={`${area.name} for extraction`}
                      value={areaUse[area.id] ?? 'ignore'}
                      onValueChange={(value) =>
                        setAreaUse((u) => {
                          const next = { ...u }
                          if (value === 'ignore') delete next[area.id]
                          else next[area.id] = value as ExtractionArea['treatment']
                          return next
                        })
                      }
                      options={AREA_TREATMENTS}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">The project has no exclusion areas.</p>
            )}
          </RoadSection>
          <Button
            size="sm"
            className="h-8 w-full"
            disabled={!block || !!p.drawing}
            onClick={() => void runReach()}
            data-testid="skid-reach-run"
          >
            {run ? 'Run extraction reach again' : 'Run extraction reach'}
          </Button>
          {stale && (
            <InlineAlert tone="warning">
              The block, machine, limits, terrain or mapped data changed since the last run.
            </InlineAlert>
          )}
          {roadsChanged && (
            <InlineAlert tone="info">Roads changed since this run. Run again for the current coverage.</InlineAlert>
          )}

          {s && current && (
            <div className="space-y-2" data-testid="skid-reach-results">
              <ExtractionReachResults summary={s} comparison={current.comparison} />
              {current.cable && (
                <CableCoverageResults
                  coverage={current.cable}
                  selection={cableSelection}
                  rule={lineRule}
                  onRule={setLineRule}
                  roadName={(landing) => {
                    const sg = current.result.grid.sg
                    return sg.roads[current.cable!.landings[landing].roadIndex]?.road.name ?? ''
                  }}
                />
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showOnPlan} onChange={(e) => setShowOnPlan(e.target.checked)} />
                Show on plan
                <InfoTip label="About the extraction reach layer">
                  Fill: ground within reach, coloured by distance class (or, with the comparison on, green where newly
                  within reach and teal where shortened). Outlines: blue winched, red beyond reach, purple too steep for
                  the machine, dark purple too steep to fell, slate no extraction, grey unknown. Orange lines are spur
                  candidates; cyan rectangles are landing candidates. Dark cyan lines are suggested skylines, with their
                  supports as dots.
                </InfoTip>
              </label>

              {current.cable ? (
                <p className="border-t pt-2 text-2xs text-muted-foreground">
                  Spur suggestions read ground-based reach: run the skidder or forwarder for them.
                </p>
              ) : (
                <div className="space-y-1.5 border-t pt-2">
                  <div className="flex items-center gap-1 font-medium">
                    Spurs
                    <InfoTip label="About spur suggestions">
                      Closest uncovered ground first: each spur is routed from the nearest road by the route search,
                      with its grade limit, exclusions and crossing prices, and cut back to the shortest length that
                      keeps its coverage. It ends at its landing. With a haul exit or a known haul direction it joins
                      swept back, so a loaded truck turns 90° or less onto the parent road. Unreviewed streams block
                      every crossing. Coverage is judged by the extraction reach above. Adapted from LANDIS-II Forest
                      Roads (Apache-2.0).
                    </InfoTip>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Target (%)"
                      value={targetPercent}
                      min={1}
                      max={100}
                      step={1}
                      hint="Of the block's known extractable area: less unknown, too-steep and closed ground."
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
                            ? `Meets the target: ${pct(spurs.after.coveredOfSkiddable)} of the extractable ground.`
                            : spurs.stopped === 'spur-budget'
                              ? `Stopped at ${maxSpurs} spurs with ${pct(spurs.after.coveredOfSkiddable)} of the extractable ground covered.`
                              : `No further spur found; ${pct(spurs.after.coveredOfSkiddable)} of the extractable ground covered.`}
                      </li>
                      {spurs.skipped.map((skip, i) => (
                        <li key={i} className="text-2xs text-muted-foreground">
                          {skip.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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
                        {turnarounds.get(c.id) ?? ''}
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
