import { describe, expect, it } from 'vitest'
import * as jspdf from 'jspdf'

import { pdfTextUnfolded } from '@/lib/mapSheet/renderPdf'

import type { NoteImage } from './blockNote'
import {
  briefOpenings,
  briefViewpoints,
  buildFieldBrief,
  fieldBriefFileName,
  fieldBriefPdf,
  fieldBriefStrings,
  formatBearing,
  measuredText,
  type BriefSavedView,
} from './fieldBrief'
import { EMPTY_FIELD_CHECKLIST, updateBoundaryNote, updateFieldCheck } from './fieldChecklist'
import type { AnalysisResult, TargetPolygon, Viewpoint } from './types'
import { assessVia, type ViaAssessment } from './via'

/** A 16 × 9 grey-green JPEG (as in `blockNote.test.ts`). */
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ0ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAJABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCeiiivOOY//9k='

const image = (caption: string): NoteImage => ({ caption, dataUrl: JPEG, width: 1600, height: 900 })

/** A square of `size` degrees with its south-west corner at (lng, lat). */
function square(lng: number, lat: number, size = 0.004): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
  }
}

function target(
  id: string,
  role: TargetPolygon['role'],
  geometry: GeoJSON.Polygon,
  extra: Partial<TargetPolygon> = {},
) {
  return {
    id,
    name: id,
    role,
    objectiveId: 'partial-retention',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry,
    source: 'test',
    ...extra,
  } as TargetPolygon
}

const block = target('CHU_26_1', 'block', square(-122.0, 54.01), {
  planning: { blockId: 'CHU_26_1', licenceId: 'A00000' },
})
const landform = target('Tabor face', 'landscape', square(-122.02, 54.0, 0.05), { objectiveId: 'retention' })
const near = target('Old cut near', 'harvested', square(-121.99, 54.01), { harvestYear: 2009 })
const far = target('Old cut far', 'harvested', square(-121.9, 54.05), { harvestYear: 1995 })
const targets = [block, landform, far, near]

const road: Viewpoint = {
  id: 'road',
  name: 'Hwy 16',
  mode: 'corridor',
  coordinates: [
    [-122.01, 53.99],
    [-121.99, 53.99],
  ],
}

const result = {
  stations: [
    { lng: -122.01, lat: 53.99, groundElevationMeters: 700, distanceAlongMeters: 0 },
    { lng: -122.0, lat: 53.99, groundElevationMeters: 700, distanceAlongMeters: 655 },
  ],
  assessmentStationIndex: 1,
  targets: [{ targetId: 'CHU_26_1', role: 'block', visiblePercent: 34.2, visibleAreaMeters: 1000 }],
  perspectiveAlteration: { existingPercent: 0, disturbancePercent: 0, proposedPercent: 1.2, cumulativePercent: 1.2 },
  quality: { numericalReady: true },
} as unknown as AnalysisResult

const views: BriefSavedView[] = [
  {
    id: 'v1',
    name: 'View from Hwy 16 looking north',
    positionMeters: 300,
    lookAtTargetId: 'CHU_26_1',
    onThisRoad: true,
  },
  {
    id: 'v2',
    name: 'Davie Lake rec site',
    positionMeters: 15,
    lookAtTargetId: null,
    lookBearing: 200,
    onThisRoad: false,
  },
]

describe('field brief content', () => {
  it('lists the assessment station, then the saved views, with where to stand and which way to face', () => {
    const points = briefViewpoints({ viewpoint: road, block, targets, result, savedViews: views })
    expect(points.map((point) => point.key)).toEqual(['station:road', 'view:v1', 'view:v2'])
    expect(points[0].where).toBe('Assessment station · 0.66 km along the road')
    expect(points[0].location).toEqual({ lng: -122.0, lat: 53.99 })
    // The block lies north of the road.
    expect(points[0].facing).toBeGreaterThan(-20)
    expect(points[0].facing).toBeLessThan(20)
    expect(points[1].where).toBe('Saved view · 0.30 km along Hwy 16')
    expect(points[1].location!.lat).toBeCloseTo(53.99, 6)
    // A view saved where the reviewer stood elsewhere keeps its bearing but has no place on this road.
    expect(points[2]).toMatchObject({ location: null, facing: 200, where: 'Saved view at another viewpoint' })
  })

  it('stands at the road before a run', () => {
    const [point] = briefViewpoints({ viewpoint: road, block, targets, result: null, savedViews: [] })
    expect(point.where).toMatch(/^Start of 1\.3\d km of road \(not run yet\)$/)
    expect(point.location).toEqual({ lng: -122.01, lat: 53.99 })
  })

  it('lists existing openings nearest the block first', () => {
    expect(briefOpenings(block, targets).map((opening) => opening.name)).toEqual(['Old cut near', 'Old cut far'])
  })

  it('states the measured figure, or why there is none', () => {
    const assessment = assessVia({ objectiveId: 'retention', result, review: {} })
    expect(measuredText({ assessment, hasResult: true, stale: false })).toBe('X = 1.2% in perspective view, reads R')
    expect(measuredText({ assessment, hasResult: false, stale: false })).toBe('Not yet run')
    expect(measuredText({ assessment, hasResult: true, stale: true })).toBe(
      'Not current: the scene changed since the run',
    )
    const provisional = { ...assessment, initialPercent: null, numericalProvisional: true } as ViaAssessment
    expect(measuredText({ assessment: provisional, hasResult: true, stale: false })).toBe(
      'Withheld: the run is provisional',
    )
  })

  it('assembles the brief: header, viewpoints with answers, up to three images, prompts and the checklist', () => {
    let checklist = updateFieldCheck(
      { ...EMPTY_FIELD_CHECKLIST, checkedBy: 'J. Smith' },
      'viewpoints',
      'view:v1',
      { answer: 'yes', note: 'Pullout at km 0.3' },
      '2026-11-12',
    )
    checklist = updateFieldCheck(checklist, 'greenUp', 'Old cut near', { answer: 'no' }, '2026-11-13')
    checklist = updateBoundaryNote(checklist, 'Follow the draw on the east edge.', '2026-11-13')
    const brief = buildFieldBrief({
      block,
      targets,
      viewpoint: road,
      landform,
      result,
      stale: false,
      assessment: assessVia({ objectiveId: 'retention', result, review: {} }),
      review: { fieldChecklist: checklist },
      savedViews: views,
      images: { v1: image('View from Hwy 16 looking north.'), v2: image('Davie Lake rec site.') },
      generatedAt: new Date(2026, 10, 11, 12),
    })
    expect(brief.stage).toBe('pre-layout')
    expect(Object.fromEntries(brief.header.map((row) => [row.label, row.value]))).toMatchObject({
      Block: 'CHU_26_1',
      Licence: 'A00000',
      'VIA stage': 'Pre-layout: proposed boundary, before field layout',
      Objective: 'Retention (R) · Table 2 range 0–1.5%',
      Measured: 'X = 1.2% in perspective view, reads R',
    })
    expect(brief.viewpoints[1].check).toMatchObject({ answer: 'yes', by: 'J. Smith', on: '2026-11-12' })
    expect(brief.viewpoints[0].check).toBeNull()
    // Captions numbered as their rows.
    expect(brief.images.map((entry) => entry.caption)).toEqual([
      '2. View from Hwy 16 looking north.',
      '3. Davie Lake rec site.',
    ])
    expect(brief.openings.map((opening) => [opening.name, opening.check?.answer ?? null])).toEqual([
      ['Old cut near', 'no'],
      ['Old cut far', null],
    ])
    expect(brief.boundary).toEqual({ note: 'Follow the draw on the east edge.', stamp: 'J. Smith, 2026-11-13' })
    expect(brief.checkedOn).toBe('2026-11-13')
    // The R objective adds its warning; the run's share of the block in view is quoted.
    expect(brief.prompts.some((prompt) => prompt.startsWith('The R objective'))).toBe(true)
    expect(brief.prompts.some((prompt) => prompt.includes('34% of the block'))).toBe(true)
    expect(brief.prompts.some((prompt) => prompt.startsWith('Strategic wildlife tree patches'))).toBe(true)
    expect(fieldBriefFileName(brief)).toBe('CHU_26_1-field-brief-2026-11-11.pdf')
    // Every string survives jsPDF's WinAnsi fonts.
    expect(fieldBriefStrings(brief).flatMap(pdfTextUnfolded)).toEqual([])
  })

  it('prints a post-layout stage and "not yet run" without a run, and caps the images at three', () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      id: `v${index}`,
      name: `View ${index}`,
      positionMeters: index * 100,
      lookAtTargetId: 'CHU_26_1',
      onThisRoad: true,
    }))
    const brief = buildFieldBrief({
      block,
      targets: [block],
      viewpoint: road,
      landform: null,
      result: null,
      stale: false,
      assessment: null,
      review: { layoutStage: 'post-layout' },
      savedViews: many,
      images: Object.fromEntries(many.map((view) => [view.id, image(view.name)])),
      generatedAt: new Date(2026, 10, 11, 12),
    })
    const header = Object.fromEntries(brief.header.map((row) => [row.label, row.value]))
    expect(header['VIA stage']).toBe('Post-layout: boundary as laid out in the field')
    expect(header.Measured).toBe('Not yet run')
    expect(header.Landform).toBe('None adopted')
    expect(brief.images).toHaveLength(3)
    expect(brief.viewpoints).toHaveLength(6)
    expect(brief.openings).toEqual([])
    expect(brief.checkedOn).toBe('')
  })
})

describe('field brief PDF', () => {
  it('writes one page with the screenshots and tick boxes', () => {
    const brief = buildFieldBrief({
      block,
      targets,
      viewpoint: road,
      landform,
      result,
      stale: false,
      assessment: assessVia({ objectiveId: 'retention', result, review: {} }),
      review: {},
      savedViews: views,
      images: { v1: image('View from Hwy 16.'), v2: image('Rec site.') },
      generatedAt: new Date(2026, 10, 11, 12),
    })
    const text = new TextDecoder('latin1').decode(new Uint8Array(fieldBriefPdf(brief, jspdf)))
    expect(text.startsWith('%PDF')).toBe(true)
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(1)
    expect((text.match(/\/I\d+ Do/g) ?? []).length).toBe(2)
  })

  it('still writes a brief with no viewpoint, run or openings', () => {
    const brief = buildFieldBrief({
      block,
      targets: [block],
      viewpoint: { ...road, coordinates: [] },
      landform: null,
      result: null,
      stale: false,
      assessment: null,
      review: undefined,
      savedViews: [],
      images: {},
      generatedAt: new Date(2026, 10, 11, 12),
    })
    expect(brief.viewpoints).toEqual([])
    const text = new TextDecoder('latin1').decode(new Uint8Array(fieldBriefPdf(brief, jspdf)))
    expect(text.startsWith('%PDF')).toBe(true)
  })

  it('names bearings by compass point', () => {
    expect(formatBearing(245)).toBe('245° (SW)')
    expect(formatBearing(-10)).toBe('350° (N)')
  })
})
