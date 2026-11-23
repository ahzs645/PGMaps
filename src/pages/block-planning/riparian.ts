import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { z } from 'zod'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import { lngLatToAlbers } from '../dev-avast/projection'

const xy = z.tuple([z.number().min(-140).max(-114), z.number().min(48).max(61)]).rest(z.number())
const ring = z
  .array(xy)
  .min(4)
  .refine((row) => row[0][0] === row.at(-1)![0] && row[0][1] === row.at(-1)![1], 'Unclosed zone ring')
const polygon = z.array(ring).min(1)
const geometries = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygon }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1) }),
])
const zoneCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        geometry: geometries,
      }),
    )
    .min(1),
})
export type Zones = { source: string; layer: FeatureCollection<Polygon | MultiPolygon> }

const factory = new GeometryFactory()
const reader = new GeoJSONReader(factory)
function projected(g: Polygon | MultiPolygon) {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return reader.read({
    type: 'MultiPolygon',
    coordinates: polygons.map((p) => p.map((r) => r.map(([x, y]) => lngLatToAlbers(x, y)))),
  })
}
export function readZones(data: unknown, source: string): Zones {
  if (!source.trim()) throw Error('Identify the source of the mapped riparian zones.')
  const collection = zoneCollection.parse(data)
  const features = collection.features.map((f) => {
    const shape = projected(f.geometry)
    if (!IsValidOp.isValid(shape) || !(shape.getArea() > 0)) throw Error('Invalid riparian polygon topology.')
    return { ...f, properties: {} }
  })
  return { source, layer: { type: 'FeatureCollection', features } }
}
export function overlapHa(block: Polygon | MultiPolygon | undefined, zones?: Zones) {
  if (!block || !zones) return null
  const mask = UnaryUnionOp.union(
    factory.createGeometryCollection(zones.layer.features.map((f) => projected(f.geometry))),
  )
  return OverlayOp.intersection(projected(block), mask).getArea() / 10000
}
