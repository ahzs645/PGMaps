import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ScanSearch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import { runCooperatively } from './cooperative'
import { parseProject } from './project'
import {
  findRoadsOnTerrainSteps,
  insidePolygon,
  offersCandidate,
  reconnectBatch,
  ROAD_BATCH_MAX_ROADS,
  ROAD_BATCH_MAX_TOTAL_M,
  ROAD_BATCH_MIN_INSIDE,
  selectBatchRoads,
  type BatchFindProgress,
  type BatchRoad,
  type BatchRow,
} from './roadBatchFind'
import type { XY } from './roadGrid'
import { ROAD_FIND_MAX_CELL_M, ROAD_FIND_SAMPLE_CELL_M, roadFindingTerrainProblem } from './roadLikeness'
import { ROAD_RECONNECT_TOLERANCE_LIMITS, ROAD_RECONNECT_TOLERANCE_M, ROAD_RECORD_NODE_M } from './roadReconnect'
import type { RoadFindResult } from './roadRelocation'
import { DEFAULT_ROAD_FIND_SETTINGS, parseRoadFindSettings } from './roadState'
import { RoadSection } from './SidebarParts'
import { exportGrid } from './terrain'
import { relocationOrigin, roadLineFeature } from './terrainRoadLines'
import type { ContextFeature, Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { useVegetationEvidence } from './vegetationEvidenceStore'

const CANDIDATE_COLOR = '#7c3aed'
const WARNING_COLOR = '#d97706'
const TERRAIN_AREA = 'terrain'
const PHASES: Record<NonNullable<BatchFindProgress['step']>['phase'], string> = {
  terrain: 'reading terrain',
  likeness: 'scoring road-likeness',
  search: 'following the road',
  slices: 'measuring the bench',
}
const STATUS: Record<RoadFindResult['status'], string> = {
  found: 'Found',
  partial: 'In part',
  'not-found': 'Not found',
  'incomplete-terrain': 'Terrain gap',
  'too-coarse': 'Too coarse',
  refused: 'Not searched',
}

const isMappedLine = (f: ContextFeature) =>
  f.kind === 'existing-road' &&
  f.geometry.type === 'LineString' &&
  f.geometry.coordinates.length >= 2 &&
  f.roadEvidence?.lineOrigin?.method !== 'terrain-relocation'

const batchRoad = (f: ContextFeature, toGrid: (c: Coordinate) => [number, number]): BatchRoad => ({
  id: f.id,
  name: f.name,
  line: (f.geometry.coordinates as Coordinate[]).map((c) => toGrid(c) as XY),
})

/**
 * "Find roads on terrain" for many mapped roads at once: every mapped road in a project area (or
 * on the loaded terrain) is searched as Find on terrain searches one, then the found roads are
 * reconnected where their records met. Adopting adds new existing roads; the records are never
 * changed, and a state class is shown as LiDAR evidence only.
 */
export function RoadBatchFinder({
  workspace: w,
  onPreview,
}: {
  workspace: RoadWorkspace
  onPreview?: (overlay: GeoJSON.FeatureCollection | null) => void
}) {
  const { project, source } = w
  const problem = roadFindingTerrainProblem(project.terrain.resolutionM)
  const kept = useVegetationEvidence(project.terrain.sha256)
  const evidence = kept && 'evidence' in kept ? kept.evidence : null
  const [areaId, setAreaId] = useState(TERRAIN_AREA)
  const [toleranceM, setToleranceM] = useState(ROAD_RECONNECT_TOLERANCE_M)
  const mapped = useMemo(() => project.context.filter(isMappedLine), [project.context])
  const areas = useMemo(
    () => project.context.filter((f) => f.geometry.type === 'Polygon' && f.kind !== 'existing-road'),
    [project.context],
  )
  const area = areas.find((f) => f.id === areaId) ?? null
  // One projection for the whole run: the terrain's own, or the UTM zone of the first road.
  const firstPoint = mapped[0]?.geometry.coordinates[0] as Coordinate | undefined
  const grid = useMemo(
    () => (firstPoint ? exportGrid(project.terrain, firstPoint) : null),
    [project.terrain, firstPoint],
  )
  const selection = useMemo(() => {
    if (!grid || problem) return null
    const rings = area
      ? (area.geometry as GeoJSON.Polygon).coordinates.map((r) => r.map((c) => grid.toGrid(c as Coordinate) as XY))
      : null
    return selectBatchRoads(
      mapped.map((f) => batchRoad(f, grid.toGrid)),
      (p) => !rings || insidePolygon(rings, p),
      (p) => {
        const [lng, lat] = grid.toLonLat(p)
        return Number.isFinite(source.elevationAt(lng, lat))
      },
    )
  }, [grid, problem, area, mapped, source])
  const runKey = `${project.terrain.name}|${evidence ? 'veg' : ''}|${selection?.chosen.map((r) => `${r.id}:${r.line.length}:${r.line[0].join()}`).join(';') ?? ''}`
  const [run, setRun] = useState<{ key: string; rows: BatchRow[]; toLonLat: (xy: XY) => Coordinate } | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<BatchFindProgress | null>(null)
  const abort = useRef<AbortController | null>(null)
  const current = run?.key === runKey ? run : null
  const fixed = useMemo(
    () =>
      grid && current
        ? mapped.filter((f) => !current.rows.some((r) => r.id === f.id)).map((f) => batchRoad(f, grid.toGrid))
        : [],
    [grid, current, mapped],
  )
  const network = useMemo(
    () => (current ? reconnectBatch(current.rows, chosen, toleranceM, fixed) : null),
    [current, chosen, toleranceM, fixed],
  )
  const preview = useRef(onPreview)
  preview.current = onPreview
  useEffect(() => {
    if (!current || !network) {
      preview.current?.(null)
      return
    }
    const toLonLat = current.toLonLat
    const features: GeoJSON.Feature[] = []
    for (const row of current.rows) {
      const line = network.lines[row.id]
      if (!line) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line.map(toLonLat) },
        properties: { kind: 'terrain-road-candidate', color: CANDIDATE_COLOR, label: `${row.name} on terrain` },
      })
    }
    for (const j of network.junctions)
      if (j.status !== 'joined')
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: toLonLat(j.at ?? j.recordAt) },
          properties: {
            color: WARNING_COLOR,
            label: j.status === 'partial' ? 'Junction in part' : 'Junction not rebuilt',
          },
        })
    preview.current?.({ type: 'FeatureCollection', features })
  }, [current, network])
  useEffect(() => () => preview.current?.(null), [])
  useEffect(() => () => abort.current?.abort(), [runKey])

  const find = async () => {
    if (!selection?.chosen.length || !grid) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    try {
      const rows = await runCooperatively(
        findRoadsOnTerrainSteps({
          roads: selection.chosen,
          ground: { terrain: source, toLonLat: grid.toLonLat, cellM: ROAD_FIND_SAMPLE_CELL_M },
          terrainCellM: project.terrain.resolutionM,
          evidence,
          water: [],
          settings: parseRoadFindSettings(DEFAULT_ROAD_FIND_SETTINGS),
        }),
        { signal: controller.signal, onProgress: setProgress },
      )
      if (controller.signal.aborted) return
      setRun({ key: runKey, rows, toLonLat: grid.toLonLat })
      setChosen(new Set(rows.filter((r) => offersCandidate(r.result)).map((r) => r.id)))
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
    w.setNotice('Road search cancelled. No road was changed.')
  }
  const adoptable =
    current?.rows.filter((r) => chosen.has(r.id) && offersCandidate(r.result) && network?.lines[r.id]) ?? []
  const adopt = () => {
    if (!current || !network || !adoptable.length) return
    try {
      const features = adoptable.map((row) =>
        roadLineFeature({
          id: crypto.randomUUID(),
          name: `${row.name} · on terrain`,
          coordinates: network.lines[row.id].map(current.toLonLat),
          origin: {
            ...relocationOrigin(row.result!, row.name, project.terrain.resolutionM),
            reconnectedEnds: network.movedEnds[row.id] ?? 0,
          },
        }),
      )
      w.update((p) => parseProject({ ...p, context: [...p.context, ...features] }))
      setRun(null)
      w.setNotice(
        `Added ${features.length} road${features.length === 1 ? '' : 's'} found on the terrain as existing roads. The records are unchanged.`,
      )
    } catch (cause) {
      w.setError(cause instanceof Error ? cause.message : 'Could not add the found roads.')
    }
  }
  const toggle = (id: string, on: boolean) =>
    setChosen((previous) => {
      const next = new Set(previous)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const warnings = network?.junctions.filter((j) => j.status !== 'joined') ?? []
  const joined = network?.junctions.filter((j) => j.status === 'joined').length ?? 0
  const roadName = (id: string) =>
    current?.rows.find((r) => r.id === id)?.name ?? mapped.find((f) => f.id === id)?.name ?? id
  const count = selection?.chosen.length ?? 0
  return (
    <RoadSection
      title="Find roads on terrain"
      summary={problem ? 'needs fine terrain' : `${count} road${count === 1 ? '' : 's'}`}
      help={
        <>
          Searches each mapped road in the area as Find on terrain does for one, with the default search settings and no
          water mask, then joins the found roads again where their records met. Junctions the record does not have are
          never made. Every result is a candidate copy: adopting adds new existing roads and the records are not
          changed. Needs bare-earth terrain of {ROAD_FIND_MAX_CELL_M} m or finer.
        </>
      }
      data-testid="road-batch-finder"
    >
      <div className="space-y-2">
        {problem ? (
          <InlineAlert tone="info">{problem}</InlineAlert>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Area">
                <RoadSelect
                  ariaLabel="Area to search"
                  className={roadFieldClass}
                  value={area ? area.id : TERRAIN_AREA}
                  onValueChange={setAreaId}
                >
                  <option value={TERRAIN_AREA}>Loaded terrain</option>
                  {areas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </RoadSelect>
              </Field>
              <NumberField
                label="Reconnect within (m)"
                value={toleranceM}
                min={ROAD_RECONNECT_TOLERANCE_LIMITS[0]}
                max={ROAD_RECONNECT_TOLERANCE_LIMITS[1]}
                step={1}
                hint="The furthest a found road's end may move to meet the roads its record meets. Past it the junction is left as found and listed."
                onChange={setToleranceM}
              />
            </div>
            <p className="text-2xs text-muted-foreground" data-testid="road-batch-selection">
              {count
                ? `${count} mapped road${count === 1 ? '' : 's'} with at least ${Math.round(ROAD_BATCH_MIN_INSIDE * 100)}% of ${count === 1 ? 'its' : 'their'} length ${area ? 'in the area and ' : ''}on the terrain.`
                : `No mapped road has ${Math.round(ROAD_BATCH_MIN_INSIDE * 100)}% of its length ${area ? 'in the area and ' : ''}on the terrain.`}
              {selection?.overCap.length
                ? ` ${selection.overCap.length} more left out: one run takes at most ${ROAD_BATCH_MAX_ROADS} roads and ${ROAD_BATCH_MAX_TOTAL_M / 1000} km.`
                : ''}
            </p>
            {progress ? (
              <div className="flex items-center gap-2 text-xs" role="status">
                <span className="min-w-0 flex-1 truncate">
                  Road {progress.road} of {progress.roads} · {progress.name}
                  {progress.step ? ` · ${PHASES[progress.step.phase]}` : ''}…
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
                disabled={!count}
                onClick={() => void find()}
              >
                <ScanSearch className="size-3" />{' '}
                {current ? 'Search again' : `Find ${count} road${count === 1 ? '' : 's'} on terrain`}
              </Button>
            )}
          </>
        )}
        {current && network && (
          <>
            <div className="max-h-64 overflow-auto overscroll-none rounded border">
              <EngineeringTable rowHeaders compact data-testid="road-batch-table">
                <thead className="sticky top-0">
                  <tr>
                    <ColumnHeader label="Road" className="text-left" />
                    <ColumnHeader label="Result" unit="found · ends joined" className="text-left" />
                    <ColumnHeader label="Shift" unit="median m" />
                    <ColumnHeader label="State" unit="LiDAR" />
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((row) => {
                    const r = row.result
                    const offered = offersCandidate(r)
                    return (
                      <tr key={row.id} aria-selected={chosen.has(row.id) && offered}>
                        <th scope="row">
                          <label className="flex items-start gap-1">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              aria-label={`Adopt ${row.name}`}
                              checked={chosen.has(row.id) && offered}
                              disabled={!offered}
                              onChange={(event) => toggle(row.id, event.target.checked)}
                            />
                            <span>{row.name}</span>
                          </label>
                        </th>
                        <td className="text-left" title={row.error ?? r?.reason}>
                          <span className="block">{r ? STATUS[r.status] : 'Failed'}</span>
                          <span className="block text-3xs text-muted-foreground">
                            {r && offered ? `${Math.round(r.foundShare * 100)}%` : '–'}
                            {network.lines[row.id] ? ` · ${network.movedEnds[row.id] ?? 0} joined` : ''}
                          </span>
                        </td>
                        <td>{r?.shiftM ? r.shiftM.p50.toFixed(1) : '–'}</td>
                        <td
                          title={r?.state ? `Score ${r.state.score.toFixed(1)}; evidence, not condition` : r?.stateNote}
                        >
                          {r?.state ? r.state.stateClass : '–'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </EngineeringTable>
            </div>
            {current.rows.some((r) => r.error) && (
              <InlineAlert tone="warning">
                {current.rows
                  .filter((r) => r.error)
                  .map((r) => r.error)
                  .join(' ')}
              </InlineAlert>
            )}
            <div className="space-y-1 text-2xs" data-testid="road-batch-junctions">
              <p className="flex items-center gap-1 font-medium">
                Junctions: {joined} rebuilt{warnings.length ? `, ${warnings.length} to check` : ''}
                <InfoTip label="About reconnecting the found roads">
                  Only junctions in the record are rebuilt: record ends within {ROAD_RECORD_NODE_M} m of each other, or
                  on another road&apos;s line. The two roads closest to straight are the through road; the others are
                  brought to cross it. No end moves more than {toleranceM} m. A road not chosen keeps its record line
                  and never moves. Ends that come close to a road the record does not join them to are listed, never
                  joined.
                </InfoTip>
              </p>
              {warnings.length > 0 && (
                <ul className="space-y-0.5 text-warning" aria-label="Junctions to check">
                  {warnings.slice(0, 8).map((j, i) => (
                    <li key={i}>{j.message}</li>
                  ))}
                  {warnings.length > 8 && <li className="text-muted-foreground">and {warnings.length - 8} more</li>}
                </ul>
              )}
              {network.nearMisses.length > 0 && (
                <ul
                  className="space-y-0.5 text-muted-foreground"
                  aria-label="Ends near a road the record does not join"
                >
                  {network.nearMisses.slice(0, 6).map((n, i) => (
                    <li key={i}>
                      {roadName(n.end.roadId)} ends {n.distanceM.toFixed(1)} m from {roadName(n.nearRoadId)}; the record
                      does not join them, so neither does this.
                    </li>
                  ))}
                  {network.nearMisses.length > 6 && <li>and {network.nearMisses.length - 6} more</li>}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 px-1"
                disabled={!adoptable.length}
                title="Add the chosen found roads as new existing roads; the records are kept"
                onClick={adopt}
              >
                <Check className="size-3" /> Adopt {adoptable.length}
              </Button>
              <Button size="sm" variant="ghost" className="gap-1 px-1" onClick={() => setRun(null)}>
                <X className="size-3" /> Discard
              </Button>
            </div>
          </>
        )}
      </div>
    </RoadSection>
  )
}
