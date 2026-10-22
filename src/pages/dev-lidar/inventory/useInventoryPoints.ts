import { useEffect, useMemo, useState } from 'react'
import type { TreeCrop } from '../treeIsolation'
import type { InventoryData, InventoryTree } from './types'
import { containsTree } from './geometry'
import type { InventoryPolygon } from './geometry'
const assets = import.meta.glob('./points/*.json', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>
export interface CorePoints {
  source_sha256: string
  run_id: string
  chunk: string
  points: number[][]
}
const cache = new Map<string, Promise<CorePoints>>()
async function loadCore(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) })
  if (!response.ok) throw Error(`Original core points unavailable (${response.status})`)
  const packed = await response.json()
  if (packed.encoding !== 'gzip-base64') throw Error('Unsupported core point encoding')
  const bytes = Uint8Array.from(atob(packed.data), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const core = (await new Response(stream).json()) as CorePoints
  if (
    !Array.isArray(core.points) ||
    core.points.length > 2000000 ||
    !core.points.every(
      (p) => Array.isArray(p) && p.length === 11 && p.every(Number.isFinite) && Number.isInteger(p[4]) && p[4] >= 0,
    )
  )
    throw Error('Invalid original core point data')
  return core
}
export function useInventoryPoints(data: InventoryData, tree: InventoryTree | null) {
  const [core, setCore] = useState<CorePoints | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  const chunk = tree?.properties.chunk
  useEffect(() => {
    if (!chunk) return
    let active = true
    const url = assets[`./points/${chunk}.json`]
    if (!url) {
      queueMicrotask(() => {
        if (active) setError('No cached point core for this area')
      })
      return () => {
        active = false
      }
    }
    if (!cache.has(url) || attempt) {
      if (cache.size > 3) cache.clear()
      cache.set(
        url,
        loadCore(url).catch((e) => {
          cache.delete(url)
          throw e
        }),
      )
    }
    cache
      .get(url)!
      .then((next) => {
        if (next.source_sha256 !== data.source_sha256 || next.run_id !== data.run_id || next.chunk !== chunk)
          throw Error('Cached points belong to a different inventory run')
        if (active) {
          setCore(next)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [chunk, data.source_sha256, data.run_id, attempt])
  const current = core && core.chunk === chunk && core.run_id === data.run_id ? core : null
  const crop = useMemo<TreeCrop | null>(() => {
    if (!current || !tree) return null
    const p = tree.properties,
      col =
        p.method === 'sat'
          ? 5
          : p.method === 'forainet'
            ? 6
            : p.method === 'fora-fixed'
              ? 9
              : p.method === 'fora-variable'
                ? 10
                : -1
    const rows = current.points.filter((q) =>
      col >= 0
        ? q[col] === p.label
        : q[3] >= 2 && containsTree(tree.geometry.type === 'Point' ? null : (tree as InventoryPolygon), q[0], q[1]),
    )
    if (!rows.length) return null
    return {
      id: p.id,
      centre: [p.lon, p.lat],
      ground_m: p.ground_m,
      source_sha256: data.source_sha256,
      loaded_points: rows.length,
      loaded_nodes: 1,
      available_nodes: 1,
      budget_limited: false,
      withheld_filtered: false,
      points: rows.map((q) => ({
        lon: q[0],
        lat: q[1],
        z: q[2],
        height: q[3],
        index: q[4],
        node: 'original-laz-row',
        classification: -1,
      })),
    }
  }, [current, tree, data.source_sha256])
  return {
    core: current,
    crop,
    error,
    retry: () => {
      setError('')
      setAttempt((n) => n + 1)
    },
  }
}
export function returnMetrics(core: CorePoints, polygon: InventoryPolygon | null) {
  const points = core.points.filter((p) => containsTree(polygon, p[0], p[1]))
  const heights = points
    .map((p) => p[3])
    .filter((h) => h > 0.5 && Number.isFinite(h))
    .sort((a, b) => a - b)
  if (!points.length || !heights.length) return null
  const quantile = (p: number) => heights[Math.min(heights.length - 1, Math.floor((heights.length * p) / 100))]
  const mean = heights.reduce((s, h) => s + h, 0) / heights.length,
    sd = Math.sqrt(heights.reduce((s, h) => s + (h - mean) ** 2, 0) / Math.max(1, heights.length - 1))
  return {
    returns: points.length,
    vegetation_returns: heights.length,
    mean,
    sd,
    cv: (sd / mean) * 100,
    percentiles: [5, 10, 25, 50, 75, 90, 95, 99].map((p) => ({ percentile: p, height: quantile(p) })),
    density: [10, 30, 50, 70, 90].map((p) => ({
      percentile: p,
      fraction: points.filter((q) => q[3] > quantile(p)).length / points.length,
    })),
    cover13: points.filter((q) => q[3] > 1.3).length / points.length,
    histogram: Array.from({ length: 8 }, (_, i) => ({
      lower: i * 5,
      upper: (i + 1) * 5,
      count: points.filter((p) => p[3] >= i * 5 && (i === 7 || p[3] < (i + 1) * 5)).length,
    })),
  }
}
