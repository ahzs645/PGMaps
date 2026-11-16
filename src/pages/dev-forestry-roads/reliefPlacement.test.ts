import { describe, expect, it } from 'vitest'
import { basemapReliefBeforeId, keepReliefOverImagery } from './RegionalDemLayer'

type Layer = { id: string; type: string; 'source-layer'?: string }

function fakeMap(layers: Layer[]) {
  const map = {
    layers: [...layers],
    moves: 0,
    getStyle: () => ({ layers: map.layers }) as never,
    moveLayer(id: string, beforeId?: string) {
      map.moves++
      const layer = map.layers.find((l) => l.id === id)!
      map.layers = map.layers.filter((l) => l.id !== id)
      const at = beforeId ? map.layers.findIndex((l) => l.id === beforeId) : map.layers.length
      map.layers.splice(at, 0, layer)
    },
  }
  return map
}

const BASEMAP: Layer[] = [
  { id: 'background', type: 'background' },
  { id: 'landuse', type: 'fill', 'source-layer': 'landuse' },
  { id: 'waterway', type: 'line', 'source-layer': 'water' },
  { id: 'water', type: 'fill', 'source-layer': 'water' },
  { id: 'waterway_label', type: 'symbol', 'source-layer': 'water' },
  { id: 'road_minor', type: 'line', 'source-layer': 'roads' },
]

describe('relief placement', () => {
  it('puts relief under the basemap water, or under the labels over imagery', () => {
    expect(basemapReliefBeforeId(fakeMap(BASEMAP), false)).toBe('waterway')
    expect(basemapReliefBeforeId(fakeMap(BASEMAP), true)).toBe('waterway_label')
    expect(basemapReliefBeforeId(fakeMap(BASEMAP.filter((l) => l['source-layer'] !== 'water')), false)).toBe(undefined)
  })

  it('moves relief back above imagery added after it, in its own order, and then leaves it', () => {
    const map = fakeMap([
      ...BASEMAP.slice(0, 4),
      { id: 'road-hrdem-relief', type: 'raster' },
      { id: 'road-regional-hillshade', type: 'hillshade' },
      { id: 'imagery', type: 'raster' },
      ...BASEMAP.slice(4),
    ])
    keepReliefOverImagery(map)
    expect(map.layers.map((l) => l.id).slice(4, 8)).toEqual([
      'imagery',
      'road-regional-hillshade',
      'road-hrdem-relief',
      'waterway_label',
    ])
    const moves = map.moves
    keepReliefOverImagery(map)
    expect(map.moves).toBe(moves)
  })
})
