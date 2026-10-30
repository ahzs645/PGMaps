import { useEffect, useMemo, useState } from 'react'
import { useKeyedState } from './useKeyedState'
import treeUrl from './treeIsolation.generated.json?url'
import { readSourceGrid, sourceCell, sourceValue, toMetric } from './sourceGrids'
import { crownCells, type TreeIsolation, type CrownFeature, type TreeCrop } from './treeIsolation'
export { treeUrl }
export function useTreeIsolation(enabled: boolean, base: string, hash: string) {
  const [data, setData] = useState<TreeIsolation | null>(null),
    [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify([base, hash, attempt])
  const [error, setError] = useKeyedState(requestKey, () => '', enabled && !!hash)
  useEffect(() => {
    if (!enabled || !hash) return
    let active = true
    const abort = new AbortController(),
      timeout = setTimeout(() => abort.abort(), 30000)
    Promise.all([
      fetch(treeUrl, { signal: abort.signal }),
      fetch(new URL('checksums.json', base), { signal: abort.signal }),
    ])
      .then(async (responses) => {
        if (responses.some((r) => !r.ok)) throw Error('Crown data unavailable')
        const [next, checksums]: [TreeIsolation, Record<string, { sha256: string }>] = (await Promise.all(
          responses.map((r) => r.json()),
        )) as never
        if (next.schema_version !== 1 || next.source_sha256 !== hash) throw Error('Crown source mismatch')
        for (const [name, digest] of Object.entries(next.input_sha256))
          if (checksums[name]?.sha256 !== digest) throw Error('Crown input mismatch')
        if (active) setData(next)
      })
      .catch((e) => {
        if (active) setError(abort.signal.aborted ? 'Crown request timed out' : String(e))
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timeout)
    }
  }, [enabled, base, hash, attempt, setError])
  return { data, error, retry: () => setAttempt((n) => n + 1) }
}
export async function isolateTreeReturns(
  data: TreeIsolation,
  crown: CrownFeature,
  base: string,
  cloudUrl: string,
  signal: AbortSignal,
  onProgress: (s: string) => void,
): Promise<TreeCrop> {
  const { EptStreamingLoader } = await import('maplibre-gl-lidar')
  const loader = new EptStreamingLoader(cloudUrl, { pointBudget: 750000, maxConcurrentRequests: 3, maxOctreeDepth: 20 })
  const stop = () => loader.destroy()
  signal.addEventListener('abort', stop, { once: true })
  const check = () => {
    if (signal.aborted) throw Error('Tree isolation cancelled')
  }
  try {
    onProgress('Reading original EPT hierarchy and source terrain…')
    check()
    const [info, terrain] = await Promise.all([
      loader.initialize(),
      readSourceGrid(base, 'dtm-1m.tif', data.input_sha256['dtm-1m.tif']),
    ])
    check()
    if (info.totalPoints !== 84608005) throw Error('Original point-cloud dataset mismatch')
    const coords: number[][] = []
    const collect = (v: unknown) => {
      if (!Array.isArray(v)) return
      if (typeof v[0] === 'number') coords.push(v as number[])
      else v.forEach(collect)
    }
    collect(crown.geometry.coordinates)
    const bounds: [number, number, number, number] = [
      Math.min(...coords.map((p) => p[0])) - 0.00002,
      Math.min(...coords.map((p) => p[1])) - 0.00002,
      Math.max(...coords.map((p) => p[0])) + 0.00002,
      Math.max(...coords.map((p) => p[1])) + 0.00002,
    ]
    const viewport = { bounds, center: crown.properties.centre, zoom: 20, pitch: 50, targetDepth: 20 }
    const nodes = await loader.selectNodesForViewport(viewport)
    check()
    let reserved = 0
    const chosen = nodes.filter((node) => {
      if (reserved + node.pointCount > 750000) return false
      reserved += node.pointCount
      return true
    })
    for (const node of chosen) loader.queueNode(node)
    await loader.loadQueuedNodes()
    const until = Date.now() + 30000
    while (loader.isLoading()) {
      check()
      if (Date.now() > until) throw Error('Tree point request timed out; retry or inspect the footprint')
      onProgress(`Loading original returns · ${loader.getLoadedNodeCount()}/${chosen.length} EPT nodes`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    check()
    if (chosen.some((n) => n.state !== 'loaded')) throw Error('One or more original point nodes failed to load')
    const cloud = loader.getLoadedPointCloudData(),
      cells = crownCells(crown, data.grid),
      points: TreeCrop['points'] = []
    const withheld = cloud.extraAttributes?.Withheld ?? cloud.extraAttributes?.withheld,
      overlap = cloud.extraAttributes?.Overlap ?? cloud.extraAttributes?.overlap
    for (const range of cloud.nodeRanges ?? [])
      for (let i = range.start; i < range.start + range.count; i++) {
        const lon = cloud.positions[i * 3] + cloud.coordinateOrigin[0],
          lat = cloud.positions[i * 3 + 1] + cloud.coordinateOrigin[1],
          z = cloud.positions[i * 3 + 2]
        if (lon < bounds[0] || lon > bounds[2] || lat < bounds[1] || lat > bounds[3]) continue
        const classification = cloud.classifications?.[i] ?? -1
        if ([2, 7, 12, 18].includes(classification) || withheld?.[i] || overlap?.[i]) continue
        const [x, y] = toMetric(lon, lat),
          cell = sourceCell(data.grid, x, y)
        if (!cells.has(cell)) continue
        const ground = sourceValue(terrain, cell)
        if (ground === null) continue
        const height = z - ground
        if (height < 2 || height > 80 || !Number.isFinite(height)) continue
        points.push({ lon, lat, z, height, classification, node: range.key, index: i - range.start })
      }
    return {
      id: crown.properties.id,
      points,
      loaded_points: loader.getLoadedPointCount(),
      loaded_nodes: loader.getLoadedNodeCount(),
      available_nodes: nodes.length,
      budget_limited: chosen.length < nodes.length || loader.hasPendingSubtrees(viewport),
      withheld_filtered: !!withheld,
      ground_m: crown.properties.ground_m,
      centre: crown.properties.centre,
      source_sha256: data.source_sha256,
    }
  } finally {
    signal.removeEventListener('abort', stop)
    loader.destroy()
  }
}
export function useTreeCrop(
  data: TreeIsolation | null,
  crown: CrownFeature | null,
  enabled: boolean,
  base: string,
  cloudUrl: string,
) {
  const [attempt, setAttempt] = useState(0)
  const requestKey = useMemo(
    () => [data, crown, enabled, base, cloudUrl, attempt],
    [data, crown, enabled, base, cloudUrl, attempt],
  )
  const [crop, setCrop] = useKeyedState<TreeCrop | null>(requestKey, () => null)
  const [status, setStatus] = useKeyedState(requestKey, () => '')
  const [error, setError] = useKeyedState(requestKey, () => '')
  useEffect(() => {
    if (!enabled || !data || !crown) return
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 45000)
    isolateTreeReturns(data, crown, base, cloudUrl, abort.signal, (s) => {
      if (active) setStatus(s)
    })
      .then((next) => {
        if (active) {
          setCrop(next)
          setStatus(`${next.points.length.toLocaleString()} cropped original returns`)
        }
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [data, crown, enabled, base, cloudUrl, attempt, setCrop, setStatus, setError])
  return { crop, status, error, retry: () => setAttempt((n) => n + 1) }
}
