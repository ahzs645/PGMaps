import { overlapHa, type Zones } from './riparian'
self.onmessage = ({ data }: MessageEvent<{ geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; zones: Zones }>) => {
  try {
    self.postMessage({ ha: overlapHa(data.geometry, data.zones) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Riparian intersection failed.' })
  }
}
