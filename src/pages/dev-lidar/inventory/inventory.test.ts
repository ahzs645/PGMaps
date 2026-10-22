import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import proj4 from 'proj4'
import { describe, it, expect } from 'vitest'
import { METRIC_CRS } from '../sourceGrids'
import { estimatedDbh, stemVolume } from './allometry'
import { drawnPolygon, parseInventoryPolygon, polygonHa, scopeArea } from './geometry'
import {
  checkInventoryData,
  inventoryRows,
  summarizeInventory,
  standTable,
  matchInventories,
  inventoryExport,
} from './summary'
import { parseReviews, reviewManifest } from './reviews'
import { DEFAULT_RULES, type InventoryData } from './types'
const data: InventoryData = JSON.parse(readFileSync(new URL('./inventory.generated.json', import.meta.url), 'utf8'))
const wgs = (x: number, y: number) => proj4(METRIC_CRS, 'EPSG:4326', [x, y]) as [number, number]
describe('inventory equations and geometry', () => {
  it('uses Jucker equation 6 and refuses missing crown dimensions', () => {
    expect(estimatedDbh(30, 6)).toBeCloseTo(0.557 * 180 ** 0.809 * Math.exp(0.056 ** 2 / 2), 10)
    expect(estimatedDbh(30, null)).toBeNull()
    expect(estimatedDbh(0, 6)).toBeNull()
    const v = stemVolume('SX', 37.136, 27.08)
    expect(v.total).toBeCloseTo(Math.exp(-9.951) * 37.136 ** 1.807 * 27.08 ** 1.08, 10)
    expect(v.merchant).toBeCloseTo(Math.exp(-10.223) * 37.136 ** 1.781 * 27.08 ** 1.178, 10)
    expect(stemVolume('UNKNOWN', 37, 27).total).toBeNull()
    expect(stemVolume('EP', 37, 30).total).toBeNull()
    expect(stemVolume('SX', 10, 12, 12.5).merchant).toBe(0)
  })
  it('calculates projected hectares, respects holes and refuses crossing boundaries', () => {
    const polygon = drawnPolygon([
      wgs(511000, 5971000),
      wgs(511100, 5971000),
      wgs(511100, 5971100),
      wgs(511000, 5971100),
    ])
    expect(polygonHa(polygon)).toBeCloseTo(1, 5)
    const hole = [
      wgs(511020, 5971020),
      wgs(511040, 5971020),
      wgs(511040, 5971040),
      wgs(511020, 5971040),
      wgs(511020, 5971020),
    ]
    if (polygon.geometry.type !== 'Polygon') throw Error('test polygon')
    const withHole = parseInventoryPolygon(
      JSON.stringify({
        ...polygon,
        geometry: { ...polygon.geometry, coordinates: [...polygon.geometry.coordinates, hole] },
      }),
    )
    expect(polygonHa(withHole)).toBeCloseTo(0.96, 5)
    expect(() =>
      drawnPolygon([wgs(511000, 5971000), wgs(511100, 5971100), wgs(511000, 5971100), wgs(511100, 5971000)]),
    ).toThrow()
    expect(() => parseInventoryPolygon('{"type":"Point","coordinates":[0,0]}')).toThrow(/Polygon/)
  })
})
describe('actual inventory snapshot', () => {
  it('contains executed method outputs, correct supported area and aligned unthinned point assets', () => {
    expect(() => checkInventoryData(data, data.source_sha256)).not.toThrow()
    expect(data.foresttools.version).toBe('1.0.4')
    expect(data.support.features).toHaveLength(7)
    expect(scopeArea(data.support, null).covered_ha).toBeCloseTo(1.75, 3)
    for (const run of data.foresttools.runs) expect(run.crowns).toBe(run.treetops)
    const sample = JSON.parse(readFileSync(new URL('./points/1-19.json', import.meta.url), 'utf8'))
    const core = JSON.parse(gunzipSync(Buffer.from(sample.data, 'base64')).toString())
    expect(core.run_id).toBe(data.run_id)
    expect(core.points).toHaveLength(157614)
    expect(new Set(core.points.map((p: number[]) => p[4])).size).toBe(core.points.length)
    for (const method of ['sat', 'forainet', 'fora-fixed', 'fora-variable']) {
      const column = { sat: 5, forainet: 6, 'fora-fixed': 9, 'fora-variable': 10 }[method]!
      for (const f of data.crowns.features.filter(
        (f) => f.properties.chunk === '1-19' && f.properties.method === method,
      )) {
        expect(core.points.filter((p: number[]) => p[column] === f.properties.label)).toHaveLength(
          f.properties.point_count!,
        )
      }
    }
  })
  it('reconciles polygon summaries and stand classes without counting unsupported area or excluded candidates', () => {
    const polygon = data.support.features[0],
      rules = { ...DEFAULT_RULES, speciesMode: 'reviewed' as const }
    const rows = inventoryRows(data, 'foresttools-base', rules, {}, polygon),
      totals = summarizeInventory(rows, data, polygon, rules)
    expect(totals.covered_ha).toBeCloseTo(0.25, 3)
    expect(totals.candidates).toBe(rows.length)
    expect(totals.total_m3).toBeNull()
    expect(totals.missing_volume).toBe(rows.length)
    expect(standTable(rows, totals.covered_ha).reduce((n, g) => n + g.n, 0)).toBe(rows.length)
    const reviews = {
      [rows[0].tree.properties.id]: { status: 'excluded' as const, species: '', dbh_cm: null, note: 'possible roof' },
    }
    const updated = inventoryRows(data, 'foresttools-base', rules, reviews, polygon)
    expect(summarizeInventory(updated, data, polygon, rules).candidates).toBe(rows.length - 1)
    const exported = inventoryExport(data, updated, rules, polygon)
    expect(exported.metadata.definitions.census).toBe(false)
    expect(exported.features[0].properties.review.note).toBe('possible roof')
  })
  it('retains run-scoped review provenance and one-to-one method matches', () => {
    const rows = inventoryRows(data, 'foresttools-base', DEFAULT_RULES, {}, null)
    const match = matchInventories(rows, rows)
    expect(match.matches).toHaveLength(rows.length)
    expect(new Set(match.matches.map((m) => m.b)).size).toBe(rows.length)
    expect(match.mean_distance).toBe(0)
    const reviews = {
      [rows[0].tree.properties.id]: { status: 'accepted' as const, species: 'SX', dbh_cm: 37.1, note: 'field value' },
    }
    expect(parseReviews(reviewManifest(data, reviews), data)).toEqual(reviews)
    expect(() => parseReviews({ ...reviewManifest(data, reviews), schema_version: 2 }, data)).toThrow(/version/)
    expect(() => parseReviews({ ...reviewManifest(data, reviews), run_id: 'another' }, data)).toThrow(/different/)
  })
})
