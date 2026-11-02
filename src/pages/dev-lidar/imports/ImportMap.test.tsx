import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportMap } from './ImportMap'
import { fileLayer } from './files'
import { emptySession } from './types'
const state = vi.hoisted(() => ({ map: null as any, observers: [] as any[] }))
vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      handlers = new Map()
      layers = new Map()
      sources = new Map()
      removed = false
      resize = vi.fn()
      fitBounds = vi.fn()
      easeTo = vi.fn()
      setLayoutProperty = vi.fn()
      setPaintProperty = vi.fn()
      setGlyphs = vi.fn()
      setSprite = vi.fn()
      constructor(options: any) {
        state.map = this
        for (const l of options.style.layers) this.layers.set(l.id, l)
        for (const [id, source] of Object.entries(options.style.sources)) this.sources.set(id, source)
      }
      on(event: string, cb: any) {
        this.handlers.set(event, cb)
      }
      addSource(id: string, source: any) {
        if (this.sources.has(id)) throw Error('duplicate source')
        this.sources.set(id, { ...source, setData: vi.fn() })
      }
      addLayer(layer: any, before?: string) {
        if (this.layers.has(layer.id)) throw Error('duplicate layer')
        if (before && !this.layers.has(before)) throw Error('Missing anchor: ' + before)
        this.layers.set(layer.id, layer)
      }
      getSource(id: string) {
        return this.sources.get(id)
      }
      getLayer(id: string) {
        return this.layers.get(id)
      }
      removeLayer(id: string) {
        this.layers.delete(id)
      }
      removeSource(id: string) {
        this.sources.delete(id)
      }
      addControl() {}
      removeControl() {}
      remove() {
        this.removed = true
      }
    },
    NavigationControl: class {},
    ScaleControl: class {},
  },
}))
vi.mock('maplibre-gl-lidar', () => ({
  LidarControl: class {
    on() {}
    getContainer() {
      return undefined
    }
  },
}))
let renderer: ReactTestRenderer
async function mount(props: any) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(public callback: () => void) {
        state.observers.push(this)
      }
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 8,
        sources: { world: { type: 'vector', tiles: ['https://example.org/{z}/{x}/{y}.pbf'] } },
        layers: [
          { id: 'context-background', type: 'background' },
          { id: 'forest', type: 'fill', source: 'world', 'source-layer': 'forest' },
        ],
      }),
    }),
  )
  await act(async () => {
    renderer = create(<ImportMap {...props} />, { createNodeMock: (n) => (n.type === 'div' ? {} : null) })
  })
  await act(async () => state.map.handlers.get('load')())
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  vi.unstubAllGlobals()
  state.observers.length = 0
})
const props = () => ({
  session: emptySession(),
  basemap: 'vector',
  fit: 0,
  selected: '',
  feature: null,
  view3d: false,
  onPick: vi.fn(),
  onSample: vi.fn(),
  onPointStatus: vi.fn(),
})
describe('import map adapter', () => {
  it('installs namespaced vector context under imported layers and resizes with the pane', async () => {
    await mount(props())
    expect(state.map.layers.has('analysis-height')).toBe(true)
    expect(state.map.layers.has('basemap-vector-context-background')).toBe(true)
    expect(state.map.layers.has('basemap-vector-forest')).toBe(true)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    state.observers[0].callback()
    expect(state.map.resize).toHaveBeenCalled()
    const observer = state.observers[0],
      map = state.map
    await act(async () => renderer.unmount())
    expect(observer.disconnect).toHaveBeenCalled()
    expect(map.removed).toBe(true)
  })
  it('reconciles layer visibility, opacity, selection and removal while switching basemaps', async () => {
    const layer = await fileLayer(
      new File(
        [
          JSON.stringify({
            type: 'Feature',
            properties: { candidate_id: 0 },
            geometry: { type: 'Point', coordinates: [-122.8, 53.9] },
          }),
        ],
        'trees.geojson',
      ),
    )
    let p = { ...props(), selected: layer.id, session: { ...emptySession(), layers: [layer] } }
    await mount(p)
    const id = 'import-' + layer.id
    expect(state.map.layers.has(id + '-point')).toBe(true)
    const data = state.map.sources.get(id).data
    expect(data.features[0].properties).toMatchObject({ candidate_id: 0, _pg_index: 0, _pg_layer: layer.id })
    expect(layer.kind === 'vector' && layer.data.features[0].properties).toEqual({ candidate_id: 0 })
    p = {
      ...p,
      basemap: 'satellite',
      feature: 0 as any,
      session: { ...p.session, layers: [{ ...layer, visible: false, opacity: 0.25 }] },
    }
    await act(async () => renderer.update(<ImportMap {...(p as any)} />))
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith(id + '-point', 'visibility', 'none')
    expect(state.map.setPaintProperty).toHaveBeenCalledWith(id + '-point', 'circle-opacity', 0.25)
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith('basemap-satellite', 'visibility', 'visible')
    expect(state.map.sources.get('import-selected').setData).toHaveBeenLastCalledWith({
      type: 'FeatureCollection',
      features: [],
    })
    await act(async () => renderer.update(<ImportMap {...(props() as any)} />))
    expect(state.map.layers.has(id + '-point')).toBe(false)
    expect(state.map.sources.has(id)).toBe(false)
  })
})
