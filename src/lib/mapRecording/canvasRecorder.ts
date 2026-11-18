/**
 * Record a canvas to a video file with `MediaRecorder`. Browser-only: it needs
 * `MediaRecorder`, `canvas.captureStream` and a 2D canvas. The browser objects can be passed
 * in (`CanvasRecorderEnvironment`), which is how the state machine is unit tested.
 *
 * Two modes:
 *
 * - **Direct** (`createDirectRecorder`): streams the given canvas exactly as the browser
 *   presents it. No copy is made, so it works on a WebGL canvas made without
 *   `preserveDrawingBuffer` (every PGMaps map) and on an engine's own canvas. No caption.
 * - **Composed** (`createComposedRecorder`): the recorder owns a fixed-size 2D canvas and
 *   streams that. The caller copies each frame into it with `drawFrame`, and the recorder draws
 *   the title/source caption on top. A WebGL canvas without `preserveDrawingBuffer` reads back
 *   blank outside its own render callback, so call `drawFrame(map.getCanvas())` from inside the
 *   map's `render` event (as `captureMapImage` does), never from a timer. Several sources are
 *   drawn in order, each fitted to the frame: the map, then an engine canvas laid over it.
 *
 * The recorder never moves a camera and never touches React state. A tour reads
 * `recorder.elapsedMs` once per frame (see `tourTimeline.ts`); `onElapsed` reports whole
 * seconds only, for a timer label.
 *
 * Every track is stopped and every handler and timer released on stop, cancel, failure and the
 * time limit (`MAX_RECORDING_MS`, after which the recorder stops itself and keeps the take).
 *
 * Adapted from GeoLibre (MIT), `apps/geolibre-desktop/src/lib/map-recorder.ts`
 * (`recordMapCanvas`: the recorder options, the 1 s timeslice, the stop timeout, stopping the
 * stream's tracks, the unsupported error). The two modes, the state machine, the time limit
 * and the injected environment are PGMaps'.
 */

import { drawRecordingCaption, type RecordingCaption } from './recordingCaption'
import {
  MAX_RECORDING_MS,
  RECORDING_BITS_PER_SECOND,
  RECORDING_STOP_TIMEOUT_MS,
  RECORDING_TIMESLICE_MS,
  clampRecordingFps,
  fitSourceInFrame,
  pickRecordingMimeType,
  recordingContainerType,
  recordingExtension,
  recordingFrameSize,
  type RecordingExtension,
} from './recordingFormat'

export type CanvasRecorderState = 'idle' | 'recording' | 'stopping' | 'done' | 'cancelled' | 'failed'

export type CanvasRecording = {
  /** The video, typed with its container (`video/mp4` or `video/webm`). */
  blob: Blob
  /** The full MIME type the encoder used, codecs included. */
  mimeType: string
  extension: RecordingExtension
  /** Wall-clock length of the take, ms. */
  durationMs: number
  /** `time-limit` when the recorder stopped itself at its `maxDurationMs`. */
  endedBy: 'stop' | 'time-limit'
}

export type CanvasRecordingErrorCode =
  | 'unsupported'
  | 'unfinished'
  | 'failed'
  | 'empty'
  | 'unreadable'
  | 'cancelled'
  | 'not-started'

/** Why a recording could not be made; `message` is written for the person recording. */
export class CanvasRecordingError extends Error {
  /** What went wrong underneath, when anything did. */
  declare cause?: unknown
  readonly code: CanvasRecordingErrorCode
  constructor(code: CanvasRecordingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message)
    // Set by hand: the ES2020 lib this project builds against has no `ErrorOptions`.
    if (options && 'cause' in options)
      Object.defineProperty(this, 'cause', { value: options.cause, configurable: true })
    this.name = 'CanvasRecordingError'
    this.code = code
  }
}

/** This browser cannot record a canvas (no `MediaRecorder`, no `captureStream`, or no codec it can write). */
export class CanvasRecordingUnsupportedError extends CanvasRecordingError {
  constructor(message = 'This browser cannot record video of the map. Try a current Chrome, Edge, Firefox or Safari.') {
    super('unsupported', message)
    this.name = 'CanvasRecordingUnsupportedError'
  }
}

/** The encoder never finished the file. `partial` holds what it had flushed, when anything. */
export class CanvasRecordingUnfinishedError extends CanvasRecordingError {
  readonly partial: Blob | null
  constructor(partial: Blob | null) {
    super(
      'unfinished',
      partial
        ? 'The video encoder did not finish the file. What it had written so far is kept, and may end early.'
        : 'The video encoder did not finish the file, and wrote nothing.',
    )
    this.name = 'CanvasRecordingUnfinishedError'
    this.partial = partial
  }
}

// --- What the recorder needs from the browser --------------------------------------------

type TrackLike = { stop(): void }
type StreamLike = { getTracks(): TrackLike[] }
type RecorderLike = {
  readonly state: 'inactive' | 'recording' | 'paused'
  start(timeslice?: number): void
  stop(): void
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: ((event: Event) => void) | null
}
/** The parts of the `MediaRecorder` class the recorder uses. */
export type MediaRecorderClass = {
  new (stream: MediaStream, options?: MediaRecorderOptions): RecorderLike
  isTypeSupported(mimeType: string): boolean
}
type FrameContext = CanvasRenderingContext2D
type OwnCanvas = {
  width: number
  height: number
  getContext(kind: '2d'): FrameContext | null
  captureStream?: (frameRate?: number) => StreamLike
}

export type CanvasRecorderEnvironment = {
  MediaRecorder?: MediaRecorderClass
  /** Makes the composed mode's 2D canvas. */
  createCanvas?: (width: number, height: number) => OwnCanvas
  /** Clock for `elapsedMs`, ms. */
  now?: () => number
}

function defaultMediaRecorder(): MediaRecorderClass | undefined {
  return typeof MediaRecorder === 'undefined' ? undefined : (MediaRecorder as unknown as MediaRecorderClass)
}

function defaultCreateCanvas(width: number, height: number): OwnCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas as unknown as OwnCanvas
}

const defaultNow = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

/**
 * Whether this browser can record a canvas: `MediaRecorder` with a codec from
 * `RECORDING_MIME_CANDIDATES`, and `captureStream` on canvases. Use it to hide or explain a
 * Record control before anyone presses it.
 */
export function canvasRecordingSupported(
  environment: Pick<CanvasRecorderEnvironment, 'MediaRecorder'> & { canCaptureCanvas?: boolean } = {},
): boolean {
  const Recorder = environment.MediaRecorder ?? defaultMediaRecorder()
  if (!Recorder) return false
  const canCapture =
    environment.canCaptureCanvas ??
    (typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function')
  return canCapture && pickRecordingMimeType((type) => Recorder.isTypeSupported(type)) !== null
}

// --- The recorder --------------------------------------------------------------------------

type CommonOptions = {
  /** Frames per second sampled from the canvas; held to `MIN_RECORDING_FPS`–`MAX_RECORDING_FPS`. */
  fps?: number
  /** The recorder stops itself after this long, ms. Default and ceiling `MAX_RECORDING_MS`. */
  maxDurationMs?: number
  /** Whole seconds recorded, reported when the number changes. */
  onElapsed?: (seconds: number) => void
  /** Every state change, including the recorder stopping itself at the time limit. */
  onStateChange?: (state: CanvasRecorderState) => void
  environment?: CanvasRecorderEnvironment
}

export type DirectRecorderOptions = CommonOptions & {
  /** The canvas to stream as presented: a map's `getCanvas()`, or an engine's own canvas. */
  canvas: HTMLCanvasElement
}

export type ComposedRecorderOptions = CommonOptions & {
  /** Frame size, device pixels: usually the source canvas's `width` and `height`. Made even and capped (`recordingFrameSize`). */
  width: number
  height: number
  caption?: RecordingCaption | null
}

export interface CanvasRecorder {
  readonly state: CanvasRecorderState
  /** The full MIME type the encoder will use. */
  readonly mimeType: string
  readonly extension: RecordingExtension
  /** Ms since `start`, frozen once the recording ends; 0 before it starts. */
  readonly elapsedMs: number
  /**
   * The finished take, whichever way it ended: `stop`, the time limit, or a failure (rejects with
   * a `CanvasRecordingError`). Settles once; `stop` returns this same promise.
   */
  readonly result: Promise<CanvasRecording>
  /** Begin recording. Throws `CanvasRecordingUnsupportedError` if the encoder refuses, or when not idle. */
  start(): void
  /** Finish the file. Resolves with the take; calling it again returns the same promise. */
  stop(): Promise<CanvasRecording>
  /** Throw the take away and release everything. `result` rejects with code `cancelled`. */
  cancel(): void
}

export interface ComposedCanvasRecorder extends CanvasRecorder {
  readonly width: number
  readonly height: number
  /**
   * Copy one frame: each source is drawn in order, fitted to the frame with its aspect kept,
   * then the caption on top. Call it from inside the source's render callback (a MapLibre
   * `render` event), before `start` too to give the first frame a picture. Returns false when
   * nothing was drawn (the recording has ended, or the canvas became unreadable, which fails it).
   */
  drawFrame(source: CanvasImageSource | readonly CanvasImageSource[]): boolean
  /** Change the caption from the next frame on, e.g. the name of the viewpoint now shown. */
  setCaption(caption: RecordingCaption | null): void
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } | null {
  const s = source as unknown as Record<string, unknown>
  const pick = (w: unknown, h: unknown) =>
    typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { width: w, height: h } : null
  if ('videoWidth' in s) return pick(s.videoWidth, s.videoHeight)
  if ('naturalWidth' in s) return pick(s.naturalWidth, s.naturalHeight)
  if ('displayWidth' in s) return pick(s.displayWidth, s.displayHeight)
  return pick(s.width, s.height)
}

type Internals = {
  options: CommonOptions
  stream: () => StreamLike
  /** Called after the recorder releases its tracks; the composed mode empties its canvas. */
  release?: () => void
}

function createRecorder(internals: Internals) {
  const { options } = internals
  const environment = options.environment ?? {}
  const Recorder = environment.MediaRecorder ?? defaultMediaRecorder()
  const now = environment.now ?? defaultNow
  const mimeType = Recorder ? pickRecordingMimeType((type) => Recorder.isTypeSupported(type)) : null
  if (!Recorder || !mimeType) throw new CanvasRecordingUnsupportedError()
  const extension = recordingExtension(mimeType)
  const fps = clampRecordingFps(options.fps ?? Number.NaN)
  const maxDurationMs = Math.min(MAX_RECORDING_MS, Math.max(1000, options.maxDurationMs ?? MAX_RECORDING_MS))

  let state: CanvasRecorderState = 'idle'
  let stream: StreamLike | null = null
  let recorder: RecorderLike | null = null
  let chunks: Blob[] = []
  let startedAt: number | null = null
  let endedAt: number | null = null
  let lastSecond = -1
  let elapsedTimer: ReturnType<typeof setInterval> | undefined
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let endedBy: CanvasRecording['endedBy'] = 'stop'
  let settle!: { resolve: (value: CanvasRecording) => void; reject: (reason: CanvasRecordingError) => void }
  const result = new Promise<CanvasRecording>((resolve, reject) => {
    settle = { resolve, reject }
  })
  // A caller that only ever calls `stop` must not see an unhandled rejection from `result`.
  result.catch(() => {})

  const setState = (next: CanvasRecorderState) => {
    if (state === next) return
    state = next
    options.onStateChange?.(next)
  }

  const elapsed = () => (startedAt === null ? 0 : (endedAt ?? now()) - startedAt)

  const release = () => {
    clearInterval(elapsedTimer)
    clearTimeout(limitTimer)
    clearTimeout(stopTimer)
    elapsedTimer = limitTimer = stopTimer = undefined
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // Already stopping; nothing to release.
        }
      }
    }
    for (const track of stream?.getTracks() ?? []) track.stop()
    recorder = null
    stream = null
    internals.release?.()
  }

  const fail = (error: CanvasRecordingError) => {
    if (state === 'done' || state === 'cancelled' || state === 'failed') return
    if (startedAt !== null && endedAt === null) endedAt = now()
    release()
    chunks = []
    setState(error.code === 'cancelled' ? 'cancelled' : 'failed')
    settle.reject(error)
  }

  const finish = () => {
    if (state !== 'stopping') return
    const blob = new Blob(chunks, { type: recordingContainerType(mimeType) })
    chunks = []
    release()
    if (!blob.size) {
      setState('failed')
      settle.reject(
        new CanvasRecordingError('empty', 'The recording is empty: the map drew no frames while it ran. Try again.'),
      )
      return
    }
    setState('done')
    settle.resolve({ blob, mimeType, extension, durationMs: elapsed(), endedBy })
  }

  const requestStop = (reason: CanvasRecording['endedBy']) => {
    if (state !== 'recording' || !recorder) return
    endedBy = reason
    endedAt = now()
    clearInterval(elapsedTimer)
    clearTimeout(limitTimer)
    setState('stopping')
    // The encoder may never send its final `stop` (a torn-down stream, a page-unload race).
    stopTimer = setTimeout(() => {
      if (state !== 'stopping') return
      const partial = chunks.length ? new Blob(chunks, { type: recordingContainerType(mimeType) }) : null
      fail(new CanvasRecordingUnfinishedError(partial && partial.size ? partial : null))
    }, RECORDING_STOP_TIMEOUT_MS)
    try {
      recorder.stop()
    } catch (cause) {
      fail(new CanvasRecordingError('failed', 'The video encoder could not stop.', { cause }))
    }
  }

  const api = {
    get state() {
      return state
    },
    mimeType,
    extension,
    get elapsedMs() {
      return elapsed()
    },
    result,
    start() {
      if (state !== 'idle')
        throw new CanvasRecordingError(
          'failed',
          `The recorder has already ${state === 'recording' ? 'started' : 'ended'}.`,
        )
      try {
        stream = internals.stream()
      } catch (cause) {
        release()
        const error =
          cause instanceof CanvasRecordingError
            ? cause
            : (cause as { name?: string })?.name === 'SecurityError'
              ? new CanvasRecordingError(
                  'unreadable',
                  'A layer on the map blocks recording. Hide that layer or use another basemap and try again.',
                  { cause },
                )
              : new CanvasRecordingUnsupportedError()
        fail(error)
        throw error
      }
      try {
        recorder = new Recorder(stream as unknown as MediaStream, {
          mimeType,
          videoBitsPerSecond: RECORDING_BITS_PER_SECOND,
        })
      } catch {
        // The constructor can still refuse a codec `isTypeSupported` accepted.
        const error = new CanvasRecordingUnsupportedError()
        fail(error)
        throw error
      }
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = finish
      recorder.onerror = (event) => {
        const cause = (event as Event & { error?: DOMException }).error
        fail(
          new CanvasRecordingError('failed', `Recording failed: ${cause?.message || 'the video encoder stopped.'}`, {
            cause,
          }),
        )
      }
      try {
        recorder.start(RECORDING_TIMESLICE_MS)
      } catch (cause) {
        const error = new CanvasRecordingError('failed', 'The video encoder would not start.', { cause })
        fail(error)
        throw error
      }
      startedAt = now()
      setState('recording')
      const reportElapsed = () => {
        const seconds = Math.floor(elapsed() / 1000)
        if (seconds !== lastSecond) {
          lastSecond = seconds
          options.onElapsed?.(seconds)
        }
      }
      reportElapsed()
      elapsedTimer = setInterval(reportElapsed, 250)
      limitTimer = setTimeout(() => requestStop('time-limit'), maxDurationMs)
    },
    stop() {
      if (state === 'idle') {
        fail(new CanvasRecordingError('not-started', 'The recording never started.'))
      } else requestStop('stop')
      return result
    },
    cancel() {
      if (state === 'idle' || state === 'recording' || state === 'stopping')
        fail(new CanvasRecordingError('cancelled', 'The recording was cancelled.'))
    },
  }
  return { api, fps, fail, isLive: () => state === 'idle' || state === 'recording' }
}

/**
 * Record a canvas as the browser presents it (no copy, no caption). Throws
 * `CanvasRecordingUnsupportedError` when this browser cannot record.
 *
 * ```ts
 * const recorder = createDirectRecorder({ canvas: engineCanvas, fps: 30 })
 * recorder.start()
 * // … later, on Stop:
 * const { blob, extension } = await recorder.stop()
 * ```
 */
export function createDirectRecorder(options: DirectRecorderOptions): CanvasRecorder {
  const canvas = options.canvas as unknown as OwnCanvas
  const built = createRecorder({
    options,
    stream: () => {
      if (typeof canvas.captureStream !== 'function') throw new CanvasRecordingUnsupportedError()
      return canvas.captureStream(built.fps)
    },
  })
  return built.api
}

/**
 * Record a frame the recorder composes: the caller copies each frame in with `drawFrame` from
 * inside its render callback, and the caption is drawn on top. Throws
 * `CanvasRecordingUnsupportedError` when this browser cannot record, and a `CanvasRecordingError`
 * (`unreadable`) when the frame size is too small.
 */
export function createComposedRecorder(options: ComposedRecorderOptions): ComposedCanvasRecorder {
  const size = recordingFrameSize(options.width, options.height)
  if (!size)
    throw new CanvasRecordingError(
      'unreadable',
      'The map has no visible picture to record. Open the map and try again.',
    )
  const environment = options.environment ?? {}
  let canvas: OwnCanvas | null = (environment.createCanvas ?? defaultCreateCanvas)(size.width, size.height)
  const context = canvas.getContext('2d')
  if (!context) throw new CanvasRecordingUnsupportedError()
  let caption = options.caption ?? null
  let checkedReadable = false

  const built = createRecorder({
    options,
    stream: () => {
      if (!canvas || typeof canvas.captureStream !== 'function') throw new CanvasRecordingUnsupportedError()
      return canvas.captureStream(built.fps)
    },
    release: () => {
      // Hand the frame's memory back; the take is already in its chunks.
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      canvas = null
    },
  })

  return Object.assign(built.api, {
    width: size.width,
    height: size.height,
    setCaption(next: RecordingCaption | null) {
      caption = next
    },
    drawFrame(source: CanvasImageSource | readonly CanvasImageSource[]): boolean {
      if (!canvas || !built.isLive()) return false
      const sources = (Array.isArray(source) ? source : [source]) as CanvasImageSource[]
      context.fillStyle = '#000000'
      context.fillRect(0, 0, size.width, size.height)
      for (const layer of sources) {
        const layerSize = sourceSize(layer)
        const placed = layerSize && fitSourceInFrame(layerSize.width, layerSize.height, size.width, size.height)
        if (!placed) continue
        context.drawImage(layer, placed.x, placed.y, placed.width, placed.height)
      }
      if (!checkedReadable) {
        // A cross-origin picture taints the frame and the stream then records nothing. Check
        // once: a per-frame read-back would cost a GPU sync every frame.
        try {
          context.getImageData(0, 0, 1, 1)
          checkedReadable = true
        } catch (cause) {
          built.fail(
            new CanvasRecordingError(
              'unreadable',
              'A layer on the map blocks recording. Hide that layer or use another basemap and try again.',
              { cause },
            ),
          )
          return false
        }
      }
      drawRecordingCaption(context, caption, size.width, size.height)
      return true
    },
  })
}
