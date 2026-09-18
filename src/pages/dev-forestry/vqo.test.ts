import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VISUAL_QUALITY_THRESHOLDS,
  VISUAL_QUALITY_CLASSES,
  assessObjective,
  classifyAlteration,
  partialCutClass,
  partialCutEquivalentPercent,
  rangeFloorFor,
  thresholdFor,
  vacDenudationPercent,
  vegHeightForSlope,
  viewingZoneFor,
  visualQualityClass,
  type VisualQualityThresholds,
} from './vqo'

describe('the two alteration scales', () => {
  it('carries the 2013 guide perspective ranges', () => {
    // A Guide to Visual Quality Objectives, QP371691 Mar/2013.
    expect(VISUAL_QUALITY_CLASSES.map((entry) => entry.perspectiveMaxPercent)).toEqual([0, 1.5, 7, 18, 30])
  })

  it('carries the 1998 Table 3 planimetric ranges', () => {
    // Procedures for Factoring Visual Resources into Timber Supply Analyses.
    expect(VISUAL_QUALITY_CLASSES.map((entry) => entry.planimetricMaxPercent)).toEqual([1, 5, 15, 25, 40])
  })

  it('keeps every planimetric threshold looser than its perspective twin', () => {
    // This is the whole reason the two are tracked apart: judging a
    // perspective number against a planimetric threshold passes alterations
    // that the objective does not allow.
    for (const entry of VISUAL_QUALITY_CLASSES) {
      expect(entry.planimetricMaxPercent).toBeGreaterThan(entry.perspectiveMaxPercent)
    }
  })

  it('reports each class range floor from the class below it', () => {
    expect(rangeFloorFor('preservation', 'perspective')).toBe(0)
    expect(rangeFloorFor('partial-retention', 'perspective')).toBe(1.5)
    expect(rangeFloorFor('partial-retention', 'planimetric')).toBe(5)
    expect(rangeFloorFor('maximum-modification', 'planimetric')).toBe(25)
  })
})

describe('classifyAlteration', () => {
  it('splits the perspective ranges where the 2013 guide does', () => {
    expect(classifyAlteration(0, 'perspective')?.id).toBe('preservation')
    expect(classifyAlteration(1.4, 'perspective')?.id).toBe('retention')
    expect(classifyAlteration(1.5, 'perspective')?.id).toBe('retention')
    expect(classifyAlteration(1.6, 'perspective')?.id).toBe('partial-retention')
    expect(classifyAlteration(7, 'perspective')?.id).toBe('partial-retention')
    expect(classifyAlteration(12, 'perspective')?.id).toBe('modification')
    expect(classifyAlteration(25, 'perspective')?.id).toBe('maximum-modification')
    expect(classifyAlteration(31, 'perspective')).toBeNull()
  })

  it('splits the planimetric ranges where Table 3 does', () => {
    expect(classifyAlteration(0.9, 'planimetric')?.id).toBe('preservation')
    expect(classifyAlteration(4, 'planimetric')?.id).toBe('retention')
    expect(classifyAlteration(12, 'planimetric')?.id).toBe('partial-retention')
    expect(classifyAlteration(20, 'planimetric')?.id).toBe('modification')
    expect(classifyAlteration(38, 'planimetric')?.id).toBe('maximum-modification')
    expect(classifyAlteration(55, 'planimetric')).toBeNull()
  })

  it('reads the same alteration differently on each scale', () => {
    // 12% is modification in perspective view but only partial retention
    // planimetrically — the mistake this split exists to prevent.
    expect(classifyAlteration(12, 'perspective')?.id).toBe('modification')
    expect(classifyAlteration(12, 'planimetric')?.id).toBe('partial-retention')
  })

  it('follows edited thresholds, including ones that reorder the classes', () => {
    const strict: VisualQualityThresholds = {
      ...DEFAULT_VISUAL_QUALITY_THRESHOLDS,
      planimetric: { ...DEFAULT_VISUAL_QUALITY_THRESHOLDS.planimetric, retention: 2, 'partial-retention': 8 },
    }
    expect(classifyAlteration(5, 'planimetric', strict)?.id).toBe('partial-retention')
    expect(thresholdFor('retention', 'planimetric', strict)).toBe(2)
    // Editing one basis leaves the other alone.
    expect(thresholdFor('retention', 'perspective', strict)).toBe(1.5)
  })
})

describe('assessObjective', () => {
  it('passes an alteration under the objective and reports the headroom left', () => {
    const verdict = assessObjective(4.2, 'partial-retention', 'perspective')
    expect(verdict.met).toBe(true)
    expect(verdict.thresholdPercent).toBe(7)
    expect(verdict.headroomPercent).toBeCloseTo(2.8, 10)
    expect(verdict.achieved?.id).toBe('partial-retention')
  })

  it('fails the same alteration against a stricter objective', () => {
    const verdict = assessObjective(4.2, 'retention', 'perspective')
    expect(verdict.met).toBe(false)
    expect(verdict.headroomPercent).toBeLessThan(0)
    expect(verdict.achieved?.id).toBe('partial-retention')
  })

  it('treats a missing number as not meeting the objective', () => {
    expect(assessObjective(Number.NaN, 'retention', 'perspective').met).toBe(false)
  })
})

describe('vacDenudationPercent', () => {
  it('narrows a class range to the single Table 4 figure', () => {
    expect(vacDenudationPercent('partial-retention', 'low')).toBe(5.1)
    expect(vacDenudationPercent('partial-retention', 'medium')).toBe(10)
    expect(vacDenudationPercent('partial-retention', 'high')).toBe(15)
    expect(vacDenudationPercent('preservation', 'medium')).toBe(0.5)
    expect(vacDenudationPercent('maximum-modification', 'medium')).toBe(32.5)
  })

  it('falls back to the class maximum where the inventory has no VAC rating', () => {
    expect(vacDenudationPercent('partial-retention', null)).toBe(15)
  })

  it('never lets a lower VAC allow more denudation than a higher one', () => {
    for (const entry of VISUAL_QUALITY_CLASSES) {
      expect(entry.vacDenudationPercent.low).toBeLessThanOrEqual(entry.vacDenudationPercent.medium)
      expect(entry.vacDenudationPercent.medium).toBeLessThanOrEqual(entry.vacDenudationPercent.high)
      // The high-VAC figure is the top of the class's planimetric range.
      expect(entry.vacDenudationPercent.high).toBe(entry.planimetricMaxPercent)
    }
  })
})

describe('vegHeightForSlope', () => {
  it('follows Table 6 from flat ground to steep', () => {
    expect(vegHeightForSlope(0)).toBe(3.0)
    expect(vegHeightForSlope(5)).toBe(3.0)
    expect(vegHeightForSlope(6)).toBe(3.5)
    expect(vegHeightForSlope(20)).toBe(4.5)
    expect(vegHeightForSlope(40)).toBe(6.5)
    expect(vegHeightForSlope(60)).toBe(8.0)
    expect(vegHeightForSlope(85)).toBe(8.5)
  })

  it('never asks for shorter trees on steeper ground', () => {
    let previous = 0
    for (let slope = 0; slope <= 100; slope += 1) {
      const height = vegHeightForSlope(slope)
      expect(height).toBeGreaterThanOrEqual(previous)
      previous = height
    }
  })
})

describe('partialCutEquivalentPercent', () => {
  it('reads FS1252 Table 4 at its corners', () => {
    expect(partialCutEquivalentPercent(10, 5)).toBe(0.1)
    expect(partialCutEquivalentPercent(10, 50)).toBe(2.2)
    expect(partialCutEquivalentPercent(90, 5)).toBe(8.0)
    expect(partialCutEquivalentPercent(90, 50)).toBe(17.0)
  })

  it('rises with volume removed and with residual height alike', () => {
    // Taller residuals read as a heavier alteration for the same removal,
    // because what is taken out leaves a bigger hole in a taller canopy.
    expect(partialCutEquivalentPercent(50, 5)).toBe(1.8)
    expect(partialCutEquivalentPercent(50, 30)).toBe(6.2)
    expect(partialCutEquivalentPercent(20, 30)).toBe(1.4)
    expect(partialCutEquivalentPercent(80, 30)).toBe(11.0)
  })

  it('reads the nearest cell rather than interpolating, as the form does', () => {
    expect(partialCutEquivalentPercent(52, 26)).toBe(partialCutEquivalentPercent(50, 25))
  })

  it('has nothing to say below the table', () => {
    expect(partialCutEquivalentPercent(5, 20)).toBeNull()
    expect(partialCutEquivalentPercent(Number.NaN, 20)).toBeNull()
  })

  it('clamps rather than falling off the ends', () => {
    expect(partialCutEquivalentPercent(200, 200)).toBe(17.0)
    expect(partialCutEquivalentPercent(10, 1)).toBe(0.1)
  })
})

describe('partialCutClass', () => {
  it('derives the class from the equivalent, matching the form’s shading', () => {
    expect(partialCutClass(10, 5)?.id).toBe('retention')
    expect(partialCutClass(10, 45)?.id).toBe('partial-retention')
    expect(partialCutClass(50, 5)?.id).toBe('partial-retention')
    expect(partialCutClass(90, 50)?.id).toBe('modification')
  })

  it('keeps a light cut among mid-height residuals in retention', () => {
    // 20% removed at 25 m is 1.2% equivalent, inside retention's 0–1.5 range.
    // The hand-transcribed class grid this replaced had it as partial
    // retention, which the form's own numbers contradict.
    expect(partialCutEquivalentPercent(20, 25)).toBe(1.2)
    expect(partialCutClass(20, 25)?.id).toBe('retention')
  })

  it('degrades the class as more volume comes out of the same stand', () => {
    expect(partialCutClass(30, 30)?.id).toBe('partial-retention')
    expect(partialCutClass(60, 30)?.id).toBe('modification')
  })

  it('cannot disagree with the equivalent it came from', () => {
    for (const volume of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
      for (const height of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
        const equivalent = partialCutEquivalentPercent(volume, height)
        expect(partialCutClass(volume, height)).toEqual(classifyAlteration(equivalent!, 'perspective'))
      }
    }
  })

  it('has nothing to say below the table', () => {
    expect(partialCutClass(5, 20)).toBeNull()
    expect(partialCutClass(Number.NaN, 20)).toBeNull()
  })
})

describe('visualQualityClass', () => {
  it('exposes every class in order of increasing alteration', () => {
    const perspective = VISUAL_QUALITY_CLASSES.map((entry) => entry.perspectiveMaxPercent)
    expect([...perspective].sort((a, b) => a - b)).toEqual(perspective)
    expect(visualQualityClass('preservation').code).toBe('P')
  })

  it('throws on an unknown class rather than guessing one', () => {
    expect(() => visualQualityClass('scenic' as never)).toThrow(/Unknown visual quality class/)
  })
})

describe('viewingZoneFor', () => {
  it('splits the view into foreground, middleground, and background', () => {
    expect(viewingZoneFor(0).id).toBe('foreground')
    expect(viewingZoneFor(999).id).toBe('foreground')
    expect(viewingZoneFor(1000).id).toBe('middleground')
    expect(viewingZoneFor(7999).id).toBe('middleground')
    expect(viewingZoneFor(8000).id).toBe('background')
    expect(viewingZoneFor(50000).id).toBe('background')
  })
})
