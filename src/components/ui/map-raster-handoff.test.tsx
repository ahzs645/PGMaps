import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MapRasterLayer } from '@pgmaps/geo-toolkit/map/layers/raster'
import { MapHandoffNote, MapRasterHandoff, useMapLayerHandoff } from './map-raster-handoff'

type Handler = (event: { sourceId?: string; tile?: unknown }) => void

const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: object) => void>>()
  const loaded = new Map<string, boolean>()
  const paint: Array<[string, string, unknown]> = []
  const map = {
    on: (type: string, handler: (event: object) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type)!.add(handler)
    },
    off: (type: string, handler: (event: object) => void) => handlers.get(type)?.delete(handler),
    getSource: () => ({}),
    getLayer: () => ({}),
    isSourceLoaded: (id: string) => loaded.get(id) ?? false,
    setPaintProperty: (id: string, name: string, value: unknown) => paint.push([id, name, value]),
    triggerRepaint: () => undefined,
  }
  return { handlers, loaded, paint, map }
})

// The component lives in the toolkit, which has no component tests of its own: mock what it imports there.
vi.mock('@pgmaps/geo-toolkit/map/map-context', () => ({ useMap: () => ({ map: fake.map, isLoaded: true }) }))
// Only the props each layer is drawn with matter here; the real layer needs a MapLibre map.
vi.mock('@pgmaps/geo-toolkit/map/layers/raster', () => ({ MapRasterLayer: () => null }))

const fire = (type: string, event: Parameters<Handler>[0] = {}) => {
  for (const handler of [...(fake.handlers.get(type) ?? [])]) handler(event)
}

function Harness({ release }: { release: string | null }) {
  const handoff = useMapLayerHandoff('wb', release ? { key: release, value: release } : null, { timeLimitMs: 4000 })
  return (
    <>
      <span data-shown={handoff.shownLayerId} />
      <MapRasterHandoff handoff={handoff} layer={(value) => ({ tiles: [`https://tiles/${value}/{z}/{x}/{y}`] })} />
      <MapHandoffNote handoff={handoff}>Still the previous layer</MapHandoffNote>
    </>
  )
}

const shownLayerIdOf = (renderer: ReactTestRenderer) => renderer.root.findByType('span').props['data-shown'] ?? null

const noteShown = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.props['data-testid'] === 'map-handoff-note').length > 0

const layers = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(MapRasterLayer).map((layer) => ({
    id: layer.props.id as string,
    opacity: layer.props.opacity as number,
    tiles: (layer.props.tiles as string[])[0],
  }))

describe('MapRasterHandoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fake.handlers.clear()
    fake.loaded.clear()
    fake.paint.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the shown release drawn until the next has its tiles, then swaps in one render', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Harness release="a" />)
    })
    expect(layers(renderer)).toEqual([{ id: 'wb', opacity: 1, tiles: 'https://tiles/a/{z}/{x}/{y}' }])

    act(() => renderer.update(<Harness release="b" />))
    expect(layers(renderer)).toEqual([
      { id: 'wb', opacity: 1, tiles: 'https://tiles/a/{z}/{x}/{y}' },
      { id: 'wb-handoff', opacity: 0, tiles: 'https://tiles/b/{z}/{x}/{y}' },
    ])
    expect(shownLayerIdOf(renderer)).toBe('wb')
    // Opacity changes at once, so the swap does not fade the incoming layer up over nothing.
    expect(fake.paint).toContainEqual(['wb-handoff', 'raster-opacity-transition', { duration: 0, delay: 0 }])

    // A tile landed but another is still loading: nothing changes.
    act(() => fire('sourcedata', { sourceId: 'wb-handoff', tile: {} }))
    expect(layers(renderer)).toHaveLength(2)
    // Another source's tiles say nothing about this one.
    fake.loaded.set('wb-handoff', true)
    act(() => fire('sourcedata', { sourceId: 'other', tile: {} }))
    expect(layers(renderer)).toHaveLength(2)

    act(() => fire('sourcedata', { sourceId: 'wb-handoff', tile: {} }))
    expect(layers(renderer)).toEqual([{ id: 'wb-handoff', opacity: 1, tiles: 'https://tiles/b/{z}/{x}/{y}' }])
    expect(shownLayerIdOf(renderer)).toBe('wb-handoff')
  })

  it('a source loaded before any tile landed does not count', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Harness release="a" />)
    })
    fake.loaded.set('wb-handoff', true)
    act(() => renderer.update(<Harness release="b" />))
    act(() => fire('sourcedata', { sourceId: 'wb-handoff' }))
    expect(layers(renderer)).toHaveLength(2)
    // An idle map has nothing left to load for it, tiles or not.
    act(() => fire('idle'))
    expect(layers(renderer)).toEqual([{ id: 'wb-handoff', opacity: 1, tiles: 'https://tiles/b/{z}/{x}/{y}' }])
  })

  it('playback faster than the tiles drops releases, never mounts a third, and still moves on', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Harness release="a" />)
    })
    act(() => renderer.update(<Harness release="b" />))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => renderer.update(<Harness release="c" />))
    expect(layers(renderer).map((layer) => layer.tiles)).toEqual([
      'https://tiles/a/{z}/{x}/{y}',
      'https://tiles/c/{z}/{x}/{y}',
    ])
    // Four seconds behind: the next release waits for c rather than replacing it.
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => renderer.update(<Harness release="d" />))
    expect(layers(renderer).map((layer) => layer.tiles)).toEqual([
      'https://tiles/a/{z}/{x}/{y}',
      'https://tiles/c/{z}/{x}/{y}',
    ])
    // c has its tiles: it is shown and d starts loading where a was.
    fake.loaded.set('wb-handoff', true)
    act(() => fire('sourcedata', { sourceId: 'wb-handoff', tile: {} }))
    expect(layers(renderer)).toEqual([
      { id: 'wb-handoff', opacity: 1, tiles: 'https://tiles/c/{z}/{x}/{y}' },
      { id: 'wb', opacity: 0, tiles: 'https://tiles/d/{z}/{x}/{y}' },
    ])
  })

  it('shows a layer whose tiles never come once its own time is up', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Harness release="a" />)
    })
    act(() => renderer.update(<Harness release="b" />))
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(layers(renderer)).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(layers(renderer)).toEqual([{ id: 'wb-handoff', opacity: 1, tiles: 'https://tiles/b/{z}/{x}/{y}' }])
  })

  it('turning the layer off removes both at once', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Harness release="a" />)
    })
    act(() => renderer.update(<Harness release="b" />))
    act(() => renderer.update(<Harness release={null} />))
    expect(layers(renderer)).toEqual([])
    expect(shownLayerIdOf(renderer)).toBeNull()
    act(() => renderer.update(<Harness release="c" />))
    expect(layers(renderer)).toEqual([{ id: 'wb', opacity: 1, tiles: 'https://tiles/c/{z}/{x}/{y}' }])
  })

  it('says the map still shows the previous layer only once a hand-off has lasted, and stops with the swap', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(<Harness release="a" />)
    })
    expect(noteShown(renderer)).toBe(false)
    act(() => renderer.update(<Harness release="b" />))
    act(() => {
      vi.advanceTimersByTime(399)
    })
    // A quick swap says nothing.
    expect(noteShown(renderer)).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(noteShown(renderer)).toBe(true)
    // A newer request while still behind keeps the note up.
    act(() => renderer.update(<Harness release="c" />))
    expect(noteShown(renderer)).toBe(true)
    fake.loaded.set('wb-handoff', true)
    act(() => fire('sourcedata', { sourceId: 'wb-handoff', tile: {} }))
    expect(noteShown(renderer)).toBe(false)
    // The next hand-off starts its own wait.
    act(() => renderer.update(<Harness release="d" />))
    expect(noteShown(renderer)).toBe(false)
  })
})
