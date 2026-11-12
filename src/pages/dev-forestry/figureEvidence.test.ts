import { describe, expect, it } from 'vitest'
import { eyeClearing, MIN_SCREENED_LANDFORM_SHARE, screenedLandformShare } from './analysis'
import { alterationWeight } from './integrity'
import { lngLatToMercator } from './terrain'

describe('accuracy study changes (docs/forestry-visual-quality.md, Evidence for the defaults)', () => {
  it('counts a retention-system opening recorded at 0 % clearcut as an opening', () => {
    const opening = { role: 'harvested' as const, harvestYear: 2022, clearcutPercent: 0, siteDisturbance: false }
    expect(alterationWeight(opening, 2026, 20)).toBe(1)
    expect(alterationWeight({ ...opening, clearcutPercent: 40 }, 2026, 20)).toBeCloseTo(0.4)
    expect(alterationWeight({ ...opening, clearcutPercent: null }, 2026, 20)).toBe(1)
    expect(alterationWeight({ ...opening, clearcutPercent: 0, harvestYear: 2000 }, 2026, 20)).toBe(0)
  })

  it('clears timber within the radius of any station, and nowhere with a radius of 0', () => {
    const near = eyeClearing([{ lng: -122.6, lat: 53.9 }], 50)
    const at = (dx: number) => lngLatToMercator(-122.6 + dx / (111320 * Math.cos((53.9 * Math.PI) / 180)), 53.9)
    expect(near(...at(30))).toBe(true)
    expect(near(...at(80))).toBe(false)
    expect(eyeClearing([{ lng: 0, lat: 0 }], 0)(...lngLatToMercator(0, 0))).toBe(false)
  })

  it('reads how much of the bare-earth visible landform screening leaves', () => {
    const share = screenedLandformShare(Uint8Array.from([1, 0, 0, 0]), Uint8Array.from([1, 1, 1, 1]), [1, 1, 1, 1])
    expect(share).toBe(0.25)
    expect(share! < MIN_SCREENED_LANDFORM_SHARE).toBe(false)
    expect(screenedLandformShare(Uint8Array.from([0]), Uint8Array.from([0]), [1])).toBeNull()
  })
})
