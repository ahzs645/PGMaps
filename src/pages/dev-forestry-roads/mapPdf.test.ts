import type { Map as MapLibreMap } from 'maplibre-gl'
import type html2canvas from 'html2canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportMapPdf } from './pdf'

const captured = vi.hoisted(() => ({
  compose: vi.fn(),
  download: vi.fn(),
  pdf: {
    internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
    setFontSize: vi.fn(),
    splitTextToSize: vi.fn((value: string) => [value]),
    text: vi.fn(),
    addImage: vi.fn(),
    output: vi.fn(() => new Blob(['%PDF-map-fixture'])),
  },
}))
vi.mock('html2canvas', () => ({ default: captured.compose }))
vi.mock('@/lib/download', () => ({ downloadBlob: captured.download }))
vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor() {
      return captured.pdf
    }
  },
}))

type CompositionOptions = NonNullable<Parameters<typeof html2canvas>[1]>

function fixture() {
  const listeners = new Map<string, () => void>()
  const source = {
    tagName: 'CANVAS',
    className: 'maplibregl-canvas',
    style: { cssText: 'width:200px;height:100px;transform:translate(0,0)' },
    clientWidth: 200,
    clientHeight: 100,
    toDataURL: vi.fn(() => 'data:image/png;base64,captured-map'),
    getContext: vi.fn(() => {
      throw Error('The live WebGL canvas must not be cloned again')
    }),
  }
  const marker = { tagName: 'DIV', hasAttribute: () => false, getAttribute: () => null, querySelector: () => null }
  const legend = { ...marker }
  const container = {
    contains: (element: unknown) => [source, marker, legend].includes(element as typeof source),
    getBoundingClientRect: () => ({ width: 200.25, height: 100.5 }),
  }
  const context = {}
  const encodedDimensions: number[][] = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => {
      encodedDimensions.push([canvas.width, canvas.height])
      return 'data:image/png;base64,composed-map-and-overlays'
    }),
  }
  const originalFrame = { remove: vi.fn() }
  const frame = { remove: vi.fn() }
  const frames = [originalFrame]
  frame.remove.mockImplementation(() => {
    const index = frames.indexOf(frame)
    if (index >= 0) frames.splice(index, 1)
  })
  const image = {
    src: '',
    className: '',
    style: { cssText: '', width: '', height: '' },
    decode: vi.fn().mockResolvedValue(undefined),
  }
  const cloneChildren: unknown[] = [marker, legend]
  const host = { prepend: vi.fn((node) => cloneChildren.unshift(node)) }
  const clonedMap = { querySelector: vi.fn(() => host) }
  const clonedDocument = { createElement: vi.fn(() => image), defaultView: { frameElement: frame } }
  vi.stubGlobal('document', {
    createElement: vi.fn(() => canvas),
    querySelectorAll: vi.fn(() => frames.slice()),
    querySelector: vi.fn(() => {
      throw Error('Replacement must use the specific cloned map root')
    }),
  })
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return { body: { textContent: 'Terrain source terms' } }
      }
    },
  )
  const map = {
    once: vi.fn((type: string, callback: () => void) => listeners.set(type, callback)),
    off: vi.fn((type: string) => listeners.delete(type)),
    triggerRepaint: vi.fn(() => listeners.get('render')?.()),
    getCanvas: () => source,
    getContainer: () => container,
    getStyle: () => ({ sources: { ground: { attribution: '<a>Terrain source terms</a>' } } }),
  }
  captured.compose.mockImplementation(async (_container: unknown, options: CompositionOptions) => {
    frames.push(frame)
    await options.onclone?.(clonedDocument as unknown as Document, clonedMap as unknown as HTMLElement)
    return options.canvas
  })
  const exportPdf = (signal?: AbortSignal) =>
    exportMapPdf(
      map as unknown as MapLibreMap,
      'Review road',
      'Survey DEM',
      'Recorded vertical datum',
      'road-map.pdf',
      signal,
    )
  return {
    source,
    container,
    marker,
    legend,
    canvas,
    encodedDimensions,
    frames,
    frame,
    originalFrame,
    image,
    clonedMap,
    clonedDocument,
    cloneChildren,
    map,
    listeners,
    exportPdf,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('map PDF composition', () => {
  it('reads WebGL once, composes on a CPU canvas, and keeps markers and legends above the captured map', async () => {
    const f = fixture()
    await f.exportPdf()
    const options = captured.compose.mock.calls[0][1] as CompositionOptions
    expect(f.source.toDataURL).toHaveBeenCalledTimes(1)
    expect(f.source.getContext).not.toHaveBeenCalled()
    expect(options.ignoreElements!(f.source as unknown as Element)).toBe(true)
    expect(options.ignoreElements!(f.marker as unknown as Element)).toBe(false)
    expect(options.ignoreElements!(f.legend as unknown as Element)).toBe(false)
    expect(f.clonedMap.querySelector).toHaveBeenCalledWith('.maplibregl-canvas-container')
    expect(f.cloneChildren).toEqual([f.image, f.marker, f.legend])
    expect(f.image).toMatchObject({
      src: 'data:image/png;base64,captured-map',
      className: 'maplibregl-canvas',
      style: { cssText: f.source.style.cssText, width: '200px', height: '100px' },
    })
    expect(f.canvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
    expect(options).toMatchObject({ canvas: f.canvas, width: 201, height: 101, scale: 2, imageTimeout: 10000 })
    expect(f.encodedDimensions).toEqual([[402, 202]])
    expect(captured.pdf.addImage.mock.calls[0][0]).toBe('data:image/png;base64,composed-map-and-overlays')
    expect(captured.pdf.text.mock.calls.flat()).toContain('Terrain source terms')
    expect(captured.download).toHaveBeenCalledWith(expect.any(Blob), 'road-map.pdf')
    expect(f.frame.remove).toHaveBeenCalled()
    expect(f.originalFrame.remove).not.toHaveBeenCalled()
    expect(f.canvas).toMatchObject({ width: 0, height: 0 })
    expect(f.listeners.size).toBe(0)
  })

  it('keeps the existing 10 second render limit and removes callbacks on abort or timeout', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.map.triggerRepaint.mockImplementation(() => {})
    const failure = expect(f.exportPdf()).rejects.toThrow('The map did not finish rendering')
    await vi.advanceTimersByTimeAsync(10000)
    await failure
    expect(f.listeners.size).toBe(0)
    expect(captured.compose).not.toHaveBeenCalled()
    const abort = new AbortController()
    const cancelled = expect(f.exportPdf(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await cancelled
    expect(f.listeners.size).toBe(0)
    expect(captured.download).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds a stalled clone before onclone and releases only its own iframe and output canvas', async () => {
    vi.useFakeTimers()
    const f = fixture()
    captured.compose.mockImplementation(() => {
      f.frames.push(f.frame)
      return new Promise(() => {})
    })
    const failure = expect(f.exportPdf()).rejects.toThrow('The map image could not be prepared in time')
    await vi.waitFor(() => expect(captured.compose).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(10000)
    await failure
    expect(f.frame.remove).toHaveBeenCalled()
    expect(f.originalFrame.remove).not.toHaveBeenCalled()
    expect(f.canvas).toMatchObject({ width: 0, height: 0 })
    expect(captured.download).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels image composition, consumes late decode rejection and never downloads a partial PDF', async () => {
    const f = fixture()
    let rejectDecode!: (error: Error) => void
    f.image.decode.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDecode = reject
        }),
    )
    const abort = new AbortController()
    const failure = expect(f.exportPdf(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(f.image.decode).toHaveBeenCalled())
    abort.abort()
    await failure
    rejectDecode(Error('Late decode failure'))
    await Promise.resolve()
    expect(f.frame.remove).toHaveBeenCalled()
    expect(f.canvas.toDataURL).not.toHaveBeenCalled()
    expect(captured.download).not.toHaveBeenCalled()
  })
})
