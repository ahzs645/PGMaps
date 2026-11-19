import { describe, expect, it } from 'vitest'

import type { PhotoFeature } from './photoOverlay'
import { layerSignature } from './usePhotoLaidLayers'

const road = (east: number): PhotoFeature => ({
  layer: 'roads',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.5, 53.9],
      [-122.5 + east, 53.91],
    ],
  },
})

describe('layerSignature', () => {
  it('names the same features the same whatever list holds them', () => {
    const first = [road(0.01), road(0.02)]
    // Made again, as the photo's feature list is whenever the ground a camera sees changes.
    const again = [road(0.01), road(0.02)]
    expect(layerSignature(again)).toBe(layerSignature(first))
  })

  it('names other features otherwise: one more, one moved, another shape', () => {
    const base = layerSignature([road(0.01), road(0.02)])
    expect(layerSignature([road(0.01), road(0.02), road(0.03)])).not.toBe(base)
    expect(layerSignature([road(0.01), road(0.025)])).not.toBe(base)
    const ring: PhotoFeature = {
      layer: 'roads',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-122.5, 53.9],
            [-122.49, 53.9],
            [-122.49, 53.91],
            [-122.5, 53.9],
          ],
        ],
      },
    }
    expect(layerSignature([road(0.01), ring])).not.toBe(base)
    expect(layerSignature([])).toBe(layerSignature([]))
  })
})
