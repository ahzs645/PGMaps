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
      renderedOn: '2026-11-12T10:00:00Z',
    })
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe('Composite of 2 simulated 50 mm camera images: FOV 79.2 degrees')
    expect(lines[1]).toBe('Observer height: 1.6 metres above ground')
    expect(lines[2]).toMatch(/^Observer position \(UTM zone 10\): 500,000, 5,98\d,\d{3}, 702 metres$/)
    expect(lines[3]).toBe('Viewline azimuth: 111 degrees')
    expect(lines[4]).toBe('Maximum tree height: trees not modelled')
    expect(lines[5]).toBe('Date of rendering: 2026-11-12')
  })

  it('names a surveyed eye elevation on the position line, and keeps the observer height line', () => {
    const lines = cameraInfoLines({
      frames: 1,
      focalMm: 50,
      fovDeg: 39.6,
      observerHeightM: 1.6,
      above: 'ground',
      lng: -116.951,
      lat: 50.2561,
      elevationM: 636,
      surveyed: true,
      azimuthDeg: 270,
      maxTreeHeightM: 30,
      renderedOn: new Date('2026-11-13T10:00:00Z'),
    })
    expect(lines).toHaveLength(6)
    expect(lines[1]).toBe('Observer height: 1.6 metres above ground')
    expect(lines[2]).toMatch(/, 636 metres \(surveyed elevation\)$/)
  })
})

describe('a view’s own camera on the block', () => {
  const base = {
    frames: 1,
    focalMm: 79.9,
    fovDeg: 25.4,
    observerHeightM: 1.6,
    above: 'ground' as const,
    lng: -122.71234,
    lat: 53.91234,
    elevationM: 812,
    surveyed: true,
    azimuthDeg: 245,
    maxTreeHeightM: null,
    renderedOn: '2026-11-22T10:00:00Z',
  }

  it('prints the lens as entered beside the lens used, and both eyes where they disagree, in six lines', () => {
    const lines = cameraInfoLines({ ...base, lensEntered: '50 mm lens x 1.6 crop', modelEyeM: 822.4, eyeToleranceM: 3 })
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe(
      'Composite of 1 simulated 80 mm camera image: FOV 25.4 degrees (entered as 50 mm lens x 1.6 crop)',
    )
    expect(lines[2]).toMatch(/, 812 metres \(surveyed elevation; terrain model eye 822 metres, 10\.4 metres higher\)$/)
  })

  it('prints the position in the zone the place was typed in', () => {
    // A made-up point just east of zone 9's band, typed in zone 9.
    const lines = cameraInfoLines({ ...base, lng: -125.8, utmZone: 9 })
    expect(lines[2]).toMatch(/^Observer position \(UTM zone 9\): /)
    expect(utmPosition(-125.8, 53.9, 9).easting).toBeGreaterThan(700_000)
    expect(utmPosition(-125.8, 53.9).zone).toBe(10)
  })
})
