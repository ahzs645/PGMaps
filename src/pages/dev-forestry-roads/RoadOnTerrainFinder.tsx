import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ScanSearch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { formatRoadStation } from './Charts'
import { runCooperatively } from './cooperative'
import { parseProject } from './project'
import type { XY } from './roadGrid'
import { ROAD_FIND_MAX_CELL_M, ROAD_FIND_SAMPLE_CELL_M, roadFindingTerrainProblem } from './roadLikeness'
import {
  findRoadOnTerrainSteps,
  ROAD_FIND_CORRIDOR_M,
  type RoadFindProgress,
  type RoadFindResult,
} from './roadRelocation'
import { exportGrid } from './terrain'
import { relocationOrigin, roadLineFeature } from './terrainRoadLines'
import type { Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

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
const m = (value: number) => `${value.toFixed(1)} m`

/**
 * "Find on terrain" for a mapped road: searches the bare-earth terrain for the road bench near the
 * record and offers the result as a candidate copy. Adopting it adds a new existing road; the
 * record and the loaded road are never changed.
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
  const lineKey = useMemo(
    () => `${alignment.id}|${project.terrain.name}|${alignment.points.map((p) => p.coordinate.join()).join(';')}`,
    [alignment, project.terrain.name],
  )
  const [result, setResult] = useState<{ key: string; result: RoadFindResult; line: Coordinate[] } | null>(null)
  const [progress, setProgress] = useState<RoadFindProgress | null>(null)
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
    try {
      const found = await runCooperatively(
        findRoadOnTerrainSteps({
          line: points.map((c) => grid.toGrid(c) as XY),
          ground: { terrain: source, toLonLat: grid.toLonLat, cellM: ROAD_FIND_SAMPLE_CELL_M },
          terrainCellM: project.terrain.resolutionM,
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

  const r = current?.result
  const kept = r?.ranges.filter((range) => range.kind !== 'found') ?? []
  const offerable = r && (r.status === 'found' || r.status === 'partial')
  return (
    <div className="space-y-2 border-t pt-2" data-testid="road-on-terrain">
      <div className="flex items-center gap-1">
        <p className="text-xs font-semibold">Find on terrain</p>
        <InfoTip label="About finding a road on the terrain">
          Searches within {ROAD_FIND_CORRIDOR_M} m of this line for the most road-like ground: gentle, smooth, and
          bounded by the breaks of slope at cut and fill batters. Cross-sections every 10 m then check for a bench. The
          result is a candidate copy: where no bench is found it keeps the record&apos;s line and says so. Width is the
          bench between batter breaks, not the drivable width. Needs bare-earth terrain of {ROAD_FIND_MAX_CELL_M} m or
          finer; flat ground, ditches, cutlines and pipelines can read as road, so check the result on imagery.
        </InfoTip>
      </div>
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
        <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => void find()}>
          <ScanSearch className="size-3" /> {current ? 'Search again' : 'Find on terrain'}
        </Button>
      )}
      {r && (
        <>
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
              r.slices?.widthM
                ? {
                    key: 'width',
                    label: 'Bench width',
                    value: `${m(r.slices.widthM.p50)} (P10–P90 ${r.slices.widthM.p10.toFixed(1)}–${r.slices.widthM.p90.toFixed(1)})`,
                  }
                : null,
              r.slices
                ? {
                    key: 'shoulders',
                    label: 'Both batters',
                    value: `${Math.round(r.slices.bothShoulderShare * 100)}% of sections`,
                  }
                : null,
              r.likenessAlong
                ? { key: 'likeness', label: 'Road-likeness', value: r.likenessAlong.mean.toFixed(2) }
                : null,
            ]}
          />
          <p className="text-xs text-muted-foreground">{r.reason}</p>
          {offerable && kept.length > 0 && (
            <ul className="space-y-0.5 text-xs" aria-label="Stretches kept as the record">
              {kept.slice(0, 6).map((range) => (
                <li key={range.from}>
                  <button
                    type="button"
                    className="tabular-nums underline decoration-dotted underline-offset-2"
                    onClick={() => onStation(range.from)}
                  >
                    {formatRoadStation(range.from)}–{formatRoadStation(range.to)} ·{' '}
                    {range.kind === 'no-terrain' ? 'no terrain' : 'no bench'}, kept as mapped
                  </button>
                </li>
              ))}
              {kept.length > 6 && <li className="text-muted-foreground">and {kept.length - 6} more</li>}
            </ul>
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
