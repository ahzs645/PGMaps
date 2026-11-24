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
