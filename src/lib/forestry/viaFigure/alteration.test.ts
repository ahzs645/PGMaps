import { describe, expect, it } from 'vitest'

import {
  ALTERATION_RULES,
  alteration,
  checkPrintedAlteration,
  formatAlteration,
  ruleNetOf,
  sceneSheetRule,
} from './alteration'

const R = ALTERATION_RULES

// Areas and printed figures as the reference documents print them (cited by document number).
describe('alteration rules reproduce the reference documents', () => {
  it.each([
    // 03: (proposed + existing) / landform, pixels
    [R.grossPixels, { landform: 371073, proposed: 18740, nonVeg: 0 }, 5.05],
    [R.grossPixels, { landform: 590161, proposed: 45920, nonVeg: 0 }, 7.78],
    [R.grossPixels, { landform: 1642069, proposed: 203195, nonVeg: 0 }, 12.37],
    // 22: net of private land, pixels
    [R.netOfPrivatePixels, { landform: 238896, privateLand: 23031, proposed: 1114, nonVeg: 0 }, 0.52],
    [R.netOfPrivatePixels, { landform: 166538, privateLand: 57419, proposed: 0, nonVeg: 0 }, 0],
    // 05: net of rock and private land, cm²
    [R.netOfRockAndPrivateCm2, { landform: 168, rock: 24, proposed: 1.9, nonVeg: 0 }, 1.3],
    [R.netOfRockAndPrivateCm2, { landform: 303, rock: 27, proposed: 10.7, nonVeg: 0 }, 3.9],
    // 06 VP2
    [R.netOfRockAndPrivateCm2, { landform: 155, rock: 27, proposed: 10.0, nonVeg: 0 }, 7.8],
    // 07: net of rock, cm²
    [R.netOfRockCm2, { landform: 374, rock: 15, proposed: 10.0, nonVeg: 0 }, 2.8],
    // 09: gross VLU, existing counted
    [R.grossCm2, { landform: 241.32, rock: 27.26, proposed: 23.23, nonVeg: 7.03 }, 12.5],
    [R.grossCm2, { landform: 875.32, rock: 33.16, proposed: 212.12, nonVeg: 105.69 }, 36.3],
    // 23: total printed as the sum of the rounded parts
    [R.grossPixelsSumOfParts, { landform: 28054, proposed: 254, nonVeg: 471 }, 2.59],
  ])('%#: %s', (rule, areas, printed) => {
    const check = checkPrintedAlteration(rule, areas, printed)
    expect(check.note).toBe('Reproduced.')
    expect(check.matches).toBe(true)
  })

  it("names the arithmetic behind a document's own slips", () => {
    // 22 Captain Island: 0.326% printed 0.32.
    const truncated = checkPrintedAlteration(
      R.netOfPrivatePixels,
      { landform: 120991, privateLand: 42763, proposed: 255, nonVeg: 0 },
      0.32,
    )
    expect(truncated.matches).toBe(false)
    expect(truncated.reproduced).toBe('0.33')
    expect(truncated.explainedBy?.how).toBe('truncated rather than rounded')

    // 23 Oyster Bay under a plain rounding rule: the printed total is the sum of rounded parts.
    const summed = checkPrintedAlteration(R.grossPixels, { landform: 28054, proposed: 254, nonVeg: 471 }, 2.59)
    expect(summed.explainedBy?.how).toBe('sum of the rounded parts')

    // 09 prints a net VLU but divides by the gross: under a net-of-rock rule the check says so.
    const gross = checkPrintedAlteration(
      R.netOfRockCm2,
      { landform: 241.32, rock: 27.26, proposed: 23.23, nonVeg: 7.03 },
      12.5,
    )
    expect(gross.explainedBy?.how).toBe('divided by the gross landform')

    // 07 VP1: 5 / 271 = 1.845% printed 1.9.
    const twice = checkPrintedAlteration(R.netOfRockCm2, { landform: 294, rock: 23, proposed: 5.0, nonVeg: 0 }, 1.9)
    expect(twice.explainedBy?.how).toBe('rounded twice')

    // 23 Piper Point: 1.94% printed, 1.80% from its own areas, and no single change explains it.
    const none = checkPrintedAlteration(R.grossPixelsSumOfParts, { landform: 86255, proposed: 788, nonVeg: 766 }, 1.94)
    expect(none.matches).toBe(false)
    expect(none.explainedBy).toBeNull()
  })

  it("prints 22's parts over the gross landform and its total over the net", () => {
    const result = alteration(R.netOfPrivatePixels, {
      landform: 101153,
      privateLand: 55889,
      proposed: 517,
      nonVeg: 0,
    })!
    expect(result.printed).toBe('1.14')
    expect(result.parts.find((part) => part.part === 'proposed')?.printed).toBe('0.51')
  })

  it('returns null with nothing to divide by', () => {
    expect(alteration(R.netOfPrivatePixels, { landform: 10, privateLand: 10, proposed: 1, nonVeg: 0 })).toBeNull()
  })

  it('truncates without float error tipping the last digit', () => {
    expect(formatAlteration(0.29, { decimals: 2, rounding: 'truncate' })).toBe('0.29')
    expect(formatAlteration(1.005, { decimals: 2, rounding: 'round' })).toBe('1.00')
  })
})

describe('a rule netted for the scene', () => {
  it('keeps the style’s arithmetic and names what leaves the landform', () => {
    const net = ruleNetOf(R.grossPixels, ['privateLand', 'rock'])
    expect(net).toMatchObject({
      deduct: ['rock', 'privateLand'],
      unit: 'px',
      decimals: 2,
      basis: 'landform net of rock and private land',
      formula: '(NonVEG + Proposed Blocks) / (Landform - Rock and Private Land)',
    })
    expect(
      alteration(net, { landform: 369494, privateLand: 20000, rock: 9017, proposed: 45755, nonVeg: 0 })?.printed,
    ).toBe('13.44')
    expect(ruleNetOf(R.netOfRockAndPrivateCm2, ['privateLand', 'rock'])).toBe(R.netOfRockAndPrivateCm2)
    expect(ruleNetOf(R.netOfRockCm2, []).basis).toBe('gross landform')
  })

  it('follows the scene only when it takes private land out of its denominators', () => {
    expect(sceneSheetRule(R.grossPixels, null)).toBe(R.grossPixels)
    expect(sceneSheetRule(R.grossPixels, { perspectiveDenominator: 'non-vegetated-out' })).toBe(R.grossPixels)
    expect(sceneSheetRule(R.grossPixels, { privateLandOutOfDenominator: true }).deduct).toEqual(['rock', 'privateLand'])
    expect(sceneSheetRule(R.netOfRockAndPrivateCm2, { privateLandOutOfDenominator: true })).toBe(
      R.netOfRockAndPrivateCm2,
    )
  })
})
