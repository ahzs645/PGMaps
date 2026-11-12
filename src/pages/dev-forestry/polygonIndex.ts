/**
 * Many-polygon point lookup: polygons bucketed on a coarse lng/lat grid, each
 * bucket answered by the page's own `preparePolygons` (exact `pointInPolygon`
 * answers). Returns the index of the first polygon (in input order) holding a point.
 * Ported from the VIA figure-style prototype (November 2026).
 */
import { polygonBounds, preparePolygons, type PolygonGeometry, type PreparedPolygons } from './visibility'

export class PolygonIndex {
  private readonly cells: Array<{ prepared: PreparedPolygons; map: number[] } | null>
  private readonly box: [number, number, number, number]
  private readonly n: number
  readonly size: number
  constructor(polygons: ReadonlyArray<PolygonGeometry>, n = 48) {
    this.size = polygons.length
    this.n = n
    const boxes = polygons.map((p) => polygonBounds(p))
    this.box = boxes.length
      ? [
          Math.min(...boxes.map((b) => b[0])),
          Math.min(...boxes.map((b) => b[1])),
          Math.max(...boxes.map((b) => b[2])),
          Math.max(...boxes.map((b) => b[3])),
        ]
      : [0, 0, 0, 0]
    const lists: number[][] = Array.from({ length: n * n }, () => [])
    boxes.forEach((b, index) => {
      const [i0, j0] = this.cell(b[0], b[1]),
        [i1, j1] = this.cell(b[2], b[3])
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * n + i].push(index)
    })
    this.cells = lists.map((list) =>
      list.length ? { prepared: preparePolygons(list.map((k) => polygons[k])), map: list } : null,
    )
  }
  private cell(lng: number, lat: number): [number, number] {
    const [w, s, e, nn] = this.box
    const i = Math.min(this.n - 1, Math.max(0, Math.floor(((lng - w) / Math.max(1e-12, e - w)) * this.n)))
    const j = Math.min(this.n - 1, Math.max(0, Math.floor(((lat - s) / Math.max(1e-12, nn - s)) * this.n)))
    return [i, j]
  }
  indexAt(lng: number, lat: number): number {
    if (!this.size) return -1
    const [w, s, e, n] = this.box
    if (lng < w || lng > e || lat < s || lat > n) return -1
    const [i, j] = this.cell(lng, lat)
    const c = this.cells[j * this.n + i]
    if (!c) return -1
    const k = c.prepared.indexAt(lng, lat)
    return k < 0 ? -1 : c.map[k]
  }
  contains(lng: number, lat: number) {
    return this.indexAt(lng, lat) >= 0
  }
}
