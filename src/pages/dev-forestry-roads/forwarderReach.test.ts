import { describe, expect, it } from 'vitest'
import {
  craneOffsets,
  DEFAULT_FORWARDER_RULE,
  freeTravelSlopePercent,
  sideSlopePercent,
  steepestDrivenPercent,
  validateForwarderRule,
  widestRunAngleDeg,
} from './forwarderReach'

describe('forwarder rules', () => {
  it('drives freely within all three limits and runs no steeper than the largest', () => {
    expect(freeTravelSlopePercent(DEFAULT_FORWARDER_RULE)).toBe(15)
    expect(steepestDrivenPercent(DEFAULT_FORWARDER_RULE)).toBe(40)
  })

  it('reads the slope across a run from the gradient square to it', () => {
    // A 20 % slope rising north: none across a run up the fall line, all of it across a contour run.
    expect(sideSlopePercent(0, 1, 0, 0.2)).toBeCloseTo(0, 12)
    expect(sideSlopePercent(1, 0, 0, 0.2)).toBeCloseTo(20, 12)
    const a = (widestRunAngleDeg(20, DEFAULT_FORWARDER_RULE) * Math.PI) / 180
    expect(sideSlopePercent(Math.sin(a), Math.cos(a), 0, 0.2)).toBeCloseTo(15, 9)
    // Within the side limit any direction passes.
    expect(widestRunAngleDeg(12, DEFAULT_FORWARDER_RULE)).toBe(90)
  })

  it('lists crane cells by centre distance', () => {
    expect(craneOffsets(5, 8).map((o) => o.d.toFixed(2))).toEqual([...Array(4).fill('5.00'), ...Array(4).fill('7.07')])
    expect(craneOffsets(10, 8)).toEqual([])
  })

  it('names the field out of range', () => {
    expect(() => validateForwarderRule({ ...DEFAULT_FORWARDER_RULE, craneReachM: 1 })).toThrow(/crane reach/)
    expect(() => validateForwarderRule({ ...DEFAULT_FORWARDER_RULE, sideSlopePercent: 0 })).toThrow(/side-slope/)
    expect(() => validateForwarderRule({ ...DEFAULT_FORWARDER_RULE, reachM: 5000 })).toThrow(/forwarding reach/)
  })
})
