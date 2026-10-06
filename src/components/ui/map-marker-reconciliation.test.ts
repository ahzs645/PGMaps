import { describe, expect, it, vi } from 'vitest'
import type MapLibreGL from 'maplibre-gl'
import { observeMarkerSource, sameMarkerPosition } from './map-marker-reconciliation'

function mapProbe() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>()
  let loaded = true
  let present = true
  const probe = {
    on(type: string, listener: (event?: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    off(type: string, listener: (event?: unknown) => void) {
      listeners.get(type)?.delete(listener)
    },
    getSource: () => (present ? {} : undefined),
    isSourceLoaded: () => loaded,
  }
  return {
    map: probe as unknown as MapLibreGL.Map,
    fire(type: string, event?: unknown) {
      listeners.get(type)?.forEach((listener) => listener(event))
    },
    setLoaded(value: boolean) {
      loaded = value
    },
    setPresent(value: boolean) {
      present = value
    },
  }
}

describe('HTML marker reconciliation', () => {
  it('ignores unrelated frames and source events, coalescing view changes', () => {
    const probe = mapProbe()
    const reconcile = vi.fn()
    const stop = observeMarkerSource(probe.map, 'clusters', reconcile)
    expect(reconcile).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 60; i++) probe.fire('render')
    probe.fire('sourcedata', { sourceId: 'basemap' })
    probe.fire('render')
    expect(reconcile).toHaveBeenCalledTimes(1)
    probe.fire('move')
    probe.fire('resize')
    probe.fire('move')
    probe.fire('render')
    expect(reconcile).toHaveBeenCalledTimes(2)
    stop()
    probe.fire('move')
    probe.fire('sourcedata', { sourceId: 'clusters' })
    probe.fire('render')
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('keeps pending changes until the source finishes loading or is recreated', () => {
    const probe = mapProbe()
    probe.setPresent(false)
    const reconcile = vi.fn()
    observeMarkerSource(probe.map, 'clusters', reconcile)
    probe.fire('render')
    expect(reconcile).not.toHaveBeenCalled()
    probe.setPresent(true)
    probe.setLoaded(false)
    probe.fire('sourcedata', { sourceId: 'clusters' })
    probe.fire('render')
    expect(reconcile).not.toHaveBeenCalled()
    probe.setLoaded(true)
    probe.fire('render')
    expect(reconcile).toHaveBeenCalledTimes(1)
    probe.fire('sourcedata', { sourceId: 'clusters' })
    probe.fire('render')
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(sameMarkerPosition([-123, 54], [-123, 54])).toBe(true)
    expect(sameMarkerPosition([-123, 54], [-123, 55])).toBe(false)
  })
})
