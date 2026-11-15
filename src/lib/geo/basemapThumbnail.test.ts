import { describe, expect, it } from 'vitest'

import { basemapThumbnailUrl, tileForLngLat } from './basemapThumbnail'

describe('basemap thumbnails', () => {
  it('finds the slippy-map tile for a point', () => {
    expect(tileForLngLat(0, 0, 0)).toEqual({ x: 0, y: 0, z: 0 })
    expect(tileForLngLat(-122.7497, 53.9171, 11)).toEqual({ x: 325, y: 658, z: 11 })
    expect(tileForLngLat(180, 89.9, 2)).toEqual({ x: 0, y: 0, z: 2 })
    expect(tileForLngLat(179.999, -89.9, 2)).toEqual({ x: 3, y: 3, z: 2 })
  })

  it('fills in a template, including Esri’s z/y/x order', () => {
    expect(
      basemapThumbnailUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        -122.7497,
        53.9171,
        11,
      ),
    ).toBe('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/11/658/325')
    expect(basemapThumbnailUrl('https://{s}.tiles.example/{z}/{x}/{y}{r}.png', 0, 0, 1)).toBe(
      'https://a.tiles.example/1/1/1.png',
    )
  })
})
