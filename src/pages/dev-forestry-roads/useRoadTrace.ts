/**
 * The Trace road draw mode's working state: the road between each pair of clicks, traced on the
 * terrain in the background (`roadTrace.ts`) as clicks arrive, and the overlay that shows which
 * segments followed a road bench and which were joined straight.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { runCooperatively, runToCompletion } from './cooperative'
import { roadFindingTerrainProblem, ROAD_FIND_SAMPLE_CELL_M } from './roadLikeness'
import { joinTrace, traceSegmentOnTerrainSteps, type TraceSegment } from './roadTrace'
import { exportGrid } from './terrain'
import type { Coordinate, RoadLineOrigin, RoadProject, TerrainSource } from './types'

export const TRACE_SNAPPED_COLOR = '#0d9488'
export const TRACE_STRAIGHT_COLOR = '#d97706'

const keyOf = (a: Coordinate, b: Coordinate) => `${a[0]},${a[1]}|${b[0]},${b[1]}`

export interface RoadTraceState {
  /** Why the terrain cannot be traced on (too coarse), or null. */
  problem: string | null
  /** Segments traced so far, in click order; null while one is still running. */
  segments: (TraceSegment | null)[]
  pending: number
  overlay: GeoJSON.Feature[]
  /** The traced line in lon/lat, finishing any segment still running; and its origin record. */
  resolve: () => { coordinates: Coordinate[]; origin: RoadLineOrigin }
}

export function useRoadTrace({
  active,
  clicks,
  source,
  terrain,
}: {
  active: boolean
  clicks: Coordinate[]
  source: TerrainSource
  terrain: RoadProject['terrain']
}): RoadTraceState {
  const problem = roadFindingTerrainProblem(terrain.resolutionM)
  const anchor = clicks[0]
  // One projection per trace, fixed by its first click, so every segment shares a grid.
  const grid = useMemo(() => (anchor ? exportGrid(terrain, anchor) : null), [terrain, anchor])
  const cache = useRef(new Map<string, TraceSegment>())
  const [version, setVersion] = useState(0)
  useEffect(() => {
    cache.current = new Map()
    setVersion((v) => v + 1)
  }, [grid, source, active])
  const sampler = useMemo(
    () => (grid ? { terrain: source, toLonLat: grid.toLonLat, cellM: ROAD_FIND_SAMPLE_CELL_M } : null),
    [grid, source],
  )
  const pairs = useMemo(() => clicks.slice(1).map((to, i) => [clicks[i], to] as const), [clicks])
  const traceOne = (a: Coordinate, b: Coordinate) =>
    traceSegmentOnTerrainSteps(sampler!, terrain.resolutionM, grid!.toGrid(a), grid!.toGrid(b))
  useEffect(() => {
    if (!active || !sampler || !grid) return
    const missing = pairs.filter(([a, b]) => !cache.current.has(keyOf(a, b)))
    if (!missing.length) return
    const controller = new AbortController()
    void (async () => {
      for (const [a, b] of missing) {
        if (controller.signal.aborted) return
        try {
          const segment = await runCooperatively(traceOne(a, b), { signal: controller.signal })
          cache.current.set(keyOf(a, b), segment)
          setVersion((v) => v + 1)
        } catch {
          return
        }
      }
    })()
    return () => controller.abort()
    // traceOne reads sampler/grid/terrain, which are dependencies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pairs, sampler, grid, terrain.resolutionM])
  // The cache is read through `version`, which changes whenever a segment lands in it.
  const segments = useMemo(
    () => pairs.map(([a, b]) => cache.current.get(keyOf(a, b)) ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pairs, version],
  )
  const overlay = useMemo<GeoJSON.Feature[]>(
    () =>
      grid
        ? segments.flatMap((segment, i) =>
            segment
              ? [
                  {
                    type: 'Feature' as const,
                    geometry: { type: 'LineString' as const, coordinates: segment.path.map((p) => grid.toLonLat(p)) },
                    properties: {
                      kind: 'road-trace',
                      color: segment.status === 'snapped' ? TRACE_SNAPPED_COLOR : TRACE_STRAIGHT_COLOR,
                      selected: segment.status === 'snapped',
                      label: `Segment ${i + 1}: ${segment.status === 'snapped' ? 'on the road bench' : 'straight'}`,
                    },
                  },
                ]
              : [],
          )
        : [],
    [segments, grid],
  )
  const resolve = () => {
    if (!grid || clicks.length < 2) throw Error('Click at least two points along the road.')
    const all = pairs.map(([a, b]) => cache.current.get(keyOf(a, b)) ?? runToCompletion(traceOne(a, b)))
    const { line, snapped } = joinTrace(all)
    return {
      coordinates: line.map((p) => grid.toLonLat(p)),
      origin: {
        method: problem ? ('clicks' as const) : ('terrain-trace' as const),
        createdAt: new Date().toISOString(),
        ...(problem ? {} : { terrainCellM: Number(terrain.resolutionM.toFixed(2)) }),
        segments: all.length,
        snappedSegments: snapped,
      },
    }
  }
  return { problem, segments, pending: segments.filter((s) => !s).length, overlay, resolve }
}
