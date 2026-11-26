import type { StyleSpecification } from 'maplibre-gl'

/**
 * The street map as one raster layer, for pages that lay a scanned or georeferenced image over a plain
 * reference picture. Esri's World Street Map, from the same keyless ArcGIS Online server as the pages'
 * satellite option. Not OSM's own tile servers: those volunteer servers block apps outside their tile
 * usage policy and answer every tile with an "Access blocked" image. Not CARTO's raster tiles either:
 * they now need an API key and answer with an "API KEY REQUIRED" watermark (CARTO's vector styles, the
 * app's basemaps, are unaffected).
 */
export const STREET_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    reference: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Sources: Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS, OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'reference', type: 'raster', source: 'reference' }],
}
