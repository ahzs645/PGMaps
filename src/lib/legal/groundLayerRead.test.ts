import type { MultiPolygon, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import type { Fetch } from '@/lib/forestry/wfsReads'
import { GROUND_CATALOGUE } from './groundInstruments'
import { layerInstruments, readGroundLayer, shareRows } from './groundLayerRead'

const box = (west: number, south: number, size: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [west + size, south],
      [west + size, south + size],
      [west, south + size],
      [west, south],
    ],
  ],
})
const twoParts: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [box(-122.5, 54, 0.01).coordinates, box(-122.4, 54, 0.01).coordinates],
}
const layer = (id: string) => GROUND_CATALOGUE.layers.find((l) => l.id === id)!

/** A stub that answers every read with `features` and records what was asked. */
function stub(features: unknown[]) {
  const asked: URLSearchParams[] = []
  const fetch: Fetch = async (_url, init) => {
    asked.push(new URLSearchParams(init?.body))
    return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features }) }
  }
  return { asked, fetch }
}

describe('reading a ground catalogue layer', () => {
  it("reads each part by its own ring, keeps a record once, and cuts it to the catalogue's fields", async () => {
    const uwr = layer('uwr')
    const { asked, fetch } = stub([
      {
        geometry: box(-122.5, 54, 0.02),
        properties: {
          UNGULATE_WINTER_RANGE_ID: 5,
          UWR_NUMBER: 'u-7-022',
          TIMBER_HARVEST_CODE: 'NO HARVEST ZONE',
          X: 1,
        },
      },
    ])
    const answer = await readGroundLayer({
      layer: uwr,
      instruments: layerInstruments(uwr),
      footprint: twoParts,
      fetch,
      cap: 500,
    })
    expect(asked).toHaveLength(2)
    expect(asked.map((a) => a.get('typeNames'))).toEqual([uwr.typeName, uwr.typeName])
    expect(asked[0].get('sortBy')).toBe('UNGULATE_WINTER_RANGE_ID')
    expect(asked[0].get('propertyName')!.split(',')).toEqual([...uwr.fields, 'GEOMETRY'])
    // Every instrument the layer holds, joined by OR beside the part's ring.
    expect(asked[0].get('CQL_FILTER')).toMatch(/^INTERSECTS\(GEOMETRY,SRID=4326;POLYGON\(\(.*\)\)\) AND \(\(/)
    expect(asked[0].get('CQL_FILTER')).toContain("TIMBER_HARVEST_CODE IN ('CONDITIONAL HARVEST ZONE')")
    expect(answer).toEqual({
      status: 'read',
      rows: [
        {
          properties: { UNGULATE_WINTER_RANGE_ID: 5, UWR_NUMBER: 'u-7-022', TIMBER_HARVEST_CODE: 'NO HARVEST ZONE' },
          geometry: box(-122.5, 54, 0.02),
        },
      ],
    })
    expect(shareRows(layerInstruments(uwr), answer.rows).get('uwr-no-harvest')).toHaveLength(1)
  })

  it('reads a context layer whole, and refuses an instrument for it', async () => {
    const treaty = layer('treaty-lands')
    expect(treaty.context).toBeTruthy()
    const { asked, fetch } = stub([])
    await readGroundLayer({ layer: treaty, instruments: [], footprint: box(-122.5, 54, 0.01), fetch, cap: 300 })
    expect(asked[0].get('CQL_FILTER')).toMatch(/^INTERSECTS\(GEOMETRY,SRID=4326;POLYGON\(\([^)]*\)\)\)$/)
    const parks = layer('parks')
    await expect(
      readGroundLayer({ layer: parks, instruments: [], footprint: box(-122.5, 54, 0.01), fetch, cap: 300 }),
    ).rejects.toThrow(/No instrument reads parks/)
    await expect(
      readGroundLayer({
        layer: treaty,
        instruments: layerInstruments(parks),
        footprint: box(-122.5, 54, 0.01),
        fetch,
        cap: 300,
      }),
    ).rejects.toThrow(/context layer/)
  })

  it('reads a line or point layer against the footprint grown by its margin, and needs the growing', async () => {
    const water = layer('water-licences')
    const { asked, fetch } = stub([])
    const grown: number[] = []
    await readGroundLayer({
      layer: water,
      instruments: layerInstruments(water),
      footprint: box(-122.5, 54, 0.01),
      fetch,
      grow: (footprint, metres) => {
        grown.push(metres)
        return footprint
      },
      cap: 500,
    })
    expect(grown).toEqual([102])
    expect(asked).toHaveLength(1)
    await expect(
      readGroundLayer({
        layer: water,
        instruments: layerInstruments(water),
        footprint: box(-122.5, 54, 0.01),
        fetch,
        cap: 500,
      }),
    ).rejects.toThrow(/pass grow/)
  })

  it('marks a read past its cap as truncated and keeps only the first', async () => {
    const reserves = layer('indian-reserves')
    const record = (id: string) => ({ geometry: box(-122.5, 54, 0.01), properties: { CLAB_ID: id } })
    const { fetch } = stub([record('1'), record('2'), record('3')])
    const answer = await readGroundLayer({
      layer: reserves,
      instruments: [],
      footprint: box(-122.5, 54, 0.01),
      fetch,
      cap: 2,
    })
    expect(answer.status).toBe('truncated')
    expect(answer.rows).toHaveLength(2)
  })

  it('throws when DataBC does not answer, so the caller can say Not read', async () => {
    const fetch: Fetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
    const ogma = layer('ogma')
    await expect(
      readGroundLayer({
        layer: ogma,
        instruments: layerInstruments(ogma),
        footprint: box(-122.5, 54, 0.01),
        fetch,
        cap: 500,
      }),
    ).rejects.toThrow('DataBC answered 500 for WHSE_LAND_USE_PLANNING.RMP_OGMA_LEGAL_CURRENT_SVW.')
  })
})

describe('a layer read only inside its gates', () => {
  const pine = layer('pine-leading-vri')
  const TSA = 'pub:WHSE_ADMIN_BOUNDARIES.FADM_TSA_SV'
  const TFL = 'pub:WHSE_ADMIN_BOUNDARIES.FADM_TFL_ALL_SP'
  /** Answers each layer with its own records, by typeNames; a number is a failed read. */
  function byLayer(answers: Record<string, unknown[] | number>) {
    const asked: URLSearchParams[] = []
    const fetch: Fetch = async (_url, init) => {
      const body = new URLSearchParams(init?.body)
      asked.push(body)
      const answer = answers[body.get('typeNames') ?? ''] ?? []
      if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ type: 'FeatureCollection', features: answer }) }
    }
    return { asked, fetch }
  }
  const stand = {
    geometry: box(-122.5, 54, 0.01),
    properties: { FEATURE_ID: 7, SPECIES_CD_1: 'PLI', POLYGON_AREA: 12.4, CLIENT_NAME: 'never kept' },
  }
  const read = (fetch: Fetch) =>
    readGroundLayer({
      layer: pine,
      instruments: layerInstruments(pine),
      footprint: box(-122.5, 54, 0.01),
      fetch,
      cap: 500,
    })

  it('asks the gates first by the footprint, keeps nothing of them, and reads the layer only inside one', async () => {
    const { asked, fetch } = byLayer({
      [TSA]: [
        {
          geometry: box(-123, 53, 2),
          properties: { TSA_NUMBER_DESCRIPTION: 'Prince George TSA', WHO_UPDATED: 'IDIR' },
        },
      ],
      [pine.typeName]: [stand],
    })
    const answer = await read(fetch)
    // The TSA gate matched, so the TFL gate is never asked.
    expect(asked.map((a) => a.get('typeNames'))).toEqual([TSA, pine.typeName])
    expect(asked[0].get('CQL_FILTER')).toMatch(
      /^INTERSECTS\(GEOMETRY,SRID=4326;POLYGON\(\(.*\)\)\) AND TSA_NUMBER_DESCRIPTION IN \('100 Mile House TSA'/,
    )
    expect(asked[0].get('propertyName')).toBe('TSA_NUMBER_DESCRIPTION,GEOMETRY')
    expect(asked[1].get('CQL_FILTER')).toContain("SPECIES_CD_1 IN ('PL', 'PLI', 'PLC') AND POLYGON_AREA >= 5")
    expect(answer.outsideGates).toBeUndefined()
    expect(answer.rows).toHaveLength(1)
    expect(answer.rows[0].properties).toEqual({ FEATURE_ID: 7, SPECIES_CD_1: 'PLI', POLYGON_AREA: 12.4 })
  })

  it('asks the next gate when the first holds nothing, a TFL by its hull', async () => {
    const { asked, fetch } = byLayer({
      [TFL]: [{ geometry: box(-123, 53, 2), properties: { FOREST_FILE_ID: 'TFL53' } }],
      [pine.typeName]: [stand],
    })
    const answer = await read(fetch)
    expect(asked.map((a) => a.get('typeNames'))).toEqual([TSA, TFL, pine.typeName])
    expect(asked[1].get('CQL_FILTER')).toMatch(/^INTERSECTS\(SHAPE,SRID=4326;POLYGON\(\(/)
    expect(asked[1].get('CQL_FILTER')).toContain("FOREST_FILE_ID IN ('TFL18'")
    expect(answer.rows).toHaveLength(1)
  })

  it('reads nothing outside every gate, and says so', async () => {
    const { asked, fetch } = byLayer({ [pine.typeName]: [stand] })
    const answer = await read(fetch)
    expect(asked.map((a) => a.get('typeNames'))).toEqual([TSA, TFL])
    expect(answer).toEqual({ status: 'read', rows: [], outsideGates: true })
  })

  it('throws when a gate is not answered, so the layer reads Not read, never none', async () => {
    const { fetch } = byLayer({ [TSA]: 503 })
    await expect(read(fetch)).rejects.toThrow('DataBC answered 503 for WHSE_ADMIN_BOUNDARIES.FADM_TSA_SV.')
  })
})
