import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js'
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson'

/** Node the rings and cutter, polygonize the network, then keep only source interiors. */
export function splitPolygon(
  source: Feature<Polygon | MultiPolygon>,
  cutter: Feature<LineString | MultiLineString>,
): FeatureCollection {
  const reader = new GeoJSONReader(new GeometryFactory()),
    writer = new GeoJSONWriter()
  const original = reader.read(source.geometry)
  if (!IsValidOp.isValid(original)) throw new Error('Polygon topology is invalid. Repair it before splitting.')
  const polygons = source.geometry.type === 'Polygon' ? [source.geometry.coordinates] : source.geometry.coordinates
  const lines = cutter.geometry.type === 'LineString' ? [cutter.geometry.coordinates] : cutter.geometry.coordinates
  const network = reader.read({ type: 'MultiLineString', coordinates: [...polygons.flat(), ...lines] })
  const polygonizer = new Polygonizer()
  polygonizer.add(UnaryUnionOp.union(network))
  const iterator = polygonizer.getPolygons().iterator(),
    features: Feature[] = []
  while (iterator.hasNext()) {
    const polygon = iterator.next()
    const interior = InteriorPointArea.getInteriorPoint(polygon)
    if (!interior || !booleanPointInPolygon({ type: 'Point', coordinates: [interior.x, interior.y] }, source)) continue
    features.push({
      type: 'Feature',
      properties: { ...source.properties, operation: 'split-polygon', part: features.length + 1 },
      geometry: writer.write(polygon) as Polygon,
    })
  }
  if (features.length <= polygons.length)
    throw new Error('The cutter does not split the polygon. Extend it across the polygon boundary.')
  return { type: 'FeatureCollection', features }
}
