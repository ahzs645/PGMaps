import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { INITIAL_ANALYSIS } from './analysisWorkflows'
import {
  treeFeatures,
  crownCells,
  belongsToCrown,
  treeCropCSV,
  type TreeIsolation,
  type TreeCrop,
} from './treeIsolation'
import { toMetric } from './sourceGrids'
import { treePointVertices } from './treePointLayer'
const data = JSON.parse(
  readFileSync(new URL('./treeIsolation.generated.json', import.meta.url), 'utf8'),
) as TreeIsolation

describe('tree footprint selection and original-point coordinates', () => {
  it('maps every retained candidate, filters heights/areas and keeps colouring separate from species', () => {
    expect(treeFeatures(data, INITIAL_ANALYSIS)).toHaveLength(16136)
    const rows = treeFeatures(data, { ...INITIAL_ANALYSIS, treeMinimum: 30, treeAreaMinimum: 25, treeHideEdge: true })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(16136)
    for (const f of rows) {
      const p = data.crowns.features.find((c) => c.properties.id === f.properties.id)!.properties
      expect(p.height_m).toBeGreaterThanOrEqual(30)
      expect(p.crown_area_m2).toBeGreaterThanOrEqual(25)
      expect(p.edge).toBe(false)
      expect('runs' in f.properties).toBe(false)
    }
  })
  it('uses exact source-cell columns rather than simplified display geometry', () => {
    for (const crown of data.crowns.features.slice(0, 20)) {
      const cells = crownCells(crown, data.grid)
      expect(cells.size).toBe(crown.properties.crown_area_m2)
      const [row, col] = crown.properties.runs[0],
        x = data.grid.bounds[0] + col + 0.5,
        y = data.grid.bounds[3] - row - 0.5
      expect(belongsToCrown(cells, data.grid, x, y)).toBe(true)
      const xy = toMetric(...crown.properties.centre)
      expect(xy[0]).toBeCloseTo(crown.properties.centre_utm[0], 1)
      expect(xy[1]).toBeCloseTo(crown.properties.centre_utm[1], 1)
    }
  })
  it('exports actual elevation and node identity and makes finite local GPU coordinates', () => {
    const c = data.crowns.features[0].properties
    const crop: TreeCrop = {
      id: c.id,
      points: [
        {
          lon: c.centre[0],
          lat: c.centre[1],
          z: c.ground_m + 10,
          height: 10,
          classification: 1,
          node: '0-0-0-0',
          index: 5,
        },
      ],
      loaded_points: 1,
      loaded_nodes: 1,
      available_nodes: 1,
      budget_limited: false,
      withheld_filtered: true,
      ground_m: c.ground_m,
      centre: c.centre,
      source_sha256: data.source_sha256,
    }
    expect(treeCropCSV(crop)).toContain('0-0-0-0,5')
    const { vertices } = treePointVertices(crop)
    expect(vertices).toHaveLength(6)
    expect(Array.from(vertices).every(Number.isFinite)).toBe(true)
    expect(vertices[2]).toBeGreaterThan(0)
  })
})
