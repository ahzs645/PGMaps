declare module '@turf/buffer' {
  import type { Feature, GeoJsonProperties, Geometry, MultiPolygon, Polygon } from 'geojson'

  export default function buffer(
    geojson: Feature<Geometry, GeoJsonProperties> | Geometry,
    radius?: number,
    options?: { units?: string; steps?: number },
  ): Feature<Polygon | MultiPolygon, GeoJsonProperties> | undefined
}

// Turf 6.5 ships this signature in dist/js/index.d.ts, but omits a types condition from exports.
declare module '@turf/boolean-intersects' {
  import type { Feature, Geometry } from 'geojson'

  export default function booleanIntersects(feature1: Feature | Geometry, feature2: Feature | Geometry): boolean
}

declare module '@turf/intersect' {
  import type { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'

  export default function intersect(
    poly1: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
    poly2: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
  ): Feature<Polygon | MultiPolygon, GeoJsonProperties> | null
}

declare module '@turf/difference' {
  import type { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'

  export default function difference(
    poly1: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
    poly2: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
  ): Feature<Polygon | MultiPolygon, GeoJsonProperties> | null
}

declare module '@turf/union' {
  import type { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'

  export default function union(
    poly1: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
    poly2: Feature<Polygon | MultiPolygon, GeoJsonProperties>,
  ): Feature<Polygon | MultiPolygon, GeoJsonProperties> | null
}
