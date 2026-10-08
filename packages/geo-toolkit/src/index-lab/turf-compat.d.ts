// Turf 6.5's export map omits its declarations. These local signatures keep the
// toolkit independently buildable without relying on PG Maps' ambient types.
declare module '@turf/boolean-point-in-polygon' {
  function booleanPointInPolygon(
    point: GeoJSON.Feature<GeoJSON.Point> | GeoJSON.Point,
    polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | GeoJSON.Polygon | GeoJSON.MultiPolygon,
  ): boolean
  export default booleanPointInPolygon
}

declare module '@turf/helpers' {
  export function point(coordinates: [number, number]): GeoJSON.Feature<GeoJSON.Point>
}
