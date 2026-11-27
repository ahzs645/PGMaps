import { describe, expect, it } from 'vitest'

import type { MatchedCamera } from './matchedCamera'
import {
  PHOTO_FAILURE_TEXT,
  PHOTO_STATUS_TEXT,
  narrowAgreement,
  photoFailureText,
  photoOptions,
  photoReasons,
  photoStripState,
  sunNote,
  type PhotoOptionsInput,
} from './photoOptions'
import type { SkylineFit } from './skylineFit'
import type { SunCheck, WideSearchResult } from './wideOrientation'

// A made-up aircraft camera.
const base: PhotoOptionsInput['base'] = { lng: -123.1, lat: 54.2, altitudeMeters: 1250, hfov: 51.9 }

const fit = (trustworthy: boolean): SkylineFit => ({
  nudge: { bearing: 0.2, pitch: -0.1 },
  agreement: 0.91,
  agreeing: 160,
  span: 0.74,
  medianErrorPx: 1.2,
  columns: 176,
  trustworthy,
})

const search = (over: Partial<WideSearchResult> = {}): WideSearchResult => ({
  bearing: 139.2,
  pitch: -5.9,
  roll: 0.3,
  fit: fit(true),
  columns: 200,
  meanLoss: 0.05,
  runnerUp: { bearing: 312, pitch: -4, roll: 1, meanLoss: 0.4 },
  ambiguous: false,
  trustworthy: true,
  ...over,
})

const sun = (over: Partial<SunCheck>): SunCheck => ({
  azimuth: 150,
  elevation: 20,
  pixel: null,
  relativeBearing: 0,
  inFrame: false,
  ...over,
})

describe('photoOptions', () => {
  it('offers the phone’s heading from high ground at the GPS altitude, on the ground and with its own lens', () => {
    const rows = photoOptions({
      base,
      search: { result: search({ ambiguous: true, trustworthy: false }) },
      phone: { bearing: 127.5, reference: 'true', pitch: -8.2, airborne: true },
      highGround: { lng: -123.105, lat: 54.21, distanceMeters: 1123, bearing: 343, aboveFixMeters: 114 },
    })
    const high = rows.find((row) => row.kind === 'high-ground')!
    expect(high).toMatchObject({
      id: 'high-ground',
      label: 'High ground 1.1 km NNW, phone’s heading',
      pose: { lng: -123.105, lat: 54.21, altitudeMeters: null, bearing: 127.5, pitch: -8.2, roll: 0, hfov: 51.9 },
      warnings: [
        'the fix is 114 m below the GPS altitude: this place is a guess from that height',
        'the phone’s heading: often a few degrees out',
      ],
    })
    // Beside the unsettled winner, above the runner-up and the phone's heading from the fix.
    expect(rows.map((row) => row.kind)).toEqual(['winner', 'high-ground', 'runner-up', 'phone'])
  })

  it('leads with the high ground when its model view is the better match', () => {
    const highPose = {
      lng: -123.105,
      lat: 54.21,
      altitudeMeters: null,
      bearing: 127.5,
      pitch: 0,
      roll: 0,
      hfov: 51.9,
    }
    const rows = photoOptions({
      base,
      search: { result: search({ ambiguous: true, trustworthy: false }) },
      modelScores: [
        { pose: { ...base, ...search() }, score: 0.05 },
        { pose: highPose, score: 0.4 },
      ],
      phone: { bearing: 127.5, reference: 'true', airborne: true },
      highGround: { lng: -123.105, lat: 54.21, distanceMeters: 1123, bearing: 343, aboveFixMeters: 114 },
    })
    expect(rows[0].kind).toBe('high-ground')
  })

  it('lists the phone’s heading once when the camera already stands on the high ground', () => {
    const there = { ...base, lng: -123.105, lat: 54.21, altitudeMeters: null }
    const rows = photoOptions({
      base: there,
      phone: { bearing: 127.5, reference: 'true', pitch: -8.2, airborne: false },
      highGround: { lng: -123.105, lat: 54.21, distanceMeters: 1123, bearing: 343, aboveFixMeters: 114 },
    })
    expect(rows.map((row) => row.kind)).toEqual(['high-ground'])
  })

  it('offers no high ground without the phone’s heading', () => {
    const rows = photoOptions({
      base,
      highGround: { lng: -123.105, lat: 54.21, distanceMeters: 1123, bearing: 343, aboveFixMeters: 114 },
    })
    expect(rows).toEqual([])
  })

  it('lists the skyline winner first and fills its evidence', () => {
    const rows = photoOptions({
      base,
      search: { result: search(), sun: { best: sun({ inFrame: true, relativeBearing: 3 }), runnerUp: null } },
      modelScores: [
        { pose: { ...base, ...search() }, score: 0.3 },
        { pose: { ...base, ...search().runnerUp! }, score: -0.06 },
      ],
      phone: { bearing: 3, reference: 'true', airborne: true },
    })
    expect(rows.map((row) => row.kind)).toEqual(['winner', 'runner-up', 'phone'])
    expect(rows[0]).toMatchObject({
      label: 'Skyline: best fit',
      pose: { ...base, bearing: 139.2, pitch: -5.9, roll: 0.3 },
      evidence: {
        skyColumns: 160,
        skySpanShare: 0.74,
        agreeShare: 0.91,
        settled: true,
        runnerUpBearing: 312,
        modelScore: 0.3,
        runnerUpModelScore: -0.06,
        sunNote: 'sun in frame: look for its glare or a lit patch of cloud',
      },
      warnings: [],
    })
    expect(rows[1].warnings).toEqual(['173° from the best fit', 'the model view matches the best fit better'])
    expect(rows[2].warnings).toEqual(['the phone’s heading: from an aircraft can be far out'])
  })

  it('warns on a winner that is not settled, and when the model view prefers the runner-up', () => {
    const rows = photoOptions({
      base,
      search: { result: search({ ambiguous: true, trustworthy: false }) },
      modelScores: [
        { pose: { ...base, ...search() }, score: 0.05 },
        { pose: { ...base, ...search().runnerUp! }, score: 0.25 },
      ],
    })
    const winner = rows.find((row) => row.kind === 'winner')!
    expect(winner.evidence.settled).toBe(false)
    expect(winner.warnings).toEqual([
      'not settled: another heading fits about as well',
      'the model view matches the runner-up better',
    ])
    // Still above the runner-up: the ranking never crosses a tier on the model view alone.
    expect(rows[0].kind).toBe('winner')
  })

  it('retains an alternate lens and ignores scores from the same heading with a different camera', () => {
    const result = search({ hfov: 41, runnerUp: { ...search().runnerUp!, hfov: 29 } })
    const rows = photoOptions({
      base,
      search: { result },
      modelScores: [
        { pose: { ...base, ...result, pitch: result.pitch + 5 }, score: 0.95 },
        { pose: { ...base, ...result, hfov: 35 }, score: 0.8 },
        { pose: { ...base, ...result, lng: base.lng + 0.01 }, score: 0.5 },
        { pose: { ...base, ...result.runnerUp!, hfov: 29 }, score: 0.3 },
      ],
    })
    expect(rows[0].evidence.modelScore).toBeNull()
    expect(rows[1]).toMatchObject({ pose: { hfov: 29 }, evidence: { modelScore: 0.3 } })
  })

  it('ranks a checked point solve and a trustworthy winner above a neighbour, and the phone last', () => {
    const rows = photoOptions({
      base,
      search: { result: search() },
      phone: { bearing: 3, reference: 'magnetic', airborne: true, pitch: -6 },
      neighbour: {
        id: 'r1',
        label: 'IMG_0001',
        gapSeconds: -3,
        distanceMeters: 80,
        pose: { bearing: 137, pitch: -6, roll: 0 },
      },
      points: {
        pose: { ...base, bearing: 139.5, pitch: -5.8, roll: 0.4 },
        pairs: 4,
        worstPairPixels: 9,
        heldOutMeters: 14,
      },
    })
    expect(rows.map((row) => row.kind)).toEqual(['points', 'winner', 'neighbour', 'runner-up', 'phone'])
    expect(rows.find((row) => row.kind === 'phone')).toMatchObject({
      pose: { bearing: 3, pitch: -6, roll: 0 },
      warnings: [
        'the phone’s heading: from an aircraft can be far out',
        'magnetic or unstated north: add the declination',
      ],
    })
    const neighbour = rows.find((row) => row.kind === 'neighbour')!
    expect(neighbour.label).toBe('IMG_0001’s camera (3 s before)')
    // The neighbour's angles on this photo's own place and lens.
    expect(neighbour.pose).toEqual({ ...base, bearing: 137, pitch: -6, roll: 0 })
    expect(neighbour.evidence.neighbourAgreesDegrees).toBeCloseTo(2.2, 5)
    expect(rows[1].evidence).toMatchObject({ neighbourId: 'r1', neighbourAgreesDegrees: expect.closeTo(2.2, 5) })
  })

  it('flags a candidate that disagrees with the burst neighbour', () => {
    const rows = photoOptions({
      base,
      search: { result: search() },
      neighbour: {
        id: 'r1',
        label: 'IMG_0001',
        gapSeconds: 4,
        distanceMeters: 120,
        pose: { bearing: 310, pitch: -4, roll: 0 },
      },
    })
    expect(rows.find((row) => row.kind === 'winner')!.warnings).toEqual(['disagrees with IMG_0001 by 171°'])
  })

  it('shows a narrow fit that agrees with the neighbour as evidence, never as settling the fit', () => {
    const neighbour = {
      id: 'r1',
      label: 'IMG_0001',
      gapSeconds: 3,
      distanceMeters: 90,
      pose: { bearing: 140, pitch: -6, roll: 0 },
    }
    const narrow = {
      pose: { bearing: 139.4, pitch: -5.9, roll: 0.2 },
      neighbourId: 'r1',
      label: 'IMG_0001',
      agreesDegrees: 0.6,
      agreeShare: 0.93,
      skyColumns: 150,
      skySpanShare: 0.7,
    }
    // The full search found the same camera but did not settle it: the agreement is on the winner, settled stays false.
    const same = photoOptions({
      base,
      search: { result: search({ bearing: 139.3, trustworthy: false, ambiguous: true }) },
      neighbour,
      narrow,
    })
    const winner = same.find((row) => row.kind === 'winner')!
    expect(winner.evidence).toMatchObject({ settled: false, neighbourId: 'r1', neighbourAgreesDegrees: 0.6 })
    expect(same.some((row) => row.id === 'narrow:r1')).toBe(false)
    // The full search settled elsewhere: the narrow fit is a row of its own, not settled.
    const apart = photoOptions({ base, search: { result: search({ bearing: 250 }) }, neighbour, narrow })
    const own = apart.find((row) => row.id === 'narrow:r1')!
    expect(own.pose.bearing).toBe(139.4)
    expect(own.evidence).toMatchObject({ settled: false, neighbourAgreesDegrees: 0.6, agreeShare: 0.93 })
    expect(apart[0].kind).toBe('winner')
  })

  it('reads a narrow fit as evidence only within 2° and on most columns', () => {
    const fitWith = (agreement: number) => ({ ...fit(false), agreement })
    const across = narrowAgreement({ bearing: 358.5, fit: fitWith(0.9) }, 0.2)!
    expect(across.agreesDegrees).toBeCloseTo(1.7, 9)
    expect(across.agreeShare).toBe(0.9)
    expect(narrowAgreement({ bearing: 356, fit: fitWith(0.9) }, 0.2)).toBeNull()
    expect(narrowAgreement({ bearing: 0.5, fit: fitWith(0.6) }, 0.2)).toBeNull()
    expect(narrowAgreement(null, 0)).toBeNull()
  })

  it('drops a point solve with a missed held-out pair to the doubtful tier', () => {
    const rows = photoOptions({
      base,
      search: { result: search() },
      points: { pose: { ...base, bearing: 150, pitch: -5, roll: 0 }, pairs: 3, worstPairPixels: 55, heldOutMeters: 90 },
    })
    expect(rows.map((row) => row.kind)).toEqual(['winner', 'points', 'runner-up'])
    expect(rows[1].warnings).toEqual(['a held-out pair lands 55 px off'])
  })

  it('takes a matched camera whole, with the checks it came with', () => {
    const camera: MatchedCamera = {
      lng: -123.101,
      lat: 54.2004,
      altitudeMeters: 1262,
      bearing: 139.1,
      pitch: -5.7,
      roll: 0.5,
      hfov: 51.4,
      method: 'skyline',
      trusted: true,
      heldOut: [
        { name: 'creek', metres: 7 },
        { name: 'road', metres: 12 },
      ],
      photoName: 'IMG_0002.HEIC',
    }
    const clean = photoOptions({ base, matched: { camera, checks: [] } })
    expect(clean[0]).toMatchObject({
      kind: 'matched',
      pose: { lng: -123.101, altitudeMeters: 1262, hfov: 51.4 },
      evidence: { settled: true, heldOutMeters: 12 },
      warnings: [],
    })
    const warned = photoOptions({
      base,
      search: { result: search() },
      matched: { camera, checks: ['This camera was matched for IMG_0002.HEIC, not IMG_0003.HEIC.'] },
    })
    expect(warned.map((row) => row.kind)).toEqual(['winner', 'matched', 'runner-up'])
  })

  it('draws both skyline cameras through the lens a cropped photo’s search fitted', () => {
    const rows = photoOptions({ base, search: { result: search({ hfov: 41 }) } })
    expect(rows.find((row) => row.kind === 'winner')!.pose.hfov).toBe(41)
    expect(rows.find((row) => row.kind === 'runner-up')!.pose.hfov).toBe(41)
    // Without a fitted lens they keep the photo's own.
    expect(photoOptions({ base, search: { result: search() } })[0].pose.hfov).toBe(base.hfov)
  })

  it('never marks a candidate accepted', () => {
    const rows = photoOptions({ base, search: { result: search() } })
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual(['evidence', 'id', 'kind', 'label', 'pose', 'warnings'])
  })
})

describe('sunNote', () => {
  it('says where the sun falls for a camera', () => {
    expect(sunNote(sun({ elevation: -3 }))).toBe('sun below the horizon')
    expect(sunNote(sun({ relativeBearing: -40 }))).toBe('sun out of frame, 40° left')
    expect(sunNote(sun({ relativeBearing: 150 }))).toBe('sun behind the camera, 150° right')
  })
})

describe('queue states', () => {
  it('has words for every status and reason', () => {
    expect(Object.keys(PHOTO_STATUS_TEXT)).toHaveLength(7)
    expect(Object.keys(PHOTO_FAILURE_TEXT)).toHaveLength(8)
    expect(photoFailureText('disagrees-with-neighbour', 'IMG_0004')).toBe(
      'Disagrees with IMG_0004, taken just before or after it.',
    )
    expect(photoFailureText('cropped-lens')).toMatch(/lens is unknown/)
  })

  it('names what wants the reviewer, and nothing for a clean photo', () => {
    expect(
      photoReasons({ skyline: true, terrain: true, search: { trustworthy: true, ambiguous: false }, otherOptions: 2 }),
    ).toEqual([])
    expect(
      photoReasons({
        terrain: false,
        skyline: false,
        lens: { cropped: true },
        search: { trustworthy: false, ambiguous: true },
        otherOptions: 0,
        neighbourGap: 40,
      }),
    ).toEqual([
      'outside-terrain',
      'no-skyline',
      'cropped-lens',
      'not-settled',
      'phone-heading-only',
      'disagrees-with-neighbour',
    ])
  })

  it('doubts the place while high ground stands at the GPS altitude, unless the skyline settles it from the air', () => {
    const unsettled = { trustworthy: false, ambiguous: true }
    expect(photoReasons({ search: unsettled, otherOptions: 3, highGround: true })).toEqual(['not-settled', 'gps-off'])
    expect(
      photoReasons({ search: { trustworthy: true, ambiguous: false }, otherOptions: 3, highGround: true }),
    ).toEqual([])
    expect(photoReasons({ skyline: false, highGround: true })).toEqual(['no-skyline', 'gps-off'])
  })
})

describe('what a photo in the strip needs', () => {
  it('tells a camera that only wants a look from one that wants a landmark', () => {
    expect(photoStripState({ status: 'options', reasons: [] })).toMatchObject({ tone: 'ready', short: 'Check it' })
    expect(photoStripState({ status: 'options', reasons: ['not-settled'] })).toMatchObject({
      tone: 'help',
      short: 'Needs a landmark',
    })
    expect(photoStripState({ status: 'options', reasons: ['phone-heading-only'] }).tone).toBe('help')
    // A place in doubt comes before the heading: no heading fits from the wrong place.
    expect(photoStripState({ status: 'options', reasons: ['not-settled', 'gps-off'] })).toMatchObject({
      tone: 'help',
      short: 'Check the place',
    })
    // A disagreement with a neighbour is said before an unsettled skyline: it is the more specific thing to look at.
    expect(photoStripState({ status: 'options', reasons: ['not-settled', 'disagrees-with-neighbour'] }).short).toBe(
      'Disagrees with a neighbour',
    )
  })

  it('says why a camera was not found', () => {
    expect(photoStripState({ status: 'failed', reasons: ['no-skyline'] })).toMatchObject({
      tone: 'failed',
      short: 'No skyline',
    })
    expect(photoStripState({ status: 'failed', reasons: ['outside-terrain'] }).short).toBe('No terrain')
    expect(photoStripState({ status: 'failed', reasons: [] }).short).toBe('Not found')
  })

  it('keeps the queue and the acceptance states apart, and reads a photo with no entry as waiting', () => {
    expect(photoStripState(undefined).tone).toBe('waiting')
    expect(photoStripState({ status: 'searching', reasons: [] }).tone).toBe('working')
    // Looked at is not settled: a photo keeps saying what it needs until its camera is accepted.
    expect(photoStripState({ status: 'checked', reasons: ['not-settled'] }).short).toBe('Needs a landmark')
    expect(photoStripState({ status: 'checked', reasons: [] })).toMatchObject({ tone: 'ready', short: 'Check it' })
    expect(photoStripState({ status: 'accepted', reasons: ['not-settled'] }).tone).toBe('done')
    expect(photoStripState({ status: 'unsearched', reasons: [] }).tone).toBe('idle')
  })

  it('gives every state a sentence that ends', () => {
    for (const status of ['unsearched', 'queued', 'searching', 'options', 'checked', 'accepted', 'failed'] as const)
      expect(photoStripState({ status, reasons: [] }).text.length).toBeGreaterThan(5)
  })
})

describe('photoOptions: other places and the look of the ground', () => {
  const ground = { ...base, altitudeMeters: null }
  const fixAt = {
    lng: -123.1,
    lat: 54.2,
    altitudeMeters: 1250,
    hfov: 51.9,
    label: 'the GPS fix',
    source: 'exif' as const,
  }

  it('keeps a search’s rows where it stood once the camera has moved, and says where', () => {
    const rows = photoOptions({
      base: { lng: -123.105, lat: 54.21, altitudeMeters: null, hfov: 51.9 },
      search: { result: search({ ambiguous: true, trustworthy: false }), at: fixAt },
    })
    const winner = rows.find((row) => row.kind === 'winner')!
    expect(winner.label).toBe('Skyline from the GPS fix: best fit')
    expect(winner.pose).toMatchObject({ lng: -123.1, lat: 54.2, altitudeMeters: 1250 })
    expect(winner.positionSource).toBe('exif')
    expect(rows.find((row) => row.kind === 'runner-up')!.label).toBe('Skyline from the GPS fix: runner-up')
  })

  it('stands a search from another place at that place, settled in tier 0 ahead of an unsettled winner', () => {
    const rows = photoOptions({
      base: ground,
      search: { result: search({ ambiguous: true, trustworthy: false }) },
      places: [
        {
          id: 'high-ground',
          label: 'the high ground 1.2 km NNW',
          positionSource: 'gps-altitude',
          warning: 'the place is a guess from the GPS altitude',
          at: { lng: -123.105, lat: 54.21, altitudeMeters: null, hfov: 51.9 },
          result: search({ bearing: 129.6 }),
        },
      ],
    })
    expect(rows[0]).toMatchObject({
      id: 'place:high-ground',
      kind: 'place',
      label: 'Skyline from the high ground 1.2 km NNW: best fit',
      positionSource: 'gps-altitude',
      pose: { lng: -123.105, lat: 54.21, altitudeMeters: null, bearing: 129.6 },
      warnings: ['the place is a guess from the GPS altitude'],
    })
    expect(rows[0].evidence.settled).toBe(true)
  })

  it('says a search from another place did not settle, and keeps it in tier 1', () => {
    const rows = photoOptions({
      base: ground,
      search: { result: search() },
      places: [
        {
          id: 'area',
          label: 'a place 500 m E of the fix',
          positionSource: 'skyline',
          warning: 'a guess',
          at: { lng: -123.09, lat: 54.2, altitudeMeters: null, hfov: 51.9 },
          result: search({ ambiguous: true, trustworthy: false }),
        },
      ],
    })
    expect(rows.map((row) => row.id)).toEqual(['winner', 'place:area', 'place:area:runner-up', 'runner-up'])
    expect(rows[1].warnings).toContain('not settled: another heading fits about as well')
    expect(rows[2]).toMatchObject({
      label: 'Skyline from a place 500 m E of the fix: runner-up',
      pose: { lng: -123.09, lat: 54.2, altitudeMeters: null, bearing: 312 },
      warnings: ['a guess', '173° from that place’s best fit'],
    })
  })

  it('notes the look of the ground on a row near its heading instead of a row of its own', () => {
    const rows = photoOptions({
      base: ground,
      search: { result: search() },
      ground: { bearing: 135, pitch: -6, depth: false },
    })
    expect(rows.some((row) => row.kind === 'ground')).toBe(false)
    expect(rows.find((row) => row.kind === 'winner')!.notes).toEqual(['The look of the ground favours this heading'])
  })

  it('offers a heading only the ground favours as a sector to search, beside the runner-up', () => {
    const rows = photoOptions({
      base: ground,
      search: { result: search({ ambiguous: true, trustworthy: false }) },
      ground: { bearing: 210, pitch: -8, depth: true },
    })
    const row = rows.find((option) => option.kind === 'ground')!
    expect(row.label).toBe('Look of the ground: near 210°')
    expect(row.pose).toMatchObject({ bearing: 210, pitch: -8, roll: 0 })
    expect(rows.map((option) => option.kind)).toEqual(['winner', 'ground', 'runner-up'])
  })

  it('notes a fit on the ground near the phone’s heading, never a fit at an altitude', () => {
    const rows = photoOptions({
      base: ground,
      search: { result: search() },
      phone: { bearing: 131, reference: 'true', airborne: false },
    })
    expect(rows.find((row) => row.kind === 'winner')!.notes).toEqual(['Within 8° of the phone’s heading (131°)'])
    const air = photoOptions({
      base,
      search: { result: search() },
      phone: { bearing: 131, reference: 'true', airborne: true },
    })
    expect(air.find((row) => row.kind === 'winner')!.notes).toBeUndefined()
    // A place on the ground is a ground-held phone's hypothesis, whatever the photo's own eye.
    const placed = photoOptions({
      base,
      phone: { bearing: 131, reference: 'true', airborne: true },
      places: [
        {
          id: 'high-ground',
          label: 'the high ground',
          positionSource: 'gps-altitude',
          warning: 'a guess',
          at: { lng: -123.105, lat: 54.21, altitudeMeters: null, hfov: 51.9 },
          result: search({ runnerUp: null }),
        },
      ],
    })
    expect(placed.find((row) => row.kind === 'place')!.notes).toEqual(['Within 8° of the phone’s heading (131°)'])
  })

  it('puts a fit that agrees with the phone first within its tier, whatever the model-view scores', () => {
    const at = { lng: -123.105, lat: 54.21, altitudeMeters: null, hfov: 51.9 }
    const place = (id: string, bearing: number) => ({
      id,
      label: id,
      positionSource: 'gps-altitude' as const,
      warning: 'a guess',
      at,
      result: search({ bearing, ambiguous: true, trustworthy: false, runnerUp: null }),
    })
    const rows = photoOptions({
      base,
      phone: { bearing: 127.5, reference: 'true', airborne: true },
      places: [place('wrong', 252.3), place('right', 129.6)],
      modelScores: [
        { pose: { ...at, ...search(), bearing: 252.3 }, score: 0.33 },
        { pose: { ...at, ...search(), bearing: 129.6 }, score: 0.31 },
      ],
    })
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(['place:right', 'place:wrong'])
  })

  it('never notes the ground on the phone’s own heading', () => {
    const rows = photoOptions({
      base: ground,
      phone: { bearing: 210, reference: 'true', airborne: false },
      ground: { bearing: 212, pitch: -8, depth: false },
    })
    expect(rows.find((row) => row.kind === 'phone')!.notes).toBeUndefined()
    expect(rows.some((row) => row.kind === 'ground')).toBe(true)
  })
})
