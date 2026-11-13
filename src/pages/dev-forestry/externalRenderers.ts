/**
 * Other forest renderers drawing the road view, chosen in View options.
 *
 * The road view can hand its picture to another engine (threejs-worldgen, Nanite Forest) without the engine
 * becoming part of PGMaps: the engine runs as its own page in a frame over the road view, fed the scene package
 * (`scenePackage.ts`) and the drive camera by `postMessage`. PGMaps' own map stays underneath and keeps driving:
 * the camera, the analysis, every figure, saved views and exported images are PGMaps' own. The engine draws only.
 *
 * Message protocol (`pgmaps-engine` v1), parent → engine:
 * - `{ type: 'pgmaps-scene', scene }`: a whole scene package; replaces whatever the engine drew.
 * - `{ type: 'pgmaps-camera', position, bearingDegrees, pitchDegrees, verticalFovDegrees }`: the eye in the
 *   current package's local metres (x east, y north, z up, absolute height), as the package's own `camera`.
 * - `{ type: 'pgmaps-environment', dateTime, latitude, longitude, ground, weather }`: the light and weather to draw,
 *   from View options (`engineEnvironment`). Kept across new packages; changing it never rebuilds the stand.
 * Engine → parent: `{ type: 'pgmaps-engine-hello', engine }` once it listens (the parent then sends the scene and
 * the camera), `{ type: 'pgmaps-engine-ready', engine }` once drawing a scene, `{ type: 'pgmaps-engine-stats', … }`
 * now and then, `{ type: 'pgmaps-engine-error', message }` on a failure.
 *
 * The adapters live outside the app (`docs/forestry-visual-tools-trial/engines/`). DOM-free and network-free.
 */

import type { ScenePackage } from './scenePackage'
import { metersPerDegree } from './visibility'

export type RoadRendererId = 'pgmaps' | 'worldgen' | 'nanite'

export type RoadRendererInfo = {
  id: RoadRendererId
  label: string
  /** One line for the option's explanation. */
  summary: string
  /** Licence of the engine itself, as its LICENSE file states. */
  licence: string
  needsWebGpu: boolean
  /** Environment variable naming the engine page's URL. */
  urlVariable?: string
  /** The engine's own dev server, used when the variable is unset in development. */
  devUrl?: string
}

export const ROAD_RENDERERS: readonly RoadRendererInfo[] = [
  {
    id: 'pgmaps',
    label: 'PGMaps',
    summary: 'The road view’s own drawing (MapLibre): the one the figures, saved views and images are made from.',
    licence: 'MIT',
    needsWebGpu: false,
  },
  {
    id: 'worldgen',
    label: 'threejs-worldgen',
    summary:
      'three.js trees grown from worldgen’s presets, placed at PGMaps’ stems with their own heights and crown widths. WebGPU, or WebGL2 where WebGPU is missing.',
    licence: 'Apache-2.0',
    needsWebGpu: false,
    urlVariable: 'VITE_FORESTRY_WORLDGEN_URL',
    devUrl: 'http://127.0.0.1:8460/pgmaps-scene.html?embed',
  },
  {
    id: 'nanite',
    label: 'Nanite Forest',
    summary:
      'GPU-driven cluster levels of detail (three.js, WebGPU), drawing PGMaps’ own tree models. One uniform scale per stem: heights are kept, crown widths become each species’ median.',
    licence: 'MIT',
    needsWebGpu: true,
    urlVariable: 'VITE_FORESTRY_NANITE_URL',
    devUrl: 'http://127.0.0.1:8461/examples/pgmaps-scene.html?embed',
  },
]

export function roadRendererInfo(id: RoadRendererId): RoadRendererInfo {
  return ROAD_RENDERERS.find((entry) => entry.id === id) ?? ROAD_RENDERERS[0]
}

/**
 * Where an engine's page is, from the build's environment: its variable when set, its dev server in
 * development, otherwise nowhere (the option is then unavailable and says why).
 */
export function roadRendererUrl(id: RoadRendererId, env: { DEV?: boolean; [key: string]: unknown }): string | null {
  const info = roadRendererInfo(id)
  if (!info.urlVariable) return null
  const configured = env[info.urlVariable]
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  return env.DEV && info.devUrl ? info.devUrl : null
}

/** Why an engine cannot be chosen here, or null when it can. */
export function roadRendererUnavailable(
  id: RoadRendererId,
  context: { url: string | null; webGpu: boolean },
): string | null {
  if (id === 'pgmaps') return null
  const info = roadRendererInfo(id)
  if (!context.url) return `Not set up on this site: ${info.urlVariable} names its page.`
  if (info.needsWebGpu && !context.webGpu) return 'Needs WebGPU, which this browser does not offer.'
  return null
}

export type EngineCamera = {
  type: 'pgmaps-camera'
  position: [number, number, number]
  bearingDegrees: number
  pitchDegrees: number
  verticalFovDegrees: number
}

/**
 * The drive camera in a package's local frame. `pitchDegrees` is up from level (MapLibre's pitch less 90), as the
 * package's own camera. Uses the package's projection (`metersPerDegree` at its origin), so the eye lands where the
 * package put its ground.
 */
export function engineCamera(
  origin: ScenePackage['origin'],
  eye: { lng: number; lat: number; elevationMeters: number },
  view: { bearingDegrees: number; pitchDegrees: number; verticalFovDegrees: number },
): EngineCamera {
  const scale = metersPerDegree(origin.lat)
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    type: 'pgmaps-camera',
    position: [
      round((eye.lng - origin.lng) * scale.lng),
      round((eye.lat - origin.lat) * scale.lat),
      round(eye.elevationMeters),
    ],
    bearingDegrees: round(((view.bearingDegrees % 360) + 360) % 360),
    pitchDegrees: round(view.pitchDegrees),
    verticalFovDegrees: round(view.verticalFovDegrees),
  }
}

/**
 * Whether the eye has gone far enough from a package's origin that the engine needs a new one. Trees reach
 * `treeRadiusMeters` round the origin, so past a third of that the view ahead starts running out of stand.
 */
export function needsNewPackage(
  origin: ScenePackage['origin'],
  eye: { lng: number; lat: number },
  treeRadiusMeters: number,
): boolean {
  const scale = metersPerDegree(origin.lat)
  const distance = Math.hypot((eye.lng - origin.lng) * scale.lng, (eye.lat - origin.lat) * scale.lat)
  return distance > treeRadiusMeters / 3
}

export type EngineWeather = 'clear' | 'overcast' | 'rain' | 'snow'

/** The light and weather an engine draws, as chosen in View options. Display only, like the renderer itself. */
export type EngineEnvironmentChoice = {
  /** Local date, `YYYY-MM-DD`; null for today. */
  date: string | null
  /** Local time, `HH:MM`. */
  time: string
  /** Snow lying on the ground (more on open and flat ground), or bare ground. */
  ground: 'bare' | 'snow'
  weather: EngineWeather
}

export const DEFAULT_ENGINE_ENVIRONMENT: EngineEnvironmentChoice = {
  date: null,
  time: '14:00',
  ground: 'bare',
  weather: 'clear',
}

export const ENGINE_WEATHER: ReadonlyArray<{ id: EngineWeather; label: string }> = [
  { id: 'clear', label: 'Clear' },
  { id: 'overcast', label: 'Overcast' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snowing' },
]

export type EngineEnvironment = {
  type: 'pgmaps-environment'
  /** ISO 8601 with the local offset, e.g. `2026-07-15T14:00:00-07:00`; the engine places the sun from it. */
  dateTime: string
  latitude: number
  longitude: number
  ground: EngineEnvironmentChoice['ground']
  weather: EngineWeather
}

const pad = (value: number) => String(Math.trunc(Math.abs(value))).padStart(2, '0')

/** `YYYY-MM-DD` of a date in this computer's time zone. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The environment message for a place. The date and time are read as local time in this computer's time zone
 * (the reviewer's, and B.C.'s for a reviewer in B.C.), with that day's offset written out, so daylight saving is
 * the engine's to ignore. A malformed date or time falls back to today and the default time.
 */
export function engineEnvironment(
  choice: EngineEnvironmentChoice,
  place: { lng: number; lat: number },
  today: Date,
): EngineEnvironment {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(choice.date ?? '')
  const timeMatch =
    /^(\d{1,2}):(\d{2})$/.exec(choice.time) ?? /^(\d{1,2}):(\d{2})$/.exec(DEFAULT_ENGINE_ENVIRONMENT.time)!
  const [year, month, day] = dateMatch
    ? [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])]
    : [today.getFullYear(), today.getMonth() + 1, today.getDate()]
  const [hours, minutes] = [Math.min(23, Number(timeMatch[1])), Math.min(59, Number(timeMatch[2]))]
  const local = new Date(year, month - 1, day, hours, minutes)
  const offset = -local.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  return {
    type: 'pgmaps-environment',
    dateTime: `${localDate(local)}T${pad(local.getHours())}:${pad(local.getMinutes())}:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`,
    latitude: Math.round(place.lat * 1e5) / 1e5,
    longitude: Math.round(place.lng * 1e5) / 1e5,
    ground: choice.ground === 'snow' ? 'snow' : 'bare',
    weather: ENGINE_WEATHER.some((entry) => entry.id === choice.weather) ? choice.weather : 'clear',
  }
}

export type EngineMessage =
  | { type: 'pgmaps-engine-hello'; engine?: string }
  | { type: 'pgmaps-engine-ready'; engine?: string }
  | { type: 'pgmaps-engine-stats'; engine?: string; [key: string]: unknown }
  | { type: 'pgmaps-engine-error'; message?: string }

/** An engine's message, or null for anything else arriving on the window. */
export function readEngineMessage(data: unknown): EngineMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  return type === 'pgmaps-engine-hello' ||
    type === 'pgmaps-engine-ready' ||
    type === 'pgmaps-engine-stats' ||
    type === 'pgmaps-engine-error'
    ? (data as EngineMessage)
    : null
}

/** One line for the road view: what drew the picture, from the engine's last stats. */
export function engineStatsLine(info: RoadRendererInfo, stats: Record<string, unknown> | null): string {
  if (!stats) return `Drawn by ${info.label}`
  const count = (key: string) => (typeof stats[key] === 'number' ? (stats[key] as number) : null)
  const drawn = count('drawn') ?? count('visible') ?? count('instances')
  const fps = count('fps')
  const parts = [`Drawn by ${info.label}`]
  if (drawn !== null) parts.push(`${Math.round(drawn).toLocaleString('en-CA')} trees`)
  if (fps !== null) parts.push(`${Math.round(fps)} fps`)
  return parts.join(' · ')
}
