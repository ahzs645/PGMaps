import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { nduParts, orderUnitUrl, readOrderUnit } from './orderUnits'

const square = (west: number, south: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + 1, south],
      [west + 1, south + 1],
      [west, south + 1],
      [west, south],
    ],
  ],
})
const pairs = (unitIdent: string, names = ['NDZ_NAME', 'ORG_CODE', 'NDZ_SUB']) => ({
  LEGAL_FEAT_ATRB_2_NAME: names[0],
  LEGAL_FEAT_ATRB_2_VALUE: 'Moist Interior',
  LEGAL_FEAT_ATRB_3_NAME: names[1],
  LEGAL_FEAT_ATRB_3_VALUE: 'DPG',
  LEGAL_FEAT_ATRB_5_VALUE: unitIdent,
  LEGAL_FEAT_ATRB_6_NAME: names[2],
  LEGAL_FEAT_ATRB_6_VALUE: 'Mountain',
})

describe('the order units', () => {
  it('splits Table 7 names into the layer’s unit and sub-unit', () => {
    expect(nduParts('Moist Interior - Plateau')).toEqual({ name: 'Moist Interior', sub: 'Plateau' })
    expect(nduParts('Wet Mountain')).toEqual({ name: 'Wet Mountain', sub: null })
  })

  it('filters by plan, district code, unit and sub-unit', () => {
    const filter = new URL(orderUnitUrl('Prince George', 'Moist Interior - Mountain', 0)).searchParams.get('CQL_FILTER')
    expect(filter).toContain("LEGAL_FEAT_ATRB_3_VALUE = 'DPG'")
    expect(filter).toContain("LEGAL_FEAT_ATRB_2_VALUE = 'Moist Interior'")
    expect(filter).toContain("LEGAL_FEAT_ATRB_6_VALUE = 'Mountain'")
    const none = new URL(orderUnitUrl('Vanderhoof', 'Wet Mountain', 0)).searchParams.get('CQL_FILTER')
    expect(none).toContain('LEGAL_FEAT_ATRB_6_VALUE IS NULL')
    // The layer stores a single space, not null, for McGregor Plateau's and Wet Mountain's sub-unit.
    expect(none).toContain("LEGAL_FEAT_ATRB_6_VALUE IN ('', ' ')")
    expect(() => orderUnitUrl('Mackenzie', 'Wet Mountain', 0)).toThrow(/not one of the order/)
  })

  it('joins the polygons into one unit and names their landscape units', async () => {
    const fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          { geometry: square(0, 0), properties: pairs('A14') },
          { geometry: square(1, 0), properties: pairs('A3') },
          { geometry: square(5, 5), properties: pairs('A14') },
        ],
      }),
    })
    const read = await readOrderUnit({
      district: 'Prince George',
      ndu: 'Moist Interior - Mountain',
      fetch,
      readOn: 'x',
    })
    expect(read.polygons).toBe(3)
    expect(read.unitIdents).toEqual(['A3', 'A14'])
    expect(read.geometry.type).toBe('MultiPolygon')
    expect(read.geometry.coordinates).toHaveLength(2)
  })

  it('refuses a layer whose attribute pairs moved', async () => {
    const fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        features: [{ geometry: square(0, 0), properties: pairs('A1', ['NDZ_NAME', 'NDU_NAME', 'NDZ_SUB']) }],
      }),
    })
    await expect(
      readOrderUnit({ district: 'Prince George', ndu: 'Moist Interior - Mountain', fetch, readOn: 'x' }),
    ).rejects.toThrow(/no longer ORG_CODE/)
  })
})
