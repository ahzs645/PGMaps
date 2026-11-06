import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { MapTerrain } from '@pgmaps/geo-toolkit/map/layers/terrain'

const state = vi.hoisted(() => ({ map: null as unknown }))
vi.mock('../../../packages/geo-toolkit/src/map/map-context', () => ({
  useMap: () => ({ map: state.map, isLoaded: true }),
}))

function fakeMap() {
  const sources = new Map<string, unknown>()
  const layers: string[] = ['context', 'analysis-height', 'label']
  return {
    sources,
    layers,
    setTerrain: vi.fn(),
    setSky: vi.fn(),
    getTerrain: () => ({ source: 'terrain-dem' }),
    getStyle: () => ({ layers: layers.map((id) => ({ id, type: 'background' })) }),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: unknown) => void sources.set(id, source),
    removeSource: (id: string) => void sources.delete(id),
    getLayer: (id: string) => layers.includes(id) || undefined,
    addLayer: (layer: { id: string }, before?: string) => {
      layers.splice(before ? layers.indexOf(before) : layers.length, 0, layer.id)
    },
    removeLayer: (id: string) => void layers.splice(layers.indexOf(id), 1),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
  }
}
const dem = { tiles: ['https://example.test/{z}/{x}/{y}.png'], encoding: 'terrarium' as const }

describe('relief-only hillshade', () => {
  it('sits under the data and leaves terrain owned by something else alone', async () => {
    const map = fakeMap()
    state.map = map
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<MapTerrain id="lidar" dem={dem} reliefOnly beforeId="analysis-height" />)
    })
    expect(map.layers).toEqual(['context', 'lidar-hillshade', 'analysis-height', 'label'])
    expect([...map.sources.keys()]).toEqual(['lidar-dem-hillshade'])
    await act(async () => view.unmount())
    expect(map.layers).toEqual(['context', 'analysis-height', 'label'])
    expect(map.setTerrain).not.toHaveBeenCalled()
    expect(map.setSky).not.toHaveBeenCalled()
  })
  it('still manages terrain by default', async () => {
    const map = fakeMap()
    state.map = map
    let view!: ReturnType<typeof create>
    await act(async () => {
      view = create(<MapTerrain id="site" dem={dem} terrain />)
    })
    expect(map.setTerrain).toHaveBeenCalledWith({ source: 'site-dem-terrain', exaggeration: 1 })
    await act(async () => view.unmount())
    expect(map.setTerrain).toHaveBeenLastCalledWith(null)
  })
})
