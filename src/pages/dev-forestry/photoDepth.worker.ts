/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import wasm from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import type { PhotoDepthReply, PhotoDepthRequest } from './photoDepth'
import { PHOTO_DEPTH_CACHE, PHOTO_DEPTH_MODELS } from './photoDepthModels'

const CACHE = PHOTO_DEPTH_CACHE
const MODELS = PHOTO_DEPTH_MODELS
const scope = self as unknown as DedicatedWorkerGlobalScope

ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm }

async function weights(url: string, size: number): Promise<ArrayBuffer> {
  const cache = await globalThis.caches?.open(CACHE).catch(() => undefined)
  const stored = await cache?.match(url).catch(() => undefined)
  if (stored) {
    const bytes = await stored.arrayBuffer()
    if (bytes.byteLength === size) return bytes
    await cache?.delete(url).catch(() => false)
  }
  const response = await fetch(url)
  if (!response.ok) throw Error(`The depth model download returned ${response.status}.`)
  const copy = cache && response.clone()
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== size) throw Error('The depth model download was incomplete.')
  if (copy) await cache?.put(url, copy).catch(() => undefined)
  return bytes
}

async function infer({ photo, model }: PhotoDepthRequest) {
  const settings = MODELS[model]
  const scale = settings.longEdge / Math.max(photo.width, photo.height)
  const width = Math.max(14, Math.round((photo.width * scale) / 14) * 14)
  const height = Math.max(14, Math.round((photo.height * scale) / 14) * 14)
  const source = new OffscreenCanvas(photo.width, photo.height)
  const context = source.getContext('2d')
  const resized = new OffscreenCanvas(width, height)
  const target = resized.getContext('2d')
  if (!context || !target) throw Error('The browser cannot prepare the photo for depth estimation.')
  const image = context.createImageData(photo.width, photo.height)
  image.data.set(photo.data)
  context.putImageData(image, 0, 0)
  target.imageSmoothingQuality = 'high'
  target.drawImage(source, 0, 0, width, height)
  const pixels = target.getImageData(0, 0, width, height).data
  const mean = [0.485, 0.456, 0.406]
  const deviation = [0.229, 0.224, 0.225]
  const plane = width * height
  const channels = new Float32Array(plane * 3)
  for (let channel = 0; channel < 3; channel++)
    for (let i = 0; i < plane; i++)
      channels[channel * plane + i] = (pixels[i * 4 + channel] / 255 - mean[channel]) / deviation[channel]
  const [graph, external] = await Promise.all(
    settings.files.map(({ path, size }) => weights(settings.root + path, size)),
  )
  const session = await ort.InferenceSession.create(graph, {
    executionProviders: ['wasm'],
    ...(external ? { externalData: [{ path: 'model.onnx_data', data: new Uint8Array(external) }] } : {}),
  })
  try {
    const input = new ort.Tensor(
      'float32',
      channels,
      model === 'da3-small' ? [1, 1, 3, height, width] : [1, 3, height, width],
    )
    const result = await session.run({ [session.inputNames[0]]: input }, ['predicted_depth'])
    const depth = result.predicted_depth
    if (!(depth.data instanceof Float32Array) || depth.data.length !== plane || !depth.data.every(Number.isFinite))
      throw Error('The depth model returned an invalid image.')
    const inverse =
      model === 'da3-small'
        ? Float32Array.from(depth.data, (value) => (value > 0 ? 1 / value : 0))
        : new Float32Array(depth.data)
    return { width, height, inverse }
  } finally {
    await session.release()
  }
}

scope.onmessage = ({ data }: MessageEvent<PhotoDepthRequest>) => {
  void infer(data).then(
    (depth) => scope.postMessage({ depth } satisfies PhotoDepthReply, [depth.inverse.buffer]),
    (error: unknown) => scope.postMessage({ error: String(error) } satisfies PhotoDepthReply),
  )
}
