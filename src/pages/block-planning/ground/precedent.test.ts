import type { Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import { assignOpenings, describeOpening, sharesGround, type PrecedentRegion } from './precedent'
import { SLIVER_HA } from './record'

const square: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
}
const region = (instrument: string, feature: string, effective: string | null): PrecedentRegion => ({
  instrument,
  feature,
  effective,
  geometry: square,
})

describe('assigning openings to instruments', () => {
  it('counts from each feature its own date, keeps an opening with no harvest date and counts the earlier ones', () => {
    const regions = [region('a', 'a1', '2010-01-01'), region('a', 'a2', null), region('b', 'b1', '2015-06-01')]
    const openings = [
      { OPENING_ID: 1, DISTURBANCE_START_DATE: '2009-05-01Z' },
      { OPENING_ID: 2, DENUDATION_1_COMPLETION_DATE: '2012-01-01Z' },
      { OPENING_ID: 3 },
      { OPENING_ID: 4, DISTURBANCE_START_DATE: '2020-01-01Z' },
    ]
    // [region][opening] in hectares: 1 is in a1 only, 2 in a1 and b1, 3 in b1, 4 in a2.
    const overlapHa = [
      [2, 1, 0, 0],
      [0, 0, 0, 3],
      [0, 0.5, 4, 0],
    ]
    const rows = assignOpenings(regions, overlapHa, openings, { a: true, b: true })
    expect(rows).toEqual([
      { instrument: 'a', since: '2010-01-01', dated: true, openings: [2, 4], earlier: 1, touching: 0 },
      { instrument: 'b', since: '2015-06-01', dated: true, openings: [3], earlier: 1, touching: 0 },
    ])
  })

  it('leaves out an opening that touches an instrument only by a sliver, and counts it', () => {
    const regions = [region('a', 'a1', null), region('a', 'a2', null), region('b', 'b1', null)]
    const openings = [{ OPENING_ID: 1 }, { OPENING_ID: 2 }, { OPENING_ID: 3 }]
    // 1 touches a1 by 66 m² and a2 by 11 m²; 2 touches a1 by 66 m² but lies 1 ha in a2; 3 shares 100 m² with b1.
    const overlapHa = [
      [0.0066, 0.0066, 0],
      [0.0011, 1, 0],
      [0, 0, SLIVER_HA],
    ]
    expect(assignOpenings(regions, overlapHa, openings, {})).toEqual([
      { instrument: 'a', dated: false, openings: [2], earlier: 0, touching: 1 },
      { instrument: 'b', dated: false, openings: [3], earlier: 0, touching: 0 },
    ])
    expect(sharesGround(SLIVER_HA)).toBe(true)
    expect(sharesGround(SLIVER_HA * 0.99)).toBe(false)
  })
})

describe('describing an opening', () => {
  it("adds a species' seedlots together and keeps trees off site preparation", () => {
    const o = describeOpening(
      { OPENING_ID: 7, DISTURBANCE_START_DATE: '2009-02-02Z', CLIENT_NAME: 'never kept' },
      {
        standards: [],
        planting: [
          { OPENING_ID: 7, ACTIVITY_TREATMENT_UNIT_ID: 1, SILV_TREE_SPECIES_CODE: 'PLI', NUMBER_PLANTED: 1000 },
          { OPENING_ID: 7, ACTIVITY_TREATMENT_UNIT_ID: 1, SILV_TREE_SPECIES_CODE: 'SX', NUMBER_PLANTED: 500 },
          { OPENING_ID: 7, ACTIVITY_TREATMENT_UNIT_ID: 1, SILV_TREE_SPECIES_CODE: 'PLI', NUMBER_PLANTED: 250 },
        ],
        activities: [
          {
            OPENING_ID: 7,
            ACTIVITY_TREATMENT_UNIT_ID: 0,
            SILV_BASE_CODE: 'SP',
            SILV_TECHNIQUE_CODE: 'ME',
            SILV_METHOD_CODE: 'MOUND',
            ACTUAL_PLANTED_NUMBER: 0,
          },
          {
            OPENING_ID: 7,
            ACTIVITY_TREATMENT_UNIT_ID: 1,
            SILV_BASE_CODE: 'PL',
            SILV_TECHNIQUE_CODE: 'PL',
            ATU_COMPLETION_DATE: '2010-05-11Z',
          },
        ],
      },
    )
    expect(o.sitePrep).toEqual(['ME MOUND · not completed'])
    expect(o.planting).toEqual(['PL · 2010-05-11 · PLI 1,250, SX 500'])
    expect(o).toMatchObject({ openingId: 7, harvested: '2009-02-02', planted: true, freeGrowing: false })
    expect(JSON.stringify(o)).not.toContain('never kept')
  })

  it('leaves planting unknown, not none, when its reads failed', () => {
    const o = describeOpening({ OPENING_ID: 8 }, { standards: null, planting: null, activities: null })
    expect(o).toMatchObject({ planted: null, freeGrowing: null, planting: [], standards: [] })
  })
})
