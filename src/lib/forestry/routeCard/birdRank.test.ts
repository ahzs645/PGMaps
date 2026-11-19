import { describe, expect, it } from 'vitest'

import { BIRD_NEST_RANK, estimateNestRank } from './birdRank'

const stand = (age: number, height: number, species: Array<[string, number]>, level2 = 'T') => ({
  BCLCS_LEVEL_2: level2,
  PROJ_AGE_1: age,
  PROJ_HEIGHT_1: height,
  ...Object.fromEntries(
    species.flatMap(([code, pct], i) => [
      [`SPECIES_CD_${i + 1}`, code],
      [`SPECIES_PCT_${i + 1}`, pct],
    ]),
  ),
})

describe('estimated migratory bird nest rank', () => {
  it('ranks open ground and stands without an age or height as nothing', () => {
    expect(estimateNestRank(stand(120, 25, [['SX', 100]], 'N'))).toBeNull()
    expect(estimateNestRank({ BCLCS_LEVEL_2: 'T', PROJ_AGE_1: null, PROJ_HEIGHT_1: 20, SPECIES_CD_1: 'SX' })).toBeNull()
  })
  it('raises the rank with age and height, as the stated rule says', () => {
    expect(estimateNestRank(stand(20, 4, [['SX', 100]]))).toBe(2)
    expect(estimateNestRank(stand(100, 15, [['SX', 100]]))).toBe(3)
    expect(estimateNestRank(stand(100, 22, [['SX', 100]]))).toBe(4)
    expect(
      estimateNestRank(
        stand(180, 30, [
          ['SX', 70],
          ['BL', 30],
        ]),
      ),
    ).toBe(5)
  })
  it('lowers pure pine and black spruce stands and raises a deciduous share', () => {
    expect(
      estimateNestRank(
        stand(100, 22, [
          ['PLI', 80],
          ['SX', 20],
        ]),
      ),
    ).toBe(3)
    expect(
      estimateNestRank(
        stand(100, 22, [
          ['SB', 60],
          ['PLI', 40],
        ]),
      ),
    ).toBe(3)
    expect(
      estimateNestRank(
        stand(100, 22, [
          ['SX', 60],
          ['AT', 40],
        ]),
      ),
    ).toBe(5)
  })
  it('stays within 1 to 6 and states its assumption and calibration', () => {
    expect(
      estimateNestRank(
        stand(300, 40, [
          ['SX', 50],
          ['AT', 50],
        ]),
      ),
    ).toBe(6)
    expect(
      estimateNestRank(
        stand(10, 2, [
          ['SB', 80],
          ['PLI', 20],
        ]),
      ),
    ).toBe(1)
    expect(BIRD_NEST_RANK.assumption).toMatch(/not published/)
    expect(BIRD_NEST_RANK.calibration).toMatch(/4 of 11 exact/)
  })
})
