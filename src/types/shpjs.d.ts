/**
 * shpjs ships no types. Its default export reads a whole shapefile or zip (the air-quality smoke
 * adapter); `parseShp` and `parseDbf` are the parts the road designer's `spatialImport.ts` calls
 * itself, so it can reproject with the workspace's CRSs.
 */
declare module 'shpjs' {
  export default function shp(
    input: ArrayBuffer | string,
  ): Promise<GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[]>
  /** Geometries in the file's own coordinates when no projection is passed. */
  export function parseShp(shp: ArrayBuffer | ArrayBufferView, prj?: string): GeoJSON.Geometry[]
  export function parseDbf(dbf: ArrayBuffer | ArrayBufferView, cpg?: string): Record<string, unknown>[]
}
