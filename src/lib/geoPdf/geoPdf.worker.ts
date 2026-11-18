/// <reference lib="webworker" />
import * as runtime from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { readGeoPdf } from './read'
import { PDF_LIMITS } from './types'
import type { MapFrame } from './georeference'
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import { classDisplayRgba, gridCorners } from './classGrid'
import type { PdfClassGrid } from './types'
import type { DecodedPdfImage } from './rasterRead'

runtime.GlobalWorkerOptions.workerSrc = workerUrl

class CanvasFactory {
  getNoAlphaContext(canvas: OffscreenCanvas) {
    return canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  }
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height)
    return { canvas, context: canvas.getContext('2d')! }
  }
  reset(target: { canvas: OffscreenCanvas }, width: number, height: number) {
    target.canvas.width = width
    target.canvas.height = height
  }
  destroy(target: { canvas: OffscreenCanvas }) {
    target.canvas.width = 0
    target.canvas.height = 0
  }
}

async function renderSheet(page: runtime.PDFPageProxy, frame: MapFrame) {
  const [left, bottom, right, top] = frame.bbox
  const scale = PDF_LIMITS.previewSide / Math.max(right - left, top - bottom)
  const full = page.getViewport({ scale, rotation: 0 })
  const [x, y] = full.convertToViewportPoint(left, top)
  const viewport = page.getViewport({ scale, rotation: 0, offsetX: -x, offsetY: -y })
  const canvas = new OffscreenCanvas(Math.ceil((right - left) * scale), Math.ceil((top - bottom) * scale))
  const ctx = canvas.getContext('2d')!
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { image: `data:image/jpeg;base64,${btoa(binary)}`, corners: frame.corners }
}

function imagePixels(image: DecodedPdfImage) {
  if (!image.bitmap) throw Error('PDF image has no readable native pixels.')
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image.bitmap, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height).data
}
async function renderClasses(grid: PdfClassGrid) {
  // The native pixels, with each JPEG estimate drawn as its 10 m cell's commonest class.
  const { data, width, height } = classDisplayRgba(grid)
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.putImageData(new ImageData(data, width, height), 0, 0)
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { image: `data:image/png;base64,${btoa(binary)}`, corners: gridCorners(grid) }
}

self.onmessage = async (
  event: MessageEvent<{ file: File; path: string; maxFeatures: number; maxVertices: number }>,
) => {
  if (!event.data?.file) return
  try {
    const { file, path, maxFeatures, maxVertices } = event.data
    const result = await readGeoPdf(new Uint8Array(await file.arrayBuffer()), path, runtime, {
      maxFeatures,
      maxVertices,
      renderSheet,
      renderClasses,
      imagePixels,
      configure: {
        CanvasFactory: CanvasFactory as unknown as DocumentInitParameters['CanvasFactory'],
        useSystemFonts: true,
        disableFontFace: true,
        useWasm: false,
      },
    })
    self.postMessage({ type: 'geopdf-result', result })
  } catch (error) {
    self.postMessage({ type: 'geopdf-result', error: error instanceof Error ? error.message : String(error) })
  }
}
