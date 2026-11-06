import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { RasterMapLayer } from './RasterMapLayer'
import type { RasterRecord } from './catalogue'

const { map } = vi.hoisted(() => ({
  map: {
    getContainer: vi.fn(() => ({
      closest: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, right: 1000, top: 0, bottom: 800 }),
    })),
    getPadding: vi.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
    isStyleLoaded: vi.fn(() => false), // Existing raster tiles are still loading.
    getLayer: vi.fn(() => undefined),
    getSource: vi.fn(() => undefined),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    removeSource: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    setPaintProperty: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}))
vi.mock('@/components/ui/map', () => ({ useMap: () => ({ map, isLoaded: true }) }))
vi.mock('maplibre-gl', () => ({ default: { addProtocol: vi.fn() } }))
vi.mock('pmtiles', () => ({
  Protocol: class {
    tile = vi.fn()
  },
}))
const item: RasterRecord = {
  id: 'a',
  title: 'A',
  bounds: [-126, 53, -124, 55],
  assets: [{ url: 'https://maps.example.test/a.pmtiles', bounds: [-126, 53, -124, 55], minZoom: 3, maxZoom: 14 }],
  sources: [],
  fullSheets: [],
  downloads: [],
}
describe('Map selection during pending raster requests', () => {
  it('installs and frames the selected map even while prior tiles are loading', () => {
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    let root: ReturnType<typeof create>
    act(() => {
      root = create(<RasterMapLayer item={item} opacity={65} onError={vi.fn()} />)
    })
    expect(map.addSource).toHaveBeenCalledWith(
      'shared-raster-0',
      expect.objectContaining({ tiles: ['pmtiles://https://maps.example.test/a.pmtiles/{z}/{x}/{y}'] }),
    )
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [
        [-126, 53],
        [-124, 55],
      ],
      expect.any(Object),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    act(() => root.unmount())
    vi.unstubAllGlobals()
  })
})
