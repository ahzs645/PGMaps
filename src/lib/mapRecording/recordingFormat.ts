/**
 * Video formats, bitrate, frame rate and frame geometry for recording a canvas.
 * DOM-free: the browser's codec check is passed in, so the choices are unit tested.
 *
 * Adapted from GeoLibre (MIT), `apps/geolibre-desktop/src/lib/map-recorder.ts`
 * (`MAP_RECORD_MIME_CANDIDATES`, `pickSupportedMimeType`, `videoExtensionForMime`,
 * the bitrate and fps bounds, the even-dimension rule). See `src/lib/NOTICE-GEOLIBRE.md`.
 */

/**
 * Recording MIME types, tried in order. MP4/H.264 first so the file plays everywhere
 * (Chrome and Edge from 126, Safari); WebM/VP9/VP8 where `MediaRecorder` cannot write
 * MP4 (Firefox).
 */
export const RECORDING_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const

/**
 * Target video bitrate, bits per second. `MediaRecorder`'s own default (about 2.5 Mbps)
 * visibly blurs imagery, labels and tree crowns; browsers clamp a value they cannot reach.
 */
export const RECORDING_BITS_PER_SECOND = 12_000_000

/** Frames per second sampled from the canvas. */
export const DEFAULT_RECORDING_FPS = 30
export const MIN_RECORDING_FPS = 10
export const MAX_RECORDING_FPS = 60

/**
 * Longest single recording. Past it the recorder stops itself and keeps the take, so a
 * forgotten recording cannot fill the tab's memory (12 Mbps is about 90 MB a minute).
 */
export const MAX_RECORDING_MS = 10 * 60_000

/** How long to wait for the encoder's final `stop` event before reporting it never finished. */
export const RECORDING_STOP_TIMEOUT_MS = 10_000

/** `MediaRecorder` timeslice: chunks are flushed this often so a long take is not one buffer. */
export const RECORDING_TIMESLICE_MS = 1000

/**
 * Longest side of a composed frame, device pixels. Hardware H.264 encoders refuse or
 * fail silently above 4K; a larger source is scaled down to fit.
 */
export const MAX_RECORDING_FRAME_SIDE = 3840
/** Smallest side of a recordable frame, device pixels. */
export const MIN_RECORDING_FRAME_SIDE = 16

export type RecordingExtension = 'mp4' | 'webm'

/** First candidate the browser can encode, or null when it can encode none. */
export function pickRecordingMimeType(
  isSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = RECORDING_MIME_CANDIDATES,
): string | null {
  for (const type of candidates) {
    try {
      if (isSupported(type)) return type
    } catch {
      // A browser that throws on an unknown codec string simply does not support it.
    }
  }
  return null
}

/** File extension for a recording MIME type. */
export function recordingExtension(mimeType: string): RecordingExtension {
  return mimeType.trim().toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** The bare container type (`video/mp4`) without its codec parameters, for a file's type. */
export function recordingContainerType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase()
}

/** A frame rate rounded and held within the bounds the controls offer; NaN gives the default. */
export function clampRecordingFps(fps: number): number {
  if (!Number.isFinite(fps)) return DEFAULT_RECORDING_FPS
  return Math.min(MAX_RECORDING_FPS, Math.max(MIN_RECORDING_FPS, Math.round(fps)))
}

/** Round down to an even integer of at least 2 (H.264 needs even dimensions). */
export function toEven(value: number): number {
  const floored = Math.floor(value)
  return Math.max(2, floored - (floored % 2))
}

/**
 * The composed recording frame for a source of the given device-pixel size: even sides,
 * scaled down (aspect kept) so the longer side is at most `maxSide`. Null when the source
 * is too small to record.
 */
export function recordingFrameSize(
  width: number,
  height: number,
  maxSide: number = MAX_RECORDING_FRAME_SIDE,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < MIN_RECORDING_FRAME_SIDE || height < MIN_RECORDING_FRAME_SIDE) return null
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: toEven(width * scale), height: toEven(height * scale) }
}

/**
 * Where a source of `sourceWidth × sourceHeight` lands in a frame of `frameWidth × frameHeight`:
 * scaled to fit whole with its aspect kept and centred (the rest of the frame stays black), so
 * a pane resized mid-recording is letterboxed, never stretched.
 */
export function fitSourceInFrame(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!(sourceWidth > 0 && sourceHeight > 0 && frameWidth > 0 && frameHeight > 0)) return null
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height }
}
