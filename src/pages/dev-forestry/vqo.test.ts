import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VISUAL_QUALITY_THRESHOLDS,
  VISUAL_QUALITY_CLASSES,
  assessObjective,
  classifyAlteration,
  partialCutClass,
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

describe('partialCutClass', () => {
  it('reads the 2013 guide grid', () => {
    // Light removal among short residuals stays in retention.
    expect(partialCutClass(10, 5)?.id).toBe('retention')
    expect(partialCutClass(10, 45)?.id).toBe('partial-retention')
    expect(partialCutClass(50, 5)?.id).toBe('partial-retention')
    expect(partialCutClass(90, 50)?.id).toBe('modification')
  })

  it('degrades the class as more volume comes out of the same stand', () => {
    expect(partialCutClass(20, 25)?.id).toBe('partial-retention')
    expect(partialCutClass(60, 30)?.id).toBe('modification')
  })

  it('has nothing to say below the grid', () => {
    expect(partialCutClass(5, 20)).toBeNull()
    expect(partialCutClass(Number.NaN, 20)).toBeNull()
  })

  it('clamps rather than falling off the ends of the grid', () => {
    expect(partialCutClass(200, 200)?.id).toBe('modification')
    expect(partialCutClass(10, 1)?.id).toBe('retention')
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
