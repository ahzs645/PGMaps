import { describe, expect, it } from 'vitest'
import { formatCamera, parseCamera } from './mapCamera'

describe('shared LiDAR camera', () => {
  it('round-trips a view', () => {
    const camera = { center: [-122.75, 53.91] as [number, number], zoom: 17.5, bearing: -30, pitch: 60 }
    expect(parseCamera(formatCamera(camera))).toEqual(camera)
  })
  it('ignores values that cannot be a view', () => {
    for (const value of [null, '', '1,2,3', '-122,53,x,0,0', '-999,53,12,0,0', '-122,53,12,0,120'])
      expect(parseCamera(value)).toBeNull()
  })
})
