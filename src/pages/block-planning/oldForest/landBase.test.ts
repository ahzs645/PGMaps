import { describe, expect, it } from 'vitest'
import { managedLicenceKind, nonCrownOwnership, readExcludedAreas } from './landBase'
import { hullRing, type Fetch } from '../wfsReads'

describe('what the order does not apply to', () => {
  it('reads F_OWN codes: private, treaty, federal and municipal land are not provincial Crown', () => {
    // 40 private, 41 treaty settlement, 52 reserve, 54 federal parcel, 80 municipal, 81 regional park.
    for (const own of [40, 41, 51, 52, 53, 54, 80, 81]) expect(nonCrownOwnership(own)).toBe(true)
    // 60 park, 62 FMU, 69 reserves, 72 TFL, 77 woodlot, 78 FNWL, 79 CFA, 91 unknown, 99 lease.
    for (const own of [60, 61, 62, 69, 72, 77, 78, 79, 91, 99]) expect(nonCrownOwnership(own)).toBe(false)
  })

  it('tells woodlots from community forests by the file’s letter, and keeps First Nations woodland licences', () => {
    expect(managedLicenceKind('W0633')).toBe('woodlot')
    expect(managedLicenceKind('K2M')).toBe('community-forest')
    expect(managedLicenceKind('N2E')).toBeNull()
  })

  it('reads each source by the unit’s shapes and classes what comes back', async () => {
    const square = [
      [-122.6, 54],
      [-122.5, 54],
      [-122.5, 54.1],
      [-122.6, 54.1],
      [-122.6, 54],
    ]
    const asked: string[] = []
    const answers: Record<string, unknown[]> = {
      F_OWN: [
        {
          id: 1,
          geometry: { type: 'Polygon', coordinates: [square] },
          properties: { OBJECTID: 1, OWN: 40, OWNERSHIP_DESCRIPTION: 'Private Parcel' },
        },
        // A code the filter should not have returned is dropped again.
        { id: 2, geometry: { type: 'Polygon', coordinates: [square] }, properties: { OBJECTID: 2, OWN: 62 } },
      ],
      FTEN_MANAGED_LICENCE_POLY_SVW: [
        {
          id: 3,
          geometry: { type: 'Polygon', coordinates: [square] },
          properties: { OBJECTID: 3, FOREST_FILE_ID: 'W0633', ML_TYPE_CODE: 'SCHEDULE_B' },
        },
        {
          id: 4,
          geometry: { type: 'Polygon', coordinates: [square] },
          properties: { OBJECTID: 4, FOREST_FILE_ID: 'K2M', ML_TYPE_CODE: 'SCHEDULE_B' },
        },
      ],
      FADM_TFL_ALL_SP: [
        {
          id: 5,
          geometry: { type: 'MultiPolygon', coordinates: [[square]] },
          properties: { OBJECTID: 5, FOREST_FILE_ID: 'TFL53' },
        },
      ],
    }
    const fetch: Fetch = async (_url, init) => {
      const body = new URLSearchParams(init?.body)
      asked.push(`${body.get('typeNames')} ${body.get('CQL_FILTER')}`)
      const layer = Object.keys(answers).find((k) => body.get('typeNames')!.includes(k))!
      return { ok: true, status: 200, json: async () => ({ features: answers[layer] }) }
    }
    const areas = await readExcludedAreas({ unit: { type: 'Polygon', coordinates: [square] }, fetch })
    expect(areas.map((a) => [a.kind, a.name])).toEqual([
      ['non-crown', 'Private Parcel'],
      ['woodlot', 'W0633 schedule b'],
      ['community-forest', 'K2M schedule b'],
      ['tfl', 'TFL53'],
    ])
    expect(asked).toHaveLength(3)
    expect(asked.every((a) => a.includes('INTERSECTS('))).toBe(true)
    expect(asked[1]).toContain("LIFE_CYCLE_STATUS_CODE = 'ACTIVE'")
  })

  it('asks with a hull that holds the ring', () => {
    const ring = [
      [0, 0],
      [4, 0],
      [2, 1],
      [4, 4],
      [0, 4],
      [0, 0],
    ]
    expect(hullRing(ring)).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ])
  })
})
