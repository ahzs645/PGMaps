import { describe, expect, it } from 'vitest'
import { albersToLngLat } from '../../../src/pages/dev-avast/projection'
import { analyze, sizeClass } from '../../../src/pages/forest-patches/analysis'
import {
  exampleProject,
  movementTowardTarget,
  parseProject,
  importLayer,
  table,
  type Footprint,
} from '../../../src/pages/forest-patches/project'

function block(id: string, x: number, width: number, height: number, year = 2026): Footprint {
  const xy = [
    [x, 0],
    [x + width, 0],
    [x + width, height],
    [x, height],
    [x, 0],
  ]
  return {
    type: 'Feature',
    properties: { id, year, scenario: 'reference' },
    geometry: {
      type: 'Polygon',
      coordinates: [xy.map(([east, north]) => albersToLngLat(1200000 + east, 850000 + north))],
    },
  }
}
const run = (...features: Footprint[]) => analyze({ ...exampleProject(), features }, 2026, 'reference')
describe('Prince George patch analysis', () => {
  it.each([
    [400, 400, 150],
    [800, 800, 200],
    [1200, 1000, 400],
    [2500, 2400, 600],
    [4000, 3000, 800],
  ])('clusters %i × %i metre footprints only within the applicable %i m join', (width, height, gap) => {
    const first = block('a', 0, width, height)
    const joined = run(first, block('b', width + gap, width, height)).timeline[0]
    expect(joined.patches).toBe(1)
    expect(joined.totalHa).toBeCloseTo((width * height * 2) / 10000, 5)
    expect(run(first, block('b', width + gap + 2, width, height)).timeline[0].patches).toBe(2)
  })
  it('keeps overlapping source area once and excludes holes', () => {
    const a = block('a', 0, 400, 400)
    if (a.geometry.type !== 'Polygon') throw Error()
    const hole = block('hole', 100, 100, 50).geometry
    if (hole.type !== 'Polygon') throw Error()
    const ring = hole.coordinates[0].map(([lng, lat]) => [lng, lat + 0.001])
    a.geometry.coordinates.push(ring)
    const b = { ...a, properties: { ...a.properties, id: 'copy' } }
    expect(run(a, b).timeline[0].totalHa).toBeCloseTo(15.5, 2)
  })
  it('uses area shares and keeps the printed gaps unresolved', () => {
    expect([49.99, 50, 50.9, 51, 100, 100.5, 101, 1000, 1000.01].map(sizeClass)).toEqual([
      'under50ha',
      null,
      null,
      'between51and100ha',
      'between51and100ha',
      null,
      'between101and1000ha',
      'between101and1000ha',
      'over1000ha',
    ])
    const row = run(block('a', 0, 500, 1000), block('b', 4000, 500, 500)).timeline[0]
    expect(row.unclassifiedHa).toBeCloseTo(50)
    expect(row.classes[0].percent).toBeCloseTo(100 / 3)
  })
  it('uses disturbance age 0–20 inclusive and isolates schedules', () => {
    const now = block('present', 0, 400, 400, 2006),
      future = block('future', 600, 400, 400, 2031)
    future.properties.scenario = 'proposed'
    const { timeline } = run(now, future)
    expect(timeline).toHaveLength(33)
    expect(timeline[0].totalHa).toBeCloseTo(16)
    expect(timeline[1].classes[0].percent).toBeNull()
    expect(timeline.find((r) => r.scenario === 'proposed' && r.year === 2031)?.totalHa).toBeCloseTo(16)
    expect(timeline.find((r) => r.scenario === 'alternative' && r.year === 2031)?.totalHa).toBe(0)
  })
  it('matches the published under-50 ha direction in Fort St. James (FPB/IRC/235 Table 2)', () => {
    const t = table.targets.find((t) => t.ndu === 'Moist Interior - Mountain')!.percent.under50ha
    expect(movementTowardTarget(22.7, 17.9, t)).toBeCloseTo(0.6)
    expect(movementTowardTarget(null, 17.9, t)).toBeNull()
    expect(table.targets.every((row) => Object.values(row.percent).reduce((a, b) => a + b, 0) === 100)).toBe(true)
  })
  it('imports a plain GeoJSON layer and rejects duplicate IDs, invalid years and unclosed rings', () => {
    const p = { ...exampleProject(), features: [] }
    const f = block('a', 0, 400, 400)
    const plain = { ...f, properties: {} }
    const imported = importLayer(p, plain, 'blocks.geojson', 2031, 'alternative')
    expect(imported.features[0].properties).toMatchObject({
      source: 'blocks.geojson',
      scenario: 'alternative',
      year: 2031,
    })
    expect(() => importLayer(imported, plain, 'blocks.geojson', 2031, 'alternative')).toThrow(/unique/)
    expect(() => importLayer(p, plain, 'blocks', NaN, 'reference')).toThrow(/year/)
    expect(() =>
      parseProject({ ...p, features: [{ ...f, geometry: { type: 'Polygon', coordinates: [[[0, 0]]] } }] }),
    ).toThrow(/rings/)
  })
})
