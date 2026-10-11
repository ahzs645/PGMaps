declare module '@turf/kinks' {
  export default function kinks(
    feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  ): GeoJSON.FeatureCollection<GeoJSON.Point>
}
declare module '@turf/line-split' {
  export default function lineSplit(
    line: GeoJSON.Feature<GeoJSON.LineString>,
    splitter: GeoJSON.Feature<
      | GeoJSON.Point
      | GeoJSON.MultiPoint
      | GeoJSON.LineString
      | GeoJSON.MultiLineString
      | GeoJSON.Polygon
      | GeoJSON.MultiPolygon
    >,
  ): GeoJSON.FeatureCollection<GeoJSON.LineString>
}
