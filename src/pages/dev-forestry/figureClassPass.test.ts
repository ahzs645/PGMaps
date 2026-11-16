import { describe, expect, it } from 'vitest'
import { CLASS_PALETTE } from '@/lib/forestry/viaFigure/composeFigure'
import { blocksInLandform, classPassLayers, paintsPartialCut, splitAtLandform } from './figureClassPass'
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

  it('stacks the classes so private land covers blocks, as the run counts it, and colours them from the palette', () => {
    const { layers, failed } = classPassLayers({
      landform: LANDFORM,
      blocks: [square(-121.995, 54.002, 0.002)],
      existing: [square(-121.998, 54.004, 0.002)],
      privateLand: [square(-121.996, 54.001, 0.02)],
      rock: [square(-121.999, 54.008, 0.001), square(-121.5, 54.5, 0.001)],
    })
    expect(failed).toBe(false)
    expect(layers.map((l) => l.id)).toEqual(['landform', 'rock', 'existingIn', 'proposedIn', 'privateOut', 'privateIn'])
    expect(layers[0].color).toBe(`#${CLASS_PALETTE.landform.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    // Rock outside the landform is not a class.
    expect(layers.find((l) => l.id === 'rock')!.data.features).toHaveLength(1)
  })
})

describe('retention in the class pass', () => {
  it('leaves a block’s retention out of the proposed class, as the run does', () => {
    const block = square(-121.996, 54.002, 0.004)
    const patch = square(-121.995, 54.003, 0.001)
    const area = (layers: ReturnType<typeof classPassLayers>['layers']) =>
      layers
        .filter((layer) => layer.id === 'proposedIn')
        .flatMap((layer) => layer.data.features)
        .reduce((sum, feature) => sum + polygonAreaMeters(feature.geometry as GeoJSON.MultiPolygon), 0)
    const input = { landform: LANDFORM, blocks: [block], existing: [], privateLand: [], rock: [] }
    const whole = area(classPassLayers(input).layers)
    const net = classPassLayers({ ...input, retained: [patch] })
    expect(net.failed).toBe(false)
    expect(area(net.layers) / whole).toBeCloseTo(15 / 16, 2)
  })
})

describe('the zone pass', () => {
  it('paints each established objective in its zone colour', async () => {
    const { zonePassLayers } = await import('./figureClassPass')
    const { zoneColor } = await import('@/lib/forestry/viaFigure/composeFigure')
    const feature = (code: string): GeoJSON.Feature => ({ type: 'Feature', properties: { code }, geometry: LANDFORM })
    const layers = zonePassLayers({ type: 'FeatureCollection', features: [feature('PR'), feature('R'), feature('PR')] })
    expect(layers.map((l) => l.id)).toEqual(['zone-R', 'zone-PR'])
    expect(layers[1].color).toBe(zoneColor(3))
    expect(layers[1].data.features).toHaveLength(2)
  })
})

describe('a partial cut in the class pass', () => {
  it('paints it as its own class above the clearcut blocks, net of retention, and nothing new without one', () => {
    const input = {
      landform: LANDFORM,
      blocks: [square(-121.995, 54.002, 0.002)],
      existing: [],
      privateLand: [],
      rock: [],
    }
    const plain = classPassLayers(input)
    expect(plain.layers.map((l) => l.id)).toEqual(['landform', 'proposedIn'])
    expect(paintsPartialCut(plain.layers)).toBe(false)
    expect(classPassLayers({ ...input, partialCuts: [] })).toEqual(plain)
    const cut = square(-121.998, 54.006, 0.002)
    const withCut = classPassLayers({
      ...input,
      partialCuts: [cut, square(-121.5, 54.5, 0.001)],
      retained: [square(-121.998, 54.006, 0.0005)],
    })
    expect(withCut.layers.map((l) => l.id)).toEqual(['landform', 'proposedIn', 'partialOut', 'partialIn'])
    expect(paintsPartialCut(withCut.layers)).toBe(true)
    const inside = withCut.layers.find((l) => l.id === 'partialIn')!
    expect(inside.color).toBe(`#${CLASS_PALETTE.partialIn.map((v) => v.toString(16).padStart(2, '0')).join('')}`)
    const area = polygonAreaMeters(inside.data.features[0].geometry as GeoJSON.MultiPolygon)
    expect(area / polygonAreaMeters(cut)).toBeCloseTo(1 - 1 / 16, 2)
  })
})

describe('a landform’s blocks', () => {
  it('names the blocks with ground in the landform, from the plan', () => {
    const blocks = [
      { id: 'in', geometry: square(-121.998, 54.002, 0.002) },
      { id: 'across', geometry: square(-121.995, 54.002, 0.01) },
      { id: 'out', geometry: square(-121.95, 54.05, 0.002) },
    ]
    expect(blocksInLandform(blocks, LANDFORM)).toEqual(['in', 'across'])
    // Another landform's pass is the same layers split at it: its blocks are inside there.
    const other = square(-121.952, 54.048, 0.006)
    expect(blocksInLandform(blocks, other)).toEqual(['out'])
    const pass = classPassLayers({
      landform: other,
      blocks: blocks.map((b) => b.geometry),
      existing: [],
      privateLand: [],
      rock: [],
    })
    expect(pass.layers.map((layer) => layer.id)).toEqual(['landform', 'proposedOut', 'proposedIn'])
  })

  it('takes no block whose outline only meets the landform’s edge', () => {
    // 0.33 m by 111 m of overlap (about 36 m²): where two outlines meet, not ground in the landform.
    const edge = { id: 'edge', geometry: square(-122.001 + 0.000005, 54.002, 0.001) }
    const real = { id: 'real', geometry: square(-122.0005, 54.004, 0.001) }
    expect(blocksInLandform([edge, real], LANDFORM)).toEqual(['real'])
  })
})
