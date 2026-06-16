declare module 'shpjs' {
  export default function shp(input: ArrayBuffer | string): Promise<GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[]>
}
