import { describe, expect, it } from 'vitest'
import {
  chosenValues,
  importReferenceCase,
  mergeReferences,
  parseReferenceRows,
  referenceArithmetic,
  referenceClass,
} from './referenceMeasurements'
import { comparisonFigures, comparisonSightline, type ReferenceComparison } from './referenceComparison'
import {
  imagePixel,
  imageRay,
  pixelError,
  projectTrace,
  refineAim,
  type ReferenceCamera,
  type RegistrationPoint,
} from './referenceProjection'
import { masksForLandform, parseMasks } from './assessmentMasks'
import { localOffset } from './photoPose'
import { treatmentTargets } from './referenceTreatment'
import { polygonAreaMeters } from './visibility'
import type { TargetPolygon } from './types'

// A made-up case: real assessments, their names and figures stay outside the repository.
const caseData = {
  id: 'case-b',
  doc: 'B',
  blockPages: { BLK1: 13 },
  reference: [
    {
      viewpoint: 'VP01',
      landform: 'L1',
      numerator: 12,
      denominator: 100,
      existingIncluded: false,
      proposedCm2: 12,
      existingNonVegCm2: 3,
    },
  ],
  referenceDetail_table5: [{ viewpoint: 'VP01', block: 'BLK1', final: 'Meets objective', rationale: 'Distant view' }],
}
const context = {
  views: [{ id: 'V', name: 'VP01' }],
  landforms: [{ id: 'L', name: 'L1' }],
  attachments: ['B study.pdf'],
}
const [row, detail] = importReferenceCase(caseData, context)
const comparison: ReferenceComparison = {
  savedAt: 'review date',
  reviewer: 'Reviewer',
  viewId: 'V',
  landformId: 'L',
  source: row.printed,
  selected: { ...row.printed },
  capture: {
    id: 'capture',
    name: 'VP01',
    viewId: 'V',
    landformId: 'L',
    landform: 'L1',
    renderer: 'PGMaps',
    savedAt: 'capture date',
    counts: { landform: 200, proposed: 32, nonVeg: 10, privateLand: 5, rock: 2 },
  },
  basis: { numerator: 'proposed', denominator: 'gross' },
  referenceNumerator: 'proposed',
  referenceDenominator: 'gross',
  referenceScale: 'perspective',
  benchmark: 'arithmetic',
  confirmed: true,
  evidence: [],
}
describe('historical review and sign-off', () => {
  it('upgrades existing source rows, keeps reviewer alternatives, citations and saved comparison operands', () => {
    const [updated, t5] = mergeReferences(
      [
        {
          ...row,
          printed: { viewpoint: 'VP01', landform: 'L1' },
          corrections: { denominator: '120' },
          origins: { denominator: 'Remeasured on p. 23' },
          useSource: ['denominator'],
          comparisons: [comparison],
        },
      ],
      [row, detail],
    )
    expect(t5.printed).toMatchObject({
      page: '13',
      source: 'B study.pdf',
      rationale: 'Distant view',
      finalDetermination: 'Meets objective',
    })
    expect(chosenValues(updated).denominator).toBe('100')
    const alternate = { ...updated, useSource: [] }
    expect(referenceArithmetic(chosenValues(alternate)).percentage).toBe(10)
    expect(referenceArithmetic(updated.printed).componentArea).toBeNull()
    expect(parseReferenceRows(JSON.parse(JSON.stringify([alternate])))[0].comparisons?.[0].selected.denominator).toBe(
      '100',
    )
    expect(referenceClass('P=0%, R<1.5%, PR<7%, M<18%, MM<30%', 1.5)).toBe('PR')
  })
  it('compares counts only for matching confirmed bases', () => {
    expect(comparisonFigures(comparison).difference).toBe(4)
    for (const change of [
      { confirmed: false },
      { referenceScale: 'plan' as const },
      { viewId: 'elsewhere' },
      { landformId: '' },
      { referenceDenominator: 'rock' as const },
      { selected: { ...row.printed, unit: 'ha' } },
      { selected: { ...row.printed, numeratorMode: 'Proposed and existing' } },
    ]) {
      expect(comparisonFigures({ ...comparison, ...change }).difference).toBeNull()
    }
  })
})
const camera: ReferenceCamera = {
  lng: 0,
  lat: 0,
  altitudeMeters: 100,
  bearing: 5,
  pitch: 0,
  roll: 5,
  projection: 'pinhole',
  span: 75,
  left: 10,
  top: 20,
  width: 900,
  height: 450,
}
const points: RegistrationPoint[] = [
  { lng: -0.002, lat: 0.01, elevation: 115, pixel: [0, 0], heldOut: false },
  { lng: 0.006, lat: 0.012, elevation: 105, pixel: [0, 0], heldOut: false },
  { lng: 0.003, lat: 0.015, elevation: 102, pixel: [0, 0], heldOut: true },
]
describe('registered reference images', () => {
  for (const projection of ['pinhole', 'cylindrical', 'equirectangular'] as const)
    it('round-trips pixels through the ' + projection + ' crop and fits without the held-out observation', () => {
      const c = { ...camera, projection }
      const measured = points.map((p) => ({ ...p, pixel: imagePixel(c, p)! }))
      const p = measured[1],
        delta = localOffset(c, p.lng, p.lat, p.elevation)
      imageRay(c, p.pixel).forEach((d, i) => expect(d).toBeCloseTo(delta[i] / Math.hypot(...delta), 8))
      const start = { ...c, bearing: 9, pitch: -3 }
      const fitted = refineAim(start, measured)
      expect(pixelError(fitted, measured[2])).toBeLessThan(0.2)
      const moved = measured.map((p) => (p.heldOut ? { ...p, pixel: [1, 1] as [number, number] } : p))
      expect(refineAim(start, moved)).toEqual(fitted)
    })
  it('keeps misses visible and refuses to bridge a gap in the polygon', () => {
    const pixels: [number, number][] = [
      [400, 200],
      [500, 210],
      [450, 240],
    ]
    expect(projectTrace({ ...camera, pitch: -30 }, pixels, { elevationAt: () => 0 }, 1000).geometry).toBeTruthy()
    const missing = projectTrace(camera, pixels, { elevationAt: () => NaN }, 1000)
    expect(missing.geometry).toBeNull()
    expect(missing.gaps.length).toBeGreaterThan(0)
  })
})
function target(id: string, west: number, east: number): TargetPolygon {
  return {
    id,
    name: id,
    role: 'block',
    objectiveId: 'partial-retention',
    vac: null,
    source: 'review',
    harvestYear: null,
    clearcutPercent: null,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, 0],
          [east, 0],
          [east, 0.01],
          [west, 0.01],
          [west, 0],
        ],
      ],
    },
  }
}
it('clips mixed treatments to the proposal, preserving reported removal units', () => {
  const parent = target('parent', 0, 0.02),
    unit = target('unit', 0.01, 0.04)
  const [remainder, treated] = treatmentTargets(parent, unit, {
    harvestSystem: 'partial',
    treesRemoved: '60',
    residualStems: '120',
    volumeRemoved: '30',
    residualHeight: '8',
  })
  expect(treated.volumeRemovedPercent).toBe(30)
  expect(polygonAreaMeters(remainder.geometry) + polygonAreaMeters(treated.geometry)).toBeCloseTo(
    polygonAreaMeters(parent.geometry),
    3,
  )
  expect(
    treatmentTargets(parent, unit, { harvestSystem: 'partial', treesRemoved: '60' })[1].volumeRemovedPercent,
  ).toBeNull()
})

it('keeps a traced rock deduction on its adopted face after reopening', () => {
  const shared = {
    id: 'retention',
    name: 'Retention',
    kind: 'retained',
    source: 'plan',
    geometry: target('a', 0, 0.02).geometry,
  }
  const masks = parseMasks([
    shared,
    { ...shared, id: 'rock', name: 'Rock', kind: 'natural', landformId: 'face-a', mappedRock: true },
  ])
  expect(masksForLandform(masks, 'face-a').map((m) => m.id)).toEqual(['retention', 'rock'])
  expect(masksForLandform(masks, 'face-b').map((m) => m.id)).toEqual(['retention'])
  expect(masks[1].mappedRock).toBe(true)
})

describe('the run’s sightline figure beside a comparison', () => {
  it('is the assessment’s only where the capture recorded that the run stood behind it', () => {
    expect(comparisonSightline({ sightlinePercent: 4.2, sightlineReadiness: 'ready' })).toEqual({
      percent: 4.2,
      assessment: true,
      note: null,
    })
    expect(
      comparisonSightline({ sightlinePercent: null, sightlineReadiness: 'withheld', sightlineWithheld: 'A gap.' }),
    ).toEqual({ percent: null, assessment: false, note: 'Withheld — A gap.' })
    // Kept without the readiness record: the run's reading, never called the assessment's figure.
    expect(comparisonSightline({ sightlinePercent: 4.2 })).toEqual({ percent: 4.2, assessment: false, note: null })
    expect(comparisonSightline({})).toEqual({ percent: null, assessment: false, note: 'not recorded with this figure' })
  })
})
