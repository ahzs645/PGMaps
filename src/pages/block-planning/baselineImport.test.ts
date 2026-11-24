import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import {
  BASELINE_MARGIN_METRES,
  cutblockPageUrl,
  firePageUrl,
  fromSource,
  grownUnit,
  readBaseline,
  readBoxes,
} from './baselineImport'
import type { Shape } from './plan'

const square = (west: number, south: number, size: number): Polygon => ({
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
const unit: Shape = square(-123, 54, 0.1)

type Row = { id?: string; geometry: Polygon; properties: Record<string, unknown> }
/**
 * A fake DataBC. Fires page by offset (WFS). Cutblocks page by OBJECTID, as the ArcGIS service is
 * read; `truncate` cuts each cutblock page to that many records and flags it, and `emptyOnce` answers
 * the first full-size cutblock request with an empty, flagged page, as the live service does.
 */
function fakeDataBc(cutblocks: Row[], fires: Row[], { truncate = Infinity, emptyOnce = false } = {}) {
  const asked: string[] = []
  let emptied = false
  const fetch = async (url: string) => {
    asked.push(url)
    const u = new URL(url)
    if (u.searchParams.get('service') === 'WFS') {
      const offset = Number(u.searchParams.get('startIndex'))
      const count = Number(u.searchParams.get('count'))
      return { ok: true, status: 200, json: async () => ({ features: fires.slice(offset, offset + count) }) }
    }
    const after = Number(/OBJECTID > (-?\d+)/.exec(u.searchParams.get('where')!)![1])
    const count = Number(u.searchParams.get('resultRecordCount'))
    const rest = cutblocks.filter((r) => Number(r.properties.OBJECTID) > after)
    if (emptyOnce && !emptied && count === 1000) {
      emptied = true
      return { ok: true, status: 200, json: async () => ({ features: [], exceededTransferLimit: true }) }
    }
    const page = rest.slice(0, Math.min(count, truncate))
    const more = rest.length > page.length
    return {
      ok: true,
      status: 200,
      json: async () => ({ features: page, ...(more && page.length < count ? { exceededTransferLimit: true } : {}) }),
    }
  }
  return { fetch, asked }
}

const cutblock = (id: number, geometry: Polygon, year: number | null): Row => ({
  geometry,
  properties: { VCCB_SYSID: id, OBJECTID: id, OPENING_ID: 1000 + id, HARVEST_START_YEAR_CALENDAR: year },
})

describe('readBaseline', () => {
  it('keeps the part of each record inside the unit and counts what it left out', async () => {
    const { fetch } = fakeDataBc(
      [
        cutblock(1, square(-122.99, 54.01, 0.02), 2005),
        cutblock(2, square(-122.91, 54.01, 0.02), 2008), // half outside the unit's east edge
        cutblock(3, square(-122.5, 54.5, 0.02), 2010), // in the box only if the box were wide
        cutblock(4, square(-122.98, 54.05, 0.01), null),
      ],
      [{ id: 'f.1', geometry: square(-122.95, 54.05, 0.03), properties: { FIRE_NUMBER: 'G1', FIRE_YEAR: 2010 } }],
    )
    const read = await readBaseline({
      unit,
      sources: ['cutblocks', 'fires'],
      earliestYear: 2015,
      fetch,
      readOn: '2026-11-23',
    })
    expect(read.fromYear).toBe(1995)
    expect(read.counts.cutblocks).toEqual({ read: 4, kept: 2, outside: 1, noYear: 1 })
    expect(read.counts.fires).toEqual({ read: 1, kept: 1, outside: 0, noYear: 0 })
    const halved = read.disturbances.find((d) => d.name.includes('1002'))!
    expect(blockAreaHa(halved.geometry) / blockAreaHa(square(-122.91, 54.01, 0.02))).toBeCloseTo(0.5, 1)
    expect(read.disturbances.every((d) => d.yearBasis === 'source-attribute')).toBe(true)
    expect(read.disturbances.filter((d) => fromSource(d, 'fires'))).toHaveLength(1)
    expect(read.disturbances.filter((d) => fromSource(d, 'cutblocks'))).toHaveLength(2)
  })

  it('reads past the unit by the margin and keeps records there whole', async () => {
    const outside = square(-122.88, 54.01, 0.01) // about 1 km east of the unit
    const { fetch } = fakeDataBc([cutblock(1, outside, 2005)], [])
    const read = await readBaseline({
      unit,
      sources: ['cutblocks'],
      earliestYear: 2015,
      fetch,
      readOn: '2026-11-23',
      marginMetres: BASELINE_MARGIN_METRES,
    })
    expect(read.marginMetres).toBe(BASELINE_MARGIN_METRES)
    expect(read.counts.cutblocks.kept).toBe(1)
    expect(blockAreaHa(read.disturbances[0].geometry)).toBeCloseTo(blockAreaHa(outside), 0)
  })

  it('pages cutblocks by OBJECTID until a page is neither full nor flagged', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) =>
      cutblock(i + 1, square(-122.99 + (i % 50) * 0.001, 54.01, 0.0005), 2000),
    )
    const { fetch, asked } = fakeDataBc(rows, [])
    const read = await readBaseline({ unit, sources: ['cutblocks'], earliestYear: 2015, fetch, readOn: '2026-11-23' })
    expect(asked).toHaveLength(2)
    expect(read.counts.cutblocks.read).toBe(1001)
  })

  it('keeps reading through pages the service cuts short, and through an empty flagged page', async () => {
    const rows = Array.from({ length: 700 }, (_, i) =>
      cutblock(i + 1, square(-122.99 + (i % 50) * 0.001, 54.01, 0.0005), 2000),
    )
    const { fetch, asked } = fakeDataBc(rows, [], { truncate: 105, emptyOnce: true })
    const read = await readBaseline({ unit, sources: ['cutblocks'], earliestYear: 2015, fetch, readOn: '2026-11-23' })
    expect(read.counts.cutblocks.read).toBe(700)
    expect(asked.some((u) => new URL(u).searchParams.get('resultRecordCount') === '500')).toBe(true)
  })

  it('asks again at half the size when the gateway gives up on a page', async () => {
    const rows = Array.from({ length: 700 }, (_, i) =>
      cutblock(i + 1, square(-122.99 + (i % 50) * 0.001, 54.01, 0.0005), 2000),
    )
    const { fetch: answer } = fakeDataBc(rows, [])
    const asked: string[] = []
    const fetch = async (url: string) => {
      asked.push(url)
      // The live gateway timed out on full pages: answer 502 to any page over 250 records.
      if (Number(new URL(url).searchParams.get('resultRecordCount')) > 250)
        return { ok: false, status: 502, json: async () => ({}) }
      return answer(url)
    }
    const read = await readBaseline({ unit, sources: ['cutblocks'], earliestYear: 2015, fetch, readOn: '2026-11-24' })
    expect(read.counts.cutblocks.read).toBe(700)
    expect(asked.map((u) => new URL(u).searchParams.get('resultRecordCount')).slice(0, 3)).toEqual([
      '1000',
      '500',
      '250',
    ])
  })

  it('refuses an invalid unit and reports a refused query', async () => {
    const bow: Shape = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    }
    const { fetch } = fakeDataBc([], [])
    await expect(
      readBaseline({ unit: bow, sources: ['fires'], earliestYear: 2015, fetch, readOn: 'x' }),
    ).rejects.toThrow(/not a valid polygon/)
    const refused = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: 'Invalid query' } }) })
    await expect(
      readBaseline({ unit, sources: ['cutblocks'], earliestYear: 2015, fetch: refused, readOn: 'x' }),
    ).rejects.toThrow('DataBC: Invalid query.')
  })
})

describe('the queries', () => {
  it('puts the fire box in CQL longitude first and the year floor in both', () => {
    const fire = new URL(firePageUrl([-123, 54, -122, 55], 1995, 2))
    expect(fire.searchParams.get('CQL_FILTER')).toBe(
      "BBOX(SHAPE,-123.000000,54.000000,-122.000000,55.000000,'EPSG:4326') AND FIRE_YEAR >= 1995",
    )
    expect(fire.searchParams.get('bbox')).toBeNull()
    expect(fire.searchParams.get('startIndex')).toBe('2000')
    const cut = new URL(cutblockPageUrl([-123, 54, -122, 55], 1995, 4321))
    expect(cut.searchParams.get('where')).toBe('HARVEST_START_YEAR_CALENDAR >= 1995 AND OBJECTID > 4321')
    expect(cut.searchParams.get('orderByFields')).toBe('OBJECTID')
    expect(cut.searchParams.get('resultOffset')).toBeNull()
  })

  it('reads scattered parts by their own boxes and merges near ones', () => {
    const scattered: Shape = {
      type: 'MultiPolygon',
      coordinates: [square(-124, 54, 0.1).coordinates, square(-122, 55, 0.1).coordinates],
    }
    expect(readBoxes(scattered)).toHaveLength(2)
    const adjacent: Shape = {
      type: 'MultiPolygon',
      coordinates: [square(-124, 54, 0.1).coordinates, square(-123.9, 54, 0.1).coordinates],
    }
    expect(readBoxes(adjacent)).toHaveLength(1)
  })

  it('grows the unit by metres on the ground', () => {
    const grown = grownUnit(unit, 1000)
    const [w] = (grown.type === 'MultiPolygon' ? grown.coordinates[0][0] : grown.coordinates[0]).reduce(
      ([minX], [x]) => [Math.min(minX, x)],
      [Infinity],
    )
    // 1 km of longitude at 54° N is about 0.0153°.
    expect(-123 - w).toBeCloseTo(1000 / (111_320 * Math.cos((54 * Math.PI) / 180)), 3)
    expect(grownUnit(unit, 0)).toBe(unit)
  })
})
