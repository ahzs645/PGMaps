/**
 * Sub-landform splits by the handbook's rules (Visual Impact Assessment Guidebook §3.3.2 and
 * Appendix 3), on a plan grid over the landform:
 *  (a) where two VSU / VQO polygons share one landform, split at their boundary;
 *  (b) split at major creek draws — FWA streams of order ≥ 3 (and/or DEM draws) that cross the
 *      landform for at least `minBarrierLengthM`;
 *  (c) split off a far ridge that the viewer sees as a separate layer (`farLayer`, from the view's
 *      depth discontinuities — see depthLayers.ts).
 * Components smaller than `minShare` of the landform merge into the neighbour they share most edge
 * with. Sub-landforms are named "<n>a", "<n>b", … left to right as seen from the viewpoint.
 * A split is a candidate for the reviewer, never adopted automatically. No DOM, no network.
 * Ported from the VIA figure-style prototype (November 2026).
 */
import { joinSegments } from '@/lib/mapSheet/contours'
import { bearingDegrees, polygonBounds, type PolygonGeometry } from './visibility'
import { PolygonIndex } from './polygonIndex'
import { gridLookup, planGrid, rasteriseLine, type PlanGrid } from './planGrid'

export interface Barrier {
  name: string
  kind: 'creek' | 'draw'
  line: [number, number][]
}
export interface SubLandformInput {
  landform: PolygonGeometry
  landformName: string
  vsus: { id: string; evqo: string | null; geometry: PolygonGeometry }[]
  barriers: Barrier[]
  farLayer?: ((lng: number, lat: number) => boolean) | null
  viewpoint: { lng: number; lat: number }
  cellMeters?: number
  minShare?: number
  minBarrierLengthM?: number
}
export interface SubLandform {
  id: string
  /** Label value + 1 in `labels`. */
  label: number
  areaHa: number
  share: number
  reasons: string[]
  vsuIds: string[]
}
export interface SubLandformResult {
  grid: PlanGrid
  /** Per cell: sub-landform label (1-based), 0 outside the landform. */
  labels: Uint8Array
  subs: SubLandform[]
  lookup: { indexAt(lng: number, lat: number): number }
  notes: string[]
}

export function splitLandform(input: SubLandformInput): SubLandformResult {
  const bounds = polygonBounds(input.landform)
  const grid = planGrid(bounds, input.cellMeters ?? 30, 1_200_000)
  const { nx, ny } = grid
  const land = new PolygonIndex([input.landform], 32)
  const vsuIndex = new PolygonIndex(
    input.vsus.map((v) => v.geometry),
    32,
  )
  const inside = new Uint8Array(nx * ny),
    key = new Int32Array(nx * ny).fill(-1),
    barrier = new Int32Array(nx * ny).fill(-1)
  let total = 0
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const [lng, lat] = grid.centre(i, j)
      if (!land.contains(lng, lat)) continue
      const k = j * nx + i
      inside[k] = 1
      total++
      const v = vsuIndex.indexAt(lng, lat)
      const far = input.farLayer ? (input.farLayer(lng, lat) ? 1 : 0) : 0
      key[k] = (v + 1) * 2 + far
    }
  const notes: string[] = []
  // (b) Barriers that cross the landform far enough.
  const minLen = input.minBarrierLengthM ?? 400
  input.barriers.forEach((b, bi) => {
    const cells: number[] = []
    rasteriseLine(grid, b.line, (i, j) => {
      if (inside[j * nx + i]) cells.push(j * nx + i)
    })
    const lengthM = new Set(cells).size * grid.cellMeters
    if (lengthM < minLen) return
    for (const c of cells) barrier[c] = bi
    notes.push(`barrier: ${b.name} (${b.kind}), ${Math.round(lengthM)} m inside the landform`)
  })
  // Components: 4-connected, same key, not across a barrier.
  const comp = new Int32Array(nx * ny).fill(-1)
  const sizes: number[] = []
  const keys: number[] = []
  for (let k = 0; k < nx * ny; k++) {
    if (!inside[k] || barrier[k] >= 0 || comp[k] >= 0) continue
    const id = sizes.length
    let size = 0
    const stack = [k]
    comp[k] = id
    while (stack.length) {
      const c = stack.pop()!
      size++
      const i = c % nx,
        j = (c - i) / nx
      for (const [a, b] of [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
      ]) {
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue
        const n = b * nx + a
        if (inside[n] && barrier[n] < 0 && comp[n] < 0 && key[n] === key[k]) {
          comp[n] = id
          stack.push(n)
        }
      }
    }
    sizes.push(size)
    keys.push(key[k])
  }
  // Barrier cells join their most common neighbouring component.
  for (let k = 0; k < nx * ny; k++) {
    if (!inside[k] || comp[k] >= 0) continue
    const i = k % nx,
      j = (k - i) / nx
    const votes = new Map<number, number>()
    for (let r = 1; r <= 3 && !votes.size; r++)
      for (let b = j - r; b <= j + r; b++)
        for (let a = i - r; a <= i + r; a++) {
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue
          const c = comp[b * nx + a]
          if (c >= 0 && barrier[b * nx + a] < 0) votes.set(c, (votes.get(c) ?? 0) + 1)
        }
    const best = [...votes].sort((p, q) => q[1] - p[1])[0]
    if (best) {
      comp[k] = best[0]
      sizes[best[0]]++
    }
  }
  // Merge small components into the neighbour with the longest shared edge (a graph over components).
  const parent = sizes.map((_, i) => i)
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])))
  const adj = sizes.map(() => new Map<number, number>())
  for (let k = 0; k < nx * ny; k++) {
    const c = comp[k]
    if (c < 0) continue
    const i = k % nx
    for (const n of [i + 1 < nx ? k + 1 : -1, k + nx < nx * ny ? k + nx : -1]) {
      if (n < 0) continue
      const d = comp[n]
      if (d < 0 || d === c) continue
      adj[c].set(d, (adj[c].get(d) ?? 0) + 1)
      adj[d].set(c, (adj[d].get(c) ?? 0) + 1)
    }
  }
  const size = sizes.slice()
  const minCells = (input.minShare ?? 0.1) * total
  const alive = new Set(sizes.map((_, i) => i))
  for (;;) {
    let victim = -1
    for (const r of alive) if (size[r] < minCells && (victim < 0 || size[r] < size[victim])) victim = r
    if (victim < 0 || alive.size <= 1) break
    let target = -1,
      best = -1
    for (const [n, e] of adj[victim])
      if (alive.has(n) && e > best) {
        best = e
        target = n
      }
    if (target < 0) {
      // Isolated (no shared edge): fold into the largest component.
      target = [...alive].filter((r) => r !== victim).sort((a, b) => size[b] - size[a])[0]
    }
    parent[victim] = target
    size[target] += size[victim]
    alive.delete(victim)
    for (const [n, e] of adj[victim]) {
      if (n === target) continue
      adj[target].set(n, (adj[target].get(n) ?? 0) + e)
      adj[n].set(target, (adj[n].get(target) ?? 0) + e)
      adj[n].delete(victim)
    }
    adj[target].delete(victim)
  }
  // Final labels, ordered left to right as seen from the viewpoint.
  const roots = [...new Set(sizes.map((_, i) => find(i)))]
  const info = roots.map((r) => {
    let sx = 0,
      sy = 0,
      n = 0
    const vs = new Set<string>(),
      reasonsKey = new Set<number>()
    for (let k = 0; k < nx * ny; k++) {
      if (comp[k] < 0 || find(comp[k]) !== r) continue
      const i = k % nx,
        j = (k - i) / nx
      const [lng, lat] = grid.centre(i, j)
      sx += lng
      sy += lat
      n++
      const v = Math.floor(key[k] / 2) - 1
      if (v >= 0) vs.add(input.vsus[v].id)
      reasonsKey.add(key[k] % 2)
    }
    const bearing = n ? bearingDegrees(input.viewpoint, { lng: sx / n, lat: sy / n }) : 0
    return { root: r, n, bearing, vsuIds: [...vs], far: reasonsKey.has(1) && !reasonsKey.has(0) }
  })
  const meanBearing = info.length
    ? Math.atan2(
        info.reduce((s, x) => s + Math.sin((x.bearing * Math.PI) / 180) * x.n, 0),
        info.reduce((s, x) => s + Math.cos((x.bearing * Math.PI) / 180) * x.n, 0),
      )
    : 0
  const rel = (b: number) =>
    Math.atan2(Math.sin((b * Math.PI) / 180 - meanBearing), Math.cos((b * Math.PI) / 180 - meanBearing))
  info.sort((a, b) => rel(a.bearing) - rel(b.bearing))
  const labels = new Uint8Array(nx * ny)
  const labelOf = new Map(info.map((x, i) => [x.root, i + 1]))
  for (let k = 0; k < nx * ny; k++) if (comp[k] >= 0) labels[k] = labelOf.get(find(comp[k]))!
  const cellHa = grid.cellMeters ** 2 / 1e4
  const single = info.length <= 1
  // What separates each pair of neighbouring sub-landforms: read along their shared border.
  const why = new Map<number, Set<string>>()
  const add = (l: number, r: string) => {
    const set = why.get(l) ?? new Set<string>()
    set.add(r)
    why.set(l, set)
  }
  const near = (k: number) => {
    const i = k % nx,
      j = (k - i) / nx
    for (let r = 0; r <= 2; r++)
      for (let b = j - r; b <= j + r; b++)
        for (let a = i - r; a <= i + r; a++) {
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue
          if (barrier[b * nx + a] >= 0) return input.barriers[barrier[b * nx + a]].name
        }
    return null
  }
  for (let k = 0; k < nx * ny; k++) {
    if (!labels[k]) continue
    const i = k % nx
    for (const n of [i + 1 < nx ? k + 1 : -1, k + nx < nx * ny ? k + nx : -1]) {
      if (n < 0 || !labels[n] || labels[n] === labels[k]) continue
      const va = Math.floor(key[k] / 2),
        vb = Math.floor(key[n] / 2)
      let r: string
      if (va !== vb && va > 0 && vb > 0) r = `VSU boundary (${input.vsus[va - 1].id} | ${input.vsus[vb - 1].id})`
      else if (key[k] % 2 !== key[n] % 2) r = 'far ridge seen as a separate layer'
      else r = `creek draw: ${near(k) ?? near(n) ?? 'merged fragment'}`
      add(labels[k], r)
      add(labels[n], r)
    }
  }
  const subs: SubLandform[] = info.map((x, i) => ({
    id: single ? input.landformName : `${input.landformName}${String.fromCharCode(97 + i)}`,
    label: i + 1,
    areaHa: x.n * cellHa,
    share: total ? x.n / total : 0,
    reasons: single ? [] : [...(why.get(i + 1) ?? [])],
    vsuIds: x.vsuIds,
  }))
  notes.unshift(
    `${nx} × ${ny} cells at ${grid.cellMeters.toFixed(0)} m; ${subs.length} sub-landform(s); merge threshold ${(100 * (input.minShare ?? 0.1)).toFixed(0)} % of the landform`,
  )
  return { grid, labels, subs, lookup: gridLookup(grid, labels), notes }
}

/**
 * The dividers between neighbouring sub-landforms, as lng/lat polylines along the grid's cell
 * edges: what a figure draws dashed. Empty when the landform is one sub-landform.
 */
export function subLandformDividers(result: Pick<SubLandformResult, 'grid' | 'labels'>): [number, number][][] {
  const { grid, labels } = result
  const { nx, ny } = grid
  const segments: [number, number][][] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = labels[j * nx + i]
      if (!a) continue
      // Edges to the east and north neighbours, in corner coordinates.
      if (i + 1 < nx) {
        const b = labels[j * nx + i + 1]
        if (b && b !== a)
          segments.push([
            [i + 1, j],
            [i + 1, j + 1],
          ])
      }
      if (j + 1 < ny) {
        const b = labels[(j + 1) * nx + i]
        if (b && b !== a)
          segments.push([
            [i, j + 1],
            [i + 1, j + 1],
          ])
      }
    }
  return joinSegments(segments).map((line) =>
    line.map(([a, b]) => [grid.west + a * grid.dLng, grid.south + b * grid.dLat] as [number, number]),
  )
}
