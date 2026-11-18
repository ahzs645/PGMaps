import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MAX_RECORDING_MS } from '@/lib/mapRecording/recordingFormat'
import {
  DEFAULT_ROAD_VIDEO_SETTINGS,
  formatVideoDuration,
  parseRoadVideoSettings,
  planRoadVideo,
  ROAD_VIDEO_LIMITS,
  roadVideoContents,
  roadVideoSummary,
  roadVideoUnavailable,
  roadVideoViews,
  stopCaption,
  VIEW_NOT_FILMED,
  type RoadVideoScene,
  type RoadVideoSettings,
  type RoadVideoView,
} from './roadVideo'
import type { ViewOfInterest } from './viewsOfInterest'

// A made-up block, a little north-east of a made-up road.
const block = {
  id: 'b1',
  name: 'Block A',
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.7, 54.01],
        [-122.69, 54.01],
        [-122.69, 54.02],
        [-122.7, 54.02],
        [-122.7, 54.01],
      ],
    ],
  },
}

const voi = (id: string, patch: Partial<ViewOfInterest> = {}): ViewOfInterest => ({
  id,
  name: `View ${id}`,
  source: { kind: 'map' },
  lng: -122.72,
  lat: 54.0,
  blockId: 'b1',
  facing: { kind: 'block' },
  focalMm: 50,
  framing: 'landform',
  ...patch,
})

const filmable = (id: string, patch: Partial<RoadVideoView> = {}): RoadVideoView => ({
  id,
  name: `View ${id}`,
  block: 'Block A',
  lens: '50 mm · 39.6° across',
  lng: -122.72,
  lat: 54.0,
  bearing: 45,
  pitch: 0,
  roll: 0,
  hfov: 39.6,
  reason: null,
  ...patch,
})

const scene = (patch: Partial<RoadVideoScene> = {}): RoadVideoScene => ({
  road: { name: 'Made-up FSR', lengthMeters: 3000 },
  facingNow: null,
  views: [filmable('a'), filmable('b'), filmable('c')],
  harvestPhase: 'after',
  renderer: { id: 'pgmaps', label: 'PGMaps' },
  roadView: null,
  frame: { width: 1920, height: 1080 },
  format: 'mp4',
  look: [{ label: 'Drawn timber', value: 'On' }],
  ...patch,
})

const settings = (patch: Partial<RoadVideoSettings> = {}): RoadVideoSettings => ({
  ...DEFAULT_ROAD_VIDEO_SETTINGS,
  ...patch,
})

describe('road view video plan', () => {
  it('reads its choices back from storage, defaulting anything missing or out of range', () => {
    expect(parseRoadVideoSettings(null)).toEqual(DEFAULT_ROAD_VIDEO_SETTINGS)
    expect(parseRoadVideoSettings('nonsense')).toEqual(DEFAULT_ROAD_VIDEO_SETTINGS)
    const read = parseRoadVideoSettings({
      mode: 'views',
      speedKmh: 33,
      fromMeters: -5,
      toMeters: 1200,
      facing: 'view',
      holdSeconds: 900,
      viewIds: ['a', 7, 'c'],
      caption: false,
    })
    expect(read).toEqual({
      mode: 'views',
      // Not one of the road view's speeds.
      speedKmh: ROAD_VIDEO_LIMITS.defaultSpeedKmh,
      fromMeters: null,
      toMeters: 1200,
      facing: 'view',
      holdSeconds: ROAD_VIDEO_LIMITS.maxHoldSeconds,
      viewIds: ['a', 'c'],
      caption: false,
    })
  })

  it('stands at each view facing its block, and says why a view cannot be filmed', () => {
    const views = roadVideoViews(
      [
        voi('a'),
        voi('far', { lng: -121, lat: 55 }),
        voi('gone', { blockId: 'missing' }),
        voi('air', { photo: { recordId: 'r', altitudeMeters: 1500, pitch: -20, roll: 2, hfov: 60 } }),
        voi('ground-photo', { photo: { recordId: 'r2', altitudeMeters: null, pitch: 3, roll: -1, hfov: 55 } }),
        voi('bearing', { facing: { kind: 'bearing', degrees: 370 } }),
      ],
      [block],
      // The road view's loaded ground ends west of -121.5.
      (lng) => (lng > -121.5 ? Number.NaN : 900),
    )
    expect(views.map((view) => view.reason)).toEqual([
      null,
      VIEW_NOT_FILMED.ground,
      VIEW_NOT_FILMED.block,
      VIEW_NOT_FILMED.air,
      null,
      null,
    ])
    // Facing the block: north-east of the view.
    expect(views[0].bearing).toBeGreaterThan(10)
    expect(views[0].bearing).toBeLessThan(80)
    expect(views[0].hfov).toBeCloseTo(39.6, 1)
    // A ground photo keeps its own pitch, roll and field.
    expect(views[4]).toMatchObject({ pitch: 3, roll: -1, hfov: 55 })
    expect(views[5].bearing).toBe(10)
  })

  it('drives a stretch of the road at the chosen speed, in real time', () => {
    const plan = planRoadVideo(scene(), settings({ speedKmh: 60, fromMeters: 500, toMeters: 2500 }))
    expect(plan.mode).toBe('road')
    expect(plan.problem).toBeNull()
    expect(plan.route).toMatchObject({ fromMeters: 500, toMeters: 2500, speedKmh: 60, facing: 'road' })
    // 2 km at 60 km/h: two minutes.
    expect(plan.durationMs).toBeCloseTo(120_000, 6)
    expect(plan.stops).toEqual([])
    expect(plan.fileName).toBe('forestry-road-video-made-up-fsr-along-the-road.mp4')
    expect(plan.caption?.title).toBe('Made-up FSR, 0.50 to 2.50 km at 60 km/h')
    expect(roadVideoSummary(plan)).toMatch(/2 min, recorded in real time/)
    // The whole road when no stretch is set, and the browser's own extension.
    const whole = planRoadVideo(scene({ format: 'webm' }), settings())
    expect(whole.route).toMatchObject({ fromMeters: 0, toMeters: 3000 })
    expect(whole.fileName.endsWith('.webm')).toBe(true)
  })

  it('faces what the road view faces only when asked and when it faces something', () => {
    expect(planRoadVideo(scene(), settings({ facing: 'view' })).route?.facing).toBe('road')
    const facing = planRoadVideo(scene({ facingNow: 'Block A' }), settings({ facing: 'view' })).route
    expect(facing?.facing).toBe('view')
    expect(facing?.facingLabel).toBe('Toward Block A, as the road view faces now')
  })

  it('refuses a drive past the recording limit or a stretch too short, saying how to fix it', () => {
    const long = planRoadVideo(scene({ road: { name: 'Long road', lengthMeters: 40_000 } }), settings({ speedKmh: 20 }))
    expect(long.durationMs).toBeGreaterThan(MAX_RECORDING_MS)
    expect(long.problem).toMatch(/past the 10 min a recording may last: drive faster, or film a shorter stretch/)
    expect(planRoadVideo(scene(), settings({ fromMeters: 1000, toMeters: 1010 })).problem).toMatch(/shorter than 25 m/)
    expect(planRoadVideo(scene(), settings({ fromMeters: 2000, toMeters: 1000 })).problem).toMatch(
      /ends before it starts/,
    )
  })

  it('films the views in the list order, held each for the chosen time, with cuts between them', () => {
    const plan = planRoadVideo(
      scene({ views: [filmable('a'), filmable('b', { reason: VIEW_NOT_FILMED.ground }), filmable('c')] }),
      settings({ mode: 'views', holdSeconds: 4 }),
    )
    expect(plan.mode).toBe('views')
    expect(plan.stops.map((stop) => stop.id)).toEqual(['a', 'c'])
    // Cuts: the length is the holds alone.
    expect(plan.durationMs).toBe(8000)
    expect(plan.leftOut).toEqual([{ name: 'View b', reason: VIEW_NOT_FILMED.ground }])
    expect(plan.fileName).toBe('forestry-road-video-made-up-fsr-views.mp4')
    // Each view's caption is its own.
    expect(stopCaption(plan, 1)?.title).toBe('View c (2 of 2)')
    expect(stopCaption({ ...plan, caption: null }, 1)).toBeNull()
    // A chosen subset keeps the list's order, and names what was not chosen.
    const subset = planRoadVideo(scene(), settings({ mode: 'views', viewIds: ['c', 'a'] }))
    expect(subset.stops.map((stop) => stop.id)).toEqual(['a', 'c'])
    expect(subset.leftOut).toEqual([{ name: 'View b', reason: 'not chosen in the options' }])
    expect(planRoadVideo(scene(), settings({ mode: 'views', viewIds: [] })).problem).toMatch(/at least one view/)
    const many = planRoadVideo(
      scene({ views: Array.from({ length: 12 }, (_, i) => filmable(String(i))) }),
      settings({ mode: 'views', holdSeconds: 60 }),
    )
    expect(many.problem).toMatch(/hold each view for less time, or film fewer views/)
  })

  it('offers only what the scene supports', () => {
    // A spot: no road to drive, so a road take gives way to the views.
    const spot = planRoadVideo(scene({ road: null, roadAbsent: 'No road here.' }), settings())
    expect(spot.mode).toBe('views')
    expect(spot.modes.road).toBe('No road here.')
    // No views planned: the road only.
    const noViews = planRoadVideo(scene({ views: [] }), settings({ mode: 'views' }))
    expect(noViews.mode).toBe('road')
    expect(noViews.modes.views).toMatch(/Plan a view of interest/)
    // Neither: the chosen kind's reason makes it unavailable.
    const nothing = planRoadVideo(scene({ road: null, views: [] }), settings())
    expect(roadVideoUnavailable(scene(), nothing, null)).toMatch(/one spot/)
  })

  it('is unavailable without a recorder or the road view, and ready once a take for its plan is kept', () => {
    const plan = planRoadVideo(scene(), settings())
    expect(roadVideoUnavailable(scene({ format: null }), plan, null)).toMatch(/cannot record video/)
    expect(roadVideoUnavailable(scene({ roadView: 'Open the road view first.' }), plan, null)).toBe(
      'Open the road view first.',
    )
    expect(roadVideoUnavailable(scene(), plan, null)).toBeNull()
    const take = { durationMs: 1000, width: 2, height: 2, extension: 'mp4' as const, endedEarly: null, notes: [] }
    expect(roadVideoUnavailable(scene({ roadView: 'Closed.' }), plan, take)).toBeNull()
  })

  it('keys a take to what it shows: the choices, the harvest phase and the look', () => {
    const base = planRoadVideo(scene(), settings())
    expect(planRoadVideo(scene(), settings()).key).toBe(base.key)
    expect(planRoadVideo(scene({ harvestPhase: 'before' }), settings()).key).not.toBe(base.key)
    expect(planRoadVideo(scene({ look: [] }), settings()).key).not.toBe(base.key)
    expect(planRoadVideo(scene(), settings({ caption: false })).key).not.toBe(base.key)
    // The frame's size is the take's own, not part of what it shows.
    expect(planRoadVideo(scene({ frame: { width: 800, height: 600 } }), settings()).key).toBe(base.key)
  })

  it('says it is a drawing, names who drew it, and prints no figure', () => {
    const engine = scene({ renderer: { id: 'nanite', label: 'Nanite Forest' } })
    const plan = planRoadVideo(engine, settings())
    expect(plan.caption?.source).toBe(
      'After harvest · Drawn by PGMaps, not Nanite Forest: a drawing of the scene, not a photo simulation',
    )
    const sections = roadVideoContents(engine, plan, null)
    const row = (title: string, label: string) =>
      sections.find((section) => section.title === title)?.rows?.find((entry) => entry.label === label)?.value
    expect(row('Video', 'Drawn by')).toMatch(/Nanite Forest’s frame is not recorded/)
    expect(row('Video', 'Format')).toMatch(/^MP4/)
    expect(row('Video', 'Frame')).toMatch(/^1920 × 1080 px/)
    expect(row('Route', 'Stretch')).toBe('0.00 to 3.00 km')
    expect(sections.find((section) => section.title === 'Not in the file')?.note).toMatch(
      /No figure, percentage or rating/,
    )
    const taken = roadVideoContents(engine, plan, {
      durationMs: 42_000,
      width: 1920,
      height: 1080,
      extension: 'webm',
      endedEarly: 'stopped at 42 s, before the end',
      notes: [],
    })
    expect(taken[0].rows?.find((entry) => entry.label === 'Recorded')?.value).toBe(
      '42 s · 1920 × 1080 px · WEBM · stopped at 42 s, before the end',
    )
    // The tour lists its views in order, and those left out with why.
    const tour = planRoadVideo(
      scene({ views: [filmable('a'), filmable('b', { reason: VIEW_NOT_FILMED.block })] }),
      settings({ mode: 'views' }),
    )
    const items = roadVideoContents(scene(), tour, null).find((section) => section.title === 'Views, in order')?.items
    expect(items?.map((item) => item.title)).toEqual(['1. View a', 'View b'])
    expect(items?.[1].subtitle).toBe(`Left out: ${VIEW_NOT_FILMED.block}`)
  })

  it('stays free of DOM and network access', () => {
    const source = readFileSync(fileURLToPath(new URL('./roadVideo.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/\b(window|document|fetch|localStorage|navigator|MediaRecorder)\b/)
  })

  it('words a length as a person reads it', () => {
    expect(formatVideoDuration(400)).toBe('0 s')
    expect(formatVideoDuration(45_000)).toBe('45 s')
    expect(formatVideoDuration(125_000)).toBe('2 min 05 s')
    expect(formatVideoDuration(600_000)).toBe('10 min')
  })
})
