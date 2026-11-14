/**
 * An engine's own picture as the analysis sheet's figure (`pgmaps-engine` capture, v1).
 *
 * When another engine draws the road view (`externalRenderers.ts`), the sheet asks it for the frames the sheet is
 * framed on (`figureFraming.ts`) instead of reading PGMaps' map. For each frame the engine returns, from one camera
 * and one scene:
 * - the picture, as an image;
 * - the ground class pass (`classes`): every pixel one flat colour of `CLASS_PALETTE` (the sheet's own palette), the
 *   request's polygons draped on the engine's terrain with no trees, stumps or slash drawn, water surfaces `water`,
 *   the sky transparent. Nearer ground still hides farther ground, so outlines follow the visible edge a ridge cuts,
 *   and run over the trees as the VIAs' own renders draw them;
 * - the screened pass (`screened`): the same with the engine's trees drawn. A tree takes the class of the ground
 *   under its own stem (a landform's forest is the landform, a tree in a block is the block); only a tree standing
 *   on unlisted ground or water is `vegetation`, screening what is behind it;
 * - depth: metres along the camera's view axis, one float a pixel, 0 for the sky.
 * The picture, the outlines and the pixel figure then all come from that engine's capture; the sightline figure stays
 * PGMaps' run, and the sheet says which is which.
 *
 * Protocol, parent → engine: `{ type: 'pgmaps-capture', id, position, frames, classes }` (`EngineCaptureRequest`):
 * camera position in the current package's local metres (x east, y north, z up, absolute height); each frame's
 * bearing (clockwise from north), pitch (up from level), horizontal and vertical field and pixel size, drawn as a
 * pinhole (`projectToFrame`); and the class layers, bottom first, in package metres. Engine → parent:
 * `{ type: 'pgmaps-engine-capture', id, … }` (`EngineCaptureReply`) with `frames` in request order, or
 * `{ type: 'pgmaps-engine-capture', id, error }`. Buffers travel as transferables.
 *
 * DOM-free and network-free: the page joins the images (`engineFramedCapture.ts`).
 */

import { CLASS_PALETTE, FIGURE_CLASS, type ClassRaster, type FigureClass } from '@/lib/forestry/viaFigure/composeFigure'
import type { ClassPassLayer } from './figureClassPass'
import type { FinalStand } from './finalStand'
import type { FrameCamera } from './figureFraming'
import type { ScenePackage } from './scenePackage'
import { skylineTerrainRadius, type SkylineReach } from './skylineReach'
import { metersPerDegree } from './visibility'

/** Class codes only an engine's pass has: its drawn trees (screening) and its water surface. */
export const ENGINE_CLASS = { vegetation: 10, water: 11 } as const

/** Their colours: far from every `CLASS_PALETTE` colour, so a blended edge never reads as either. */
export const ENGINE_CLASS_COLOUR: Record<keyof typeof ENGINE_CLASS, readonly [number, number, number]> = {
  vegetation: [255, 255, 255],
  water: [255, 128, 0],
}

/** The palette to decode an engine's class pass with (`decodeClassRaster`). */
export const ENGINE_CLASS_PALETTE: ReadonlyArray<{ code: number; rgb: readonly number[] }> = [
  ...(Object.entries(CLASS_PALETTE) as Array<[Exclude<FigureClass, 'sky'>, readonly number[]]>).map(([name, rgb]) => ({
    code: FIGURE_CLASS[name],
    rgb,
  })),
  { code: ENGINE_CLASS.vegetation, rgb: ENGINE_CLASS_COLOUR.vegetation },
  { code: ENGINE_CLASS.water, rgb: ENGINE_CLASS_COLOUR.water },
]

type Rgb = [number, number, number]
/** Package metres, x east and y north: polygons of rings of points. */
type LocalMultiPolygon = Array<Array<Array<[number, number]>>>

export type EngineCaptureFrame = {
  bearingDegrees: number
  /** Up from level, degrees. */
  pitchDegrees: number
  horizontalFovDegrees: number
  verticalFovDegrees: number
  /** Pixels. `width / height` is `tan(h/2) / tan(v/2)`. */
  width: number
  height: number
}

export type EngineCaptureRequest = {
  type: 'pgmaps-capture'
  id: string
  /** The eye, package local metres, absolute height. */
  position: [number, number, number]
  frames: EngineCaptureFrame[]
  classes: {
    /** All other terrain. */
    terrain: Rgb
    /** Draped on the terrain, bottom first; a later layer paints over an earlier one. */
    layers: Array<{ id: string; rgb: Rgb; polygons: LocalMultiPolygon }>
    /** The colour the engine's drawn trees take, in front of what they hide. */
    vegetation: Rgb
    /** The colour of the engine's water surfaces. */
    water: Rgb
  }
  /**
   * A second flat pass of the same cameras, when asked: the VQO zone polygons (`ZONE_PALETTE`) draped on the bare
   * terrain, trees and water not drawn, sky transparent. Returned as each frame's `zones`.
   */
  zones?: {
    terrain: Rgb
    layers: Array<{ id: string; rgb: Rgb; polygons: LocalMultiPolygon }>
  }
  /**
   * `active` (absent): draw as the road view does. `final`: the report's still. The engine waits for every stream and
   * LOD, fits its shadows to the frame, accumulates `samples` jittered sub-pixel samples per frame (TAA held still, or
   * SSAA), draws `stand` in place of the package's own stems where it reaches, the far forest as a canopy surface past
   * `canopyCutoffPx`, and water at full reflection resolution. The ground class pass is the same in both modes; the
   * picture, the screened pass and depth use the final stems. Engines report what they did in `final`.
   */
  quality?: 'active' | 'final'
  /** Jittered samples accumulated per frame in `final` (default 24). */
  samples?: number
  /**
   * The frame's forest at real density for `final` (`finalStand.ts`): stems in the package's local metres, the same
   * `fields` as the package's `trees`, `data` a transferable Float32Array. Where it reaches (`radiusMeters` from the
   * eye, within `bearings`), it replaces the package's stems; past it the package's stems or the canopy surface draw.
   */
  stand?: {
    fields: readonly string[]
    species: readonly string[]
    count: number
    data: Float32Array
    radiusMeters: number
    /** Bearing span it covers, degrees clockwise from north, [from, to] (may wrap past 360). */
    bearings: [number, number]
  }
  /**
   * Past the distance at which the stand's median tree is under this many pixels tall in the frame, the forest is
   * drawn as a canopy surface (terrain raised by stand height, coloured by species mix and closure, crown-scale
   * mottling and shadow) rather than single trees: Visual Nature Studio's "dissolve" rule. Default 4.
   */
  canopyCutoffPx?: number
}

export type EngineCaptureFrameReply = {
  width: number
  height: number
  /** The picture: PNG or JPEG. */
  image: Blob
  /** The ground class pass (no trees), straight RGBA, `width × height × 4`, unsmoothed; alpha 0 for the sky. */
  classes: Uint8ClampedArray | Uint8Array
  /** The screened pass (the engine's trees drawn, each in its ground's class), like `classes`; absent from older engines. */
  screened?: Uint8ClampedArray | Uint8Array
  /** Metres along the view axis, `width × height`, row-major from the top-left; 0 for the sky. */
  depth: Float32Array
  /** The zone pass, straight RGBA like `classes`, when the request asked for one. */
  zones?: Uint8ClampedArray | Uint8Array
  /** The camera the engine drew with, as it applied it. */
  camera: {
    position: [number, number, number]
    bearingDegrees: number
    pitchDegrees: number
    horizontalFovDegrees: number
    verticalFovDegrees: number
    near: number
    far: number
  }
}

export type EngineCaptureReply = {
  type: 'pgmaps-engine-capture'
  id: string
  engine: string
  /** The engine's version: a commit, a package version, or both. */
  version: string
  frames: EngineCaptureFrameReply[]
  /** The package the capture was drawn from (`createdAt`, `origin`), as the engine received it. */
  scene: { createdAt: string | null; origin: ScenePackage['origin'] | null }
  /** The light and weather drawn (the engine's `sun` record included). */
  environment: Record<string, unknown> | null
  /** Tallest tree drawn, metres; null when none. */
  maxTreeHeightMeters: number | null
  /**
   * What the engine drew without data of its own, each a short phrase the sheet prints (at most about 60 characters:
   * "far terrain past 12 km invented", "trees past 5.2 km not drawn").
   */
  missing: string[]
  /** The same at length, with figures, kept with the saved view. */
  missingDetail: string[]
  /** What the engine drew for a `final` request (absent for `active`): samples, stems drawn, the canopy cut-off. */
  final?: { samples: number; stems: number; canopyCutoffMeters: number | null; millis: number } | null
}

let sequence = 0

const rgbOf = (colour: string): Rgb => {
  const hex = /^#?([0-9a-f]{6})$/i.exec(colour.trim())
  if (!hex) throw new Error(`Not a class colour: ${colour}`)
  const value = parseInt(hex[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Polygons of a class layer in package metres. */
function localPolygons(layer: ClassPassLayer, origin: ScenePackage['origin']): LocalMultiPolygon {
  const scale = metersPerDegree(origin.lat)
  const toLocal = ([lng, lat]: GeoJSON.Position): [number, number] => [
    round2((lng - origin.lng) * scale.lng),
    round2((lat - origin.lat) * scale.lat),
  ]
  return layer.data.features.flatMap((feature) => {
    const geometry = feature.geometry
    if (geometry?.type === 'Polygon') return [geometry.coordinates.map((ring) => ring.map(toLocal))]
    if (geometry?.type === 'MultiPolygon')
      return geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(toLocal)))
    return []
  })
}

/**
 * The capture request for a framing plan: the eye moved into the package's frame (as `engineCamera` does), each
 * frame at `frameWidth × height`, and the class pass's layers (`classPassLayers`) in package metres.
 */
export function captureRequest(input: {
  origin: ScenePackage['origin']
  eye: { lng: number; lat: number; elevation: number }
  frames: readonly FrameCamera[]
  frameWidth: number
  height: number
  layers: readonly ClassPassLayer[]
  terrainColour: string
  /** The VQO zone pass's layers (`zonePassLayers`) and its terrain colour, when zones are drawn. */
  zones?: { layers: readonly ClassPassLayer[]; terrainColour: string } | null
  /**
   * The report's still (`quality: 'final'`): the frame's forest at real density (`finalStand.ts`, in the package's
   * metres), the samples to accumulate and the canopy cut-off. Absent: the active capture, as the road view draws.
   */
  final?: { stand: FinalStand | null; samples?: number; canopyCutoffPx?: number } | null
}): EngineCaptureRequest {
  const { origin, eye } = input
  const scale = metersPerDegree(origin.lat)
  return {
    type: 'pgmaps-capture',
    id: `capture-${Date.now().toString(36)}-${(sequence++).toString(36)}`,
    position: [
      round2((eye.lng - origin.lng) * scale.lng),
      round2((eye.lat - origin.lat) * scale.lat),
      round2(eye.elevation),
    ],
    frames: input.frames.map((frame) => ({
      bearingDegrees: ((frame.bearingDeg % 360) + 360) % 360,
      pitchDegrees: frame.pitchDeg,
      horizontalFovDegrees: frame.hfovDeg,
      verticalFovDegrees: frame.vfovDeg,
      width: input.frameWidth,
      height: input.height,
    })),
    classes: {
      terrain: rgbOf(input.terrainColour),
      layers: input.layers.map((layer) => ({
        id: layer.id,
        rgb: rgbOf(layer.color),
        polygons: localPolygons(layer, origin),
      })),
      vegetation: [...ENGINE_CLASS_COLOUR.vegetation],
      water: [...ENGINE_CLASS_COLOUR.water],
    },
    ...(input.zones?.layers.length
      ? {
          zones: {
            terrain: rgbOf(input.zones.terrainColour),
            layers: input.zones.layers.map((layer) => ({
              id: layer.id,
              rgb: rgbOf(layer.color),
              polygons: localPolygons(layer, origin),
            })),
          },
        }
      : {}),
    ...(input.final
      ? {
          quality: 'final' as const,
          samples: input.final.samples ?? FINAL_SAMPLES,
          canopyCutoffPx: input.final.canopyCutoffPx ?? FINAL_CANOPY_CUTOFF_PX,
          ...(input.final.stand
            ? {
                stand: {
                  fields: input.final.stand.fields,
                  species: input.final.stand.species,
                  count: input.final.stand.count,
                  data: input.final.stand.data,
                  radiusMeters: input.final.stand.radiusMeters,
                  bearings: input.final.stand.bearings,
                },
              }
            : {}),
        }
      : {}),
  }
}

/** Jittered samples a `final` capture accumulates per frame. */
export const FINAL_SAMPLES = 24
/** A tree under this many pixels tall in a `final` frame is drawn as canopy surface (VNS's dissolve rule). */
export const FINAL_CANOPY_CUTOFF_PX = 4

/** The buffers a request hands over rather than copies: the final stand's stems. */
export function captureTransfer(request: EngineCaptureRequest): Transferable[] {
  return request.stand ? [request.stand.data.buffer as ArrayBuffer] : []
}

/**
 * How much terrain a capture's package needs: out past the farthest class polygon from the eye (the landform, the
 * blocks) by a kilometre, so the class pass drapes them on real ground rather than an engine's invented edge, and a
 * spacing that keeps the grid near 800 posts across. Never less than the road view's own 3 km at 15 m.
 *
 * Given the frames' skyline scan (`skylineReach`, run by `loadSkylineTerrain`), a coarsest grid (`skylineTerrain`)
 * reaches past `farTerrain` to the farthest skyline point plus a margin (`skylineTerrainRadius`, at most 60 km),
 * when that point stands past `farTerrain`'s radius; otherwise its radius is 0.
 */
export function captureTerrain(
  eye: { lng: number; lat: number },
  layers: readonly ClassPassLayer[],
  limitMeters = 12_000,
  skyline: Pick<SkylineReach, 'farthestMeters' | 'reachesLimit'> | null = null,
): {
  terrainRadiusMeters: number
  terrainSpacingMeters: number
  /** Stems out past the farthest class polygon by half a kilometre, so a far block reads as a cut in the forest. */
  treeRadiusMeters: number
  /** Coarse terrain out to the skyline, past the detailed grid. */
  farTerrainRadiusMeters: number
  farTerrainSpacingMeters: number
  reachMeters: number
  clipped: boolean
  /** Coarsest terrain to the frames' farthest skyline (`skylineTerrain`); 0 when `farTerrain` already holds it. */
  skylineTerrainRadiusMeters: number
  skylineTerrainSpacingMeters: number
  /** The farthest skyline point the scan found, metres; null without a scan. */
  skylineReachMeters: number | null
  /** The skyline may stand past what the package carries (the 60 km cap). */
  skylineClipped: boolean
} {
  const scale = metersPerDegree(eye.lat)
  let reach = 0
  for (const layer of layers)
    for (const feature of layer.data.features) {
      const geometry = feature.geometry
      const rings =
        geometry?.type === 'Polygon'
          ? geometry.coordinates
          : geometry?.type === 'MultiPolygon'
            ? geometry.coordinates.flat()
            : []
      for (const ring of rings)
        for (const [lng, lat] of ring)
          reach = Math.max(reach, Math.hypot((lng - eye.lng) * scale.lng, (lat - eye.lat) * scale.lat))
    }
  const wanted = Math.max(3000, Math.ceil((reach + 1000) / 500) * 500)
  const radius = Math.min(limitMeters, wanted)
  const far = Math.max(SKYLINE_RADIUS_METERS, radius)
  const farSpacing = Math.ceil(far / 250)
  const outer = skyline ? skylineTerrainRadius(skyline) : null
  const reachesPast = !!outer && outer.radiusMeters > far
  return {
    terrainRadiusMeters: radius,
    terrainSpacingMeters: Math.max(15, Math.ceil(radius / 400)),
    treeRadiusMeters: Math.max(600, Math.min(radius, Math.ceil((reach + 500) / 100) * 100)),
    farTerrainRadiusMeters: far,
    farTerrainSpacingMeters: farSpacing,
    reachMeters: Math.round(reach),
    clipped: wanted > limitMeters,
    skylineTerrainRadiusMeters: reachesPast ? outer.radiusMeters : 0,
    skylineTerrainSpacingMeters: reachesPast ? Math.max(farSpacing, outer.spacingMeters) : 0,
    skylineReachMeters: skyline ? Math.round(skyline.farthestMeters) : null,
    skylineClipped: !!outer?.clipped,
  }
}

/**
 * How far a capture's coarse terrain (`farTerrain`) reaches: the skyline of most B.C. valley views. West Gun Boat
 * Launch's farthest ridge layers stand 9–11 km off. A skyline past it (Lost Ledge's peak on the left at 17–19 km,
 * Gun Lake VPT1's at 26–32 km) is carried by `skylineTerrain`, sized from the frames' skyline scan.
 */
export const SKYLINE_RADIUS_METERS = 15_000

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : []

/**
 * An engine's capture reply, checked against its request: the same id, a frame for each frame asked for, at the size
 * asked for, with a picture, a whole class pass and whole depth. Throws with the reason otherwise, and with the
 * engine's own message when it sent an error.
 */
export function readCaptureReply(data: unknown, request: EngineCaptureRequest): EngineCaptureReply {
  if (!isRecord(data) || data.type !== 'pgmaps-engine-capture' || data.id !== request.id)
    throw new Error('Not this capture’s reply.')
  if (typeof data.error === 'string') throw new Error(data.error)
  const frames = Array.isArray(data.frames) ? data.frames : []
  if (frames.length !== request.frames.length)
    throw new Error(`The engine drew ${frames.length} frames for ${request.frames.length} asked for.`)
  const read = frames.map((frame, i): EngineCaptureFrameReply => {
    const asked = request.frames[i]
    if (!isRecord(frame)) throw new Error(`Frame ${i + 1} is missing.`)
    if (frame.width !== asked.width || frame.height !== asked.height)
      throw new Error(
        `Frame ${i + 1} is ${String(frame.width)} × ${String(frame.height)}, not ${asked.width} × ${asked.height}.`,
      )
    const pixels = asked.width * asked.height
    if (!(typeof Blob !== 'undefined' && frame.image instanceof Blob) && !isRecord(frame.image))
      throw new Error(`Frame ${i + 1} has no picture.`)
    const classes = frame.classes
    if (!(classes instanceof Uint8ClampedArray || classes instanceof Uint8Array) || classes.length !== pixels * 4)
      throw new Error(`Frame ${i + 1}'s class pass is not ${pixels} RGBA pixels.`)
    const depth = frame.depth
    if (!(depth instanceof Float32Array) || depth.length !== pixels)
      throw new Error(`Frame ${i + 1}'s depth is not ${pixels} values.`)
    const zones = frame.zones
    if (
      request.zones &&
      !((zones instanceof Uint8ClampedArray || zones instanceof Uint8Array) && zones.length === pixels * 4)
    )
      throw new Error(`Frame ${i + 1}'s zone pass is not ${pixels} RGBA pixels.`)
    const camera = isRecord(frame.camera) ? frame.camera : {}
    const position = Array.isArray(camera.position) && camera.position.length === 3 ? camera.position : null
    return {
      width: asked.width,
      height: asked.height,
      image: frame.image as Blob,
      classes,
      depth,
      ...(request.zones ? { zones: zones as Uint8ClampedArray | Uint8Array } : {}),
      ...((frame.screened instanceof Uint8ClampedArray || frame.screened instanceof Uint8Array) &&
      frame.screened.length === pixels * 4
        ? { screened: frame.screened }
        : {}),
      camera: {
        position: (position?.every(finite) ? position : request.position) as [number, number, number],
        bearingDegrees: finite(camera.bearingDegrees) ? camera.bearingDegrees : asked.bearingDegrees,
        pitchDegrees: finite(camera.pitchDegrees) ? camera.pitchDegrees : asked.pitchDegrees,
        horizontalFovDegrees: finite(camera.horizontalFovDegrees)
          ? camera.horizontalFovDegrees
          : asked.horizontalFovDegrees,
        verticalFovDegrees: finite(camera.verticalFovDegrees) ? camera.verticalFovDegrees : asked.verticalFovDegrees,
        near: finite(camera.near) ? camera.near : NaN,
        far: finite(camera.far) ? camera.far : NaN,
      },
    }
  })
  const scene = isRecord(data.scene) ? data.scene : {}
  return {
    type: 'pgmaps-engine-capture',
    id: request.id,
    engine: typeof data.engine === 'string' ? data.engine : 'engine',
    version: typeof data.version === 'string' && data.version ? data.version : 'unknown',
    frames: read,
    scene: {
      createdAt: typeof scene.createdAt === 'string' ? scene.createdAt : null,
      origin: isRecord(scene.origin) ? (scene.origin as ScenePackage['origin']) : null,
    },
    environment: isRecord(data.environment) ? data.environment : null,
    maxTreeHeightMeters: finite(data.maxTreeHeightMeters) ? data.maxTreeHeightMeters : null,
    missing: strings(data.missing),
    missingDetail: strings(data.missingDetail),
    ...(request.quality === 'final' ? { final: readFinal(data.final) } : {}),
  }
}

/** An engine's `final` record, or null when it did not report one (it drew the active capture). */
function readFinal(value: unknown): EngineCaptureReply['final'] {
  if (!isRecord(value) || !finite(value.samples) || !finite(value.stems)) return null
  return {
    samples: Math.max(0, Math.round(value.samples)),
    stems: Math.max(0, Math.round(value.stems)),
    canopyCutoffMeters: finite(value.canopyCutoffMeters) ? value.canopyCutoffMeters : null,
    millis: finite(value.millis) ? Math.round(value.millis) : 0,
  }
}

/**
 * Where the drawn camera parted from the one asked for, frame by frame: position (metres), bearing, pitch and fields
 * (degrees). The sheet's outlines and callouts are projected with the camera asked for, so a capture that moved its
 * camera is refused rather than printed with outlines off the picture.
 */
export function cameraMismatch(reply: EngineCaptureReply, request: EngineCaptureRequest): string | null {
  const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
  for (let i = 0; i < reply.frames.length; i++) {
    const drawn = reply.frames[i].camera
    const asked = request.frames[i]
    const moved = Math.hypot(...drawn.position.map((value, k) => value - request.position[k]))
    const off = [
      moved > 0.5 && `stood ${moved.toFixed(1)} m from the eye`,
      turn(drawn.bearingDegrees, asked.bearingDegrees) > 0.05 && 'turned',
      Math.abs(drawn.pitchDegrees - asked.pitchDegrees) > 0.05 && 'pitched differently',
      Math.abs(drawn.horizontalFovDegrees - asked.horizontalFovDegrees) > 0.05 && 'a different horizontal field',
      Math.abs(drawn.verticalFovDegrees - asked.verticalFovDegrees) > 0.05 && 'a different vertical field',
    ].filter(Boolean)
    if (off.length) return `Frame ${i + 1} was drawn with ${off.join(', ')}.`
  }
  return null
}

/** Frames of `channels` values a pixel, `frameWidth × height` each, joined side by side in request order. */
export function joinFrames<T extends Uint8ClampedArray | Float32Array>(
  parts: readonly ArrayLike<number>[],
  frameWidth: number,
  height: number,
  channels: number,
  make: (length: number) => T,
): T {
  const width = frameWidth * parts.length
  const joined = make(width * height * channels)
  const row = frameWidth * channels
  parts.forEach((part, i) => {
    for (let y = 0; y < height; y++)
      for (let k = 0; k < row; k++) joined[(y * width + i * frameWidth) * channels + k] = part[y * row + k]
  })
  return joined
}

/** Nearest and farthest drawn surface, metres, and the share of the picture that is sky. */
export function depthSummary(depth: ArrayLike<number>): {
  nearestM: number | null
  farthestM: number | null
  skyShare: number
} {
  let near = Infinity,
    far = 0,
    sky = 0
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]
    if (!(d > 0) || !Number.isFinite(d)) {
      sky++
      continue
    }
    if (d < near) near = d
    if (d > far) far = d
  }
  return {
    nearestM: Number.isFinite(near) ? Math.round(near * 10) / 10 : null,
    farthestM: far > 0 ? Math.round(far) : null,
    skyShare: depth.length ? sky / depth.length : 1,
  }
}

/** Pixels of the engine's trees and water in a decoded pass, beside the landform's. */
export function screeningCounts(raster: ClassRaster): { vegetation: number; water: number } {
  let vegetation = 0,
    water = 0
  for (const code of raster.codes) {
    if (code === ENGINE_CLASS.vegetation) vegetation++
    else if (code === ENGINE_CLASS.water) water++
  }
  return { vegetation, water }
}

/** Who drew a sheet's picture: printed with the pixel figure, kept with the saved view. */
export type FigureIllustration = {
  /** e.g. "Nanite Forest". */
  renderer: string
  version: string
  /** When the capture was drawn. */
  capturedAt: string
  /** The package it was drawn from. */
  sceneCreatedAt: string | null
  /** The sun and weather drawn (the engine's record). */
  environment: Record<string, unknown> | null
  depth: { nearestM: number | null; farthestM: number | null; skyShare: number }
  /** What was drawn without data, the engine's and PGMaps' own (terrain cut short). */
  missing: string[]
  /**
   * What the engine drew for a final render (`quality: 'final'`), as it reported it; null when it was asked for one
   * and drew the active capture instead, absent when none was asked for.
   */
  final?: EngineCaptureReply['final']
  /** The real-density stand PGMaps sent for it (`finalStand.ts`): stems, how far it reached, time to grow it. */
  stand?: { stems: number; radiusMeters: number; clipped: boolean; millis: number } | null
}

/** The sheet's line of what the picture drew without data, or null when nothing. */
export function missingLine(illustration: FigureIllustration): string | null {
  return illustration.missing.length ? `Drawn without data: ${illustration.missing.join('; ')}` : null
}

/** One line for the sheet: what drew the picture and its pixel figure. */
export function illustrationLine(illustration: FigureIllustration): string {
  const version = illustration.version === 'unknown' ? '' : ` ${illustration.version}`
  const final = illustration.final
  const render = final
    ? `; final render: ${final.samples} samples, ${formatStems(final.stems)} stems`
    : final === null
      ? '; active render (final not drawn)'
      : ''
  return `Picture and pixel measures: ${illustration.renderer}${version}, one capture${render}`
}

/** A stem count for a printed line: 812 or 1.38 M. */
function formatStems(stems: number): string {
  if (stems >= 1_000_000) return `${(stems / 1_000_000).toFixed(2)} M`
  if (stems >= 10_000) return `${Math.round(stems / 1000)} k`
  return String(stems)
}
