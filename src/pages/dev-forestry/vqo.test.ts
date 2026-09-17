import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VISUAL_QUALITY_THRESHOLDS,
  VISUAL_QUALITY_CLASSES,
  assessObjective,
  classifyAlteration,
  thresholdFor,
  viewingZoneFor,
  visualQualityClass,
  type VisualQualityThresholds,
} from './vqo'

describe('classifyAlteration', () => {
  it('returns the most restrictive class the alteration still satisfies', () => {
    expect(classifyAlteration(0.4)?.id).toBe('preservation')
    expect(classifyAlteration(1)?.id).toBe('preservation')
    expect(classifyAlteration(1.1)?.id).toBe('retention')
    expect(classifyAlteration(5)?.id).toBe('retention')
    expect(classifyAlteration(12)?.id).toBe('partial-retention')
    expect(classifyAlteration(20)?.id).toBe('modification')
    expect(classifyAlteration(38)?.id).toBe('maximum-modification')
  })

  it('has no class left above maximum modification', () => {
    expect(classifyAlteration(55)).toBeNull()
    expect(classifyAlteration(Number.NaN)).toBeNull()
  })

  it('follows edited thresholds, including ones that reorder the classes', () => {
    const strict: VisualQualityThresholds = {
      ...DEFAULT_VISUAL_QUALITY_THRESHOLDS,
      retention: 2,
      'partial-retention': 8,
    }
    expect(classifyAlteration(5, strict)?.id).toBe('partial-retention')
    expect(thresholdFor('retention', strict)).toBe(2)
  })
})

describe('assessObjective', () => {
  it('passes an alteration under the objective and reports the headroom left', () => {
    const verdict = assessObjective(9, 'partial-retention')
    expect(verdict.met).toBe(true)
    expect(verdict.thresholdPercent).toBe(15)
    expect(verdict.headroomPercent).toBe(6)
    expect(verdict.achieved?.id).toBe('partial-retention')
  })

  it('fails an alteration over the objective and names what it achieves instead', () => {
    const verdict = assessObjective(22, 'retention')
    expect(verdict.met).toBe(false)
    expect(verdict.headroomPercent).toBeLessThan(0)
    expect(verdict.achieved?.id).toBe('modification')
  })

  it('treats a missing number as not meeting the objective', () => {
    expect(assessObjective(Number.NaN, 'retention').met).toBe(false)
  })
})

describe('visualQualityClass', () => {
  it('exposes every class in order of increasing alteration', () => {
    const thresholds = VISUAL_QUALITY_CLASSES.map((entry) => entry.maxAlterationPercent)
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds)
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
