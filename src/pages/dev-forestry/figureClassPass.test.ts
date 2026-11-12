import { describe, expect, it } from 'vitest'
import { CLASS_PALETTE } from '@/lib/forestry/viaFigure/composeFigure'
import { classPassLayers, splitAtLandform } from './figureClassPass'
import { polygonAreaMeters } from './visibility'

const square = (x0: number, y0: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x0 + size, y0],
      [x0 + size, y0 + size],
      [x0, y0 + size],
      [x0, y0],
    ],
  ],
})

const LANDFORM = square(-122, 54, 0.01)

describe('class pass layers', () => {
  it('splits a block that crosses the landform edge into inside and outside parts', () => {
    const block = square(-121.995, 54.002, 0.01)
    const { inside, outside, failed } = splitAtLandform([block], LANDFORM)
    expect(failed).toBe(false)
    const area = (parts: typeof inside) => polygonAreaMeters({ type: 'MultiPolygon', coordinates: parts })
    const whole = polygonAreaMeters(block)
    expect(area(inside) + area(outside)).toBeCloseTo(whole, -2)
    expect(area(inside) / whole).toBeCloseTo(0.4, 1)
    expect(splitAtLandform([block], null)).toMatchObject({ inside: [], failed: false })
    expect(splitAtLandform([], LANDFORM)).toEqual({ inside: [], outside: [], failed: false })
  })

  it('stacks the classes in VIA precedence and colours them from the palette', () => {
    const { layers, failed } = classPassLayers({
      landform: LANDFORM,
      blocks: [square(-121.995, 54.002, 0.002)],
      existing: [square(-121.998, 54.004, 0.002)],
      privateLand: [square(-121.996, 54.001, 0.02)],
      rock: [square(-121.999, 54.008, 0.001), square(-121.5, 54.5, 0.001)],
    })
    expect(failed).toBe(false)
    expect(layers.map((l) => l.id)).toEqual(['landform', 'rock', 'privateOut', 'privateIn', 'existingIn', 'proposedIn'])
    expect(layers[0].color).toBe(`#${CLASS_PALETTE.landform.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    // Rock outside the landform is not a class.
    expect(layers.find((l) => l.id === 'rock')!.data.features).toHaveLength(1)
  })
})
