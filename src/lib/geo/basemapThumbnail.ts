/**
 * One XYZ tile of a basemap, used as its thumbnail in the Layers control so the choices can be
 * told apart before one is applied. No DOM or network access.
 */

/** The slippy-map tile holding a point at zoom `z`. */
export function tileForLngLat(lng: number, lat: number, z: number): { x: number; y: number; z: number } {
  const n = 2 ** z
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat))
  const x = Math.floor((((((lng + 180) % 360) + 360) % 360) / 360) * n)
  const rad = (clampedLat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return { x: Math.min(n - 1, x), y: Math.min(n - 1, Math.max(0, y)), z }
}

/** A tile template (`{z}`, `{x}`, `{y}`, optional `{s}` and `{r}`) filled in for the tile at a point. */
export function basemapThumbnailUrl(template: string, lng: number, lat: number, z: number): string {
  const tile = tileForLngLat(lng, lat, z)
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
    .replace('{s}', 'a')
    .replace('{r}', '')
}

/**
 * Raster stand-ins for the Positron and Dark Matter vector styles PGMaps draws, so the thumbnail of the
 * plain map looks like the map: Esri's light and dark gray canvas, keyless like the satellite imagery.
 * CARTO's own raster renderings now need an API key and return an "API KEY REQUIRED" watermark.
 */
export const PLAIN_MAP_RASTER_TILES = {
  light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
} as const

/** The zoom the thumbnails are taken at: Prince George and its surroundings fill the tile. */
export const THUMBNAIL_ZOOM = 11
