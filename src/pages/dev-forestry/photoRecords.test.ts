import { describe, expect, it } from 'vitest'
import { emptyTools, MAX_FIELD_RECORDS, parseTools, serializeTools, type FieldRecord } from './assessmentTools'
import type { ExifReading, OwnPose, OwnPoseSources } from './exifPose'
import type { PhotoAcceptance } from './photoAcceptance'
import {
  fieldRecordRoom,
  hasPhotoJob,
  linkPhotoJob,
  ownSourcesOnReopen,
  parseOwnPoseSources,
  parseOwnSearchSummary,
  photoAttachment,
  photoRecordFromOwn,
  photoTakenAt,
  recordCameraPose,
  searchSummaryFrom,
  unlinkPhotoJob,
  withFlights,
} from './photoRecords'
import type { WideSearchResult } from './wideOrientation'

const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
// A made-up place and flight: nothing here is a real photo's.
const pose: OwnPose = {
  lng: -122.5,
  lat: 53.8,
  bearing: 101.234,
  pitch: -5.678,
  roll: 1.234,
  hfov: 54.44,
  eyeHeightMeters: 1.6,
  altitudeMeters: 1210,
}
const exif: ExifReading = {
  position: { lng: -122.5, lat: 53.8 },
  heading: { degrees: 140, reference: 'magnetic' },
  fov: { horizontal: 54.44, vertical: 42, from: '35mm' },
  takenAt: '2026-07-01 07:03',
  camera: 'A phone',
  altitudeMeters: 1210,
  tilt: null,
  gpsTimeUtc: '2026-07-01T14:03:21.000Z',
}
const fromExif: OwnPoseSources = {
  position: 'exif',
  heading: 'exif',
  pitch: 'level',
  roll: 'level',
  fov: 'exif',
  eyeHeight: 'exif',
}
const acceptance: PhotoAcceptance = {
  acceptedBy: 'AB',
  acceptedAt: '2026-11-17T10:00:00Z',
  method: 'skyline',
  pose: { lng: -122.5, lat: 53.8, altitudeMeters: 1210, bearing: 101.2, pitch: -5.7, roll: 1.2, hfov: 54.4 },
  evidence: { skyColumns: 310, skySpanShare: 0.8, agreeShare: 0.9, settled: true, runnerUpBearing: 260 },
  note: '',
}

const record = (id: string, takenAtUtc: string | null, patch: Partial<FieldRecord> = {}): FieldRecord => ({
  ...photoRecordFromOwn({
    id,
    name: `${id}.HEIC`,
    image: { dataUrl: PIXEL, width: 4, height: 3 },
    exif: { ...exif, gpsTimeUtc: takenAtUtc, takenAt: null },
    pose,
    sources: fromExif,
  }),
  ...patch,
})

describe('a field record made from an own photo', () => {
  it('keeps the GPS time, the place and the lens, and leaves the phone’s magnetic heading and a level tilt blank', () => {
    const made = photoRecordFromOwn({
      id: 'field-1',
      name: 'IMG_0001.HEIC',
      image: { dataUrl: PIXEL, width: 4, height: 3 },
      exif,
      pose,
      sources: fromExif,
      focal35Mm: 35,
    })
    expect(made).toMatchObject({
      kind: 'photo',
      image: PIXEL,
      originalName: 'IMG_0001.HEIC',
      takenAtUtc: '2026-07-01T14:03:21.000Z',
      captured: '2026-07-01',
      lng: -122.5,
      lat: 53.8,
      altitude: 1210,
      bearing: null,
      pitch: 0,
      roll: 0,
      hfov: 54.4,
      focal35Mm: 35,
    })
    // A camera the skyline fixed is the record's.
    const fitted = photoRecordFromOwn({
      id: 'field-2',
      name: 'IMG_0002.HEIC',
      image: { dataUrl: PIXEL, width: 4, height: 3 },
      exif,
      pose,
      sources: { ...fromExif, heading: 'skyline', pitch: 'skyline', roll: 'skyline' },
    })
    expect(fitted).toMatchObject({ bearing: 101.2, pitch: -5.68, roll: 1.23 })
    expect(recordCameraPose(fitted)).toEqual({
      lng: -122.5,
      lat: 53.8,
      altitudeMeters: 1210,
      bearing: 101.2,
      pitch: -5.68,
      roll: 1.23,
      hfov: 54.4,
    })
    // A road-view stand-in is no place to record.
    expect(
      photoRecordFromOwn({
        id: 'field-3',
        name: 'x.jpg',
        image: { dataUrl: PIXEL, width: 4, height: 3 },
        exif: null,
        pose,
        sources: { ...fromExif, position: 'road-view', fov: 'default' },
      }),
    ).toMatchObject({ lng: null, lat: null, hfov: null, takenAtUtc: null })
  })

  it('reads the camera clock when there is no GPS time', () => {
    expect(photoTakenAt({ gpsTimeUtc: null, takenAt: '2026-07-01 07:03' })).toBe('2026-07-01T07:03')
    expect(photoTakenAt({ gpsTimeUtc: null, takenAt: 'yesterday' })).toBeNull()
    expect(photoTakenAt(null)).toBeNull()
  })

  it('keeps its original as the attachment of that record', () => {
    const original = new Blob([new Uint8Array([1, 2, 3])])
    expect(photoAttachment(record('field-1', null), original)).toEqual({
      name: 'field-1.HEIC',
      blob: original,
      recordId: 'field-1',
    })
  })
})

describe('the workspace', () => {
  it('round-trips a photo’s flight, time, acceptance and uses, and still reads records made before them', () => {
    const accepted = linkPhotoJob(
      record('field-1', '2026-07-01T14:03:21.000Z', { flightId: 'flight-a', frameIndex: 0, acceptance }),
      'viewpoint',
      'voi-1',
    )
    const older = record('field-2', null)
    delete older.takenAtUtc
    const document = { ...emptyTools(), fields: [accepted, older] }
    const read = parseTools(JSON.parse(serializeTools(document)))
    expect(read.fields).toEqual([accepted, older])
    expect(Object.keys(read.fields[1])).not.toContain('acceptance')
  })

  it('leaves out an acceptance or a job it cannot read rather than failing the workspace', () => {
    const odd = {
      ...record('field-1', null),
      acceptance: { ...acceptance, method: 'guess' },
      uses: [{ job: 'viewpoint', targetId: 'voi-1' }, { job: 'a newer job' }],
    }
    const [read] = parseTools({ ...emptyTools(), fields: [odd] }).fields
    expect(read.acceptance).toBeNull()
    expect(read.uses).toEqual([{ job: 'viewpoint', targetId: 'voi-1' }])
    expect(() => parseTools({ ...emptyTools(), fields: [{ ...record('f', null), frameIndex: -1 }] })).toThrow(
      'place in its flight',
    )
    expect(() => parseTools({ ...emptyTools(), fields: [{ ...record('f', null), takenAtUtc: 'soon' }] })).toThrow(
      'time is invalid',
    )
  })

  it('says how many photos fit in the attachments left', () => {
    expect(fieldRecordRoom(10, 14)).toBeNull()
    expect(fieldRecordRoom(20, 14)).toBe(
      `The workspace holds at most ${MAX_FIELD_RECORDS} attachments and has 20: 4 of these 14 fit. Remove some, or choose fewer.`,
    )
    expect(fieldRecordRoom(MAX_FIELD_RECORDS, 1)).toContain('is full')
  })
})

describe('flights', () => {
  const at = (minutes: number, seconds = 0) => new Date(Date.UTC(2026, 6, 1, 14, minutes, seconds)).toISOString()

  it('groups photos by time, a gap over five minutes starting another, numbered in time order', () => {
    const fields = [
      record('c', at(10, 5)),
      record('a', at(0)),
      record('b', at(0, 3)),
      record('d', at(30)),
      record('none', null),
      { ...record('map', at(0, 1)), kind: 'map' as const },
    ]
    const grouped = withFlights(fields)
    expect(grouped.map((r) => r.id)).toEqual(fields.map((r) => r.id))
    const byId = Object.fromEntries(grouped.map((r) => [r.id, r]))
    // a and b 3 s apart; c 10 min later; d 20 min after that.
    expect(byId.a.flightId).toBe(byId.b.flightId)
    expect([byId.a.frameIndex, byId.b.frameIndex]).toEqual([0, 1])
    expect(new Set([byId.a.flightId, byId.c.flightId, byId.d.flightId]).size).toBe(3)
    expect(byId.c.frameIndex).toBe(0)
    expect(byId.none.flightId ?? null).toBeNull()
    expect(byId.map).toBe(fields[5])
  })

  it('keeps a flight’s id as photos join it, and leaves records that did not change as they were', () => {
    const first = withFlights([record('a', at(0)), record('b', at(1))])
    const joined = withFlights([...first, record('c', at(0, 30))])
    expect(joined[0].flightId).toBe(first[0].flightId)
    expect(joined.map((r) => r.frameIndex)).toEqual([0, 2, 1])
    expect(withFlights(joined)[0]).toBe(joined[0])
  })
})

describe('jobs', () => {
  it('links a photo to a job once per target, and takes it off', () => {
    const photo = record('field-1', null)
    const linked = linkPhotoJob(linkPhotoJob(photo, 'before', 'voi-1'), 'ground', 'block-1')
    expect(linkPhotoJob(linked, 'before', 'voi-1')).toBe(linked)
    expect(hasPhotoJob(linked, 'before')).toBe(true)
    expect(hasPhotoJob(linked, 'before', 'voi-2')).toBe(false)
    expect(unlinkPhotoJob(linked, 'before', 'voi-1').uses).toEqual([{ job: 'ground', targetId: 'block-1' }])
    expect(unlinkPhotoJob(linked, 'regrowth')).toBe(linked)
    expect(linkPhotoJob(photo, 'landform').uses).toEqual([{ job: 'landform' }])
  })
})

describe('a photo reopened from a project file', () => {
  const start = { pose: { ...pose, bearing: 140, pitch: 0, roll: 0 }, sources: fromExif }

  it('gives back the sources the file kept', () => {
    const kept = { ...fromExif, heading: 'skyline' as const }
    expect(ownSourcesOnReopen({ pose, recordId: null, sources: kept }, start)).toEqual(kept)
    expect(
      ownSourcesOnReopen({ pose: { ...pose, lng: null, lat: null }, recordId: null, sources: kept }, start),
    ).toMatchObject({ position: null })
  })

  it('never says "from the field record" for a photo that came from none, in an older file', () => {
    const sources = ownSourcesOnReopen({ pose, recordId: null }, start)
    expect(sources).toEqual({
      position: 'exif',
      heading: 'reviewer',
      pitch: 'reviewer',
      roll: 'reviewer',
      fov: 'exif',
      eyeHeight: 'exif',
    })
    expect(Object.values(sources)).not.toContain('record')
    expect(ownSourcesOnReopen({ pose, recordId: 'field-1' }, start).heading).toBe('record')
    expect(ownSourcesOnReopen({ pose: start.pose, recordId: 'field-1' }, start)).toEqual(fromExif)
  })

  it('reads stored sources strictly', () => {
    expect(parseOwnPoseSources(fromExif)).toEqual(fromExif)
    expect(parseOwnPoseSources({ ...fromExif, heading: 'guess' })).toBeNull()
    expect(parseOwnPoseSources(null)).toBeNull()
  })

  it('keeps the search’s winner, runner-up, columns and model-view scores', () => {
    const result: WideSearchResult = {
      bearing: 101.2,
      pitch: -5.7,
      roll: 1.2,
      fit: {
        nudge: { bearing: 0, pitch: 0 },
        agreement: 0.9,
        agreeing: 280,
        span: 0.8,
        medianErrorPx: 2.5,
        columns: 310,
        trustworthy: true,
      },
      columns: 310,
      meanLoss: 0.21,
      runnerUp: { bearing: 260.4, pitch: -3, roll: -2, meanLoss: 0.6 },
      ambiguous: false,
      trustworthy: true,
    }
    const summary = searchSummaryFrom(result, [
      { bearing: 260.5, score: 0.4 },
      undefined,
      { bearing: 101.1, score: 0.8 },
    ])
    expect(summary).toMatchObject({ columns: 310, agreeing: 280, modelScore: 0.8, runnerUpModelScore: 0.4 })
    expect(parseOwnSearchSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary)
    expect(parseOwnSearchSummary({ ...summary, bearing: 'east' })).toBeNull()
    expect(parseOwnSearchSummary({ ...summary, modelScore: 'high' })).toEqual({ ...summary, modelScore: null })
  })
})
