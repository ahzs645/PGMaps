import type { Geometry, Position } from 'geojson'
import type { Coordinate } from './model'

export interface VertexAddress {
  collections: number[]
  coordinates: number[]
}
export interface GeometryVertex {
  address: VertexAddress
  point: Coordinate
  removable: boolean
}
export interface GeometryEdge {
  after: VertexAddress
  point: Coordinate
}
const leaf = (geometry: Geometry, collections: number[]): Exclude<Geometry, { type: 'GeometryCollection' }> => {
  let current = geometry
  for (const index of collections) {
    if (current.type !== 'GeometryCollection' || !current.geometries[index])
      throw new Error('This geometry changed. Select its vertex again.')
    current = current.geometries[index]
  }
  if (current.type === 'GeometryCollection') throw new Error('Choose a coordinate geometry.')
  return current
}
function coordinateList(geometry: ReturnType<typeof leaf>, path: number[]): Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates]
  let current: unknown = geometry.coordinates
  for (const index of path.slice(0, -1)) current = (current as unknown[])[index]
  if (!Array.isArray(current)) throw new Error('This vertex is no longer available.')
  return current as Position[]
}
function isRing(geometry: ReturnType<typeof leaf>) {
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'
}
export function geometryHandles(geometry: Geometry): { vertices: GeometryVertex[]; edges: GeometryEdge[] } {
  const vertices: GeometryVertex[] = [],
    edges: GeometryEdge[] = []
  const sequence = (points: Position[], collections: number[], prefix: number[], ring: boolean, edge: boolean) => {
    const count = points.length - (ring ? 1 : 0)
    for (let i = 0; i < count; i++) {
      const address = { collections, coordinates: [...prefix, i] }
      vertices.push({ address, point: [points[i][0], points[i][1]], removable: count > (ring ? 3 : edge ? 2 : 1) })
      const next = points[i + 1]
      if (edge && next) {
        const delta = ((next[0] - points[i][0] + 540) % 360) - 180
        edges.push({
          after: address,
          point: [((points[i][0] + delta / 2 + 540) % 360) - 180, (points[i][1] + next[1]) / 2],
        })
      }
    }
  }
  const visit = (g: Geometry, collections: number[]) => {
    if (g.type === 'GeometryCollection') g.geometries.forEach((child, i) => visit(child, [...collections, i]))
    else if (g.type === 'Point')
      vertices.push({
        address: { collections, coordinates: [] },
        point: [g.coordinates[0], g.coordinates[1]],
        removable: false,
      })
    else if (g.type === 'MultiPoint' || g.type === 'LineString')
      sequence(g.coordinates, collections, [], false, g.type === 'LineString')
    else if (g.type === 'Polygon' || g.type === 'MultiLineString')
      g.coordinates.forEach((p, i) => sequence(p, collections, [i], g.type === 'Polygon', true))
    else
      g.coordinates.forEach((polygon, i) =>
        polygon.forEach((ring, j) => sequence(ring, collections, [i, j], true, true)),
      )
  }
  visit(geometry, [])
  return { vertices, edges }
}
export function editVertex(geometry: Geometry, address: VertexAddress, point: Coordinate): Geometry {
  if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)
    throw new Error('Use longitude −180…180 and latitude −90…90.')
  const next = structuredClone(geometry),
    target = leaf(next, address.collections)
  if (target.type === 'Point') target.coordinates = [...point, ...target.coordinates.slice(2)]
  else {
    const points = coordinateList(target, address.coordinates),
      index = address.coordinates.at(-1)!
    if (!points[index]) throw new Error('This vertex is no longer available.')
    points[index] = [...point, ...points[index].slice(2)]
    if (isRing(target) && index === 0) points[points.length - 1] = [...points[0]]
  }
  return next
}
export function insertVertex(geometry: Geometry, address: VertexAddress): Geometry {
  const next = structuredClone(geometry),
    target = leaf(next, address.collections)
  if (target.type === 'Point' || target.type === 'MultiPoint') throw new Error('Choose a line or polygon edge.')
  const points = coordinateList(target, address.coordinates),
    index = address.coordinates.at(-1)!
  const a = points[index],
    b = points[index + 1]
  if (!a || !b) throw new Error('Choose an edge between two vertices.')
  const delta = ((b[0] - a[0] + 540) % 360) - 180
  points.splice(index + 1, 0, [
    ((a[0] + delta / 2 + 540) % 360) - 180,
    ...a.slice(1).map((value, i) => (i + 1 < b.length ? (value + b[i + 1]) / 2 : value)),
  ])
  return next
}
export function removeVertex(geometry: Geometry, address: VertexAddress): Geometry {
  const match = geometryHandles(geometry).vertices.find((v) => JSON.stringify(v.address) === JSON.stringify(address))
  if (!match?.removable) throw new Error('Keep at least two line vertices or three polygon vertices.')
  const next = structuredClone(geometry),
    target = leaf(next, address.collections)
  const points = coordinateList(target, address.coordinates),
    index = address.coordinates.at(-1)!
  points.splice(index, 1)
  if (isRing(target)) points[points.length - 1] = [...points[0]]
  return next
}
export function snapCoordinate(
  point: Coordinate,
  geometries: Geometry[],
  project: (point: Coordinate) => { x: number; y: number },
  pixels = 12,
): Coordinate {
  const origin = project(point)
  let best = pixels * pixels,
    result = point
  for (const geometry of geometries)
    for (const vertex of geometryHandles(geometry).vertices) {
      const p = project(vertex.point),
        distance = (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2
      if (distance <= best) {
        best = distance
        result = vertex.point
      }
    }
  return result
}
