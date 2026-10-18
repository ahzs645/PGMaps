import { describe, expect, it } from 'vitest'
import { LIDAR_TILE, lidarViewerUrl } from './data'

describe('LiDAR viewer integration', () => {
  it('opens the full EPT cloud from the PGMaps origin in GeoLibre', () => {
    const url = new URL(lidarViewerUrl('geolibre', 'https://pgmaps.ahmadjalil.com', 'dark'))
    expect(url.origin).toBe('https://web.geolibre.app')
    expect(url.searchParams.get('data')).toBe(`https://pgmaps.ahmadjalil.com${LIDAR_TILE.basePath}ept.json`)
    expect(url.searchParams.get('layout')).toBe('compact')
    expect(url.searchParams.get('theme')).toBe('dark')
  })

  it('loads only the prepared overview into a blank embedded RustGIS workspace', () => {
    const url = new URL(lidarViewerUrl('rustgis', 'http://localhost:5173', 'light'))
    expect(url.origin).toBe('https://web.rustgis.app')
    expect(url.searchParams.get('data')).toBe(`http://localhost:5173${LIDAR_TILE.basePath}overview.laz`)
    expect(url.searchParams.get('blank')).toBe('1')
    expect(url.searchParams.get('embed')).toBe('1')
  })
})
