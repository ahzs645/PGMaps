import { describe, expect, it } from 'vitest'
import { cameraInfoLines, utmPosition } from './cameraInfo'

describe('the camera information block', () => {
  it('places the observer in UTM: on a central meridian the easting is 500,000 m', () => {
    const onMeridian = utmPosition(-123, 54)
    expect(onMeridian.zone).toBe(10)
    expect(onMeridian.easting).toBeCloseTo(500000, 3)
    expect(onMeridian.northing).toBeGreaterThan(5_980_000)
    expect(onMeridian.northing).toBeLessThan(5_990_000)
    expect(utmPosition(-122.6, 53.9).zone).toBe(10)
    expect(utmPosition(-119.9, 50).zone).toBe(11)
  })

  it('prints exactly the six lines, in order', () => {
    const lines = cameraInfoLines({
      frames: 2,
      focalMm: 50,
      fovDeg: 79.2,
      observerHeightM: 1.6,
      above: 'ground',
      lng: -123,
      lat: 54,
      elevationM: 702.4,
      azimuthDeg: -248.6,
      maxTreeHeightM: null,
      renderedOn: new Date('2026-11-12T10:00:00Z'),
    })
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe('Composite of 2 simulated 50 mm camera images: FOV 79.2 degrees')
    expect(lines[1]).toBe('Observer height: 1.6 metres above ground')
    expect(lines[2]).toMatch(/^Observer position \(UTM zone 10\): 500,000, 5,98\d,\d{3}, 702 metres$/)
    expect(lines[3]).toBe('Viewline azimuth: 111 degrees')
    expect(lines[4]).toBe('Maximum tree height: trees not modelled')
    expect(lines[5]).toBe('Date of rendering: 2026-11-12')
  })
})
