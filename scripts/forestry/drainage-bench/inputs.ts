/**
 * Reading a bench tile (`fetch-inputs.ts` writes them): the DEM as a dense SurfaceGrid, the road
 * and stream lines in the DEM's projection, a road mask and the places mapped streams cross roads.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { roadProjection } from '../../../src/pages/dev-forestry-roads/terrain'
import { cellIndexAt, type SurfaceGrid } from '../../../src/pages/dev-forestry-roads/surfaceGrid'
import { tiffToGrid, tool } from './whitebox'

export type Line = [number, number][]
export interface Tile {
  name: string
  /** The tile's input folder. */
  dir: string
  dem: SurfaceGrid
  epsg: number
  toGrid: (c: [number, number]) => [number, number]
  toLonLat: (xy: [number, number]) => [number, number]
  /** FTEN road sections and Digital Road Atlas roads, projected. */
  roads: Line[]
  /** FWA stream lines (not lake/wetland construction lines), projected, with their elevations. */
  streams: { line: Line; z: number[] }[]
  /** 1 on cells within `ROAD_BUFFER_M` of a road centreline, 2 on the centreline itself. */
  roadMask: Uint8Array
  /** Where a mapped stream crosses a mapped road, projected, with its downstream direction. */
  crossings: { x: number; y: number; downX: number; downY: number }[]
}

/** Half the width of the road prism and ditches a centreline is taken to stand for, m. */
export const ROAD_BUFFER_M = 8
/** FWA edge types of construction lines through lakes and wetlands, which are not channels. */
const FWA_CONSTRUCTION_EDGES = new Set([1100, 1150, 1200, 1250, 1300, 1350, 1400, 1410, 1425, 1450, 1475, 1500])

type Geo = {
  features: { geometry: { type: string; coordinates: unknown } | null; properties?: Record<string, unknown> }[]
}

function linesOf(geometry: Geo['features'][number]['geometry']): number[][][] {
  if (!geometry) return []
  if (geometry.type === 'LineString') return [geometry.coordinates as number[][]]
  if (geometry.type === 'MultiLineString') return geometry.coordinates as number[][][]
  return []
}

async function readGeo(file: string): Promise<Geo> {
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Geo) : { features: [] }
}

export async function readTile(dir: string): Promise<Tile> {
  const dem = await tiffToGrid(new Uint8Array(await readFile(path.join(dir, 'dem.tif'))))
  const projection = roadProjection(dem.epsg)
  const toGrid = (c: [number, number]) => projection.forward([...c]) as [number, number]
  const toLonLat = (xy: [number, number]) => projection.inverse([...xy]) as [number, number]
  const roads: Line[] = []
  for (const file of ['ften.geojson', 'dra.geojson'])
    for (const f of (await readGeo(path.join(dir, file))).features)
      for (const line of linesOf(f.geometry)) roads.push(line.map((c) => toGrid([c[0], c[1]])))
  const streams: Tile['streams'] = []
  for (const f of (await readGeo(path.join(dir, 'fwa.geojson'))).features) {
    if (FWA_CONSTRUCTION_EDGES.has(Number(f.properties?.EDGE_TYPE))) continue
    for (const line of linesOf(f.geometry))
      streams.push({ line: line.map((c) => toGrid([c[0], c[1]])), z: line.map((c) => c[2] ?? NaN) })
  }
  return {
    name: path.basename(dir),
    dir,
    dem: { origin: dem.origin, cellM: dem.cellM, width: dem.width, height: dem.height, values: dem.values },
    epsg: dem.epsg,
    toGrid,
    toLonLat,
    roads,
    streams,
    roadMask: roadMask(dem, roads),
    crossings: crossings(roads, streams),
  }
}

/**
 * Whitebox's `burn_streams_at_roads`: lowers each mapped road where a mapped stream crosses it, over
 * `roadWidthM`, so the stream passes the embankment (the culvert the LiDAR cannot see). Lines go in
 * as the fetched lon/lat GeoJSON, which the tool reprojects to the DEM.
 */
export async function burnStreamsAtRoads(tile: Tile, tiff: Uint8Array, roadWidthM: number) {
  const plain = (features: Geo['features']) =>
    new TextEncoder().encode(
      JSON.stringify({
        type: 'FeatureCollection',
        features: features
          .filter((f) => f.geometry)
          .map((f) => ({
            type: 'Feature',
            properties: {},
            geometry: {
              type: f.geometry!.type,
              coordinates: linesOf(f.geometry).map((l) => l.map((c) => [c[0], c[1]])),
            },
          }))
          .map((f) =>
            f.geometry.type === 'LineString'
              ? { ...f, geometry: { ...f.geometry, coordinates: f.geometry.coordinates[0] } }
              : f,
          ),
      }),
    )
  const roads = [
    ...(await readGeo(path.join(tile.dir, 'ften.geojson'))).features,
    ...(await readGeo(path.join(tile.dir, 'dra.geojson'))).features,
  ]
  const streams = (await readGeo(path.join(tile.dir, 'fwa.geojson'))).features.filter(
    (f) => !FWA_CONSTRUCTION_EDGES.has(Number(f.properties?.EDGE_TYPE)),
  )
  return tool(
    'burn_streams_at_roads',
    [
      '--dem=/work/d.tif',
      '--streams=/work/s.geojson',
      '--roads=/work/r.geojson',
      `--road_width=${roadWidthM}`,
      '--output=/work/o.tif',
    ],
    { 'd.tif': tiff, 's.geojson': plain(streams), 'r.geojson': plain(roads) },
  )
}

function roadMask(grid: SurfaceGrid, roads: Line[]): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height)
  const r = Math.ceil(ROAD_BUFFER_M / grid.cellM)
  const step = grid.cellM / 2
  for (const line of roads)
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1],
        [bx, by] = line[k]
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
      for (let s = 0; s <= n; s++) {
        const x = ax + ((bx - ax) * s) / n,
          y = ay + ((by - ay) * s) / n
        const centre = cellIndexAt(grid, x, y)
        if (centre < 0) continue
        const row = Math.floor(centre / grid.width),
          col = centre - row * grid.width
        for (let dr = -r; dr <= r; dr++)
          for (let dc = -r; dc <= r; dc++) {
            const rr = row + dr,
              cc = col + dc
            if (rr < 0 || cc < 0 || rr >= grid.height || cc >= grid.width) continue
            if (Math.hypot(dr, dc) * grid.cellM > ROAD_BUFFER_M) continue
            const i = rr * grid.width + cc
            if (!mask[i]) mask[i] = 1
          }
        mask[centre] = 2
      }
    }
  return mask
}

function intersect(a: number[], b: number[], c: number[], d: number[]): [number, number, number] | null {
  const rx = b[0] - a[0],
    ry = b[1] - a[1],
    sx = d[0] - c[0],
    sy = d[1] - c[1]
  const den = rx * sy - ry * sx
  if (!den) return null
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den,
    u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * rx, a[1] + t * ry, u] : null
}

/** Mapped road × mapped stream crossings, one per 10 m (a road's two lines on one stream are one). */
function crossings(roads: Line[], streams: Tile['streams']): Tile['crossings'] {
  const out: Tile['crossings'] = []
  for (const { line, z } of streams)
    for (let k = 1; k < line.length; k++)
      for (const road of roads)
        for (let m = 1; m < road.length; m++) {
          const hit = intersect(line[k - 1], line[k], road[m - 1], road[m])
          if (!hit) continue
          // FWA lines carry elevations; downstream is the lower end.
          const [ux, uy] = line[k - 1],
            [vx, vy] = line[k]
          const down = z[k] <= z[k - 1] ? [vx - ux, vy - uy] : [ux - vx, uy - vy]
          const len = Math.hypot(down[0], down[1]) || 1
          if (out.some((c) => Math.hypot(c.x - hit[0], c.y - hit[1]) < 10)) continue
          out.push({ x: hit[0], y: hit[1], downX: down[0] / len, downY: down[1] / len })
        }
  return out
}
