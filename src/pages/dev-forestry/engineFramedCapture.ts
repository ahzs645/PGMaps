/**
 * An engine's capture (`engineCapture.ts`) joined into the framed capture the analysis sheet takes
 * (`mapCapture.captureFramed`'s shape): the pictures side by side as one JPEG, the class passes and depth side by
 * side in request order. Browser only (it decodes the pictures on a canvas).
 */

import type { CapturedImage } from './mapCapture'
import { joinFrames, type EngineCaptureReply, type EngineCaptureRequest } from './engineCapture'

export type EngineFramedCapture = {
  image: CapturedImage
  classes: { data: Uint8ClampedArray; width: number; height: number }
  depth: { data: Float32Array; width: number; height: number }
  /** The screened pass (the engine's trees drawn), joined the same way, when every frame has one. */
  screened: { data: Uint8ClampedArray; width: number; height: number } | null
  /** The zone pass, joined the same way, when it was asked for. */
  zones: { data: Uint8ClampedArray; width: number; height: number } | null
  frameWidth: number
}

export async function joinEngineCapture(
  reply: EngineCaptureReply,
  request: EngineCaptureRequest,
): Promise<EngineFramedCapture> {
  const { width: frameWidth, height } = request.frames[0]
  if (request.frames.some((frame) => frame.width !== frameWidth || frame.height !== height))
    throw new Error('The capture’s frames are not all one size.')
  const width = frameWidth * reply.frames.length
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No 2D canvas for the capture.')
  for (let i = 0; i < reply.frames.length; i++) {
    const bitmap = await createImageBitmap(reply.frames[i].image)
    try {
      context.drawImage(bitmap, i * frameWidth, 0, frameWidth, height)
    } finally {
      bitmap.close()
    }
  }
  return {
    image: { dataUrl: canvas.toDataURL('image/jpeg', 0.88), width, height },
    classes: {
      data: joinFrames(
        reply.frames.map((frame) => frame.classes),
        frameWidth,
        height,
        4,
        (n) => new Uint8ClampedArray(n),
      ),
      width,
      height,
    },
    depth: {
      data: joinFrames(
        reply.frames.map((frame) => frame.depth),
        frameWidth,
        height,
        1,
        (n) => new Float32Array(n),
      ),
      width,
      height,
    },
    screened: reply.frames.every((frame) => frame.screened)
      ? {
          data: joinFrames(
            reply.frames.map((frame) => frame.screened!),
            frameWidth,
            height,
            4,
            (n) => new Uint8ClampedArray(n),
          ),
          width,
          height,
        }
      : null,
    zones: request.zones
      ? {
          data: joinFrames(
            reply.frames.map((frame) => frame.zones ?? new Uint8ClampedArray(frameWidth * height * 4)),
            frameWidth,
            height,
            4,
            (n) => new Uint8ClampedArray(n),
          ),
          width,
          height,
        }
      : null,
    frameWidth,
  }
}
