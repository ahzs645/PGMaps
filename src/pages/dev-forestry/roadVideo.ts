/**
 * The road view video (Save & export → *Road view video*): what a take records, how long it runs, why it cannot be
 * recorded as set, the caption burned into it, its file name and its *What goes in*. Built from the scene as the page
 * reads it (`RoadVideoScene`) and the person's choices (`RoadVideoSettings`, kept in this browser, never in the scene or
 * the project file). DOM-free and network-free; `useRoadVideo.ts` records the take.
 *
 * Two takes:
 * - **Along the road**: the road view's own drive (`DriveController`), from one end of a stretch of the assessed road
 *   to the other at a chosen speed, so the video is the drive the reviewer sees. Its length is the stretch over the
 *   speed, as `driveTimeline` measures it.
 * - **Through the views of interest**: each chosen view in the list's order, stood at by the drive camera (the eye at
 *   the view's place, facing its bearing through its lens) and held for a chosen time, with a cut between views: the
 *   eye never flies across the terrain between them. Only views on the ground the road view has loaded can be stood
 *   at; standing elsewhere would run the assessment there, which a video never does.
 *
 * A video is display only: it never starts or stales a run, changes the scene, a saved view or the road view's own
 * settings, and prints no figure. It is a drawing of the scene with timber calibrated to the inventory, not a photo
 * simulation anyone has signed, and it records PGMaps' own road view, never another engine's frame.
 */
import { MAX_RECORDING_MS } from '@/lib/mapRecording/recordingFormat'
import type { RecordingCaption } from '@/lib/mapRecording/recordingCaption'
import { tourDurationMs, type TourStop } from '@/lib/mapRecording/tourTimeline'
import { DRIVE_SPEEDS_KMH } from './driveMath'
import type { ViaStepId } from './via'
import { blockCentre, lensHfovDeg, lensLabel, viewBearing, type ViewOfInterest } from './viewsOfInterest'
import type { PolygonGeometry } from './visibility'

export type RoadVideoMode = 'road' | 'views'

/** The person's choices for the video, kept in this browser (`ROAD_VIDEO_STORAGE_KEY`). */
export type RoadVideoSettings = {
  mode: RoadVideoMode
  /** Along the road: one of the road view's speeds (`DRIVE_SPEEDS_KMH`). */
  speedKmh: number
  /** The stretch of road, metres along it; null runs from its start, or to its end. */
  fromMeters: number | null
  toMeters: number | null
  /** Along the road, or toward what the road view faces now (a block, or an inventory arrow's bearing). */
  facing: 'road' | 'view'
  /** How long each view of interest is held, seconds. */
  holdSeconds: number
  /** The views filmed, by id; null films every view the road view can stand at, in the list's order. */
  viewIds: string[] | null
  /** Burn the caption (what is shown, who drew it) into every frame. */
  caption: boolean
}

export const ROAD_VIDEO_LIMITS = {
  defaultSpeedKmh: 40,
  minHoldSeconds: 1,
  maxHoldSeconds: 60,
  defaultHoldSeconds: 5,
  /** Shortest stretch of road a video drives, metres. */
  minStretchMeters: 25,
  /** Longest video, ms: the recorder's own limit (`MAX_RECORDING_MS`). */
  maxDurationMs: MAX_RECORDING_MS,
} as const

export const DEFAULT_ROAD_VIDEO_SETTINGS: RoadVideoSettings = {
  mode: 'road',
  speedKmh: ROAD_VIDEO_LIMITS.defaultSpeedKmh,
  fromMeters: null,
  toMeters: null,
  facing: 'road',
  holdSeconds: ROAD_VIDEO_LIMITS.defaultHoldSeconds,
  viewIds: null,
  caption: true,
}

/** Where this browser keeps the choices. */
export const ROAD_VIDEO_STORAGE_KEY = 'pgmaps.forestryVisuals.roadVideo'

/** The output's one format: the extension is the browser's (MP4 where it can write it, else WebM). */
export const ROAD_VIDEO_FORMAT = { id: 'video', label: 'Video', extension: '.mp4' } as const

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Choices read back from storage: anything missing or out of range takes its default. Never throws. */
export function parseRoadVideoSettings(raw: unknown): RoadVideoSettings {
  const d = DEFAULT_ROAD_VIDEO_SETTINGS
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d }
  const r = raw as Record<string, unknown>
  const metres = (value: unknown) => (finite(value) && value >= 0 ? value : null)
  return {
    mode: r.mode === 'views' ? 'views' : 'road',
    speedKmh: finite(r.speedKmh) && DRIVE_SPEEDS_KMH.includes(r.speedKmh) ? r.speedKmh : d.speedKmh,
    fromMeters: metres(r.fromMeters),
    toMeters: metres(r.toMeters),
    facing: r.facing === 'view' ? 'view' : 'road',
    holdSeconds: finite(r.holdSeconds)
      ? clamp(Math.round(r.holdSeconds), ROAD_VIDEO_LIMITS.minHoldSeconds, ROAD_VIDEO_LIMITS.maxHoldSeconds)
      : d.holdSeconds,
    viewIds: Array.isArray(r.viewIds) ? r.viewIds.filter((id): id is string => typeof id === 'string') : null,
    caption: r.caption !== false,
  }
}

/** A view of interest as the video can stand at it: its place, facing and lens, or why it cannot be filmed. */
export type RoadVideoView = {
  id: string
  name: string
  block: string
  /** `lensLabel`: "50 mm · 39.6° across". */
  lens: string
  lng: number
  lat: number
  /** Compass bearing it faces, degrees. */
  bearing: number
  /** Degrees above the horizon (a ground photo's own; 0 for a map view). */
  pitch: number
  /** Degrees; a ground photo's own, positive raising its right side. */
  roll: number
  /** The lens's field across, degrees. */
  hfov: number
  /** Why the road view cannot stand at it here, or null when it can. */
  reason: string | null
}

/** Why a view cannot be stood at in the road view here, worded to follow its name. */
export const VIEW_NOT_FILMED = {
  block: 'its block is no longer in the scene',
  air: 'its photo was taken from the air: the road view stands at eye level, and only standing there places that camera',
  ground: 'it is outside the ground the road view has loaded here: stand there in step 2 to see it in the road view',
} as const

/**
 * The views of interest as the video stands at them, in the list's order: each one's place, the bearing it faces
 * (its block's centre or its own bearing, `viewBearing`), its lens, and why the road view cannot stand there when it
 * cannot. `groundAt` is the road view's own loaded ground (the drive camera's elevation source): a view off it would
 * leave the camera waiting for terrain.
 */
export function roadVideoViews(
  views: readonly ViewOfInterest[],
  blocks: ReadonlyArray<{ id: string; name: string; geometry: PolygonGeometry }>,
  groundAt: (lng: number, lat: number) => number | null,
): RoadVideoView[] {
  return views.map((view) => {
    const block = blocks.find((entry) => entry.id === view.blockId) ?? null
    const bearing = viewBearing(view, block ? blockCentre(block.geometry) : null)
    const ground = groundAt(view.lng, view.lat)
    const reason =
      !block || bearing === null
        ? VIEW_NOT_FILMED.block
        : view.photo && view.photo.altitudeMeters !== null
          ? VIEW_NOT_FILMED.air
          : ground === null || !Number.isFinite(ground)
            ? VIEW_NOT_FILMED.ground
            : null
    return {
      id: view.id,
      name: view.name,
      block: block?.name ?? 'A block no longer in the scene',
      lens: view.photo ? `${view.photo.hfov.toFixed(1)}° across, the photo's` : lensLabel(view.focalMm),
      lng: view.lng,
      lat: view.lat,
      bearing: bearing ?? 0,
      pitch: view.photo?.pitch ?? 0,
      roll: view.photo?.roll ?? 0,
      hfov: view.photo?.hfov ?? lensHfovDeg(view.focalMm),
      reason,
    }
  })
}

export type Row = { label: string; value: string }

/** The scene as the video reads it, from the page. */
export type RoadVideoScene = {
  /** The assessed road the road view drives, or null when there is none to drive. */
  road: { name: string; lengthMeters: number } | null
  /** Why there is no road to drive ("The road view stands at a spot…"), when `road` is null. */
  roadAbsent?: string | null
  /** What the road view faces now, named ("Block 12", "245°"), or null when it looks along the road. */
  facingNow: string | null
  views: readonly RoadVideoView[]
  harvestPhase: 'before' | 'after'
  /** Who draws the road view on screen; the video always records PGMaps' own drawing. */
  renderer: { id: string; label: string }
  /** Why the road view cannot be recorded now (closed, terrain loading), or null when it can. */
  roadView: string | null
  /** The road view's canvas in device pixels, as the recorder will frame it; null while it is closed. */
  frame: { width: number; height: number } | null
  /** What this browser writes; null when it cannot record video at all. */
  format: 'mp4' | 'webm' | null
  /** How the road view is drawn now (timber, imagery, analysis colours…), as the video shows it. */
  look: Row[]
}

/** A stop of the tour through the views: the view, its look, and how long it is held. */
export type RoadVideoStop = {
  id: string
  name: string
  block: string
  lens: string
  holdMs: number
  look: { lng: number; lat: number; bearing: number; pitch: number; roll: number; hfov: number }
}

export type RoadVideoPlan = {
  mode: RoadVideoMode
  /** Why each kind of take cannot be recorded here, or null when it can. */
  modes: Record<RoadVideoMode, string | null>
  /** Along the road: the stretch, the speed and the facing. Null for the tour. */
  route: {
    road: string
    lengthMeters: number
    fromMeters: number
    toMeters: number
    speedKmh: number
    speedMetersPerSecond: number
    facing: 'road' | 'view'
    /** "Along the road", or "Toward Block 12, as the road view faces now". */
    facingLabel: string
  } | null
  /** Through the views: the views filmed, in order. Empty along the road. */
  stops: RoadVideoStop[]
  /** Views of interest not filmed, each with why. */
  leftOut: Array<{ name: string; reason: string }>
  /** The planned length, ms: the stretch at the speed, or the holds (the tour also holds while each view draws). */
  durationMs: number
  /** Why the take cannot be recorded as set (nothing to film, past the time limit), or null. */
  problem: string | null
  /** The caption at the start of the take, or null when it is off. Each view of the tour takes its own (`stopCaption`). */
  caption: RecordingCaption | null
  /** The file's name, extension included (the browser's format). */
  fileName: string
  /** What the take records, as one string: a recording made under another key is not this plan's file. */
  key: string
}

/** "45 s", "2 min 05 s", "10 min". */
export function formatVideoDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} min ${String(rest).padStart(2, '0')} s` : `${minutes} min`
}

const km = (metres: number) => (metres / 1000).toFixed(2)

/** The caption's second line: the phase, who drew it, and that it is a drawing. */
function sourceLine(scene: RoadVideoScene): string {
  const phase = scene.harvestPhase === 'after' ? 'After harvest' : 'Before harvest'
  const engine = scene.renderer.id !== 'pgmaps' ? `, not ${scene.renderer.label}` : ''
  return `${phase} · Drawn by PGMaps${engine}: a drawing of the scene, not a photo simulation`
}

/** The caption for stop `index` of the tour (the view's name), or the take's own along the road. */
export function stopCaption(plan: RoadVideoPlan, index: number): RecordingCaption | null {
  if (!plan.caption) return null
  const stop = plan.stops[index]
  return stop ? { ...plan.caption, title: `${stop.name} (${index + 1} of ${plan.stops.length})` } : plan.caption
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'scene'

const TOO_LONG = (ms: number, fix: string) =>
  `The video would run ${formatVideoDuration(ms)}, past the ${formatVideoDuration(ROAD_VIDEO_LIMITS.maxDurationMs)} a recording may last: ${fix}.`

/** What a take records, from the scene and the choices. Pure. */
export function planRoadVideo(scene: RoadVideoScene, settings: RoadVideoSettings): RoadVideoPlan {
  const filmable = scene.views.filter((view) => view.reason === null)
  const modes: Record<RoadVideoMode, string | null> = {
    road: scene.road
      ? null
      : (scene.roadAbsent ?? 'The road view stands at one spot: there is no road to drive. Film the views instead.'),
    views: !scene.views.length
      ? 'Plan a view of interest in step 2 first.'
      : !filmable.length
        ? `None of the views of interest can be stood at in the road view here: ${scene.views[0].name}: ${scene.views[0].reason}.`
        : null,
  }
  // A kind that cannot be recorded here gives way to the other one when that one can.
  const mode: RoadVideoMode =
    modes[settings.mode] && !modes[settings.mode === 'road' ? 'views' : 'road']
      ? settings.mode === 'road'
        ? 'views'
        : 'road'
      : settings.mode
  const extension = scene.format ?? 'mp4'
  const base = slug(scene.road?.name || (scene.views[0]?.block ?? 'scene'))
  let problem: string | null = modes[mode]
  let route: RoadVideoPlan['route'] = null
  const stops: RoadVideoStop[] = []
  const leftOut: RoadVideoPlan['leftOut'] = []
  let durationMs = 0
  let title = ''
  if (mode === 'road' && scene.road) {
    const length = scene.road.lengthMeters
    const from = clamp(settings.fromMeters ?? 0, 0, length)
    const to = clamp(settings.toMeters ?? length, 0, length)
    const speedKmh = DRIVE_SPEEDS_KMH.includes(settings.speedKmh)
      ? settings.speedKmh
      : ROAD_VIDEO_LIMITS.defaultSpeedKmh
    const speed = speedKmh / 3.6
    const facing = settings.facing === 'view' && scene.facingNow ? 'view' : 'road'
    route = {
      road: scene.road.name || 'The road',
      lengthMeters: length,
      fromMeters: from,
      toMeters: to,
      speedKmh,
      speedMetersPerSecond: speed,
      facing,
      facingLabel: facing === 'view' ? `Toward ${scene.facingNow}, as the road view faces now` : 'Along the road',
    }
    durationMs = to > from ? ((to - from) / speed) * 1000 : 0
    title = `${route.road}, ${km(from)} to ${km(to)} km at ${speedKmh} km/h`
    if (!problem && to - from < ROAD_VIDEO_LIMITS.minStretchMeters)
      problem =
        to < from
          ? 'The stretch ends before it starts: set its start before its end.'
          : `The stretch is shorter than ${ROAD_VIDEO_LIMITS.minStretchMeters} m: widen it.`
    if (!problem && durationMs > ROAD_VIDEO_LIMITS.maxDurationMs)
      problem = TOO_LONG(durationMs, 'drive faster, or film a shorter stretch')
  } else if (mode === 'views') {
    const chosen = settings.viewIds ? new Set(settings.viewIds) : null
    const holdMs =
      clamp(Math.round(settings.holdSeconds), ROAD_VIDEO_LIMITS.minHoldSeconds, ROAD_VIDEO_LIMITS.maxHoldSeconds) * 1000
    for (const view of scene.views) {
      if (view.reason) leftOut.push({ name: view.name, reason: view.reason })
      else if (chosen && !chosen.has(view.id)) leftOut.push({ name: view.name, reason: 'not chosen in the options' })
      else
        stops.push({
          id: view.id,
          name: view.name,
          block: view.block,
          lens: view.lens,
          holdMs,
          look: {
            lng: view.lng,
            lat: view.lat,
            bearing: view.bearing,
            pitch: view.pitch,
            roll: view.roll,
            hfov: view.hfov,
          },
        })
    }
    // Cuts between views (`transitionMs` 0): the tour's length is its holds.
    const tour: TourStop[] = stops.map((stop) => ({
      pose: { lng: stop.look.lng, lat: stop.look.lat, bearing: stop.look.bearing, pitch: 90 + stop.look.pitch },
      holdMs: stop.holdMs,
      transitionMs: 0,
      label: stop.name,
    }))
    durationMs = tourDurationMs({ stops: tour })
    title = stops[0]?.name ?? ''
    if (!problem && !stops.length) problem = 'Choose at least one view of interest to film.'
    if (!problem && durationMs > ROAD_VIDEO_LIMITS.maxDurationMs)
      problem = TOO_LONG(durationMs, 'hold each view for less time, or film fewer views')
  }
  const caption = settings.caption ? { title, source: sourceLine(scene), position: 'bottom-left' as const } : null
  const key = JSON.stringify({
    mode,
    route: route && [route.fromMeters, route.toMeters, route.speedKmh, route.facing, scene.facingNow],
    stops: stops.map((stop) => [stop.id, stop.look, stop.holdMs]),
    caption: caption && [caption.title, caption.source],
    phase: scene.harvestPhase,
    look: scene.look,
  })
  return {
    mode,
    modes,
    route,
    stops,
    leftOut,
    durationMs,
    problem,
    caption,
    fileName: `forestry-road-video-${base}-${mode === 'road' ? 'along-the-road' : 'views'}.${extension}`,
    key,
  }
}

/** The plan in one line, for the take's pane. */
export function roadVideoSummary(plan: RoadVideoPlan): string {
  if (plan.route)
    return `Along ${plan.route.road}, ${km(plan.route.fromMeters)} to ${km(plan.route.toMeters)} km at ${plan.route.speedKmh} km/h: ${formatVideoDuration(plan.durationMs)}, recorded in real time.`
  const n = plan.stops.length
  return `${n} view${n === 1 ? '' : 's'} of interest, ${formatVideoDuration(plan.stops[0]?.holdMs ?? 0)} each: about ${formatVideoDuration(plan.durationMs)}, recorded in real time and a little longer while each view draws.`
}

/** A take as *What goes in* lists it once recorded. */
export type RoadVideoTakeFacts = {
  durationMs: number
  width: number
  height: number
  extension: 'mp4' | 'webm'
  /** Why it ended before the plan's end (Stop, the time limit, a view that would not draw), or null. */
  endedEarly: string | null
  /** Views left out during the take (they did not draw in time). */
  notes: readonly string[]
}

/** Why the video cannot be recorded here, or null when it can (or a take for this plan is ready to write). */
export function roadVideoUnavailable(
  scene: Pick<RoadVideoScene, 'format' | 'roadView'>,
  plan: RoadVideoPlan,
  take: RoadVideoTakeFacts | null,
): string | null {
  if (take) return null
  if (!scene.format)
    return 'This browser cannot record video of the map. Try a current Chrome, Edge, Firefox or Safari.'
  if (scene.roadView) return scene.roadView
  return plan.modes.road && plan.modes.views ? plan.modes[plan.mode] : null
}

/** What goes in: a section of the dialog's list (as `visualsExports.ts`'s `ExportSection`). */
export type RoadVideoSection = {
  title: string
  step?: ViaStepId
  rows?: Row[]
  items?: Array<{ title: string; subtitle?: string }>
  empty?: string
  note?: string
}

const FORMAT_WORDS = {
  mp4: 'MP4 (H.264), which plays almost everywhere',
  webm: 'WebM: this browser cannot write MP4 (Firefox writes WebM; Chrome, Edge and Safari write MP4)',
} as const

/** What goes into the video, part by part, from the same plan the take records. */
export function roadVideoContents(
  scene: RoadVideoScene,
  plan: RoadVideoPlan,
  take: RoadVideoTakeFacts | null,
): RoadVideoSection[] {
  const engine = scene.renderer.id !== 'pgmaps'
  const sections: RoadVideoSection[] = [
    {
      title: 'Video',
      rows: [
        {
          label: 'Records',
          value: plan.mode === 'road' ? 'The drive along the road' : 'The views of interest, in turn',
        },
        {
          label: 'Length',
          value:
            plan.mode === 'road'
              ? `${formatVideoDuration(plan.durationMs)}, recorded in real time`
              : `About ${formatVideoDuration(plan.durationMs)}, recorded in real time; the picture holds while each view draws`,
        },
        {
          label: 'Frame',
          value: scene.frame
            ? `${scene.frame.width} × ${scene.frame.height} px, the road view’s canvas as it is now`
            : 'The road view’s canvas, once it is open',
        },
        { label: 'Format', value: scene.format ? FORMAT_WORDS[scene.format] : 'None: this browser cannot record' },
        {
          label: 'Drawn by',
          value: engine
            ? `PGMaps’ own road view, drawn under ${scene.renderer.label}: ${scene.renderer.label}’s frame is not recorded`
            : 'PGMaps’ road view',
        },
        {
          label: 'Caption',
          value: plan.caption
            ? `On every frame: ${plan.mode === 'views' ? 'each view’s name' : plan.caption.title}; ${plan.caption.source}`
            : 'Off',
        },
        ...(take
          ? [
              {
                label: 'Recorded',
                value: `${formatVideoDuration(take.durationMs)} · ${take.width} × ${take.height} px · ${take.extension.toUpperCase()}${take.endedEarly ? ` · ${take.endedEarly}` : ''}`,
              },
            ]
          : []),
      ],
      note: plan.problem ?? undefined,
    },
  ]
  if (plan.route)
    sections.push({
      title: 'Route',
      step: 'visit',
      rows: [
        { label: 'Road', value: `${plan.route.road}, ${km(plan.route.lengthMeters)} km` },
        { label: 'Stretch', value: `${km(plan.route.fromMeters)} to ${km(plan.route.toMeters)} km` },
        { label: 'Speed', value: `${plan.route.speedKmh} km/h` },
        { label: 'Facing', value: plan.route.facingLabel },
      ],
      note: 'The road view’s own drive, from the start of the stretch to its end. The road view’s speed and place are put back afterwards.',
    })
  else
    sections.push({
      title: 'Views, in order',
      step: 'visit',
      items: [
        ...plan.stops.map((stop, index) => ({
          title: `${index + 1}. ${stop.name}`,
          subtitle: `${stop.block} · ${stop.lens} · held ${formatVideoDuration(stop.holdMs)}`,
        })),
        ...plan.leftOut.map((view) => ({ title: view.name, subtitle: `Left out: ${view.reason}` })),
        ...(take?.notes ?? []).map((note) => ({ title: 'During the recording', subtitle: note })),
      ],
      empty: 'No views of interest planned.',
      note: 'Each view is stood at by the road view’s camera, facing its bearing through its lens, with a cut to the next: the eye never flies across the terrain between them. A view’s panorama frames are not joined. The assessment is not run there.',
    })
  sections.push(
    {
      title: 'As the road view draws it',
      rows: [
        { label: 'Harvest phase', value: scene.harvestPhase === 'after' ? 'After harvest' : 'Before harvest' },
        ...scene.look,
      ],
      note: 'Set in the road view’s bar: the harvest phase, View options and Drawn timber. The timber is drawn to the inventory’s crown closure; it is a drawing, not a photo simulation.',
    },
    {
      title: 'Not in the file',
      note: `No figure, percentage or rating: the video is a drawing of the scene, not a photo simulation anyone has signed off. Not the road view’s guides (the inventory arrows), its controls or the plan map${engine ? `, and not ${scene.renderer.label}’s frame` : ''}. Recording it changes nothing: no run starts or goes out of date, and the scene, the saved views and the road view’s settings stay as they are.`,
    },
  )
  return sections
}
