/** The shapefile parts of shpjs that `spatialImport.ts` calls itself, so it can reproject with the workspace's CRSs. */
declare module 'shpjs' {
  /** Geometries in the file's own coordinates when no projection is passed. */
  export function parseShp(shp: ArrayBuffer | ArrayBufferView, prj?: string): GeoJSON.Geometry[]
  export function parseDbf(dbf: ArrayBuffer | ArrayBufferView, cpg?: string): Record<string, unknown>[]
}
