import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { captureMapImage } from './mapImageCapture'

function fixture() {
  const handlers = new Map<string, Set<() => void>>()
  const drawImage = vi.fn()
  const copy = {
    getContext: () => ({ drawImage, getImageData: () => ({ data: [10, 20, 30, 255] }) }),
    width: 0,
    height: 0,
  }
  vi.stubGlobal('document', { createElement: () => copy })
  const source = { width: 1200, height: 800, clientWidth: 600, clientHeight: 400 }
  const map = {
    on: (name: string, fn: () => void) => {
      if (!handlers.has(name)) handlers.set(name, new Set())
      handlers.get(name)!.add(fn)
    },
    off: (name: string, fn: () => void) => handlers.get(name)?.delete(fn),
    loaded: vi.fn(() => true),
    isMoving: vi.fn(() => false),
    getCanvas: () => source,
    unproject: ([x, y]: number[]) => ({ lng: -123 + x / 1000, lat: 54 - y / 1000 }),
    getCenter: () => ({ lng: -123, lat: 54 }),
    project: (point: { lng: number; lat: number } | number[]) => ({ x: 300, y: Array.isArray(point) ? 199 : 200 }),
    getBearing: () => 0,
    getPitch: () => 0,
    getContainer: () => ({ querySelectorAll: () => [{ textContent: '© Map Provider' }] }),
    triggerRepaint: vi.fn(),
  }
  return {
    map,
    source,
    copy,
    drawImage,
    handlers,
    render: () => [...(handlers.get('render') ?? [])].forEach((fn) => fn()),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('render-frame map image capture', () => {
  it('copies only inside a ready render frame, preserves the backing dimensions, and removes listeners', async () => {
    const f = fixture()
    const pending = captureMapImage(f.map as unknown as MapLibreMap)
    expect(f.map.triggerRepaint).toHaveBeenCalledOnce()
    expect(f.drawImage).not.toHaveBeenCalled()
    f.map.loaded.mockReturnValueOnce(false)
    f.render()
    expect(f.drawImage).not.toHaveBeenCalled()
    f.render()
    const result = await pending
    expect(f.drawImage).toHaveBeenCalledWith(f.source, 0, 0)
    expect(result.canvas).toBe(f.copy)
    expect(f.copy).toMatchObject({ width: 1200, height: 800 })
    expect(result).toMatchObject({ cssWidth: 600, cssHeight: 400, northAngle: 0, attribution: '© Map Provider' })
    expect(result.metersPerCssPixel).toBeGreaterThan(60)
    expect(f.handlers.get('render')?.size).toBe(0)
    expect(f.handlers.get('remove')?.size).toBe(0)
  })

  it('cancels without retaining a render listener or reporting an old image', async () => {
    const f = fixture()
    const controller = new AbortController()
    const pending = captureMapImage(f.map as unknown as MapLibreMap, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.handlers.get('render')?.size).toBe(0)
    f.render()
    expect(f.drawImage).not.toHaveBeenCalled()
  })

  it('fails explicitly if a map never finishes rendering', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const pending = captureMapImage(f.map as unknown as MapLibreMap, undefined, 100)
    const failure = expect(pending).rejects.toThrow(/still loading/)
    await vi.advanceTimersByTimeAsync(101)
    await failure
    expect(f.handlers.get('render')?.size).toBe(0)
  })
})
