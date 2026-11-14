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
 * - `{ type: 'pgmaps-environment', dateTime, utc, timeZone, latitude, longitude, sun, sunPosition, ground,
 *   weather, cloudCover, visibilityKm }`: the light
 *   and weather to draw, from View options (`engineEnvironment`), the time read on the site's clock. Kept across new
 *   packages; changing it never rebuilds the stand.
 * Engine → parent: `{ type: 'pgmaps-engine-hello', engine }` once it listens (the parent then sends the scene and
 * the camera), `{ type: 'pgmaps-engine-ready', engine }` once drawing a scene, `{ type: 'pgmaps-engine-stats', … }`
 * now and then (with `sun`: the elevation and azimuth asked for and those the light was drawn from), `{ type: 'pgmaps-engine-error', message }` on a failure.
 *
 * The adapters live outside the app (`docs/forestry-visual-tools-trial/engines/`). DOM-free and network-free.
 */

import { sunPosition } from '@/lib/geo/solarPosition'
import type { ScenePackage } from './scenePackage'
import { metersPerDegree } from './visibility'
import { scenePerspective, type SceneCamera, type SceneViewport } from './sceneCamera'

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

export type EngineCamera = SceneCamera & {
  type: 'pgmaps-camera'
}

/**
 * The drive camera in a package's local frame. `pitchDegrees` is up from level (MapLibre's pitch less 90), as the
 * package's own camera. Uses the package's projection (`metersPerDegree` at its origin), so the eye lands where the
 * package put its ground.
 */
export function engineCamera(
  origin: ScenePackage['origin'],
  eye: { lng: number; lat: number; elevationMeters: number },
  view: { bearingDegrees: number; pitchDegrees: number; verticalFovDegrees: number; viewport?: SceneViewport },
): EngineCamera {
  const scale = metersPerDegree(origin.lat)
  return {
    type: 'pgmaps-camera',
    position: [(eye.lng - origin.lng) * scale.lng, (eye.lat - origin.lat) * scale.lat, eye.elevationMeters],
    bearingDegrees: ((view.bearingDegrees % 360) + 360) % 360,
    pitchDegrees: view.pitchDegrees,
    verticalFovDegrees: view.verticalFovDegrees,
    rollDegrees: 0,
    ...(view.viewport ? { projection: scenePerspective(view.verticalFovDegrees, view.viewport) } : {}),
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

/** How the engine lights the scene: from the sun's true position, or kept to daylight (the engines' own look). */
export type EngineSun = 'true' | 'daylight'

/** The light and weather an engine draws, as chosen in View options. Display only, like the renderer itself. */
export type EngineEnvironmentChoice = {
  /** Local date at the site, `YYYY-MM-DD`; null for today there. */
  date: string | null
  /** Local time at the site, `HH:MM`. */
  time: string
  /** The site's IANA time zone; null takes it from the place (`siteTimeZone`). */
  timeZone: string | null
  /**
   * `true`: the light comes from where the sun is at that instant, below the horizon none. `daylight`: an engine
   * may lift a low sun or move a night clock to dusk so the picture stays lit; the engine reports what it drew.
   */
  sun: EngineSun
  /** Snow lying on the ground (more on open and flat ground), or bare ground. */
  ground: 'bare' | 'snow'
  weather: EngineWeather
  /** Share of the sky under cloud in clear weather, 0–1 (`ENGINE_CLOUDS`); overcast, rain and snow are 1. */
  cloudCover: number
  /** How far one can see, km (`ENGINE_VISIBILITY`): the haze every engine draws over distance. */
  visibilityKm: number
  /** Wind over water, m/s: 0 a mirror, 2–4 a ripple, 8+ whitecaps (Cox–Munk roughness). */
  windMs?: number
  /** `via`: the consultants' convention (dark olive canopy, mirror lakes, little haze); `photo`: a photo's look. */
  look?: EngineLook
}

export type EngineLook = 'via' | 'photo'

/** A visibility this far or farther means no haze at all: engines draw no aerial perspective. */
export const NO_HAZE_KM = 1000

export const DEFAULT_ENGINE_ENVIRONMENT: EngineEnvironmentChoice = {
  date: null,
  time: '14:00',
  timeZone: null,
  sun: 'true',
  ground: 'bare',
  weather: 'clear',
  cloudCover: 0.2,
  // No haze for now: a far slope's colour is then the engine's own, as the VIAs' renders draw it.
  visibilityKm: NO_HAZE_KM,
  windMs: 0,
  look: 'via',
}

/** Wind over water, m/s: a calm mirror to a wind-rippled lake. */
export const ENGINE_WIND: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Calm' },
  { value: 2, label: 'Light, 2 m/s' },
  { value: 5, label: 'Breezy, 5 m/s' },
  { value: 9, label: 'Windy, 9 m/s' },
]

/** The two looks the references disagree on (`docs/forestry-visual-quality.md`, **Final render**). */
export const ENGINE_LOOKS: ReadonlyArray<{ id: EngineLook; label: string }> = [
  { id: 'via', label: 'VIA convention' },
  { id: 'photo', label: 'Photo match' },
]

/** Cloud cover in clear weather, as oktas read it: none, few (1–2/8), scattered (3–4/8), broken (5–7/8). */
export const ENGINE_CLOUDS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'None' },
  { value: 0.2, label: 'Few' },
  { value: 0.45, label: 'Scattered' },
  { value: 0.75, label: 'Broken' },
]

/** How far the air lets one see. */
export const ENGINE_VISIBILITY: ReadonlyArray<{ value: number; label: string }> = [
  { value: NO_HAZE_KM, label: 'No haze' },
  { value: 100, label: 'Very clear, 100 km' },
  { value: 50, label: 'Clear, 50 km' },
  { value: 25, label: 'Light haze, 25 km' },
  { value: 10, label: 'Hazy, 10 km' },
  { value: 4, label: 'Smoke, 4 km' },
]

export const ENGINE_WEATHER: ReadonlyArray<{ id: EngineWeather; label: string }> = [
  { id: 'clear', label: 'Clear' },
  { id: 'overcast', label: 'Overcast' },
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snowing' },
]

/** B.C.'s clocks. The northeast and Creston keep Mountain standard time all year; the East Kootenay keeps Mountain. */
export const SITE_TIME_ZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'America/Vancouver', label: 'Pacific' },
  { id: 'America/Edmonton', label: 'Mountain' },
  { id: 'America/Dawson_Creek', label: 'Mountain standard all year' },
]

/**
 * The clock a B.C. site keeps, from its place. A coarse screen of the boundaries, not a survey of them: the Peace and
 * Northern Rockies (Dawson Creek, Fort St. John, Chetwynd, Tumbler Ridge, Fort Nelson) and Creston keep Mountain
 * standard time all year, the East Kootenay (Golden, Invermere, Cranbrook, Fernie) keeps Mountain, and the rest
 * Pacific; Mackenzie, McBride, Kaslo and Nelson stay Pacific. View options can override it.
 */
export function siteTimeZone(place: { lng: number; lat: number }): string {
  const { lng, lat } = place
  if ((lat >= 54.8 && lng >= -122.2) || (lat >= 57 && lng >= -125)) return 'America/Dawson_Creek'
  if (lat < 49.35 && lng >= -116.75 && lng <= -116.3) return 'America/Dawson_Creek' // Creston
  if (lat < 52.5 && (lng >= -116.7 || (lat >= 50.8 && lng >= -117.6))) return 'America/Edmonton'
  return 'America/Vancouver'
}

export type EngineEnvironment = {
  type: 'pgmaps-environment'
  /** ISO 8601 at the site's offset, e.g. `2026-07-15T14:00:00-07:00`; the engine places the sun from it. */
  dateTime: string
  /** The same instant in UTC, e.g. `2026-07-15T21:00:00.000Z`. */
  utc: string
  /** The site's IANA time zone the date and time were read in. */
  timeZone: string
  latitude: number
  longitude: number
  sun: EngineSun
  /**
   * The sun at that instant and place (`sunPosition`, NOAA's equations), worked out once here so that every engine
   * lights the same moment from the same direction: threejs-sky's own ephemeris put it 0.25° lower and 0.7° round.
   */
  sunPosition: { elevationDegrees: number; azimuthDegrees: number }
  ground: EngineEnvironmentChoice['ground']
  weather: EngineWeather
  /**
   * Share of the sky under cloud, 0–1: the choice in clear weather, 1 in overcast, rain or snow. Engines draw this
   * much cloud whatever their own weather presets say, so two renderers can be compared under one sky.
   */
  cloudCover: number
  /**
   * Meteorological visibility, km: engines fade distance with Koschmieder's law (contrast 2% at this range,
   * extinction 3.912 / visibility), so the haze over a far slope is the same in every renderer. `NO_HAZE_KM` (1000)
   * or more: no haze at all.
   */
  visibilityKm: number
  /**
   * Wind over water, m/s. Engines shade water with Fresnel F0 ≈ 0.02 and Cox–Munk roughness
   * (σ² ≈ 0.003 + 0.00512 · wind): 0 a mirror, a few m/s a ripple.
   */
  windMs: number
  /**
   * `via`: the convention of the consultants' renders (dark olive canopy ≈ #2a3a2a, crisp mirror lakes, haze only
   * past 8–10 km, a cloudless gradient sky). `photo`: a photograph's look (haze from `visibilityKm`, blue-grey far
   * forest, wind-rippled water reflecting the sky). Display only.
   */
  look: EngineLook
}

const pad = (value: number) => String(Math.trunc(Math.abs(value))).padStart(2, '0')

/** `YYYY-MM-DD` of a date in this computer's time zone, or in `timeZone` when given. */
export function localDate(date: Date, timeZone?: string): string {
  if (!timeZone) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Minutes a time zone is ahead of UTC at an instant (negative west of Greenwich). */
function zoneOffsetMinutes(timeZone: string, instant: number): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0
}

const knownZone = (timeZone: string | null | undefined): timeZone is string => {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * The environment message for a place. The date and time are the site's wall clock, read in the site's time zone
 * (the choice's, else `siteTimeZone`), never this computer's: the same entry on two computers is the same instant.
 * The message carries that day's offset and the UTC instant. A malformed date or time falls back to today at the
 * site and the default time; in a spring-forward gap the clock reads an hour on.
 */
export function engineEnvironment(
  choice: EngineEnvironmentChoice,
  place: { lng: number; lat: number },
  today: Date,
): EngineEnvironment {
  const timeZone = knownZone(choice.timeZone) ? choice.timeZone : siteTimeZone(place)
  const dateMatch =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(choice.date ?? '') ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate(today, timeZone))!
  const timeMatch =
    /^(\d{1,2}):(\d{2})$/.exec(choice.time) ?? /^(\d{1,2}):(\d{2})$/.exec(DEFAULT_ENGINE_ENVIRONMENT.time)!
  const [year, month, day] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])]
  const [hours, minutes] = [Math.min(23, Number(timeMatch[1])), Math.min(59, Number(timeMatch[2]))]
  // The wall clock as if it were UTC, less the zone's offset; checked again at the result for a change of offset.
  const wall = Date.UTC(year, month - 1, day, hours, minutes)
  let instant = wall - zoneOffsetMinutes(timeZone, wall) * 60_000
  instant = wall - zoneOffsetMinutes(timeZone, instant) * 60_000
  const offset = zoneOffsetMinutes(timeZone, instant)
  const shown = new Date(instant + offset * 60_000)
  const sign = offset < 0 ? '-' : '+'
  const latitude = Math.round(place.lat * 1e5) / 1e5
  const longitude = Math.round(place.lng * 1e5) / 1e5
  const sun = sunPosition(instant, { lng: longitude, lat: latitude })
  return {
    type: 'pgmaps-environment',
    dateTime: `${shown.getUTCFullYear()}-${pad(shown.getUTCMonth() + 1)}-${pad(shown.getUTCDate())}T${pad(shown.getUTCHours())}:${pad(shown.getUTCMinutes())}:00${sign}${pad(offset / 60)}:${pad(offset % 60)}`,
    utc: new Date(instant).toISOString(),
    timeZone,
    latitude,
    longitude,
    sun: choice.sun === 'daylight' ? 'daylight' : 'true',
    sunPosition: {
      elevationDegrees: Math.round(sun.elevationDegrees * 100) / 100,
      azimuthDegrees: Math.round(sun.azimuthDegrees * 100) / 100,
    },
    ground: choice.ground === 'snow' ? 'snow' : 'bare',
    weather: ENGINE_WEATHER.some((entry) => entry.id === choice.weather) ? choice.weather : 'clear',
    cloudCover:
      choice.weather !== 'clear' && ENGINE_WEATHER.some((entry) => entry.id === choice.weather)
        ? 1
        : Number.isFinite(choice.cloudCover)
          ? Math.min(1, Math.max(0, choice.cloudCover))
          : DEFAULT_ENGINE_ENVIRONMENT.cloudCover,
    windMs: Number.isFinite(choice.windMs) ? Math.min(20, Math.max(0, choice.windMs!)) : 0,
    look: choice.look === 'photo' ? 'photo' : 'via',
    visibilityKm:
      Number.isFinite(choice.visibilityKm) && choice.visibilityKm > 0
        ? choice.visibilityKm >= NO_HAZE_KM
          ? NO_HAZE_KM
          : Math.min(200, Math.max(0.5, choice.visibilityKm))
        : DEFAULT_ENGINE_ENVIRONMENT.visibilityKm,
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
  // The sun asked for, and the one the light came from when the engine moved it (its daylight look).
  const sun = stats.sun as { elevation?: unknown; drawnElevation?: unknown } | undefined
  const asked = typeof sun?.elevation === 'number' ? sun.elevation : null
  const drawnAt = typeof sun?.drawnElevation === 'number' ? sun.drawnElevation : null
  if (asked !== null) {
    const degrees = (value: number) => `${value.toFixed(1)}°`
    parts.push(
      drawnAt !== null && Math.abs(drawnAt - asked) >= 0.5
        ? `sun ${degrees(asked)}, lit as ${degrees(drawnAt)}`
        : `sun ${degrees(asked)}`,
    )
  }
  return parts.join(' · ')
}
