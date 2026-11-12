import { describe, expect, it } from 'vitest'

import {
  carryFieldGreenUp,
  fieldGreenUpInput,
  fieldGreenUpIssue,
  formatFieldDate,
  greenUpBasis,
  greenUpBasisLine,
  greenUpReading,
  parseFieldGreenUp,
  runGreenUpBasis,
  runGreenUpReadings,
  type FieldGreenUp,
} from './greenUp'
import { alterationWeight } from './integrity'
import { createEmptyScene, parseScene, serializeScene, type ForestryScene } from './scene'
import { buildSceneInput, sceneFingerprint } from './sceneInput'
import type { AnalysisResult, TargetPolygon } from './types'

const box: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.7, 53.9],
      [-122.69, 53.9],
      [-122.69, 53.91],
      [-122.7, 53.91],
      [-122.7, 53.9],
    ],
  ],
}

function opening(patch: Partial<TargetPolygon> = {}): TargetPolygon {
  return {
    id: 'o1',
    name: 'Cutblock 123 (2004)',
    role: 'harvested',
    objectiveId: 'partial-retention',
    vac: null,
    harvestYear: 2004,
    clearcutPercent: 100,
    geometry: box,
    source: 'test',
    ...patch,
  }
}

const checked: FieldGreenUp = {
  finding: 'percent',
  greenedUpPercent: 60,
  observedOn: '2026-11-12',
  observedBy: 'J. Smith',
  note: 'Pine 4–5 m, well stocked.',
}

const empty = createEmptyScene()
function scene(targets: TargetPolygon[]): ForestryScene {
  return { ...empty, assessmentYear: 2026, targets }
}

describe('parseFieldGreenUp', () => {
  it('drops anything unreadable, so older scenes load unchanged', () => {
    expect(parseFieldGreenUp(undefined)).toBeUndefined()
    expect(parseFieldGreenUp(null)).toBeUndefined()
    expect(parseFieldGreenUp('yes')).toBeUndefined()
    expect(parseFieldGreenUp({ finding: 'maybe' })).toBeUndefined()
  })

  it('fixes the share from a yes or no, clamps a percent, and blanks a bad date', () => {
    expect(
      parseFieldGreenUp({ finding: 'yes', greenedUpPercent: 12, observedOn: '2026-11-12', observedBy: ' A ' }),
    ).toEqual({ finding: 'yes', greenedUpPercent: 100, observedOn: '2026-11-12', observedBy: 'A' })
    expect(parseFieldGreenUp({ finding: 'no', observedOn: '2026-02-30' })).toEqual({
      finding: 'no',
      greenedUpPercent: 0,
      observedOn: '',
      observedBy: '',
    })
    expect(parseFieldGreenUp({ finding: 'percent', greenedUpPercent: 140 })?.greenedUpPercent).toBe(100)
    expect(parseFieldGreenUp({ finding: 'percent', greenedUpPercent: 'x' })?.greenedUpPercent).toBeNull()
  })
})

describe('field check against the model', () => {
  it('overrides the green-up age once dated and signed, and keeps the modelled share', () => {
    const target = opening({ fieldGreenUp: checked })
    // 22 years old against a 20-year age: the model calls it greened up and counts nothing.
    expect(alterationWeight(opening(), 2026, 20)).toBe(0)
    expect(alterationWeight(target, 2026, 20)).toBeCloseTo(0.4)
    const reading = greenUpReading(target, 2026, 20)
    expect(reading.used).toBe('field')
    expect(reading.greenedUpPercent).toBe(60)
    expect(reading.label).toBe('field-confirmed 12 Nov 2026 by J. Smith')
    expect(reading.modelled).toEqual({
      greenedUpPercent: 100,
      basis: 'age',
      detail: 'harvested 2004, 22 yr ≥ 20-yr green-up age',
    })
  })

  it('overrides a supplied estimate, and a "not greened up" counts the whole clearcut share', () => {
    const target = opening({
      clearcutPercent: 80,
      recoveryPercent: 50,
      fieldGreenUp: { finding: 'no', greenedUpPercent: 0, observedOn: '2026-06-01', observedBy: 'R. Lee' },
    })
    expect(alterationWeight(target, 2026, 20)).toBeCloseTo(0.8)
    expect(greenUpReading(target, 2026, 20).modelled.detail).toBe('supplied recovery estimate 50%')
  })

  it('leaves the model in charge while the check is a draft, and says why', () => {
    const draft = opening({ harvestYear: 2015, fieldGreenUp: { ...checked, observedBy: '' } })
    expect(alterationWeight(draft, 2026, 20)).toBe(1)
    const reading = greenUpReading(draft, 2026, 20)
    expect(reading.used).toBe('modelled')
    expect(reading.fieldIssue).toBe('Enter who checked it.')
    expect(reading.label).toBe('modelled (harvested 2015, 11 yr < 20-yr green-up age)')
    expect(fieldGreenUpIssue({ ...checked, greenedUpPercent: null }, 2026)).toBe('Enter the share greened up.')
    expect(fieldGreenUpIssue({ ...checked, observedOn: '' }, 2026)).toBe('Enter the date of the field check.')
  })

  it('does not carry a check back to an assessment year before it was made', () => {
    const target = opening({ harvestYear: 2015, fieldGreenUp: checked })
    expect(alterationWeight(target, 2025, 20)).toBe(1)
    expect(greenUpReading(target, 2025, 20).fieldIssue).toMatch(/after the 2025 assessment year/)
  })

  it('agrees with alterationWeight wherever the opening counts', () => {
    const cases: Array<Partial<TargetPolygon>> = [
      {},
      { harvestYear: null },
      { harvestYear: 2030 },
      { recoveryPercent: 25, clearcutPercent: 40 },
      { fieldGreenUp: checked, clearcutPercent: 50 },
      { fieldGreenUp: { ...checked, finding: 'yes', greenedUpPercent: 100 } },
      { fieldGreenUp: { ...checked, observedOn: '2027-01-01' }, harvestYear: 2012 },
    ]
    for (const patch of cases) {
      const target = opening(patch)
      const reading = greenUpReading(target, 2026, 20)
      const clearcut = (target.clearcutPercent ?? 100) / 100
      const expected = reading.greenedUpPercent === null ? 0 : clearcut * (1 - reading.greenedUpPercent / 100)
      expect(alterationWeight(target, 2026, 20)).toBeCloseTo(expected)
    }
  })
})

describe('run inputs', () => {
  it('passes only a complete check to the run, without its note', () => {
    expect(fieldGreenUpInput(checked)).toEqual({
      finding: 'percent',
      greenedUpPercent: 60,
      observedOn: '2026-11-12',
      observedBy: 'J. Smith',
    })
    expect(fieldGreenUpInput({ ...checked, observedOn: '' })).toBeUndefined()
    const input = buildSceneInput(scene([opening({ fieldGreenUp: checked })]))
    expect(input.targets[0].fieldGreenUp).toEqual(fieldGreenUpInput(checked))
    expect(buildSceneInput(scene([opening()])).targets[0]).not.toHaveProperty('fieldGreenUp')
  })

  it('stales the run when a check is completed or changed, never for its note or a draft', () => {
    const base = sceneFingerprint(scene([opening()]))
    const draft = sceneFingerprint(scene([opening({ fieldGreenUp: { ...checked, observedBy: '' } })]))
    const complete = sceneFingerprint(scene([opening({ fieldGreenUp: checked })]))
    const renoted = sceneFingerprint(scene([opening({ fieldGreenUp: { ...checked, note: 'Different' } })]))
    const redated = sceneFingerprint(scene([opening({ fieldGreenUp: { ...checked, observedOn: '2026-11-13' } })]))
    expect(draft).toBe(base)
    expect(complete).not.toBe(base)
    expect(renoted).toBe(complete)
    expect(redated).not.toBe(complete)
  })

  it('round-trips through a scene file and drops a broken record', () => {
    const saved = JSON.parse(serializeScene(scene([opening({ fieldGreenUp: checked })])))
    expect(parseScene(saved)?.targets[0].fieldGreenUp).toEqual(checked)
    saved.targets[0].fieldGreenUp = { finding: 42 }
    expect(parseScene(saved)?.targets[0]).not.toHaveProperty('fieldGreenUp')
  })
})

describe('labels', () => {
  it('formats a field date without the locale or time zone', () => {
    expect(formatFieldDate('2026-11-12')).toBe('12 Nov 2026')
    expect(formatFieldDate('2026-01-05')).toBe('5 Jan 2026')
  })

  it('names line c as modelled, field-confirmed, or both', () => {
    const field = greenUpReading(opening({ fieldGreenUp: checked }), 2026, 20)
    const modelled = greenUpReading(opening(), 2026, 20)
    expect(greenUpBasis([]).label).toBe('no existing openings counted')
    expect(greenUpBasisLine(greenUpBasis([]))).toBe('No existing openings counted')
    expect(greenUpBasis([modelled, modelled]).label).toBe('modelled')
    expect(greenUpBasis([field]).label).toBe('field-confirmed 12 Nov 2026 by J. Smith')
    expect(greenUpBasis([field, field]).label).toBe('field-confirmed 12 Nov 2026 by J. Smith (2 openings)')
    expect(greenUpBasis([field, modelled, modelled]).label).toBe(
      'field-confirmed for 1 of 3 openings (12 Nov 2026 by J. Smith), modelled for 2',
    )
    expect(greenUpBasisLine(greenUpBasis([modelled]))).toBe('Green-up modelled')
  })

  it('reads a run from its own input snapshot, leaving out openings that miss the landform', () => {
    const input = buildSceneInput(
      scene([
        opening({ fieldGreenUp: checked }),
        opening({ id: 'o2', name: 'Far away' }),
        opening({ id: 'o3', name: 'Not cut yet', harvestYear: 2030 }),
        opening({ id: 'road', name: 'Road', siteDisturbance: true }),
      ]),
    )
    const result = {
      inputSnapshot: input,
      targets: [
        { targetId: 'o1', outOfRange: false, areaInsideLandformMeters: 5000 },
        { targetId: 'o2', outOfRange: false, areaInsideLandformMeters: 0 },
        { targetId: 'o3', outOfRange: false, areaInsideLandformMeters: 5000 },
      ],
    } as unknown as AnalysisResult
    expect(runGreenUpReadings(result).map((entry) => entry.id)).toEqual(['o1'])
    expect(runGreenUpBasis(result).label).toBe('field-confirmed 12 Nov 2026 by J. Smith')
    expect(runGreenUpBasis(null).total).toBe(0)
  })
})

describe('carryFieldGreenUp', () => {
  it('follows a uniquely named opening across an inventory refresh', () => {
    const previous = [
      opening({ id: 'old1', fieldGreenUp: checked }),
      opening({ id: 'old2', name: 'Cutblock cutblock-4', fieldGreenUp: checked }),
    ]
    const next = [opening({ id: 'new1' }), opening({ id: 'new2', name: 'Cutblock cutblock-4' })]
    const carried = carryFieldGreenUp(previous, next)
    expect(carried[0].fieldGreenUp).toEqual(checked)
    // Position-made names are not stable, so the check is not guessed onto another opening.
    expect(carried[1].fieldGreenUp).toBeUndefined()
  })
})
