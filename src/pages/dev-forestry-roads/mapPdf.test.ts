import type { Map as MapLibreMap } from 'maplibre-gl'
import type html2canvas from 'html2canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapPdf, mapPdfNotice } from './mapPdf'
import { captureCamera, framedMapBox, type MapPdfPlan } from './mapPdfFrame'

const captured = vi.hoisted(() => ({
  compose: vi.fn(),
  register: vi.fn(async (_bytes: unknown, _viewports: unknown[]) => new Uint8Array([37, 80, 68, 70])),
  pdf: {
    internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
    setFontSize: vi.fn(),
    splitTextToSize: vi.fn((value: string) => [value]),
    text: vi.fn(),
    addImage: vi.fn(),
    setDrawColor: vi.fn(),
    setFillColor: vi.fn(),
    setTextColor: vi.fn(),
    setLineWidth: vi.fn(),
    rect: vi.fn(),
    output: vi.fn((type?: string) => (type === 'arraybuffer' ? new ArrayBuffer(4) : new Blob(['%PDF-map-fixture']))),
  },
}))
vi.mock('html2canvas', () => ({ default: captured.compose }))
vi.mock('@/lib/geoPdf/writeViewport', () => ({ addMapViewports: captured.register, WEB_MERCATOR_WKT: 'WEB MERCATOR' }))
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
    width: 200,
    style: { cssText: 'width:200px;height:100px;transform:translate(0,0)' },
    clientWidth: 200,
    clientHeight: 100,
    toDataURL: vi.fn(() => 'data:image/png;base64,captured-map'),
    getContext: vi.fn(() => {
      throw Error('The live WebGL canvas must not be cloned again')
    }),
  }
  const marker = {
    tagName: 'DIV',
    hasAttribute: () => false,
    getAttribute: () => null,
    querySelector: () => null,
    closest: () => null,
  }
  const legend = { ...marker }
  // A station label is a button inside a marker; zoom and layer buttons are map controls.
  const stationLabel = {
    ...marker,
    tagName: 'BUTTON',
    closest: (selector: string) => (selector === '.maplibregl-marker' ? marker : null),
  }
  const control = { ...marker, tagName: 'BUTTON' }
  const container = {
    clientWidth: 200,
    clientHeight: 100,
    contains: (element: unknown) => [source, marker, legend].includes(element as typeof source),
    getBoundingClientRect: () => ({ width: 200.25, height: 100.5 }),
  }
  const context = { drawImage: vi.fn() }
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
  const clonedMap = {
    querySelector: vi.fn(() => host),
    querySelectorAll: vi.fn(() => []),
    style: { width: '', height: '', flex: '' },
  }
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
  const view = {
    bearing: 12,
    pitch: 0,
    terrain: null as object | null,
    center: { lng: -121.5, lat: 53.75 },
    zoom: 9,
    /** MapLibre clamps the zoom to its range; a test sets this to see the export refuse. */
    maxZoom: 24,
    pixelRatio: 1,
    overridePixelRatio: undefined as number | undefined,
  }
  const map = {
    getBearing: () => view.bearing,
    getPitch: () => view.pitch,
    getTerrain: () => view.terrain,
    setTerrain: vi.fn((terrain: object | null) => (view.terrain = terrain)),
    getCenter: () => view.center,
    getZoom: () => view.zoom,
    jumpTo: vi.fn(
      (camera: {
        center?: [number, number] | { lng: number; lat: number }
        zoom?: number
        bearing?: number
        pitch?: number
      }) => {
        if (camera.center)
          view.center = Array.isArray(camera.center) ? { lng: camera.center[0], lat: camera.center[1] } : camera.center
        if (camera.zoom !== undefined) view.zoom = Math.min(view.maxZoom, camera.zoom)
        if (camera.bearing !== undefined) view.bearing = camera.bearing
        if (camera.pitch !== undefined) view.pitch = camera.pitch
      },
    ),
    getPixelRatio: () => view.overridePixelRatio ?? view.pixelRatio,
    setPixelRatio: vi.fn((ratio: number | undefined) => {
      view.overridePixelRatio = ratio
      source.width = 200 * (ratio ?? view.pixelRatio)
    }),
    get _overridePixelRatio() {
      return view.overridePixelRatio
    },
    // A plan 200 x 100 px over a degree by half a degree, so the corners can be checked.
    unproject: ([x, y]: [number, number]) => ({ lng: -122 + x / 200, lat: 54 - y / 200 }),
    once: vi.fn((type: string, callback: () => void) => listeners.set(type, callback)),
    off: vi.fn((type: string) => listeners.delete(type)),
    triggerRepaint: vi.fn(() => {
      listeners.get('idle')?.()
      listeners.get('render')?.()
    }),
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
    mapPdf(map as unknown as MapLibreMap, {
      plan: AS_SHOWN,
      name: 'Review road',
      terrain: 'Survey DEM',
      datum: 'Recorded vertical datum',
      signal,
    })
  const exportFramed = (plan: MapPdfPlan, signal?: AbortSignal) =>
    mapPdf(map as unknown as MapLibreMap, {
      plan,
      name: 'Review road',
      terrain: 'Survey DEM',
      datum: 'Recorded vertical datum',
      signal,
    })
  return {
    exportFramed,
    source,
    container,
    marker,
    legend,
    stationLabel,
    control,
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
    view,
    listeners,
    exportPdf,
  }
}

/** The default Map PDF: the plan as shown on A4. */
const AS_SHOWN: MapPdfPlan = { mode: 'as-shown', paper: 'a4', orientation: 'auto' }

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('map PDF composition', () => {
  it('reads WebGL once, composes on a CPU canvas, and keeps markers and legends above the captured map', async () => {
    const f = fixture()
    const result = await f.exportPdf()
    const options = captured.compose.mock.calls[0][1] as CompositionOptions
    expect(f.source.toDataURL).toHaveBeenCalledTimes(1)
    expect(f.source.getContext).not.toHaveBeenCalled()
    expect(options.ignoreElements!(f.source as unknown as Element)).toBe(true)
    expect(options.ignoreElements!(f.marker as unknown as Element)).toBe(false)
    expect(options.ignoreElements!(f.legend as unknown as Element)).toBe(false)
    expect(options.ignoreElements!(f.stationLabel as unknown as Element)).toBe(false)
    expect(options.ignoreElements!(f.control as unknown as Element)).toBe(true)
    // The clone keeps the on-screen size, so overlays placed from the bottom edge stay on the image.
    expect(f.clonedMap.style).toEqual({ width: '201px', height: '101px', flex: 'none' })
    expect(f.clonedMap.querySelectorAll).toHaveBeenCalledWith('.maplibregl-marker *')
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
    expect(result.blob).toBeInstanceOf(Blob)
    // Turned 12°, the view is not a Web Mercator picture: printed, not registered, and the notice says why.
    expect(result.georeferenced).toBe(false)
    expect(captured.register).not.toHaveBeenCalled()
    expect(captured.pdf.text.mock.calls.flat()).toContain(
      'DDC Access | Current plan view | Preliminary planning - not for construction',
    )
    expect(mapPdfNotice(AS_SHOWN, result)).toMatch(/Not georeferenced, because the plan is turned or tilted/)
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
    expect(captured.pdf.output).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('registers the plan as shown when it is north-up and flat, with the corners it was captured at', async () => {
    const f = fixture()
    f.view.bearing = 0
    const result = await f.exportPdf()
    expect(result.georeferenced).toBe(true)
    expect(captured.register).toHaveBeenCalledTimes(1)
    const [viewport] = captured.register.mock.calls[0][1] as { corners: number[][]; wkt: string; bbox: number[] }[]
    // The image is the whole plan as composed: 201 x 101 CSS px from 402 x 202.
    expect(viewport.corners).toEqual([
      [-122, 54],
      [-122 + 201 / 200, 54],
      [-122 + 201 / 200, 54 - 101 / 200],
      [-122, 54 - 101 / 200],
    ])
    expect(viewport.wkt).toBe('WEB MERCATOR')
    expect(viewport.bbox[2]).toBeGreaterThan(viewport.bbox[0])
    expect(captured.pdf.text.mock.calls.flat()).toContain(
      'DDC Access | Current plan view | Georeferenced, Web Mercator | Preliminary planning - not for construction',
    )
    expect(mapPdfNotice(AS_SHOWN, result)).toMatch(/georeferenced in Web Mercator/)
    // 3D terrain makes the picture no longer flat Mercator.
    vi.clearAllMocks()
    const tilted = fixture()
    tilted.view.bearing = 0
    tilted.view.terrain = {}
    const flatOff = await tilted.exportPdf()
    expect(flatOff).toMatchObject({ georeferenced: false, unregisteredReason: 'the plan shows 3D terrain' })
    expect(captured.register).not.toHaveBeenCalled()
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
    expect(captured.pdf.output).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels image composition, consumes late decode rejection and never writes a partial PDF', async () => {
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
    expect(captured.pdf.output).not.toHaveBeenCalled()
  })

  it('frames the plan north-up at the stated scale, registers the crop, and puts the plan back', async () => {
    const f = fixture()
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        decode = async () => {}
      },
    )
    f.view.terrain = { source: 'dem' }
    f.view.pitch = 40
    const plan: MapPdfPlan = {
      mode: 'framed',
      paper: 'a4',
      orientation: 'landscape',
      label: 'Block 12',
      bounds: [-122.01, 53.99, -121.99, 54.01],
      center: [-122, 54],
      scale: 20000,
      marginPercent: 10,
    }
    const result = await f.exportFramed(plan)
    // The header ends at 34 mm on this page: the map box and the camera the PDF asked for.
    const box = framedMapBox({ width: 297, height: 210 }, 34)
    const camera = captureCamera(plan.center, 20000, box, { width: 200, height: 100 })
    const framedAt = f.map.jumpTo.mock.calls.find(([options]) => options.zoom !== undefined)![0]
    expect(framedAt).toMatchObject({ center: [-122, 54], zoom: camera.zoom, bearing: 0, pitch: 0 })
    // Drawn flat and sharper, then everything is put back as it was.
    expect(f.map.setTerrain.mock.calls).toEqual([[null], [{ source: 'dem' }]])
    expect(f.map.setPixelRatio.mock.calls).toEqual([[3], [undefined]])
    expect(f.map.jumpTo.mock.lastCall![0]).toEqual({
      center: { lng: -121.5, lat: 53.75 },
      zoom: 9,
      bearing: 12,
      pitch: 40,
      roll: 0,
    })
    expect(f.view).toMatchObject({ bearing: 12, pitch: 40, zoom: 9, terrain: { source: 'dem' } })
    // Composed at the raised ratio, and the page's map is the centred crop of it.
    expect(captured.compose.mock.calls[0][1]).toMatchObject({ scale: 3 })
    const s = 603 / 201
    const x0 = Math.round(camera.crop.x * s),
      x1 = Math.round((camera.crop.x + camera.crop.w) * s),
      y1 = Math.round((camera.crop.y + camera.crop.h) * s)
    const at = (x: number, y: number) => [-122 + x / s / 200, 54 - y / s / 200]
    const [viewport] = captured.register.mock.calls[0][1] as { corners: number[][]; name: string }[]
    expect(viewport.corners).toEqual([at(x0, 0), at(x1, 0), at(x1, y1), at(x0, y1)])
    expect(viewport.name).toBe('Review road Block 12')
    expect(captured.pdf.addImage.mock.calls[0].slice(2)).toEqual([box.x, box.y, box.w, box.h])
    const printed = captured.pdf.text.mock.calls.map((call) => call[0]).flat()
    expect(printed).toContain(
      'Scale 1:20,000 on A4, true at latitude 54.00 N | North up | Web Mercator | Georeferenced (EPSG:3857)',
    )
    expect(printed).toContain('DDC Access | Block 12 | Preliminary planning - not for construction')
    expect(result).toMatchObject({ georeferenced: true, scale: 20000 })
    expect(mapPdfNotice(plan, result)).toMatch(
      /^Map PDF downloaded: Block 12 at 1:20,000, north-up and georeferenced in Web Mercator \(EPSG:3857\).* about \d+ dpi\.$/,
    )
  })

  it('refuses a scale the plan cannot zoom to, and still puts the plan back', async () => {
    const f = fixture()
    f.view.maxZoom = 10
    const plan: MapPdfPlan = {
      mode: 'framed',
      paper: 'a4',
      orientation: 'landscape',
      label: 'Plan centre',
      center: [-122, 54],
      scale: 1000,
      marginPercent: 10,
    }
    await expect(f.exportFramed(plan)).rejects.toThrow(/cannot zoom to show 1:1,000/)
    expect(f.view).toMatchObject({ bearing: 12, zoom: 9, center: { lng: -121.5, lat: 53.75 } })
    expect(f.map.setPixelRatio.mock.lastCall).toEqual([undefined])
    expect(captured.register).not.toHaveBeenCalled()
  })
})
