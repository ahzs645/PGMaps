import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CanvasRecordingError,
  CanvasRecordingUnfinishedError,
  CanvasRecordingUnsupportedError,
  canvasRecordingSupported,
  createComposedRecorder,
  createDirectRecorder,
  type CanvasRecorderEnvironment,
  type CanvasRecorderState,
  type MediaRecorderClass,
} from './canvasRecorder'
import { MAX_RECORDING_MS, RECORDING_BITS_PER_SECOND, RECORDING_STOP_TIMEOUT_MS } from './recordingFormat'

class FakeTrack {
  stopped = false
  stop() {
    this.stopped = true
  }
}

class FakeStream {
  tracks = [new FakeTrack()]
  getTracks() {
    return this.tracks
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = []
  static supported = (type: string) => type.startsWith('video/webm')
  static isTypeSupported(type: string) {
    return FakeRecorder.supported(type)
  }
  /** When false, `stop` never fires `onstop` (an encoder that hangs). */
  static finishes = true
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: Event) => void) | null = null
  timeslice?: number
  constructor(
    readonly stream: FakeStream,
    readonly options: MediaRecorderOptions,
  ) {
    FakeRecorder.instances.push(this)
  }
  start(timeslice?: number) {
    this.timeslice = timeslice
    this.state = 'recording'
  }
  emit(bytes: string) {
    this.ondataavailable?.({ data: new Blob([bytes]) })
  }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    if (!FakeRecorder.finishes) return
    this.emit('tail')
    this.onstop?.()
  }
}

function fakeCanvas(options: { tainted?: boolean } = {}) {
  const stream = new FakeStream()
  const drawn: string[] = []
  const context = {
    fillStyle: '',
    fillRect: () => drawn.push('clear'),
    drawImage: (_source: unknown, x: number, y: number, w: number, h: number) =>
      drawn.push(`image ${x},${y},${w}x${h}`),
    getImageData: () => {
      if (options.tainted) throw new DOMException('tainted', 'SecurityError')
      return {}
    },
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => drawn.push('caption box'),
    fillText: (text: string) => drawn.push(`text ${text}`),
    measureText: (text: string) => ({ width: text.length * 8 }),
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  }
  const canvas = {
    width: 0,
    height: 0,
    fps: undefined as number | undefined,
    getContext: () => context,
    captureStream(fps?: number) {
      canvas.fps = fps
      return stream
    },
  }
  return { canvas, stream, drawn }
}

let clock = 0
const environment = (extra: Partial<CanvasRecorderEnvironment> = {}): CanvasRecorderEnvironment => ({
  MediaRecorder: FakeRecorder as unknown as MediaRecorderClass,
  now: () => clock,
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers()
  clock = 1000
  FakeRecorder.instances = []
  FakeRecorder.finishes = true
  FakeRecorder.supported = (type) => type.startsWith('video/webm')
})
afterEach(() => vi.useRealTimers())

describe('canvas recording support', () => {
  it('needs a recorder, a codec and canvas capture', () => {
    const MediaRecorder = FakeRecorder as unknown as MediaRecorderClass
    expect(canvasRecordingSupported({ MediaRecorder, canCaptureCanvas: true })).toBe(true)
    expect(canvasRecordingSupported({ MediaRecorder, canCaptureCanvas: false })).toBe(false)
    FakeRecorder.supported = () => false
    expect(canvasRecordingSupported({ MediaRecorder, canCaptureCanvas: true })).toBe(false)
  })

  it('refuses to build a recorder where nothing can be encoded', () => {
    FakeRecorder.supported = () => false
    const { canvas } = fakeCanvas()
    expect(() => createDirectRecorder({ canvas: canvas as never, environment: environment() })).toThrow(
      CanvasRecordingUnsupportedError,
    )
  })
})

describe('direct recorder', () => {
  it('streams the canvas, then returns the take and releases its tracks', async () => {
    const { canvas, stream } = fakeCanvas()
    const states: CanvasRecorderState[] = []
    const seconds: number[] = []
    const recorder = createDirectRecorder({
      canvas: canvas as never,
      fps: 24,
      environment: environment(),
      onStateChange: (state) => states.push(state),
      onElapsed: (s) => seconds.push(s),
    })
    expect(recorder.state).toBe('idle')
    expect(recorder.mimeType).toBe('video/webm;codecs=vp9')
    expect(recorder.extension).toBe('webm')
    recorder.start()
    expect(canvas.fps).toBe(24)
    const encoder = FakeRecorder.instances[0]
    expect(encoder.options).toEqual({
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: RECORDING_BITS_PER_SECOND,
    })
    expect(encoder.timeslice).toBe(1000)
    encoder.emit('head')
    for (let step = 0; step < 10; step++) {
      clock += 250
      vi.advanceTimersByTime(250)
    }
    expect(recorder.elapsedMs).toBe(2500)
    const take = await recorder.stop()
    expect(take.blob.type).toBe('video/webm')
    expect(await take.blob.text()).toBe('headtail')
    expect(take).toMatchObject({ extension: 'webm', durationMs: 2500, endedBy: 'stop' })
    expect(states).toEqual(['recording', 'stopping', 'done'])
    expect(seconds).toEqual([0, 1, 2])
    expect(stream.tracks[0].stopped).toBe(true)
    expect(encoder.onstop).toBeNull()
    // Stop again returns the same take.
    await expect(recorder.stop()).resolves.toBe(take)
    expect(() => recorder.start()).toThrow(CanvasRecordingError)
  })

  it('stops itself at the time limit and keeps the take', async () => {
    const { canvas } = fakeCanvas()
    const recorder = createDirectRecorder({ canvas: canvas as never, maxDurationMs: 5000, environment: environment() })
    recorder.start()
    clock += 5000
    vi.advanceTimersByTime(5000)
    const take = await recorder.result
    expect(take.endedBy).toBe('time-limit')
    expect(recorder.state).toBe('done')
  })

  it('never runs past the recording ceiling', async () => {
    const { canvas } = fakeCanvas()
    const recorder = createDirectRecorder({ canvas: canvas as never, maxDurationMs: 1e12, environment: environment() })
    recorder.start()
    vi.advanceTimersByTime(MAX_RECORDING_MS - 1)
    expect(recorder.state).toBe('recording')
    vi.advanceTimersByTime(1)
    await expect(recorder.result).resolves.toMatchObject({ endedBy: 'time-limit' })
  })

  it('reports an encoder that never finishes, with what it had written', async () => {
    FakeRecorder.finishes = false
    const { canvas, stream } = fakeCanvas()
    const recorder = createDirectRecorder({ canvas: canvas as never, environment: environment() })
    recorder.start()
    FakeRecorder.instances[0].emit('part')
    const stopped = recorder.stop()
    vi.advanceTimersByTime(RECORDING_STOP_TIMEOUT_MS)
    const error = await stopped.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(CanvasRecordingUnfinishedError)
    expect(await (error as CanvasRecordingUnfinishedError).partial?.text()).toBe('part')
    expect(recorder.state).toBe('failed')
    expect(stream.tracks[0].stopped).toBe(true)
  })

  it('fails an encoder error and releases everything', async () => {
    const { canvas, stream } = fakeCanvas()
    const recorder = createDirectRecorder({ canvas: canvas as never, environment: environment() })
    recorder.start()
    const encoder = FakeRecorder.instances[0]
    encoder.onerror?.(Object.assign(new Event('error'), { error: new DOMException('GPU lost') }))
    await expect(recorder.result).rejects.toMatchObject({ code: 'failed', message: 'Recording failed: GPU lost' })
    expect(stream.tracks[0].stopped).toBe(true)
    expect(encoder.state).toBe('inactive')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels without a take and releases everything', async () => {
    const { canvas, stream } = fakeCanvas()
    const recorder = createDirectRecorder({ canvas: canvas as never, environment: environment() })
    recorder.start()
    recorder.cancel()
    await expect(recorder.result).rejects.toMatchObject({ code: 'cancelled' })
    expect(recorder.state).toBe('cancelled')
    expect(stream.tracks[0].stopped).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('reports an empty take and a stop before start', async () => {
    const { canvas } = fakeCanvas()
    const recorder = createDirectRecorder({ canvas: canvas as never, environment: environment() })
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'not-started' })

    const second = createDirectRecorder({ canvas: fakeCanvas().canvas as never, environment: environment() })
    second.start()
    FakeRecorder.instances[0].emit = () => {}
    const encoder = FakeRecorder.instances[0]
    encoder.stop = () => {
      encoder.state = 'inactive'
      encoder.onstop?.()
    }
    await expect(second.stop()).rejects.toMatchObject({ code: 'empty' })
  })

  it('names a canvas a cross-origin layer has made unreadable', () => {
    const { canvas } = fakeCanvas()
    canvas.captureStream = () => {
      throw new DOMException('tainted', 'SecurityError')
    }
    const recorder = createDirectRecorder({ canvas: canvas as never, environment: environment() })
    expect(() => recorder.start()).toThrow(/blocks recording/)
    expect(recorder.state).toBe('failed')
  })
})

describe('composed recorder', () => {
  it('owns an even frame, fits each source in it and draws the caption on top', async () => {
    const { canvas, stream, drawn } = fakeCanvas()
    const recorder = createComposedRecorder({
      width: 1001,
      height: 601,
      caption: { title: 'Road 7', source: 'PGMaps' },
      environment: environment({ createCanvas: () => canvas as never }),
    })
    expect([recorder.width, recorder.height]).toEqual([1000, 600])
    // A first frame before start, from the map's render event.
    expect(recorder.drawFrame({ width: 2000, height: 1200 } as never)).toBe(true)
    expect(drawn).toEqual(['clear', 'image 0,0,1000x600', 'caption box', 'text Road 7', 'text PGMaps'])
    recorder.start()
    drawn.length = 0
    recorder.setCaption(null)
    // The map and an engine canvas over it; the engine is narrower and is letterboxed.
    recorder.drawFrame([
      { width: 1000, height: 600 },
      { width: 500, height: 600 },
    ] as never)
    expect(drawn).toEqual(['clear', 'image 0,0,1000x600', 'image 250,0,500x600'])
    const take = await recorder.stop()
    expect(take.blob.size).toBeGreaterThan(0)
    expect(stream.tracks[0].stopped).toBe(true)
    // The frame's memory is handed back and later frames are ignored.
    expect(canvas.width).toBe(0)
    expect(recorder.drawFrame({ width: 10, height: 10 } as never)).toBe(false)
  })

  it('fails when a frame turns out unreadable', async () => {
    const { canvas } = fakeCanvas({ tainted: true })
    const recorder = createComposedRecorder({
      width: 640,
      height: 480,
      environment: environment({ createCanvas: () => canvas as never }),
    })
    recorder.start()
    expect(recorder.drawFrame({ width: 640, height: 480 } as never)).toBe(false)
    await expect(recorder.result).rejects.toMatchObject({ code: 'unreadable' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a frame too small to record', () => {
    expect(() => createComposedRecorder({ width: 0, height: 480, environment: environment() })).toThrow(
      /no visible picture/,
    )
  })
})
