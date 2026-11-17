import { describe, expect, it, vi } from 'vitest'
import type { DemTileRange, ElevationSource } from '@/lib/forestry/terrain/terrain'
import { buildHitBuffer } from './photoHitBuffer'
import type { PhotoPose } from './photoPose'
import { drapePhoto, renderModelView, tileXY, type Rgba } from './photoViews'
import {
  createPhotoWorkHost,
  imagerySampler,
  layeredElevation,
  photoTerrainSpec,
  terrainSpecKey,
  type ImageryLayer,
  type PhotoWorkRequest,
  type PhotoWorkResponse,
} from './photoWork'
import { createPhotoWorkClient, type PhotoWorkerLike } from './photoWorkClient'
import { terrainProfile } from './skylineFit'

const RAD = Math.PI / 180
// A made-up place and generated ground.
const LNG = -122.5,
  LAT = 53.7
const mx = 111320 * Math.cos(LAT * RAD)
const hill: ElevationSource = {
  elevationAt(lng, lat) {
    const e = (lng - LNG) * mx,
      n = (lat - LAT) * 110574
    return 800 + 0.02 * e + 0.03 * n + 300 * Math.exp(-(((e - 1400) ** 2 + (n - 1400) ** 2) / (350 * 350)))
  },
}
const pose: PhotoPose = {
  lng: LNG,
  lat: LAT,
  altitudeMeters: 1500,
  bearing: 45,
  pitch: -25,
  roll: 4,
  width: 600,
  height: 450,
  focalPx: 600 / 2 / Math.tan(30 * RAD),
  k1: 0,
  k2: 0,
}
const spec = photoTerrainSpec(LNG, LAT, [{ radiusMeters: 25000, maxZoom: 11, maxTiles: 160 }])

/** An imagery mosaic at zoom 12 round the place, in two colours by tile column. */
function mosaic(): ImageryLayer {
  const zoom = 12
  const [x0, y0] = tileXY(LNG - 0.3, LAT + 0.2, zoom).map(Math.floor),
    [x1, y1] = tileXY(LNG + 0.3, LAT - 0.2, zoom).map(Math.floor)
  const width = (x1 - x0 + 1) * 256,
    height = (y1 - y0 + 1) * 256
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = Math.floor(x / 64) % 2 ? 210 : 40
      data[i + 1] = Math.floor(y / 64) % 2 ? 210 : 40
      data[i + 2] = 100
      data[i + 3] = 255
    }
  return { zoom, minX: x0, minY: y0, width, height, data }
}

/** A worker run in this thread: messages cross by structured clone on a later turn, as they would. */
function inThread(options: { now?: () => number } = {}) {
  const loads: DemTileRange[] = []
  const requests: PhotoWorkRequest[] = []
  const responses: PhotoWorkResponse[] = []
  const workers: PhotoWorkerLike[] = []
  const make = () => {
    const worker: PhotoWorkerLike = {
      onmessage: null,
      onerror: null,
      terminate() {},
      postMessage(message) {
        requests.push(message)
        const copy = structuredClone(message)
        setTimeout(() => host(copy), 0)
      },
    }
    const host = createPhotoWorkHost({
      loadTerrain: async (range) => {
        loads.push(range)
        return hill
      },
      post: (message) => {
        responses.push(message)
        const copy = structuredClone(message)
        setTimeout(() => worker.onmessage?.({ data: copy }), 0)
      },
      now: options.now,
    })
    workers.push(worker)
    return worker
  }
  return { client: createPhotoWorkClient(make), loads, requests, responses, workers }
}

const photoPixels = (): Rgba => renderModelView(pose, hill, imagerySampler([mosaic()]), 120)

describe('the own-photo worker', () => {
  it('casts the hit buffer and the horizon as the page would, loading each terrain range once', async () => {
    const { client, loads } = inThread()
    const hits = await client.run({ kind: 'hitBuffer', pose, terrain: spec, width: 60 }, {})
    expect(hits.kind).toBe('hitBuffer')
    if (hits.kind !== 'hitBuffer') return
    const direct = buildHitBuffer(pose, hill, { width: 60 })
    expect(Array.from(hits.buffer.distance)).toEqual(Array.from(direct.distance))
    expect(hits.buffer.poseKey).toBe(direct.poseKey)

    const eye = { lng: LNG, lat: LAT, altitudeMeters: 1500 }
    const horizon = await client.run({ kind: 'horizon', eye, terrain: spec, from: 10, to: 50, step: 0.25 }, {})
    if (horizon.kind !== 'horizon') throw Error(horizon.kind)
    const whole = terrainProfile(eye, hill, { from: 10, to: 50, step: 0.25 })
    expect(horizon.profile).toHaveLength(whole.length)
    horizon.profile.forEach((point, i) => {
      expect(point.azimuth).toBeCloseTo(whole[i].azimuth, 9)
      expect(point.elevation).toBeCloseTo(whole[i].elevation, 9)
    })
    expect(loads).toHaveLength(1)
  })

  it('sends the photo once under its key, and again only when the worker asks for it', async () => {
    const { client, requests } = inThread()
    const photo = photoPixels()
    const job = { kind: 'drape' as const, pose, terrain: spec, photo: 'frame-1', options: { maxCells: 5000 } }
    const first = await client.run(job, { photo })
    const second = await client.run({ ...job, pose: { ...pose, bearing: 46 } }, { photo })
    const carried = () => requests.filter((r) => r.type === 'job' && r.resources?.photo).length
    expect(carried()).toBe(1)
    if (first.kind !== 'drape' || second.kind !== 'drape') throw Error('not a drape')
    const direct = drapePhoto(pose, hill, photo, { maxCells: 5000 })!
    expect(first.drape!.width).toBe(direct.width)
    expect(Array.from(first.drape!.data)).toEqual(Array.from(direct.data))
    expect(Array.from(first.drape!.hiddenMask)).toEqual(Array.from(direct.hiddenMask))
    expect(first.drape!.footprint).toEqual(direct.footprint)
    // Eight other photos push frame-1 out of the worker; the client still thinks it is there, is asked, resends.
    for (let k = 2; k < 11; k++) await client.run({ ...job, photo: `frame-${k}` }, { photo })
    const before = carried()
    const again = await client.run(job, { photo })
    expect(again.kind).toBe('drape')
    expect(carried()).toBe(before + 1)
  })

  it('draws and scores the model view against the photo', async () => {
    const { client, requests } = inThread()
    const imagery = [mosaic()]
    const photo = photoPixels()
    const run = (bearing: number) =>
      client.run(
        { kind: 'modelView', pose: { ...pose, bearing }, terrain: spec, imagery: 'spot', photo: 'frame', width: 60 },
        { imagery, photo },
      )
    const right = await run(45)
    const wrong = await run(80)
    if (right.kind !== 'modelView' || wrong.kind !== 'modelView') throw Error('not a model view')
    expect(right.image.width).toBe(60)
    expect(Array.from(right.image.data)).toEqual(
      Array.from(renderModelView(pose, hill, imagerySampler(imagery), 60, 60000).data),
    )
    expect(right.agreement!.score).toBeGreaterThan(wrong.agreement!.score)
    expect(requests.filter((r) => r.type === 'job' && r.resources?.imagery).length).toBe(1)
  })

  it('rejects at once when aborted, drops the job in the worker, and carries on with the next', async () => {
    let clock = 0
    const { client, responses } = inThread({ now: () => (clock += 100) })
    const controller = new AbortController()
    const progress: number[] = []
    const slow = client.run(
      { kind: 'modelView', pose, terrain: spec, imagery: 'spot', photo: null, width: 160 },
      { imagery: [mosaic()] },
      controller.signal,
      (stage, done) => {
        if (stage !== 'work') return
        progress.push(done)
        if (progress.length === 2) controller.abort()
      },
    )
    await expect(slow).rejects.toThrow()
    // The worker drops the job at its next slice; wait for that rather than a fixed delay, which a loaded run outlasts.
    await vi.waitFor(() => expect(responses.some((r) => r.type === 'cancelled')).toBe(true), { timeout: 5000 })
    expect(responses.some((r) => r.type === 'done')).toBe(false)
    const next = await client.run({ kind: 'hitBuffer', pose, terrain: spec, width: 20 }, {})
    expect(next.kind).toBe('hitBuffer')
  })

  it('refuses a job whose pixels it was never given', async () => {
    const { client } = inThread()
    await expect(client.run({ kind: 'drape', pose, terrain: spec, photo: 'never' }, {})).rejects.toThrow(
      /needs the photo/,
    )
  })
})

describe('terrain for the worker', () => {
  it('chooses each ring within its tile budget and names it by its tiles', () => {
    const rings = photoTerrainSpec(LNG, LAT, [
      { radiusMeters: 25000, maxZoom: 11, maxTiles: 160 },
      { radiusMeters: 90000, maxZoom: 9, maxTiles: 40 },
    ])
    expect(rings.layers).toHaveLength(2)
    expect(rings.layers[0].zoom).toBeLessThanOrEqual(11)
    expect(rings.layers[0].tileCount).toBeLessThanOrEqual(160)
    expect(rings.layers[1].tileCount).toBeLessThanOrEqual(40)
    expect(terrainSpecKey(rings)).toBe(
      terrainSpecKey(
        photoTerrainSpec(LNG, LAT, [
          { radiusMeters: 25000, maxZoom: 11, maxTiles: 160 },
          { radiusMeters: 90000, maxZoom: 9, maxTiles: 40 },
        ]),
      ),
    )
  })

  it('reads the first layer with ground', () => {
    const near: ElevationSource = { elevationAt: (lng) => (lng < LNG ? 100 : Number.NaN) }
    const far: ElevationSource = { elevationAt: () => 200 }
    const both = layeredElevation([near, far])
    expect(both.elevationAt(LNG - 0.1, LAT)).toBe(100)
    expect(both.elevationAt(LNG + 0.1, LAT)).toBe(200)
    expect(layeredElevation([near]).elevationAt(LNG + 0.1, LAT)).toBeNaN()
  })
})
