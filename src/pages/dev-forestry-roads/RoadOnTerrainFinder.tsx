import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ClipboardCheck, ScanSearch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { formatRoadStation } from './Charts'
import { Field, NumberField, roadFieldClass } from './Controls'
import { runCooperatively } from './cooperative'
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import { parseProject } from './project'
import { lidarStateFinding, roadConditionDate, type RoadConditionObservation } from './roadCondition'
import type { XY } from './roadGrid'
import { ROAD_FIND_MAX_CELL_M, ROAD_FIND_SAMPLE_CELL_M, roadFindingTerrainProblem } from './roadLikeness'
import {
  findRoadOnTerrainSteps,
  ROAD_FIND_BRIDGE_M,
  type RoadFindProgress,
  type RoadFindResult,
} from './roadRelocation'
import {
  changedRoadFindSettings,
  DEFAULT_ROAD_FIND_SETTINGS,
  parseRoadFindSettings,
  ROAD_FIND_SETTING_LIMITS,
  ROAD_STATE_CLASS_LABELS,
  type RoadFindSettings,
  type ThresholdPair,
} from './roadState'
import { RoadSection } from './SidebarParts'
import { exportGrid } from './terrain'
import { relocationOrigin, roadLineFeature } from './terrainRoadLines'
import type { Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { describeVegetationEvidence } from './vegetationEvidence'
import { useVegetationEvidence } from './vegetationEvidenceStore'

const CANDIDATE_COLOR = '#7c3aed'
const PHASES: Record<RoadFindProgress['phase'], string> = {
  terrain: 'Reading terrain',
  likeness: 'Scoring road-likeness',
  search: 'Following the road',
  slices: 'Measuring the bench',
}
const STATUS: Record<RoadFindResult['status'], string> = {
  found: 'Road found',
  partial: 'Found in part',
  'not-found': 'No road found',
  'incomplete-terrain': 'Terrain incomplete',
  'too-coarse': 'Terrain too coarse',
  refused: 'Not searched',
}
const KEPT: Record<Exclude<RoadFindResult['ranges'][number]['kind'], 'found'>, string> = {
  'no-terrain': 'no terrain',
  'not-found': 'no bench',
  'presumed-structure': 'water crossing, presumed structure',
}
const m = (value: number) => `${value.toFixed(1)} m`
const pct = (value: number) => `${Math.round(value)}%`

/**
 * "Find on terrain" for a mapped road: searches the bare-earth terrain (and, when this session
 * imported its point cloud, the vegetation evidence) for the road bench near the record and offers
 * the result as a candidate copy. Adopting it adds a new existing road; the record and the loaded
 * road are never changed. A LiDAR state class is offered as a dated observation for the record's
 * condition evidence, never as its condition.
 */
export function RoadOnTerrainFinder({
  workspace: w,
  onPreview,
  onStation,
}: {
  workspace: RoadWorkspace
  onPreview?: (overlay: GeoJSON.FeatureCollection | null) => void
  onStation: (chainage: number) => void
}) {
  const { alignment, project, source } = w
  const problem = roadFindingTerrainProblem(project.terrain.resolutionM)
  const kept = useVegetationEvidence(project.terrain.sha256)
  const evidence = kept && 'evidence' in kept ? kept.evidence : null
  const [settings, setSettings] = useState<RoadFindSettings>(DEFAULT_ROAD_FIND_SETTINGS)
  const [waterIds, setWaterIds] = useState<string[]>([])
  const polygons = useMemo(
    () => project.context.filter((f) => f.geometry.type === 'Polygon' && f.kind !== 'existing-road'),
    [project.context],
  )
  let settingsError = ''
  try {
    parseRoadFindSettings(settings)
  } catch (cause) {
    settingsError = cause instanceof Error ? cause.message : 'Invalid road search settings.'
  }
  const lineKey = useMemo(
    () =>
      `${alignment.id}|${project.terrain.name}|${alignment.points.map((p) => p.coordinate.join()).join(';')}|${evidence ? 'veg' : ''}|${JSON.stringify(settings)}|${waterIds.join()}`,
    [alignment, project.terrain.name, evidence, settings, waterIds],
  )
  const [result, setResult] = useState<{ key: string; result: RoadFindResult; line: Coordinate[] } | null>(null)
  const [progress, setProgress] = useState<RoadFindProgress | null>(null)
  const [acquired, setAcquired] = useState(() => project.terrain.raster?.acquired ?? '')
  const [reviewer, setReviewer] = useState('')
  const abort = useRef<AbortController | null>(null)
  const current = result?.key === lineKey ? result : null
  const preview = useRef(onPreview)
  preview.current = onPreview
  const shown = current && (current.result.status === 'found' || current.result.status === 'partial') ? current : null
  useEffect(() => {
    preview.current?.(
      shown
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: shown.line },
                properties: {
                  kind: 'terrain-road-candidate',
                  color: CANDIDATE_COLOR,
                  selected: true,
                  label: 'Found on terrain',
                },
              },
            ],
          }
        : null,
    )
  }, [shown])
  useEffect(() => () => preview.current?.(null), [])
  useEffect(() => () => abort.current?.abort(), [lineKey])

  const find = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const points = alignment.points.map((p) => p.coordinate)
    const grid = exportGrid(project.terrain, points[0])
    const water = polygons
      .filter((f) => waterIds.includes(f.id))
      .map((f) =>
        (f.geometry as GeoJSON.Polygon).coordinates.map((ring) => ring.map((c) => grid.toGrid(c as Coordinate) as XY)),
      )
    try {
      const found = await runCooperatively(
        findRoadOnTerrainSteps({
          line: points.map((c) => grid.toGrid(c) as XY),
          ground: { terrain: source, toLonLat: grid.toLonLat, cellM: ROAD_FIND_SAMPLE_CELL_M },
          terrainCellM: project.terrain.resolutionM,
          evidence,
          water,
          settings: parseRoadFindSettings(settings),
        }),
        { signal: controller.signal, onProgress: setProgress },
      )
      if (controller.signal.aborted) return
      setResult({ key: lineKey, result: found, line: found.candidate.map((p) => grid.toLonLat(p)) })
    } catch (cause) {
      if (!controller.signal.aborted)
        w.setError(cause instanceof Error ? cause.message : 'Could not search the terrain.')
    } finally {
      if (abort.current === controller) {
        abort.current = null
        setProgress(null)
      }
    }
  }
  const cancel = () => {
    abort.current?.abort()
    abort.current = null
    setProgress(null)
  }
  const adopt = () => {
    if (!current) return
    const origin = alignment.mappedRoad
    const name = `${origin?.roadName ?? alignment.name} · on terrain`
    try {
      const feature = roadLineFeature({
        id: crypto.randomUUID(),
        name,
        coordinates: current.line,
        origin: relocationOrigin(current.result, origin?.roadName ?? alignment.name, project.terrain.resolutionM),
      })
      w.update((p) => parseProject({ ...p, context: [...p.context, feature] }))
      setResult(null)
      w.setNotice(
        `Added ${name} as an existing road. The record and this loaded road are unchanged; pick the new road as the road to connect to.`,
      )
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not add the found road.')
    }
  }
  const recordIds = (alignment.mappedRoad?.contextIds ?? []).filter((id) =>
    project.context.some((f) => f.id === id && f.kind === 'existing-road'),
  )
  const record = () => {
    const r = current?.result
    const state = r?.state
    if (!r || !state) return
    try {
      const observedAt = roadConditionDate(acquired, 'LiDAR acquisition date')
      const changed = changedRoadFindSettings(r.settings)
      const notes =
        `Find on terrain, scored with ${r.mode === 'terrain+vegetation' ? 'terrain + vegetation' : 'terrain only'}: ` +
        `state class ${state.stateClass}, score ${state.score.toFixed(1)} (vegetation over the bed ${state.input.vegetationPercent.toFixed(1)}%, ` +
        `drivable width ${state.input.drivableWidthM.toFixed(1)} m, path conductivity ${state.input.conductivity.toFixed(2)}, ` +
        `shoulders ${state.input.shoulderPercent.toFixed(0)}%), over the found ${Math.round(r.foundShare * 100)}% of the record. ` +
        `${r.modeNote} Settings: ${changed.length ? changed.join(', ') : 'defaults'}. Date is the LiDAR acquisition date as entered.`
      const observation: RoadConditionObservation = {
        id: `lidar-${crypto.randomUUID()}`,
        source: 'lidar',
        component: 'surface',
        observedAt,
        sourceUrl: '',
        notes: notes.slice(0, 2000),
        finding: lidarStateFinding(state.stateClass),
        lidar: {
          stateClass: state.stateClass,
          score: state.score,
          vegetationPercent: state.input.vegetationPercent,
          drivableWidthM: state.input.drivableWidthM,
          conductivity: state.input.conductivity,
          shoulderPercent: state.input.shoulderPercent,
          foundPercent: Math.round(r.foundShare * 100),
          terrainName: project.terrain.name.slice(0, 300),
        },
        ...(reviewer.trim()
          ? { review: { reviewer: reviewer.trim().slice(0, 200), reviewedAt: new Date().toISOString().slice(0, 10) } }
          : {}),
      }
      w.update((p) =>
        parseProject({
          ...p,
          context: p.context.map((f) =>
            recordIds.includes(f.id)
              ? {
                  ...f,
                  roadEvidence: {
                    ...(f.roadEvidence ?? unreviewedRoadEvidence('user')),
                    observations: [
                      ...(f.roadEvidence?.observations ?? []),
                      { ...observation, id: `lidar-${crypto.randomUUID()}` },
                    ],
                  },
                }
              : f,
          ),
        }),
      )
      w.setNotice(
        `Recorded a LiDAR observation dated ${observedAt} (class ${state.stateClass}) on ${alignment.mappedRoad?.roadName ?? alignment.name}. ` +
          'It counts towards the condition estimate only once reviewed and within a LiDAR age window set under Existing roads & reuse; the planning condition is unchanged.',
      )
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not record the LiDAR observation.')
    }
  }

  const r = current?.result
  const keptRanges = r?.ranges.filter((range) => range.kind !== 'found') ?? []
  const offerable = r && (r.status === 'found' || r.status === 'partial')
  const s = r?.slices
  const setPair = (key: keyof RoadFindSettings['state'], index: 0 | 1, value: number) =>
    setSettings((previous) => {
      const pair = [...previous.state[key]] as ThresholdPair
      pair[index] = value
      return { ...previous, state: { ...previous.state, [key]: pair } }
    })
  const lim = ROAD_FIND_SETTING_LIMITS
  return (
    <div className="space-y-2 border-t pt-2" data-testid="road-on-terrain">
      <div className="flex items-center gap-1">
        <p className="text-xs font-semibold">Find on terrain</p>
        <InfoTip label="About finding a road on the terrain">
          Searches within {settings.corridorM} m of this line for the most road-like ground: gentle, smooth, and bounded
          by the breaks of slope at cut and fill batters. Cross-sections every 10 m then check for a bench. The result
          is a candidate copy: where no bench is found it keeps the record&apos;s line and says so. With the point
          cloud&apos;s vegetation evidence (kept when this session imported it) the search also reads canopy, brush,
          ground returns and intensity, and the sections measure the drivable width and grade the road&apos;s state.
          Needs bare-earth terrain of {ROAD_FIND_MAX_CELL_M} m or finer; flat ground, ditches, cutlines and pipelines
          can read as road, so check the result on imagery.
        </InfoTip>
      </div>
      <p className="text-2xs text-muted-foreground" data-testid="road-find-mode">
        {evidence
          ? `Point cloud: ${describeVegetationEvidence(evidence.info)}.`
          : kept && 'refused' in kept
            ? `Terrain only: vegetation evidence was not kept (${kept.refused})`
            : 'Terrain only: import the point cloud this session to use its vegetation evidence.'}
      </p>
      <RoadSection
        title="Search settings"
        summary={`Corridor ${settings.corridorM} m · pull ${settings.confidence} · edge ${settings.flatToleranceM} m`}
        help="Change these only with a reason; the defaults follow the method's published values. Every value used is saved with an adopted road and a recorded observation."
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Corridor (m)"
            value={settings.corridorM}
            min={lim.corridorM[0]}
            max={lim.corridorM[1]}
            step={5}
            hint="How far either side of the record the road may be. Wider finds a badly placed record but admits parallel road-like strips."
            onChange={(corridorM) => setSettings((p) => ({ ...p, corridorM }))}
          />
          <NumberField
            label="Pull to record"
            value={settings.confidence}
            min={lim.confidence[0]}
            max={lim.confidence[1]}
            step={0.05}
            hint="The score falls to 1 − this at the corridor edge. 0.1 only breaks ties between parallel candidates."
            onChange={(confidence) => setSettings((p) => ({ ...p, confidence }))}
          />
          <NumberField
            label="Level edge (m)"
            value={settings.flatToleranceM}
            min={lim.flatToleranceM[0]}
            max={lim.flatToleranceM[1]}
            step={0.01}
            hint="On a side with no batter, the road edge is where the ground departs this far from the bed. Lower reads a narrower road on flat ground."
            onChange={(flatToleranceM) => setSettings((p) => ({ ...p, flatToleranceM }))}
          />
          <NumberField
            label="Ground spread (m)"
            value={settings.maxGroundSdM}
            min={lim.maxGroundSdM[0]}
            max={lim.maxGroundSdM[1]}
            step={0.01}
            hint="With a point cloud: a side with no batter also ends where ground returns spread more than this."
            onChange={(maxGroundSdM) => setSettings((p) => ({ ...p, maxGroundSdM }))}
          />
          <NumberField
            label="Drivable brush (%)"
            value={Math.round(settings.maxBrushShare * 100)}
            min={lim.maxBrushShare[0] * 100}
            max={lim.maxBrushShare[1] * 100}
            step={1}
            hint="With a point cloud: the drivable bed ends where returns 0.5–5 m up exceed this share of those below 5 m."
            onChange={(value) => setSettings((p) => ({ ...p, maxBrushShare: value / 100 }))}
          />
        </div>
        <p className="text-2xs font-medium">State thresholds</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [
                'vegetationPercent',
                'Vegetation (%)',
                1,
                'Sub-score 1 at or below the first, 0 at or above the second.',
              ],
              [
                'drivableWidthM',
                'Drivable width (m)',
                0.5,
                'Sub-score 0 at or below the first, 1 at or above the second. Use 1–3 where a 4 m road is good locally.',
              ],
              [
                'shoulderPercent',
                'Shoulders (%)',
                5,
                'Sub-score 0 at or below the first, 1 at or above the second. Lower where roads are built without strong ditches.',
              ],
            ] as const
          ).map(([key, label, step, hint]) => (
            <div key={key} className="col-span-2 grid grid-cols-2 gap-2">
              <NumberField
                label={`${label} from`}
                value={settings.state[key][0]}
                min={lim[key][0]}
                max={lim[key][1]}
                step={step}
                hint={hint}
                onChange={(value) => setPair(key, 0, value)}
              />
              <NumberField
                label={`${label} to`}
                value={settings.state[key][1]}
                min={lim[key][0]}
                max={lim[key][1]}
                step={step}
                onChange={(value) => setPair(key, 1, value)}
              />
            </div>
          ))}
        </div>
        <p className="text-2xs text-muted-foreground">
          Path conductivity sub-score: 0 at {settings.state.conductivity[0]}, 1 at {settings.state.conductivity[1]}{' '}
          (fixed).
        </p>
        {polygons.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="flex items-center gap-1 text-2xs font-medium">
              Treat as water
              <InfoTip label="About the water mask">
                Ticked polygons cannot be crossed, except within {ROAD_FIND_BRIDGE_M} m of where the record crosses
                them: a presumed bridge or culvert, kept as the record and never counted as found road. Nothing is
                treated as water unless ticked here.
              </InfoTip>
            </legend>
            {polygons.slice(0, 12).map((f) => (
              <label key={f.id} className="flex items-center gap-1 text-2xs">
                <input
                  type="checkbox"
                  checked={waterIds.includes(f.id)}
                  onChange={(event) =>
                    setWaterIds((ids) => (event.target.checked ? [...ids, f.id] : ids.filter((id) => id !== f.id)))
                  }
                />
                {f.name}
              </label>
            ))}
          </fieldset>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1 text-2xs"
          onClick={() => {
            setSettings(DEFAULT_ROAD_FIND_SETTINGS)
            setWaterIds([])
          }}
        >
          Reset to defaults
        </Button>
      </RoadSection>
      {settingsError && <InlineAlert tone="warning">{settingsError}</InlineAlert>}
      {problem ? (
        <InlineAlert tone="info">{problem}</InlineAlert>
      ) : progress ? (
        <div className="flex items-center gap-2 text-xs" role="status">
          <span className="flex-1">
            {PHASES[progress.phase]}
            {progress.pieces > 1 ? ` · piece ${progress.piece} of ${progress.pieces}` : ''}…
          </span>
          <Button size="sm" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1"
          disabled={!!settingsError}
          onClick={() => void find()}
        >
          <ScanSearch className="size-3" /> {current ? 'Search again' : 'Find on terrain'}
        </Button>
      )}
      {r && (
        <>
          <p className="text-2xs text-muted-foreground" data-testid="road-find-used">
            Used: {r.mode === 'terrain+vegetation' ? 'terrain + vegetation' : 'terrain only'}. {r.modeNote}
            {r.water.polygons
              ? ` Water mask: ${r.water.polygons} polygon${r.water.polygons === 1 ? '' : 's'}, ${r.water.crossings} crossing${r.water.crossings === 1 ? '' : 's'}.`
              : ''}
          </p>
          <KeyValueRows
            variant="grid"
            valueClassName="tabular-nums"
            rows={[
              { key: 'status', label: 'Result', value: STATUS[r.status] },
              offerable
                ? { key: 'found', label: 'Bench found', value: `${Math.round(r.foundShare * 100)}% of the road` }
                : null,
              r.shiftM
                ? { key: 'shift', label: 'Shift', value: `median ${m(r.shiftM.p50)} · P90 ${m(r.shiftM.p90)}` }
                : null,
              offerable && r.endShiftM !== null
                ? { key: 'ends', label: 'End shift', value: `up to ${m(r.endShiftM)}` }
                : null,
              s?.widthM
                ? {
                    key: 'width',
                    label: 'Bench width',
                    value: `${m(s.widthM.p50)} (P10–P90 ${s.widthM.p10.toFixed(1)}–${s.widthM.p90.toFixed(1)})`,
                  }
                : null,
              s?.drivableWidthM
                ? {
                    key: 'drivable',
                    label: 'Drivable width',
                    value: `${m(s.drivableWidthM.p50)} (P10–P90 ${s.drivableWidthM.p10.toFixed(1)}–${s.drivableWidthM.p90.toFixed(1)})`,
                  }
                : null,
              s?.vegetationPercent !== null && s?.vegetationPercent !== undefined
                ? { key: 'vegetation', label: 'Vegetation over bed', value: pct(s.vegetationPercent) }
                : null,
              s
                ? {
                    key: 'shoulders',
                    label: 'Shoulders',
                    value: `${pct(s.shoulderPercent)} found · both in ${pct(s.bothShoulderShare * 100)}`,
                  }
                : null,
              r.likenessAlong
                ? {
                    key: 'likeness',
                    label: 'Road-likeness',
                    value: `${r.likenessAlong.mean.toFixed(2)}${r.conductivity !== null ? ` · path ${r.conductivity.toFixed(2)} harmonic` : ''}`,
                  }
                : null,
              r.sinuosity !== null && offerable
                ? { key: 'sinuosity', label: 'Sinuosity', value: r.sinuosity.toFixed(2) }
                : null,
            ]}
          />
          <p className="text-xs text-muted-foreground">{r.reason}</p>
          {offerable && keptRanges.length > 0 && (
            <ul className="space-y-0.5 text-xs" aria-label="Stretches kept as the record">
              {keptRanges.slice(0, 6).map((range) => (
                <li key={range.from}>
                  <button
                    type="button"
                    className="tabular-nums underline decoration-dotted underline-offset-2"
                    onClick={() => onStation(range.from)}
                  >
                    {formatRoadStation(range.from)}–{formatRoadStation(range.to)} ·{' '}
                    {KEPT[range.kind as keyof typeof KEPT]}, kept as mapped
                  </button>
                </li>
              ))}
              {keptRanges.length > 6 && <li className="text-muted-foreground">and {keptRanges.length - 6} more</li>}
            </ul>
          )}
          {offerable && (
            <div className="space-y-1 rounded border p-2 text-2xs" data-testid="road-state">
              {r.state ? (
                <>
                  <p className="flex items-center gap-1 text-xs font-semibold">
                    State (LiDAR): {ROAD_STATE_CLASS_LABELS[r.state.stateClass]} · score {r.state.score.toFixed(1)}
                    <InfoTip label="About the road state">
                      The mean of four sub-scores, each 0–1: vegetation over the bed, drivable width, path conductivity
                      (the harmonic mean of the search score along the found road) and shoulders found. Class 1 from 75,
                      2 from 50, 3 from 25, 4 below. It describes the bed as the LiDAR saw it on its acquisition date.
                      It is not the road&apos;s condition: record it as evidence and review it there.
                    </InfoTip>
                  </p>
                  <p className="tabular-nums">
                    Vegetation {r.state.subScores.vegetation.toFixed(2)} · drivable{' '}
                    {r.state.subScores.drivableWidth.toFixed(2)}
                    {' · '}conductivity {r.state.subScores.conductivity.toFixed(2)} · shoulders{' '}
                    {r.state.subScores.shoulders.toFixed(2)}
                  </p>
                  {r.stateRanges.length > 1 && (
                    <ul className="space-y-0.5" aria-label="Stretches by state class">
                      {r.stateRanges.slice(0, 8).map((range) => (
                        <li key={range.from}>
                          <button
                            type="button"
                            className="tabular-nums underline decoration-dotted underline-offset-2"
                            onClick={() => onStation(range.from)}
                          >
                            {formatRoadStation(range.from)}–{formatRoadStation(range.to)} · class {range.stateClass}
                          </button>
                        </li>
                      ))}
                      {r.stateRanges.length > 8 && (
                        <li className="text-muted-foreground">and {r.stateRanges.length - 8} more</li>
                      )}
                    </ul>
                  )}
                  {recordIds.length > 0 ? (
                    <div className="grid grid-cols-2 gap-1">
                      <Field label="LiDAR acquired" hint="The acquisition date of the point cloud, not today.">
                        <input
                          type="date"
                          className={roadFieldClass}
                          value={acquired}
                          onChange={(event) => setAcquired(event.target.value)}
                        />
                      </Field>
                      <Field label="Reviewed by (optional)" hint="Leave blank to record it unreviewed.">
                        <input
                          className={roadFieldClass}
                          value={reviewer}
                          maxLength={200}
                          onChange={(event) => setReviewer(event.target.value)}
                        />
                      </Field>
                      <Button
                        size="sm"
                        variant="outline"
                        className="col-span-2 gap-1 px-1"
                        disabled={!acquired}
                        title="Add a dated LiDAR observation to this record's condition evidence; its condition is not changed"
                        onClick={record}
                      >
                        <ClipboardCheck className="size-3" /> Record as LiDAR evidence
                      </Button>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      This road has no existing-road record to attach a LiDAR observation to.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">State: {r.stateNote}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 px-1"
              disabled={!offerable}
              title="Add the found line as a new existing road; the record is kept"
              onClick={adopt}
            >
              <Check className="size-3" /> Adopt
            </Button>
            <Button size="sm" variant="ghost" className="gap-1 px-1" onClick={() => setResult(null)}>
              <X className="size-3" /> Discard
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
