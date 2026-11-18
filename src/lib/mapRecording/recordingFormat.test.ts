import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECORDING_FPS,
  MAX_RECORDING_FPS,
  MIN_RECORDING_FPS,
  RECORDING_MIME_CANDIDATES,
  clampRecordingFps,
  fitSourceInFrame,
  pickRecordingMimeType,
  recordingContainerType,
  recordingExtension,
  recordingFrameSize,
  toEven,
} from './recordingFormat'
import {
  captionBoxOrigin,
  captionLines,
  captionMetrics,
  drawRecordingCaption,
  hasCaptionText,
} from './recordingCaption'

describe('recording format', () => {
  it('prefers MP4 and falls back to WebM in order', () => {
    expect(pickRecordingMimeType(() => true)).toBe(RECORDING_MIME_CANDIDATES[0])
    const firefox = (type: string) => type.startsWith('video/webm')
    expect(pickRecordingMimeType(firefox)).toBe('video/webm;codecs=vp9')
    const vp8Only = (type: string) => type === 'video/webm;codecs=vp8' || type === 'video/webm'
    expect(pickRecordingMimeType(vp8Only)).toBe('video/webm;codecs=vp8')
    expect(pickRecordingMimeType(() => false)).toBeNull()
  })

  it('treats a codec check that throws as unsupported', () => {
    expect(
      pickRecordingMimeType((type) => {
        if (type.includes('avc1')) throw new Error('unknown codec')
        return type === 'video/mp4'
      }),
    ).toBe('video/mp4')
  })

  it('names the extension and the container from the MIME type', () => {
    expect(recordingExtension('video/mp4;codecs=avc1.42E01E')).toBe('mp4')
    expect(recordingExtension('video/webm;codecs=vp9')).toBe('webm')
    expect(recordingContainerType('video/webm;codecs=vp9')).toBe('video/webm')
    expect(recordingContainerType('VIDEO/MP4')).toBe('video/mp4')
  })

  it('holds the frame rate within its bounds', () => {
    expect(clampRecordingFps(Number.NaN)).toBe(DEFAULT_RECORDING_FPS)
    expect(clampRecordingFps(1)).toBe(MIN_RECORDING_FPS)
    expect(clampRecordingFps(240)).toBe(MAX_RECORDING_FPS)
    expect(clampRecordingFps(24.6)).toBe(25)
  })

  it('makes frame sides even and caps the long side', () => {
    expect(toEven(1081)).toBe(1080)
    expect(toEven(1)).toBe(2)
    expect(recordingFrameSize(1921, 1081)).toEqual({ width: 1920, height: 1080 })
    expect(recordingFrameSize(7680, 4320)).toEqual({ width: 3840, height: 2160 })
    expect(recordingFrameSize(8, 600)).toBeNull()
    expect(recordingFrameSize(Number.NaN, 600)).toBeNull()
  })

  it('letterboxes a source of another shape rather than stretching it', () => {
    expect(fitSourceInFrame(1000, 500, 1000, 1000)).toEqual({ x: 0, y: 250, width: 1000, height: 500 })
    expect(fitSourceInFrame(2000, 2000, 1000, 500)).toEqual({ x: 250, y: 0, width: 500, height: 500 })
    expect(fitSourceInFrame(0, 500, 1000, 1000)).toBeNull()
  })
})

describe('recording caption', () => {
  it('prints trimmed single lines, cut when too long', () => {
    expect(captionLines({ title: '  Block 12 \n road  ', source: '' })).toEqual({ title: 'Block 12 road', source: '' })
    expect(captionLines({ title: 'x'.repeat(400) }).title).toHaveLength(160)
    expect(hasCaptionText({ title: '   ' })).toBe(false)
    expect(hasCaptionText(null)).toBe(false)
    expect(hasCaptionText({ source: 'PGMaps' })).toBe(true)
  })

  it('scales with the frame and stays inside it', () => {
    expect(captionMetrics(100).titlePx).toBe(14)
    expect(captionMetrics(10_000).titlePx).toBe(48)
    expect(captionBoxOrigin('bottom-right', 200, 50, 1000, 600, 10)).toEqual({ x: 790, y: 540 })
    expect(captionBoxOrigin('top-center', 200, 50, 1000, 600, 10)).toEqual({ x: 400, y: 10 })
    // A box wider than the frame pins to the near margin.
    expect(captionBoxOrigin('bottom-right', 2000, 50, 1000, 600, 10).x).toBe(10)
  })

  it('draws a box and both lines on a 2D context', () => {
    const calls: string[] = []
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => {},
      moveTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      fill: () => calls.push('fill'),
      fillText: (text: string) => calls.push(`text:${text}`),
      measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics,
      font: '',
      fillStyle: '',
      textAlign: 'left',
      textBaseline: 'top',
    }
    const box = drawRecordingCaption(ctx as never, { title: 'Road 7', source: 'PGMaps' }, 1280, 720)
    expect(box).not.toBeNull()
    expect(calls).toEqual(['save', 'fill', 'text:Road 7', 'text:PGMaps', 'restore'])
    expect(drawRecordingCaption(ctx as never, { title: ' ' }, 1280, 720)).toBeNull()
  })
})
