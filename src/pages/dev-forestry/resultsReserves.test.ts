import { describe, expect, it, vi } from 'vitest'
import {
  blockFootprint,
  fetchBlockFootprints,
  ftenBlockQueryUrl,
  groupReserveQueryUrl,
  parseFtenBlocks,
  parseGroupReserves,
  reserveMaskFields,
} from './resultsReserves'
import { polygonAreaMeters } from './visibility'

const box = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
})
const BLOCK = box(-122.61, 53.9, -122.6, 53.905)
const RESERVE = box(-122.61, 53.9, -122.607, 53.902)

describe('net block footprints from RESULTS group reserves', () => {
  it('asks only for group reserves, box in the CQL filter, longitude first', () => {
    const url = new URL(groupReserveQueryUrl([-122.62, 53.89, -122.59, 53.91]))
    expect(url.searchParams.get('bbox')).toBeNull()
    expect(url.searchParams.get('CQL_FILTER')).toBe(
      "SILV_RESERVE_CODE='G' AND BBOX(GEOMETRY,-122.62,53.89,-122.59,53.91,'EPSG:4326')",
    )
    expect(new URL(ftenBlockQueryUrl([-122.62, 53.89, -122.59, 53.91])).searchParams.get('propertyName')).toBe(
      'CUT_BLOCK_ID,PLANNED_NET_BLOCK_AREA,PLANNED_GROSS_BLOCK_AREA,GEOMETRY',
    )
  })

  it('subtracts group reserves, never dispersed ones, and reads FTEN’s planned net beside it', () => {
    const reserves = parseGroupReserves({
      features: [
        {
          id: 'r1',
          geometry: RESERVE,
          properties: { OPENING_ID: 123, SILV_RESERVE_CODE: 'G', SILV_RESERVE_OBJECTIVE_CODE: 'WTR' },
        },
        {
          id: 'r2',
          geometry: BLOCK,
          properties: { OPENING_ID: 123, SILV_RESERVE_CODE: 'D', SILV_RESERVE_OBJECTIVE_CODE: 'BIO' },
        },
      ],
    })
    expect(reserves.map((r) => r.id)).toEqual(['r1'])
    const ften = parseFtenBlocks({
      features: [
        {
          geometry: BLOCK,
          properties: { CUT_BLOCK_ID: '7', PLANNED_NET_BLOCK_AREA: 31.3, PLANNED_GROSS_BLOCK_AREA: 40 },
        },
      ],
    })
    const footprint = blockFootprint(BLOCK, reserves, ften)
    const gross = polygonAreaMeters(BLOCK) / 10_000
    expect(footprint.grossHectares).toBeCloseTo(gross)
    expect(footprint.netOfReservesHectares).toBeCloseTo(gross - polygonAreaMeters(RESERVE) / 10_000, 1)
    expect(footprint).toMatchObject({ plannedNetHectares: 31.3, ftenCutBlockId: '7' })
    expect(reserveMaskFields(reserves[0]).name).toBe('Group reserve (WTR), opening 123')
    // A block FTEN does not hold has no planned net area.
    expect(blockFootprint(BLOCK, [], []).plannedNetHectares).toBeNull()
  })

  it('reports a refused query as an error, never as no reserves', async () => {
    const refuse = vi.fn(async () => new Response(JSON.stringify({ exceptions: ['bad'] }), { status: 200 }))
    await expect(fetchBlockFootprints([BLOCK], refuse)).rejects.toThrow(/refused/)
  })
})
