/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import wasm from '../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'
import extractorUrl from '../../assets/forestry/photo-matching/xfeat.onnx?url'
import matcherUrl from '../../assets/forestry/photo-matching/matching.onnx?url'
import type { FeatureFrame, FeatureReply, FeatureRequest } from './photoFeatureClient'
import { overlapStrength, verifyFeatureOverlap, type FeatureOverlap } from './photoFeatureGeometry'
import type { ImageMatch } from './photoOverlap'
import type { Rgba } from './photoViews'

const scope = self as unknown as DedicatedWorkerGlobalScope
ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm }
const options = { executionProviders: ['wasm'] }
let sessions: Promise<[ort.InferenceSession, ort.InferenceSession]> | undefined
const models = () =>
  (sessions ??= Promise.all([
    ort.InferenceSession.create(extractorUrl, options),
    ort.InferenceSession.create(matcherUrl, options),
  ]))

type Features = { count: number; keypoints: Float32Array; descriptors: ort.Tensor }
type Frame = { pixels: Rgba; scales: Map<number, Features> }
const frames = new Map<string, Frame>()
const mainWidth = 832
const altWidth = 560

function frameFor({ key, pixels }: FeatureFrame): Frame {
  const existing = frames.get(key)
  if (existing) return existing
  if (!pixels) throw Error('The flight matcher needs the photo pixels.')
  const entry = { pixels, scales: new Map<number, Features>() }
  frames.set(key, entry)
  return entry
}

function toTensor(photo: Rgba, resolution: number) {
  const scale = Math.min(1, resolution / Math.max(photo.width, photo.height))
  const width = Math.max(32, Math.round((photo.width * scale) / 32) * 32)
  const height = Math.max(32, Math.round((photo.height * scale) / 32) * 32)
  const source = new OffscreenCanvas(photo.width, photo.height).getContext('2d')
  const canvas = new OffscreenCanvas(width, height).getContext('2d')
  if (!source || !canvas) throw Error('This browser could not resize the flight photo.')
  const image = source.createImageData(photo.width, photo.height)
  image.data.set(photo.data)
  source.putImageData(image, 0, 0)
  canvas.imageSmoothingQuality = 'high'
  canvas.drawImage(source.canvas, 0, 0, width, height)
  const rgba = canvas.getImageData(0, 0, width, height).data
  const plane = width * height
  const rgb = new Float32Array(plane * 3)
  for (let channel = 0; channel < 3; channel++)
    for (let i = 0; i < plane; i++) rgb[channel * plane + i] = rgba[i * 4 + channel] / 255
  return { image: new ort.Tensor('float32', rgb, [1, 3, height, width]), width, height }
}

async function describe(frame: Frame, resolution: number): Promise<Features> {
  const existing = frame.scales.get(resolution)
  if (existing) return existing
  const [extract] = await models()
  const { image, width, height } = toTensor(frame.pixels, resolution)
  const { keypoints, descriptors } = await extract.run({ images: image })
  const points = Float32Array.from(keypoints.data as Float32Array, (value, i) =>
    i % 2 === 0 ? (value * frame.pixels.width) / width : (value * frame.pixels.height) / height,
  )
  const features = { count: points.length / 2, keypoints: points, descriptors }
  frame.scales.set(resolution, features)
  return features
}

async function reciprocal(a: Features, b: Features): Promise<ImageMatch[]> {
  if (Math.min(a.count, b.count) < 2) return []
  const [, match] = await models()
  const result = await match.run({ reference: a.descriptors, target: b.descriptors })
  const forward = result.ref_index.data as BigInt64Array
  const backward = result.target_index.data as BigInt64Array
  const near = result.ref_score.data as Float32Array
  const reverse = result.target_score.data as Float32Array
  const rows: Array<{ strength: number; match: ImageMatch }> = []
  for (let i = 0; i < a.count; i++) {
    const j = Number(forward[i * 2])
    const strength = near[i * 2]
    if (Number(backward[j * 2]) !== i || strength < 0.68) continue
    const distance = 1 - strength
    if (distance > 0.94 * (1 - near[i * 2 + 1]) || distance > 0.94 * (1 - reverse[j * 2 + 1])) continue
    rows.push({
      strength,
      match: [
        [a.keypoints[i * 2], a.keypoints[i * 2 + 1]],
        [b.keypoints[j * 2], b.keypoints[j * 2 + 1]],
      ],
    })
  }
  return rows.sort((a, b) => b.strength - a.strength).map((row) => row.match)
}

async function overlap({ reference, target, focalRatio = 1 }: FeatureRequest): Promise<FeatureOverlap> {
  const a = frameFor(reference)
  const b = frameFor(target)
  const check = async (first: number, second: number) => {
    const matches = await reciprocal(await describe(a, first), await describe(b, second))
    return verifyFeatureOverlap(matches, a.pixels, b.pixels)
  }
  const direct = await check(mainWidth, mainWidth)
  const options = [direct, await check(altWidth, mainWidth), await check(mainWidth, altWidth)]
  const ratio = Math.max(focalRatio, 1 / focalRatio)
  if (ratio > 1.75) {
    const zoomWidth = Math.max(320, Math.round(mainWidth / ratio / 32) * 32)
    options.push(focalRatio > 1 ? await check(mainWidth, zoomWidth) : await check(zoomWidth, mainWidth))
  }
  return options.sort((a, b) => overlapStrength(b) - overlapStrength(a))[0]
}

scope.onmessage = ({ data }: MessageEvent<FeatureRequest>) => {
  void overlap(data).then(
    (result) => scope.postMessage(result satisfies FeatureReply),
    (error: unknown) => scope.postMessage({ error: error instanceof Error ? error.message : String(error) }),
  )
}
