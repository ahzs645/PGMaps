declare module '@turf/area' {
  function area(geojson: GeoJSON.Feature | GeoJSON.Geometry): number
  export default area
}

declare module '@turf/bbox' {
  function bbox(geojson: GeoJSON.Feature | GeoJSON.Geometry): [number, number, number, number]
  export default bbox
}

declare module '@turf/length' {
  function length(geojson: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>, options?: { units?: string }): number
  export default length
}

declare module '@turf/bbox-polygon' {
  function bboxPolygon(bounds: [number, number, number, number]): GeoJSON.Feature<GeoJSON.Polygon>
  export default bboxPolygon
}

declare module '@turf/boolean-point-in-polygon' {
  function booleanPointInPolygon(
    point: GeoJSON.Feature<GeoJSON.Point> | GeoJSON.Point,
    polygon:
      | GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      | GeoJSON.Polygon
      | GeoJSON.MultiPolygon
  ): boolean
  export default booleanPointInPolygon
}

declare module '@turf/convex' {
  function convex(
    points: GeoJSON.FeatureCollection<GeoJSON.Point>
  ): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
  export default convex
}

declare module '@turf/helpers' {
  export function point(coordinates: [number, number]): GeoJSON.Feature<GeoJSON.Point>
  export function featureCollection(
    features: GeoJSON.Feature<GeoJSON.Point>[]
  ): GeoJSON.FeatureCollection<GeoJSON.Point>
}
