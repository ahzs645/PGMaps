import type { ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ImportMap } from './ImportMap'
import { fileLayer } from './files'
import { emptySession } from './types'
type Props = ComponentProps<typeof ImportMap>
interface MockSource {
  data?: { features: Array<{ properties: Record<string, unknown> }> }
  setData: Mock
}
interface MockMap {
  handlers: Map<string, () => void>
  layers: Map<string, unknown>
  sources: Map<string, MockSource>
  removed: boolean
  resize: Mock
  setLayoutProperty: Mock
  setPaintProperty: Mock
}
interface MockObserver {
  callback: () => void
  disconnect: Mock
}
const state = vi.hoisted(() => ({ map: null as unknown as MockMap, observers: [] as MockObserver[] }))
interface StyleInput {
  style: { layers: Array<{ id: string }>; sources: Record<string, unknown> }
}
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
      constructor(options: StyleInput) {
        state.map = this as unknown as MockMap
        for (const l of options.style.layers) this.layers.set(l.id, l)
        for (const [id, source] of Object.entries(options.style.sources)) this.sources.set(id, source)
      }
      on(event: string, cb: () => void) {
        this.handlers.set(event, cb)
      }
      addSource(id: string, source: object) {
        if (this.sources.has(id)) throw Error('duplicate source')
        this.sources.set(id, { ...source, setData: vi.fn() })
      }
      addLayer(layer: { id: string }, before?: string) {
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
      getContainer() {
        return undefined
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
// The toolkit map's own lifecycle has its own tests; this file pins the layers ImportMap adds.
vi.mock('@/components/ui/map', async () => {
  const { useEffect } = await import('react')
  const { default: maplibre } = await import('maplibre-gl')
  const Map = ({
    styles,
    onMapCreate,
  }: {
    styles: { light: unknown }
    onMapCreate: (map: unknown) => void | (() => void)
  }) => {
    useEffect(() => {
      const map = new (maplibre.Map as unknown as new (options: unknown) => { remove(): void })({ style: styles.light })
      const release = onMapCreate(map)
      return () => {
        release?.()
        map.remove()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return null
  }
  return { Map, MapControls: () => null, MapScaleBar: () => null, useMap: () => ({ map: null, isLoaded: false }) }
})
vi.mock('maplibre-gl-lidar', () => ({
  LidarControl: class {
    on() {}
    getContainer() {
      return undefined
    }
  },
}))
let renderer: ReactTestRenderer
async function mount(props: Props) {
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
  await act(async () => state.map.handlers.get('load')!())
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount())
  vi.unstubAllGlobals()
  state.observers.length = 0
})
const props = (): Props => ({
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
  it('installs namespaced vector context under imported layers', async () => {
    await mount(props())
    expect(state.map.layers.has('analysis-height')).toBe(true)
    expect(state.map.layers.has('basemap-vector-context-background')).toBe(true)
    expect(state.map.layers.has('basemap-vector-forest')).toBe(true)
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    const map = state.map
    await act(async () => renderer.unmount())
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
    let p: Props = { ...props(), selected: layer.id, session: { ...emptySession(), layers: [layer] } }
    await mount(p)
    const id = 'import-' + layer.id
    expect(state.map.layers.has(id + '-point')).toBe(true)
    const data = state.map.sources.get(id)!.data!
    expect(data.features[0].properties).toMatchObject({ candidate_id: 0, _pg_index: 0, _pg_layer: layer.id })
    expect(layer.kind === 'vector' && layer.data.features[0].properties).toEqual({ candidate_id: 0 })
    p = {
      ...p,
      basemap: 'satellite',
      feature: 0,
      session: { ...p.session, layers: [{ ...layer, visible: false, opacity: 0.25 }] },
    }
    await act(async () => renderer.update(<ImportMap {...p} />))
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith(id + '-point', 'visibility', 'none')
    expect(state.map.setPaintProperty).toHaveBeenCalledWith(id + '-point', 'circle-opacity', 0.25)
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith('basemap-satellite', 'visibility', 'visible')
    expect(state.map.sources.get('import-selected')!.setData).toHaveBeenLastCalledWith({
      type: 'FeatureCollection',
      features: [],
    })
    await act(async () => renderer.update(<ImportMap {...props()} />))
    expect(state.map.layers.has(id + '-point')).toBe(false)
    expect(state.map.sources.has(id)).toBe(false)
  })
})
